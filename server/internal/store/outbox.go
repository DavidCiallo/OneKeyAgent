package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"onekey/server/internal/cryptox"
)

// Outbox — the durable buffer between a replica node and the main database.
//
// A replica serves traffic locally and records every change the main database
// needs to see. Changes collapse per (row, op), so a busy account produces one
// entry per sync cycle rather than one per request, and the buffer is pushed as
// a single batch once it is large enough or old enough.
//
// Two kinds of change, because they need different merge semantics:
//
//	put   — an absolute row snapshot from an admin edit (a model's price, a
//	        provider's enabled flag). Later writes replace earlier ones per
//	        column, so only the newest state has to travel.
//	delta — an increment to a counter many requests contribute to concurrently
//	        (a balance deduction, a usage window). These must be summed, never
//	        overwritten, or a delayed batch would erase traffic that landed in
//	        between.
//
// That distinction is why a replica can be read-mostly for balances without
// losing money: deltas accumulate on both sides.

// Additive columns are signed changes: a deduction is a negative balance delta.
// The main database applies balance = MAX(balance + delta, 0), which is exactly
// the floor the local deduction uses, so several nodes can each deduct to the
// limit without the sum going negative.

// additiveCols — columns that merge by addition. A put never carries them; a
// delta always does.
var additiveCols = map[string]map[string]bool{
	"account": {
		"balance": true,
	},
	"usage_bucket": {
		"input_tokens":        true,
		"cached_input_tokens": true,
		"output_tokens":       true,
		"cost":                true,
		"request_count":       true,
	},
}

// deltaKeyCols — the columns that locate a delta's row on the main database.
// usage_bucket uses its natural window key rather than the node-local id, so
// every replica's traffic for one window lands in the same row.
var deltaKeyCols = map[string][]string{
	"account":      {"id"},
	"usage_bucket": {"account_id", "model_alias", "provider_id", "granularity", "bucket_time"},
}

// floorAtZeroCols — delta columns that may not go below zero. The main database
// applies the same floor the local deduction does, so concurrent deductions
// from several nodes can never overdraft.
var floorAtZeroCols = map[string]bool{"balance": true}

// ─────────────────── enable switch ───────────────────

// syncPutTables — tables whose changes are buffered as absolute row snapshots.
// These are admin-owned reference data: a replica reads them, and an edit made
// anywhere is a whole-value change.
//
// gift_card and transaction are here despite being written by user actions
// rather than the admin UI. A redemption or an invoice created on a replica
// would otherwise stay invisible to the main database: the card would still
// read as unused there, and with an ephemeral replica volume a re-bootstrap
// would hand the same card back for a second redemption.
var syncPutTables = map[string]bool{
	"model": true, "provider": true, "role": true, "account_role": true,
	"account": true, "settings": true, "gift_card": true, "transaction": true,
}

// syncDeltaTables — tables whose changes are buffered as increments. Usage
// windows and balances are written by concurrent requests, so their changes must
// accumulate on the main database rather than overwrite.
var syncDeltaTables = map[string]bool{
	"account": true, "usage_bucket": true,
}

var outboxEnabled struct {
	mu sync.RWMutex
	v  bool
}

// SetOutboxEnabled — set once at startup when MAIN_DB_URL is configured. The
// main node leaves it off: it must not buffer its own writes, or it would push
// them back to itself.
func SetOutboxEnabled(v bool) {
	outboxEnabled.mu.Lock()
	outboxEnabled.v = v
	outboxEnabled.mu.Unlock()
}

// OutboxOn reports whether this node buffers changes for a main database.
func OutboxOn() bool {
	outboxEnabled.mu.RLock()
	defer outboxEnabled.mu.RUnlock()
	return outboxEnabled.v
}

// suppressDepth > 0 while this node is applying data that came *from* the main
// database (bootstrap import). Buffering those would echo them straight back.
var suppressMu sync.Mutex
var suppressDepth int

// SuppressOutbox runs fn with change buffering disabled, for the duration of a
// bootstrap import. Not safe to nest across goroutines, which is fine: it is
// only used during single-threaded startup.
func SuppressOutbox(fn func() error) error {
	suppressMu.Lock()
	suppressDepth++
	suppressMu.Unlock()
	defer func() {
		suppressMu.Lock()
		suppressDepth--
		suppressMu.Unlock()
	}()
	return fn()
}

func outboxPaused() bool {
	suppressMu.Lock()
	defer suppressMu.Unlock()
	return suppressDepth > 0
}

var outboxSeqMu sync.Mutex
var outboxSeqCache int64

// ─────────────────── payload encoding ───────────────────

// decodePayload keeps integers integral. A plain json.Unmarshal into any turns
// every number into float64, which would turn token counters into floats and
// accumulate drift over a long-lived window.
func decodePayload(s string) map[string]any {
	out := map[string]any{}
	if s == "" {
		return out
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(s)))
	dec.UseNumber()
	if err := dec.Decode(&out); err != nil {
		return map[string]any{}
	}
	return out
}

func encodePayload(m map[string]any) (string, error) {
	b, err := json.Marshal(m)
	return string(b), err
}

// ─────────────────── enqueue ───────────────────

func nextOutboxSeq(db *sql.DB) (int64, error) {
	if outboxSeqCache == 0 {
		if err := db.QueryRow("SELECT COALESCE(MAX(seq), 0) FROM outbox").Scan(&outboxSeqCache); err != nil {
			return 0, err
		}
	}
	outboxSeqCache++
	return outboxSeqCache, nil
}

// nextOutboxSeqTx — same, inside a caller's transaction so the sequence reflects
// a buffer write that is about to commit with it.
func nextOutboxSeqTx(tx *sql.Tx) (int64, error) {
	if outboxSeqCache == 0 {
		if err := tx.QueryRow("SELECT COALESCE(MAX(seq), 0) FROM outbox").Scan(&outboxSeqCache); err != nil {
			return 0, err
		}
	}
	outboxSeqCache++
	return outboxSeqCache, nil
}

// EnqueuePut records an absolute change to a row.
//
// Collapses with any buffered put for the same row, later column winning, and
// keeps the original sequence number so a continuously-edited row can't be
// starved. Additive columns are dropped: those travel as deltas only.
func EnqueuePut(db *sql.DB, table, rowID string, payload map[string]any) error {
	if !OutboxOn() || outboxPaused() || rowID == "" {
		return nil
	}
	clean := map[string]any{}
	for k, v := range payload {
		if k == "id" || additiveCols[table][k] {
			continue
		}
		clean[k] = v
	}
	if len(clean) == 0 {
		return nil
	}
	return mergeOutboxEntry(db, table, rowID, "put", clean, false)
}

// EnqueueDelta records an increment to a row's counters.
//
// rowID is the collapse key (see deltaKeyCols); payload must carry both the key
// columns and the additive columns.
func EnqueueDelta(db *sql.DB, table, rowID string, payload map[string]any) error {
	if !OutboxOn() || outboxPaused() || rowID == "" {
		return nil
	}
	for _, k := range deltaKeyCols[table] {
		if _, ok := payload[k]; !ok {
			return fmt.Errorf("EnqueueDelta %s: payload missing key column %s", table, k)
		}
	}
	return mergeOutboxEntry(db, table, rowID, "delta", payload, true)
}

// mergeOutboxEntry inserts or folds one buffered change in its own transaction.
func mergeOutboxEntry(db *sql.DB, table, rowID, op string, payload map[string]any, sum bool) error {
	outboxSeqMu.Lock()
	defer outboxSeqMu.Unlock()

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := mergeOutboxEntryTx(tx, table, rowID, op, payload, sum); err != nil {
		return err
	}
	return tx.Commit()
}

// mergeOutboxEntryTx folds a change into the buffer inside a caller's
// transaction, so a write and the record of it to sync commit together. The
// money paths (balance deduction, usage windows) rely on that atomicity: a
// crash must not commit a deduction whose delta never gets buffered.
func mergeOutboxEntryTx(tx *sql.Tx, table, rowID, op string, payload map[string]any, sum bool) error {
	var oldJSON string
	err := tx.QueryRow("SELECT payload FROM outbox WHERE table_name = ? AND row_id = ? AND op = ?",
		table, rowID, op).Scan(&oldJSON)

	switch {
	case err == sql.ErrNoRows:
		seq, serr := nextOutboxSeqTx(tx)
		if serr != nil {
			return serr
		}
		encoded, merr := encodePayload(payload)
		if merr != nil {
			return merr
		}
		now := Now()
		_, err := tx.Exec(`INSERT INTO outbox (id, table_name, row_id, op, payload, seq, create_time, update_time, delete_time)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			cryptox.Nanoid(8), table, rowID, op, encoded, seq, now, now)
		return err
	case err != nil:
		return err
	}

	merged := decodePayload(oldJSON)
	for k, v := range payload {
		if sum && additiveCols[table][k] {
			merged[k] = addNumeric(merged[k], v)
		} else {
			merged[k] = v
		}
	}
	encoded, merr := encodePayload(merged)
	if merr != nil {
		return merr
	}
	_, err = tx.Exec("UPDATE outbox SET payload = ?, update_time = ? WHERE table_name = ? AND row_id = ? AND op = ?",
		encoded, Now(), table, rowID, op)
	return err
}

// BucketDeltaRowID — the collapse key for a usage-bucket delta, matching the
// unique index on the main database.
func BucketDeltaRowID(accountID, alias, providerID, gran string, bucketTime int64) string {
	return fmt.Sprintf("%s|%s|%s|%s|%d", accountID, alias, providerID, gran, bucketTime)
}

// addNumeric sums two decoded numbers, keeping the result integral when both
// operands were integral.
func addNumeric(a, b any) any {
	av, aok := toFloat(a)
	bv, bok := toFloat(b)
	if !aok {
		return b
	}
	if !bok {
		return a
	}
	ai, aInt := toInt(a)
	bi, bInt := toInt(b)
	if aInt && bInt {
		return ai + bi
	}
	return av + bv
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	}
	return 0, false
}

func toInt(v any) (int64, bool) {
	switch x := v.(type) {
	case int:
		return int64(x), true
	case int64:
		return x, true
	case json.Number:
		i, err := x.Int64()
		return i, err == nil
	case float64:
		if x == float64(int64(x)) {
			return int64(x), true
		}
	}
	return 0, false
}

// ─────────────────── batch read / acknowledge ───────────────────

// OutboxEntry — one buffered change.
type OutboxEntry struct {
	Seq     int64          `json:"seq"`
	Table   string         `json:"table"`
	RowID   string         `json:"row_id"`
	Op      string         `json:"op"`
	Payload map[string]any `json:"payload"`
}

// OutboxBatch — the oldest buffered changes in sequence order, bounded by both
// row count and total payload bytes so one push stays a reasonable body.
func OutboxBatch(db *sql.DB, maxRows int, maxBytes int) ([]OutboxEntry, error) {
	if maxRows <= 0 {
		maxRows = 500
	}
	if maxBytes <= 0 {
		maxBytes = 2 << 20 // 2 MiB
	}
	rows, err := db.Query(`SELECT seq, table_name, row_id, op, payload FROM outbox ORDER BY seq ASC LIMIT ?`, maxRows)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []OutboxEntry{}
	bytes := 0
	for rows.Next() {
		var (
			e       OutboxEntry
			payload string
		)
		if err := rows.Scan(&e.Seq, &e.Table, &e.RowID, &e.Op, &payload); err != nil {
			return nil, err
		}
		if len(out) > 0 && bytes+len(payload) > maxBytes {
			break // the remainder goes in the next cycle
		}
		bytes += len(payload)
		e.Payload = decodePayload(payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// OutboxAck — drop entries the main database confirmed, up to and including
// upToSeq. Entries added after the batch was read have a higher seq and survive.
func OutboxAck(db *sql.DB, upToSeq int64) error {
	if upToSeq <= 0 {
		return nil
	}
	if _, err := db.Exec("DELETE FROM outbox WHERE seq <= ?", upToSeq); err != nil {
		return err
	}
	return SetNodeState(db, "last_pushed_seq", fmt.Sprintf("%d", upToSeq))
}

// OutboxStats — buffered row count and payload bytes, for the flush threshold.
func OutboxStats(db *sql.DB) (rows int64, bytes int64, err error) {
	err = db.QueryRow("SELECT COUNT(*), COALESCE(SUM(LENGTH(payload)), 0) FROM outbox").Scan(&rows, &bytes)
	return rows, bytes, err
}

// ─────────────────── apply (main database side) ───────────────────

// ApplyOutbox applies one received entry in its own transaction.
func ApplyOutbox(db *sql.DB, e OutboxEntry) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := ApplyOutboxTx(tx, e); err != nil {
		return err
	}
	return tx.Commit()
}

// ApplyOutboxTx applies one received entry inside a caller's transaction, so a
// whole batch lands together or not at all.
func ApplyOutboxTx(tx *sql.Tx, e OutboxEntry) error {
	switch e.Op {
	case "put":
		return applyPut(tx, e)
	case "delta":
		return applyDelta(tx, e)
	}
	return fmt.Errorf("unknown outbox op %q", e.Op)
}

// execer — a *sql.DB or *sql.Tx, whichever the apply helpers were handed.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// putConflictCols — how an incoming put is matched to an existing row. Most
// tables match on id, but settings is keyed by its name: every node generates
// its own row id for the same setting, so matching on id would insert a second
// row and violate the unique index on settings(key).
var putConflictCols = map[string]string{
	"settings": "key",
}

func applyPut(x execer, e OutboxEntry) error {
	if updatable[e.Table] == nil {
		return fmt.Errorf("unknown table %s", e.Table)
	}
	now := Now()
	conflictCol := putConflictCols[e.Table]
	cols := []string{"id"}
	args := []any{cryptox.Nanoid(8)}
	if conflictCol == "" {
		args[0] = e.RowID // match on the row id
	} else if v, has := e.Payload[conflictCol]; has {
		cols = append(cols, conflictCol)
		args = append(args, v)
	} else {
		return fmt.Errorf("put %s/%s missing key column %s", e.Table, e.RowID, conflictCol)
	}

	for _, c := range append(append([]string{}, updatable[e.Table]...), "create_time", "update_time", "delete_time") {
		v, has := e.Payload[c]
		if !has {
			continue
		}
		cols = append(cols, c)
		args = append(args, v)
	}
	if _, has := e.Payload["create_time"]; !has {
		cols = append(cols, "create_time")
		args = append(args, now)
	}
	if _, has := e.Payload["update_time"]; !has {
		cols = append(cols, "update_time")
		args = append(args, now)
	}

	sets := make([]string, 0, len(cols))
	for _, c := range cols {
		if c == "id" {
			continue
		}
		sets = append(sets, c+" = excluded."+c)
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(cols)), ",")

	if conflictCol == "" {
		_, err := x.Exec(
			fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s) ON CONFLICT(id) DO UPDATE SET %s`,
				e.Table, strings.Join(cols, ","), ph, strings.Join(sets, ", ")),
			args...)
		return err
	}
	// Natural-key tables: find the existing row first, update it in place,
	// otherwise insert. Two statements rather than an ON CONFLICT target so the
	// node-local id is preserved when the row already exists.
	var existingID string
	if err := x.QueryRow(fmt.Sprintf(`SELECT id FROM "%s" WHERE %s = ? LIMIT 1`, e.Table, conflictCol),
		e.Payload[conflictCol]).Scan(&existingID); err == nil && existingID != "" {
		sets := []string{}
		uargs := []any{}
		for i, c := range cols {
			if c == "id" {
				continue
			}
			sets = append(sets, c+" = ?")
			uargs = append(uargs, args[i])
		}
		uargs = append(uargs, existingID)
		_, err := x.Exec(fmt.Sprintf(`UPDATE "%s" SET %s WHERE id = ?`, e.Table, strings.Join(sets, ", ")), uargs...)
		return err
	} else if err != nil && err != sql.ErrNoRows {
		return err
	}
	_, err := x.Exec(
		fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s)`, e.Table, strings.Join(cols, ","), ph),
		args...)
	return err
}

func applyDelta(x execer, e OutboxEntry) error {
	keys := deltaKeyCols[e.Table]
	if len(keys) == 0 {
		return fmt.Errorf("no delta key for table %s", e.Table)
	}
	keyVals := make([]any, 0, len(keys))
	keyConds := make([]string, 0, len(keys))
	for _, k := range keys {
		v, has := e.Payload[k]
		if !has {
			return fmt.Errorf("delta %s/%s missing key column %s", e.Table, e.RowID, k)
		}
		keyConds = append(keyConds, k+" = ?")
		keyVals = append(keyVals, v)
	}

	// The row may not exist yet: the replica created it locally and only the
	// delta was buffered. Ensure it exists first (ON CONFLICT DO NOTHING leaves
	// an existing row alone) so the UPDATE below has a target.
	if err := ensureDeltaRow(x, e.Table, keys, keyVals); err != nil {
		return err
	}

	now := Now()
	// Placeholder order follows the statement: SET values, update_time, then the
	// WHERE key values.
	setExprs := []string{}
	setArgs := []any{}
	for _, c := range sortedCols(additiveCols[e.Table]) {
		v, has := e.Payload[c]
		if !has {
			continue
		}
		if floorAtZeroCols[c] {
			setExprs = append(setExprs, fmt.Sprintf("%s = MAX(%s + ?, 0)", c, c))
		} else {
			setExprs = append(setExprs, fmt.Sprintf("%s = %s + ?", c, c))
		}
		setArgs = append(setArgs, v)
	}
	if len(setExprs) == 0 {
		return nil
	}
	setExprs = append(setExprs, "update_time = ?")
	setArgs = append(setArgs, now)

	args := append(setArgs, keyVals...)
	_, err := x.Exec(
		fmt.Sprintf(`UPDATE "%s" SET %s WHERE %s`, e.Table, strings.Join(setExprs, ", "), strings.Join(keyConds, " AND ")),
		args...)
	return err
}

// ensureDeltaRow inserts the key columns of a delta if the row is absent. When
// the key is the row id, the payload's id becomes the new row's id; otherwise a
// generated id is used (usage_bucket rows are located by their window columns
// on every node, so the id itself is node-local).
func ensureDeltaRow(x execer, table string, keys []string, keyVals []any) error {
	cols := []string{"id"}
	args := []any{}
	if keys[0] == "id" {
		args = append(args, keyVals[0])
	} else {
		args = append(args, cryptox.Nanoid(8))
	}
	for i, k := range keys {
		if k == "id" {
			continue
		}
		cols = append(cols, k)
		args = append(args, keyVals[i])
	}
	now := Now()
	cols = append(cols, "create_time", "update_time")
	args = append(args, now, now)

	ph := strings.TrimSuffix(strings.Repeat("?,", len(cols)), ",")
	_, err := x.Exec(
		fmt.Sprintf(`INSERT INTO "%s" (%s) VALUES (%s) ON CONFLICT DO NOTHING`,
			table, strings.Join(cols, ","), ph),
		args...)
	return err
}

// sortedCols — deterministic column order, so a delta's SQL is stable.
func sortedCols(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// ─────────────────── bootstrap import ───────────────────

// bootstrapTables — what a starting replica imports, and the key each payload
// uses. Reference data plus billing state; not the node-local audit trail.
var bootstrapTables = [][2]string{
	{"account", "accounts"},
	{"model", "models"},
	{"provider", "providers"},
	{"role", "roles"},
	{"account_role", "account_roles"},
	{"settings", "settings"},
	{"gift_card", "gift_cards"},
	{"usage_bucket", "usage_buckets"},
	{"transaction", "transactions"},
}

// ImportSnapshot loads a main-database snapshot into a fresh replica.
//
// It runs only once per node: a restart on a persistent volume must keep the
// local rows, because they carry deltas the main database has not received yet
// (re-importing would roll those back to the main database's older values). A
// redeploy onto an empty volume has no local state and imports normally.
//
// The import runs with the outbox suppressed, so rows arriving from the main
// database are not queued straight back to it.
func ImportSnapshot(db *sql.DB, data map[string]any) (map[string]int, error) {
	if done, err := GetNodeState(db, "bootstrapped"); err != nil {
		return nil, err
	} else if done == "1" {
		return map[string]int{}, nil
	}

	counts := map[string]int{}
	err := SuppressOutbox(func() error {
		for _, t := range bootstrapTables {
			items, _ := data[t[1]].([]any)
			rows := make([]map[string]any, 0, len(items))
			for _, it := range items {
				if m, ok := it.(map[string]any); ok {
					rows = append(rows, m)
				}
			}
			if len(rows) == 0 {
				continue
			}
			n, err := BatchInsertRows(db, t[0], rows)
			if err != nil {
				return fmt.Errorf("bootstrap %s: %w", t[0], err)
			}
			counts[t[1]] = n
		}
		InvalidateRefCache()
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := SetNodeState(db, "bootstrapped", "1"); err != nil {
		return nil, err
	}
	return counts, nil
}

// ─────────────────── node_state ───────────────────

// SetNodeState — per-node bookkeeping key/value.
func SetNodeState(db *sql.DB, key, value string) error {
	now := Now()
	_, err := db.Exec(`INSERT INTO node_state (id, value, create_time, update_time, delete_time)
		VALUES (?, ?, ?, ?, NULL)
		ON CONFLICT(id) DO UPDATE SET value = excluded.value, update_time = excluded.update_time`,
		key, value, now, now)
	return err
}

// GetNodeState — read a bookkeeping value ("" when unset).
func GetNodeState(db *sql.DB, key string) (string, error) {
	var v string
	err := db.QueryRow("SELECT value FROM node_state WHERE id = ?", key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}
