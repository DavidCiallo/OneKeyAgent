package store

import "testing"

// TestImportSnapshotRunsOnce — the bootstrap import must not repeat on a restart.
//
// A replica on a persistent volume holds deltas the main database has not
// received yet (a locally-served request that was billed but not pushed). If a
// restart re-imported the snapshot, those rows would be rolled back to main's
// older values and the spend would silently disappear.
func TestImportSnapshotRunsOnce(t *testing.T) {
	path := t.TempDir() + "/boot.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	snapshot := map[string]any{
		"accounts": []any{
			map[string]any{"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0},
		},
		"models": []any{
			map[string]any{"id": "m1", "alias": "alpha", "input_price": 1.0, "cache_price": 0.0, "output_price": 1.0, "is_public": 1},
		},
	}
	counts, err := ImportSnapshot(db, snapshot)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if counts["accounts"] != 1 || counts["models"] != 1 {
		t.Fatalf("imported %v, want an account and a model", counts)
	}

	// The bootstrap must not queue the imported rows back to the main database.
	if rows, _, err := OutboxStats(db); err != nil || rows != 0 {
		t.Fatalf("bootstrap buffered %d rows, want 0 (err %v)", rows, err)
	}

	// Local traffic then spends from the bootstrapped balance.
	if _, err := AccountDeductBalance(db, "acc1", 4.0); err != nil {
		t.Fatalf("deduct: %v", err)
	}

	// A restart re-imports nothing, so the local spend survives.
	counts, err = ImportSnapshot(db, snapshot)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if len(counts) != 0 {
		t.Fatalf("second import applied %v, want nothing", counts)
	}
	bal, err := AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 6.0 (10 - 4); a re-import rolled it back", bal)
	}

	// And the deduction is still queued for the main database.
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	foundDelta := false
	for _, e := range batch {
		if e.Table == "account" && e.Op == "delta" {
			if v, _ := toFloat(e.Payload["balance"]); v == -4.0 {
				foundDelta = true
			}
		}
	}
	if !foundDelta {
		t.Fatalf("the local deduction is not buffered; batch = %v", batch)
	}
}

// TestImportSnapshotRefreshesReferenceData — the snapshot is authoritative for
// reference rows, so a re-import (on a fresh volume) must not leave a stale
// model price behind from a previous write.
func TestImportSnapshotRefreshesReferenceData(t *testing.T) {
	db, err := Open(t.TempDir() + "/bootref.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := GenericInsert(db, "model", map[string]any{
		"id": "m1", "alias": "alpha", "input_price": 9.0, "cache_price": 0.0, "output_price": 9.0, "is_public": 1,
	}); err != nil {
		t.Fatalf("seed model: %v", err)
	}

	// The import overwrites by id (the fresh-volume case), not skip-on-exist.
	if _, err := ImportSnapshot(db, map[string]any{
		"models": []any{
			map[string]any{"id": "m1", "alias": "alpha", "input_price": 2.0, "cache_price": 0.0, "output_price": 2.0, "is_public": 1},
		},
	}); err != nil {
		t.Fatalf("import: %v", err)
	}
	m, err := ModelFindOne(db, "m1")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if m.InputPrice != 2.0 {
		t.Fatalf("input_price = %v, want 2.0 (the snapshot's value)", m.InputPrice)
	}
}
