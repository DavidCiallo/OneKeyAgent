package store

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func strPtr(s string) *string { return &s }

// TestRefreshSnapshotUpdatesReferenceData — the whole point of the pull loop: a
// model or provider edited on the main database must reach a replica that is
// already running, not just one that is bootstrapping for the first time.
func TestRefreshSnapshotUpdatesReferenceData(t *testing.T) {
	db, err := Open(t.TempDir() + "/refresh.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	// The replica starts with an old price and a provider the main database has
	// since disabled.
	if _, err := GenericInsert(db, "model", map[string]any{
		"id": "m1", "alias": "alpha", "input_price": 9.0, "cache_price": 0.0, "output_price": 9.0, "is_public": 1,
	}); err != nil {
		t.Fatalf("seed model: %v", err)
	}
	if _, err := GenericInsert(db, "provider", map[string]any{
		"id": "p1", "alias": "acme", "name": "Acme", "enabled": 1, "priority": 1,
	}); err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	// Drain what the local seed writes buffered, so the assertion below sees
	// only what the refresh itself adds.
	drain(t, db)

	counts, err := RefreshSnapshot(db, map[string]any{
		"models": []any{
			map[string]any{"id": "m1", "alias": "alpha", "input_price": 2.0, "cache_price": 0.0, "output_price": 2.0, "is_public": 1},
			// A model that exists only on the main database.
			map[string]any{"id": "m2", "alias": "beta", "input_price": 3.0, "cache_price": 0.0, "output_price": 3.0, "is_public": 1},
		},
		"providers": []any{
			map[string]any{"id": "p1", "alias": "acme", "name": "Acme", "enabled": 0, "priority": 5},
		},
	})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if counts["models"] != 2 || counts["providers"] != 1 {
		t.Fatalf("refresh applied %v, want 2 models and 1 provider", counts)
	}

	m, err := ModelFindOne(db, "m1")
	if err != nil {
		t.Fatalf("find model: %v", err)
	}
	if m.InputPrice != 2.0 {
		t.Fatalf("input_price = %v, want 2.0 — the main database's edit never arrived", m.InputPrice)
	}
	if _, err := ModelFindOne(db, "m2"); err != nil {
		t.Fatalf("model m2 added on the main database is missing locally: %v", err)
	}
	p, err := ProviderFindOne(db, "p1", false)
	if err != nil {
		t.Fatalf("find provider: %v", err)
	}
	if p.Enabled != 0 {
		t.Fatalf("provider enabled = %v, want 0 — the main database disabled it", p.Enabled)
	}

	// The refresh must not queue what it just received back to the main database.
	if rows, _, err := OutboxStats(db); err != nil || rows != 0 {
		t.Fatalf("refresh buffered %d rows, want 0 (err %v)", rows, err)
	}
}

// TestRefreshSnapshotPreservesLocalBalance — the money test.
//
// A replica deducts balance locally and buffers the deduction as a delta. The
// main database's snapshot still shows the older, higher balance, because it
// cannot know about a deduction it has not received. Reconciling writes
// snapshot + unpushed deltas — 10 + (−4) — which is exactly the local value:
// the snapshot's money arrives without refunding the unpushed spend. (Both
// alternatives lose money: "skip" would hide the main database's own changes
// forever, "copy" would hand the 4.0 straight back.)
func TestRefreshSnapshotPreservesLocalBalance(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshbal.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	snapshot := map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0},
		},
	}
	if _, err := RefreshSnapshot(db, snapshot); err != nil {
		t.Fatalf("initial refresh: %v", err)
	}

	// Local traffic spends 4.0; only the delta is buffered, the row still reads
	// 6.0 locally.
	if _, err := AccountDeductBalance(db, "acc1", 4.0); err != nil {
		t.Fatalf("deduct: %v", err)
	}

	// A later refresh carries the main database's stale balance of 10.0.
	if _, err := RefreshSnapshot(db, snapshot); err != nil {
		t.Fatalf("second refresh: %v", err)
	}

	bal, err := AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 6.0 (10 - 4); the refresh overwrote the local spend", bal)
	}

	// The deduction is still queued, so the main database will receive it.
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	found := false
	for _, e := range batch {
		if e.Table == "account" && e.Op == "delta" {
			if v, _ := toFloat(e.Payload["balance"]); v == -4.0 {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("the local deduction is not buffered; batch = %v", batch)
	}
}

// TestRefreshSnapshotMergesUsageWindowByNaturalKey — usage counters are
// additive, and usage rows are keyed by their window, not their id (ids are
// node-local: the main database's window row and this node's carry different
// ids for the same window). A refresh must merge the two into the one window
// row — main's absorbed totals plus this node's unpushed increments — instead
// of forking a second row or rolling local usage back.
func TestRefreshSnapshotMergesUsageWindowByNaturalKey(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshusage.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	// Local traffic through the real settle path: the window row gets a
	// node-local id, and the same increment is buffered as a delta.
	if err := BucketLogUsage(db, BucketLogInput{
		AccountID: "acc1", ModelAlias: "alpha", ProviderID: "p1",
		InputTokens: 30, CachedInputTokens: 0, OutputTokens: 10, Cost: 0.5,
	}); err != nil {
		t.Fatalf("local usage: %v", err)
	}
	var localID string
	var bucketTime int64
	if err := db.QueryRow(
		`SELECT id, bucket_time FROM usage_bucket WHERE account_id='acc1' AND granularity='1m'`,
	).Scan(&localID, &bucketTime); err != nil {
		t.Fatalf("local window row: %v", err)
	}

	// The main database's snapshot carries its own row for the SAME window —
	// under its own id — with the totals it has absorbed (other nodes' traffic
	// included), but not this node's unpushed 30/10.
	if _, err := RefreshSnapshot(db, map[string]any{
		"usage_buckets": []any{
			map[string]any{
				"id": "main-row-9", "account_id": "acc1", "model_alias": "alpha", "provider_id": "p1",
				"granularity": "1m", "bucket_time": bucketTime,
				"input_tokens": 100, "cached_input_tokens": 0, "output_tokens": 50,
				"cost": 1.5, "request_count": 2,
			},
		},
	}); err != nil {
		t.Fatalf("refresh must merge by the window's natural key, not fork the row: %v", err)
	}

	var rows int
	var gotID string
	var it, ot, rc int64
	var cost float64
	if err := db.QueryRow(`SELECT COUNT(*) FROM usage_bucket WHERE account_id='acc1' AND granularity='1m'`).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("%d rows for one window, want 1 — the refresh forked it by id", rows)
	}
	if err := db.QueryRow(`SELECT id, input_tokens, output_tokens, cost, request_count FROM usage_bucket
		WHERE account_id='acc1' AND granularity='1m'`).Scan(&gotID, &it, &ot, &cost, &rc); err != nil {
		t.Fatalf("read: %v", err)
	}
	if gotID != localID {
		t.Fatalf("window row id = %q, want the node-local %q", gotID, localID)
	}
	// main's absorbed totals + this node's unpushed increments.
	if it != 130 || ot != 60 || rc != 3 {
		t.Fatalf("counters = in:%d out:%d count:%d, want 130/60/3 (100/50/2 + local 30/10/1)", it, ot, rc)
	}
	if diff := cost - 2.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("cost = %v, want 2.0 (1.5 + local 0.5)", cost)
	}
}

// TestRefreshSnapshotIsRepeatable — the pull loop runs forever, so applying the
// same snapshot repeatedly must be a no-op rather than accumulating duplicates.
func TestRefreshSnapshotIsRepeatable(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshrep.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	snapshot := map[string]any{
		"models": []any{
			map[string]any{"id": "m1", "alias": "alpha", "input_price": 1.0, "cache_price": 0.0, "output_price": 1.0, "is_public": 1},
		},
	}
	for i := 0; i < 3; i++ {
		if _, err := RefreshSnapshot(db, snapshot); err != nil {
			t.Fatalf("refresh %d: %v", i, err)
		}
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM model WHERE id = 'm1'").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("model rows = %d, want 1 — the refresh duplicated the row", n)
	}
	if rows, _, err := OutboxStats(db); err != nil || rows != 0 {
		t.Fatalf("refresh buffered %d rows, want 0 (err %v)", rows, err)
	}
}

// TestRefreshSnapshotKeepsLocalSoftDelete — a row deleted locally (and buffered
// as a put) must not be resurrected by a refresh that still lists it.
func TestRefreshSnapshotKeepsLocalSoftDelete(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshdel.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := GenericInsert(db, "provider", map[string]any{
		"id": "p1", "alias": "acme", "name": "Acme", "enabled": 1, "priority": 1,
	}); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	if err := GenericSoftDelete(db, "provider", "p1"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	if _, err := RefreshSnapshot(db, map[string]any{
		"providers": []any{
			map[string]any{"id": "p1", "alias": "acme", "name": "Acme", "enabled": 1, "priority": 1},
		},
	}); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	if _, err := ProviderFindOne(db, "p1", false); err != ErrNotFound {
		t.Fatalf("provider lookup = %v, want ErrNotFound — the refresh resurrected a deleted row", err)
	}
}

// TestRefreshSnapshotAbsorbsMainSpend — the other half of the money test. The
// main database spends on its own (its snapshot drops from 10 to 7) and knows
// nothing of this node's unpushed −4. The reconciled balance is 7 + (−4) = 3 —
// the true remainder — not the old blind 6.0, which kept serving against money
// the main database had already spent.
func TestRefreshSnapshotAbsorbsMainSpend(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshspend.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	acct := func(bal float64) map[string]any {
		return map[string]any{
			"accounts": []any{
				map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": bal},
			},
		}
	}
	if _, err := RefreshSnapshot(db, acct(10.0)); err != nil {
		t.Fatalf("initial refresh: %v", err)
	}
	if _, err := AccountDeductBalance(db, "acc1", 4.0); err != nil {
		t.Fatalf("deduct: %v", err)
	}

	// Main spent 3.0 of its own; its snapshot now reads 7.0 and has NOT
	// absorbed this node's −4.
	if _, err := RefreshSnapshot(db, acct(7.0)); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	bal, err := AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 3.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 3.0 (7 + (−4)); the main database's spend did not arrive", bal)
	}

	// The deduction is still queued: the main database must receive it too.
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	found := false
	for _, e := range batch {
		if e.Table == "account" && e.Op == "delta" {
			if v, _ := toFloat(e.Payload["balance"]); v == -4.0 {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("the local deduction is not buffered; batch = %v", batch)
	}
}

// TestRefreshSnapshotAfterDeltaLands — once a deduction has been pushed and
// confirmed, the main database's snapshot already contains it. Reconciling
// must then write the snapshot value exactly: subtracting the (now empty)
// unpushed tail again would charge the account twice.
func TestRefreshSnapshotAfterDeltaLands(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshlanded.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := RefreshSnapshot(db, map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0},
		},
	}); err != nil {
		t.Fatalf("initial refresh: %v", err)
	}
	if _, err := AccountDeductBalance(db, "acc1", 4.0); err != nil {
		t.Fatalf("deduct: %v", err)
	}

	// The push succeeds: the main database applied the −4 (its balance is 6.0
	// now) and confirmed the batch.
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if err := OutboxAck(db, batch); err != nil {
		t.Fatalf("ack: %v", err)
	}

	if _, err := RefreshSnapshot(db, map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 6.0},
		},
	}); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	bal, err := AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want exactly 6.0 — an already-landed deduction must not be subtracted twice", bal)
	}
}

// TestAdditiveModesSkipAndCopy — the SYNC_ADDITIVE_MODE escape hatches keep
// their documented (and measured, see server/demo_skip_balance.py) semantics.
func TestAdditiveModesSkipAndCopy(t *testing.T) {
	orig := additiveMode
	defer func() { additiveMode = orig }()

	db, err := Open(t.TempDir() + "/refreshmodes.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	stale := map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0},
		},
	}
	spent := map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 7.0},
		},
	}

	// "skip" — the pre-reconcile behaviour: unpushed local spend is kept, but
	// the main database's own spend (10 → 7) never arrives.
	additiveMode = modeSkip
	if _, err := RefreshSnapshot(db, stale); err != nil {
		t.Fatalf("skip seed: %v", err)
	}
	if _, err := AccountDeductBalance(db, "acc1", 4.0); err != nil {
		t.Fatalf("skip deduct: %v", err)
	}
	if _, err := RefreshSnapshot(db, spent); err != nil {
		t.Fatalf("skip refresh: %v", err)
	}
	if bal, _ := AccountGetBalance(db, "acc1"); bal != 6.0 {
		t.Fatalf("skip mode balance = %v, want 6.0 (local spend kept, main's spend invisible)", bal)
	}

	// "copy" — plain overwrite: the stale snapshot's 10.0 REFUNDS the unpushed
	// 4.0 deduction. This is the hazard the mode exists to demonstrate.
	additiveMode = modeCopy
	if _, err := RefreshSnapshot(db, stale); err != nil {
		t.Fatalf("copy refresh: %v", err)
	}
	if bal, _ := AccountGetBalance(db, "acc1"); bal != 10.0 {
		t.Fatalf("copy mode balance = %v, want 10.0 (the snapshot refunding unpushed spend)", bal)
	}
}

// TestRefreshSnapshotSettingsMatchedByKey — settings rows are keyed by their
// name; each node generates its own row id for the same setting. The refresh
// must update the local row rather than insert a second one (which trips the
// unique index and aborts the whole refresh).
func TestRefreshSnapshotSettingsMatchedByKey(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshsettings.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := db.Exec(`INSERT INTO settings (id, key, value, create_time, update_time, delete_time)
		VALUES ('local-1','theme','dark',1,1,NULL)`); err != nil {
		t.Fatalf("seed setting: %v", err)
	}
	if _, err := RefreshSnapshot(db, map[string]any{
		"settings": []any{
			map[string]any{"id": "main-9", "key": "theme", "value": "light"},
		},
	}); err != nil {
		t.Fatalf("refresh must merge by key, not fork the row: %v", err)
	}

	var rows int
	var id, value string
	if err := db.QueryRow("SELECT COUNT(*) FROM settings WHERE key = 'theme'").Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("%d rows for the setting, want 1", rows)
	}
	if err := db.QueryRow("SELECT id, value FROM settings WHERE key = 'theme'").Scan(&id, &value); err != nil {
		t.Fatalf("read: %v", err)
	}
	if value != "light" {
		t.Fatalf("value = %q, want \"light\" (the main database's edit)", value)
	}
	if id != "local-1" {
		t.Fatalf("id = %q, want the node-local \"local-1\" kept", id)
	}
}

// TestRefreshSnapshotConcurrentDeductLosesNothing — traffic does not stop for
// the pull loop. A deduction landing while a snapshot is being applied must be
// billed locally AND buffered (the buffer entry is what makes the main
// database collect it), and an admin edit in the same window must still be
// queued. The old refresh used to suppress the buffer for the whole window:
// the deduction committed silently and nobody ever collected the money.
func TestRefreshSnapshotConcurrentDeductLosesNothing(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshrace.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	// A wide snapshot, so the refresh takes long enough to overlap traffic.
	accounts := []any{map[string]any{"id": "acc000", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0}}
	for i := 1; i < 300; i++ {
		accounts = append(accounts, map[string]any{
			"id": fmt.Sprintf("acc%03d", i), "name": "u", "email": fmt.Sprintf("u%d@example.com", i),
			"api_key": fmt.Sprintf("sk-%d", i), "balance": 10.0,
		})
	}
	snap := map[string]any{
		"accounts": accounts,
		"providers": []any{
			map[string]any{"id": "p1", "alias": "acme", "name": "Acme", "enabled": 1, "priority": 1},
		},
	}
	if _, err := RefreshSnapshot(db, snap); err != nil {
		t.Fatalf("seed refresh: %v", err)
	}
	drain(t, db) // assertions below are about what the traffic itself buffers

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 20; i++ {
			if _, err := AccountDeductBalance(db, "acc000", 0.01); err != nil {
				t.Errorf("deduct %d: %v", i, err)
			}
			time.Sleep(2 * time.Millisecond)
		}
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond)
		if err := GenericUpdateByID(db, "provider", "p1", map[string]any{"name": "edited mid-refresh"}); err != nil {
			t.Errorf("provider edit: %v", err)
		}
	}()

	if _, err := RefreshSnapshot(db, snap); err != nil {
		t.Fatalf("refresh under traffic: %v", err)
	}
	wg.Wait()

	bal, err := AccountGetBalance(db, "acc000")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 9.8; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 9.8 (10 − 20×0.01)", bal)
	}
	// Every deduction must have its delta: the same total has to be sitting in
	// the buffer, or the main database will never collect it.
	batch, err := OutboxBatch(db, 1000, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	delta, edit := 0.0, false
	for _, e := range batch {
		switch {
		case e.Table == "account" && e.Op == "delta":
			if v, _ := toFloat(e.Payload["balance"]); v != 0 {
				delta += v
			}
		case e.Table == "provider" && e.Op == "put":
			if s, _ := e.Payload["name"].(string); s == "edited mid-refresh" {
				edit = true
			}
		}
	}
	if diff := delta + 0.2; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("buffered balance delta = %v, want −0.20 — deductions landing mid-refresh lost their delta", delta)
	}
	if !edit {
		t.Fatalf("the concurrent admin edit is not buffered: %v", batch)
	}
}
