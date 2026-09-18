package store

import (
	"database/sql"
	"testing"
)

func strPtr(s string) *string { return &s }

// maxSeq — the highest buffered sequence, used to drain the outbox in tests.
func maxSeq(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	batch, err := OutboxBatch(db, 1000, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	var max int64
	for _, e := range batch {
		if e.Seq > max {
			max = e.Seq
		}
	}
	return max
}

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
	if err := OutboxAck(db, maxSeq(t, db)); err != nil {
		t.Fatalf("ack: %v", err)
	}

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
// main database's snapshot still shows the older, higher balance. Refreshing
// must NOT write that snapshot value over the local one, or the node would be
// handing out balance it has already spent (and, once the delta lands, the
// account would be credited the spend back).
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

// TestRefreshSnapshotPreservesUsageCounters — usage_bucket counters are additive
// too. A replica's own served traffic must survive a refresh, or its reported
// token totals would silently fall back to the main database's older window.
func TestRefreshSnapshotPreservesUsageCounters(t *testing.T) {
	db, err := Open(t.TempDir() + "/refreshusage.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := GenericInsert(db, "usage_bucket", map[string]any{
		"id": "b1", "account_id": "acc1", "model_alias": "alpha", "provider_id": "p1",
		"granularity": "hour", "bucket_time": int64(1000),
		"input_tokens": 100, "cached_input_tokens": 0, "output_tokens": 50,
		"cost": 1.5, "request_count": 2,
	}); err != nil {
		t.Fatalf("seed bucket: %v", err)
	}
	// Local traffic adds to the same window.
	if err := EnqueueDelta(db, "usage_bucket",
		BucketDeltaRowID("acc1", "alpha", "p1", "hour", 1000), map[string]any{
			"account_id": "acc1", "model_alias": "alpha", "provider_id": "p1",
			"granularity": "hour", "bucket_time": int64(1000),
			"input_tokens": 30, "output_tokens": 10, "cost": 0.5, "request_count": 1,
		}); err != nil {
		t.Fatalf("enqueue delta: %v", err)
	}

	// The main database's snapshot has the older counters.
	if _, err := RefreshSnapshot(db, map[string]any{
		"usage_buckets": []any{
			map[string]any{
				"id": "b1", "account_id": "acc1", "model_alias": "alpha", "provider_id": "p1",
				"granularity": "hour", "bucket_time": int64(1000),
				"input_tokens": 100, "cached_input_tokens": 0, "output_tokens": 50,
				"cost": 1.5, "request_count": 2,
			},
		},
	}); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	var got *UsageBucket
	if _, err := BucketEach(db, BucketFilter{AccountID: strPtr("acc1")}, func(b *UsageBucket) bool {
		got = b
		return false
	}); err != nil {
		t.Fatalf("read bucket: %v", err)
	}
	if got == nil {
		t.Fatalf("usage bucket is missing after the refresh")
	}
	// The added quota lives on the replica until it is pushed, so locally the
	// counters must still be 100/50 — the refresh must not roll them back.
	if got.InputTokens != 100 || got.OutputTokens != 50 {
		t.Fatalf("counters = %d/%d, want 100/50 — the refresh rolled back local usage",
			got.InputTokens, got.OutputTokens)
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
