package store

import (
	"database/sql"
	"testing"
)

// TestReplicaEditsReachMainWithoutDuplicationOrLoss - the end-to-end property
// behind "editing a model/provider on a replica must not pile up duplicate
// pushes, and must not drop the columns it did not touch".
//
// Two databases: one plays the replica (writes go through GenericUpdateByID,
// the same path the admin UI hits, and land in the outbox), the other plays the
// main database (the replica's batch is applied with ApplyOutbox, exactly as
// syncPush does).
func TestReplicaEditsReachMainWithoutDuplicationOrLoss(t *testing.T) {
	replica, err := Open(t.TempDir() + "/replica.db")
	if err != nil {
		t.Fatalf("open replica: %v", err)
	}
	defer replica.Close()
	main, err := Open(t.TempDir() + "/main.db")
	if err != nil {
		t.Fatalf("open main: %v", err)
	}
	defer main.Close()

	// Seed both sides with the same provider row, as a replicated catalog
	// would already have. Direct SQL, so nothing is queued in the outbox.
	const id = "prov-1"
	for _, db := range []*sql.DB{replica, main} {
		if _, err := db.Exec(
			`INSERT INTO provider (id, name, model_alias, base_url, api_key, priority, enabled, create_time, update_time)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
			id, "OpenAI", "gpt-4", "https://api.openai.com", "sk-secret", 1, 1,
		); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	//  replica edits, one field at a time (as a UI form would send deltas)
	edits := []map[string]any{
		{"name": "OpenAI Primary"},          // rename
		{"priority": 5},                     // reorder
		{"base_url": "https://new.example"}, // url change
		{"name": "OpenAI Main"},             // rename again  same column, later wins
	}
	for i, patch := range edits {
		if err := GenericUpdateByID(replica, "provider", id, patch); err != nil {
			t.Fatalf("replica edit %d: %v", i, err)
		}
	}

	//  the outbox must hold exactly ONE entry for this row, not four
	batch, err := OutboxBatch(replica, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("replica queued %d entries for one row, want 1 (edits must collapse)", len(batch))
	}
	if batch[0].Op != "put" {
		t.Fatalf("op = %q, want put", batch[0].Op)
	}

	//  push to the main database
	for _, e := range batch {
		if err := ApplyOutbox(main, e); err != nil {
			t.Fatalf("apply %s: %v", e.RowID, err)
		}
	}

	//  the main row: every edited column present, untouched columns intact
	p, err := ProviderFindOne(main, id, false)
	if err != nil {
		t.Fatalf("find on main: %v", err)
	}
	if p.Name != "OpenAI Main" {
		t.Errorf("name = %q, want the last edit %q", p.Name, "OpenAI Main")
	}
	if p.Priority != 5 {
		t.Errorf("priority = %d, want 5", p.Priority)
	}
	if p.BaseURL != "https://new.example" {
		t.Errorf("base_url = %q, want https://new.example", p.BaseURL)
	}
	// Columns never edited must survive the column-scoped upsert.
	if p.ApiKey == nil || *p.ApiKey != "sk-secret" {
		t.Errorf("api_key = %v, want sk-secret (must not be cleared by a partial edit)", p.ApiKey)
	}
	if p.ModelAlias != "gpt-4" {
		t.Errorf("model_alias = %q, want gpt-4 (must not be cleared)", p.ModelAlias)
	}
}

// TestReplicaEditThenAckLeavesNothingBehind - after the main database confirms a
// push (OutboxAck), the buffer is empty; a later edit of the same row queues a
// fresh entry rather than being folded into an acknowledged one.
func TestReplicaEditThenAckLeavesNothingBehind(t *testing.T) {
	db, err := Open(t.TempDir() + "/ack.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if err := EnqueuePut(db, "provider", "p1", map[string]any{"name": "a"}); err != nil {
		t.Fatalf("put: %v", err)
	}
	batch, _ := OutboxBatch(db, 100, 0)
	if len(batch) != 1 {
		t.Fatalf("batch len = %d, want 1", len(batch))
	}
	if err := OutboxAck(db, batch[0].Seq); err != nil {
		t.Fatalf("ack: %v", err)
	}
	if again, _ := OutboxBatch(db, 100, 0); len(again) != 0 {
		t.Fatalf("buffer not empty after ack: %d entries", len(again))
	}

	if err := EnqueuePut(db, "provider", "p1", map[string]any{"name": "b"}); err != nil {
		t.Fatalf("put after ack: %v", err)
	}
	batch2, _ := OutboxBatch(db, 100, 0)
	if len(batch2) != 1 {
		t.Fatalf("post-ack edit queued %d entries, want 1", len(batch2))
	}
	if batch2[0].Payload["name"] != "b" {
		t.Fatalf("payload = %v, want name b", batch2[0].Payload)
	}
}
