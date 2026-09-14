package api

import (
	"crypto/subtle"
	"fmt"
	"os"

	"onekey/server/internal/httpx"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

// ─────────────────── node sync (replica ⇄ main database) ───────────────────
//
// A replica pulls a bootstrap snapshot once at startup and then pushes batches
// of locally-buffered changes. Both directions are authenticated with a shared
// SYNC_SECRET: these endpoints move whole tables, so they must never be
// reachable with a normal account token.
//
// The main node serves this API; a replica only calls it. See store/outbox.go
// for the buffering rules and the put/delta distinction.

// syncTables — what a bootstrap snapshot contains. Reference data plus the
// billing state a replica needs to serve correctly; not the node-local audit
// trail or its unsent buffer.
var syncTables = []struct {
	table  string
	key    string
	ignore bool // include soft-deleted rows?
}{
	{"account", "accounts", false},
	{"model", "models", false},
	{"provider", "providers", false},
	{"role", "roles", false},
	{"account_role", "account_roles", false},
	{"settings", "settings", false},
	{"gift_card", "gift_cards", false},
	{"usage_bucket", "usage_buckets", false},
	{"transaction", "transactions", false},
}

// requireSyncAuth — constant-time comparison against SYNC_SECRET. An empty
// configured secret disables the endpoints entirely rather than leaving them
// open.
func requireSyncAuth(c *httpx.Ctx) error {
	want := os.Getenv("SYNC_SECRET")
	if want == "" {
		return fmt.Errorf("sync is not configured on this node")
	}
	got := c.Auth
	if got == "" {
		got = c.Str("secret")
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		return fmt.Errorf("sync authorization failed")
	}
	return nil
}

// syncSnapshot — the bootstrap payload a starting replica pulls. Served by the
// main node.
//
// Returns a bare body (not the {success,data} envelope): this is a
// machine-to-machine endpoint, and the replica parses the payload directly.
func (a *App) syncSnapshot(c *httpx.Ctx) (any, error) {
	if err := requireSyncAuth(c); err != nil {
		return nil, err
	}
	data := map[string]any{}
	for _, t := range syncTables {
		rows, err := store.AllRowsIgnoreDelete(a.DB, t.table)
		if err != nil {
			return nil, err
		}
		alive := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			if !t.ignore {
				if dt, has := r["delete_time"]; has && dt != nil {
					continue
				}
			}
			alive = append(alive, r)
		}
		data[t.key] = alive
	}
	return raw(map[string]any{
		"version":      1,
		"generated_at": store.Now(),
		"node":         os.Getenv("NODE_ID"),
		"data":         data,
	}), nil
}

// syncBootstrapImport — apply a snapshot locally. Runs with the outbox
// suppressed, so the rows just received are not immediately queued back.
func (a *App) applySnapshot(payload map[string]any) (map[string]int, error) {
	counts := map[string]int{}
	err := store.SuppressOutbox(func() error {
		for _, t := range syncTables {
			items, _ := payload[t.key].([]any)
			rows := make([]map[string]any, 0, len(items))
			for _, it := range items {
				if m, ok := it.(map[string]any); ok {
					rows = append(rows, m)
				}
			}
			if len(rows) == 0 {
				continue
			}
			n, err := store.BatchInsertRows(a.DB, t.table, rows)
			if err != nil {
				return fmt.Errorf("bootstrap %s: %w", t.table, err)
			}
			counts[t.key] = n
		}
		store.InvalidateRefCache()
		return nil
	})
	return counts, err
}

// syncPush — apply a batch of a replica's changes. Served by the main node.
//
// The batch is applied in one transaction, so either all of a replica's changes
// land or none do and it retries the same batch: no partial application to
// reason about.
func (a *App) syncPush(c *httpx.Ctx) (any, error) {
	if err := requireSyncAuth(c); err != nil {
		return nil, err
	}
	rawEntries := c.Arr("entries")
	entries := make([]store.OutboxEntry, 0, len(rawEntries))
	for _, r := range rawEntries {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		e := store.OutboxEntry{
			Table:   strOf(m["table"]),
			RowID:   strOf(m["row_id"]),
			Op:      strOf(m["op"]),
			Payload: map[string]any{},
		}
		if p, ok := m["payload"].(map[string]any); ok {
			e.Payload = p
		}
		if s, ok := m["seq"]; ok {
			if v, ok := toInt64(s); ok {
				e.Seq = v
			}
		}
		if e.Table == "" || e.Op == "" {
			return nil, fmt.Errorf("malformed sync entry")
		}
		entries = append(entries, e)
	}

	tx, err := a.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, e := range entries {
		if err := store.ApplyOutboxTx(tx, e); err != nil {
			return nil, fmt.Errorf("apply %s/%s (%s): %w", e.Table, e.RowID, e.Op, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	store.InvalidateRefCache()

	// Report the highest sequence applied so the replica can trim its buffer.
	var maxSeq int64
	for _, e := range entries {
		if e.Seq > maxSeq {
			maxSeq = e.Seq
		}
	}
	return raw(map[string]any{"applied": len(entries), "up_to_seq": maxSeq}), nil
}

func strOf(v any) string {
	s, _ := v.(string)
	return s
}

func toInt64(v any) (int64, bool) {
	switch x := v.(type) {
	case float64:
		return int64(x), true
	case int64:
		return x, true
	case int:
		return int64(x), true
	}
	return 0, false
}

// syncStatus — a replica's own view of the buffer, for the admin UI and for
// smoke tests.
func (a *App) syncStatus(c *httpx.Ctx) (any, error) {
	rows, bytes, err := store.OutboxStats(a.DB)
	if err != nil {
		return nil, err
	}
	last, err := store.GetNodeState(a.DB, "last_pushed_seq")
	if err != nil {
		return nil, err
	}
	mainURL := os.Getenv("MAIN_DB_URL")
	return map[string]any{
		"replica":         mainURL != "",
		"main_url":        mainURL,
		"node_id":         os.Getenv("NODE_ID"),
		"pending_rows":    rows,
		"pending_bytes":   bytes,
		"last_pushed_seq": last,
	}, nil
}

// syncTrigger — force a flush now (admin convenience: "push my changes").
func (a *App) syncTrigger(c *httpx.Ctx) (any, error) {
	if _, err := service.RequireAdmin(a.DB, c.Auth); err != nil {
		return nil, err
	}
	if a.Syncer == nil {
		return map[string]any{"skipped": "this node is not a replica"}, nil
	}
	if err := a.Syncer.Flush(); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}
