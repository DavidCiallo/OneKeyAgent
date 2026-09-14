package store

import (
	"fmt"
	"testing"
)

// TestOutboxPutCollapses — repeated puts for one row collapse into a single
// entry, later columns winning, and the sequence number is preserved so a
// continuously-edited row can't be starved behind newer entries.
func TestOutboxPutCollapses(t *testing.T) {
	db, err := Open(t.TempDir() + "/put.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if err := EnqueuePut(db, "provider", "p1", map[string]any{"enabled": 1, "priority": 1}); err != nil {
		t.Fatalf("put 1: %v", err)
	}
	if err := EnqueuePut(db, "provider", "p1", map[string]any{"enabled": 0}); err != nil {
		t.Fatalf("put 2: %v", err)
	}
	if err := EnqueuePut(db, "model", "m1", map[string]any{"input_price": 2.5}); err != nil {
		t.Fatalf("put model: %v", err)
	}

	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 2 {
		t.Fatalf("got %d entries, want 2 (one per row)", len(batch))
	}
	// Order is by sequence, and the first row keeps its original seq despite
	// being edited again.
	if batch[0].RowID != "p1" || batch[1].RowID != "m1" {
		t.Fatalf("order = [%s %s], want [p1 m1]", batch[0].RowID, batch[1].RowID)
	}
	if batch[0].Seq > batch[1].Seq {
		t.Fatalf("p1 seq %d > m1 seq %d; the earlier entry lost its place", batch[0].Seq, batch[1].Seq)
	}
	// Both columns survive, with the later write winning on the overlap.
	if v, _ := toFloat(batch[0].Payload["enabled"]); v != 0 {
		t.Fatalf("enabled = %v, want the later value 0", batch[0].Payload["enabled"])
	}
	if v, _ := toFloat(batch[0].Payload["priority"]); v != 1 {
		t.Fatalf("priority = %v, want 1 (merged, not replaced)", batch[0].Payload["priority"])
	}
}

// TestOutboxDeltaSums — the property that makes delayed flushing safe: repeated
// balance deductions accumulate rather than overwrite.
func TestOutboxDeltaSums(t *testing.T) {
	db, err := Open(t.TempDir() + "/delta.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	for _, amt := range []float64{0.001, 0.002, 0.0005} {
		if err := EnqueueDelta(db, "account", "acc1", map[string]any{"id": "acc1", "balance": amt}); err != nil {
			t.Fatalf("delta %v: %v", amt, err)
		}
	}

	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries, want 1", len(batch))
	}
	got, _ := toFloat(batch[0].Payload["balance"])
	if diff := got - 0.0035; diff > 1e-12 || diff < -1e-12 {
		t.Fatalf("balance delta = %v, want 0.0035 (summed)", got)
	}
}

// TestOutboxTokenCountersStayIntegral — token counts must not become floats, or
// a long-lived window accumulates rounding drift.
func TestOutboxTokenCountersStayIntegral(t *testing.T) {
	db, err := Open(t.TempDir() + "/int.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	rowID := BucketDeltaRowID("acc", "alias", "prov", "1m", 60000)
	base := map[string]any{
		"account_id": "acc", "model_alias": "alias", "provider_id": "prov",
		"granularity": "1m", "bucket_time": int64(60000),
	}
	for i := 0; i < 3; i++ {
		p := map[string]any{}
		for k, v := range base {
			p[k] = v
		}
		p["input_tokens"] = int64(7)
		p["output_tokens"] = int64(3)
		p["cost"] = 0.000001
		p["request_count"] = int64(1)
		if err := EnqueueDelta(db, "usage_bucket", rowID, p); err != nil {
			t.Fatalf("delta %d: %v", i, err)
		}
	}

	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries, want 1", len(batch))
	}
	if n, ok := toInt(batch[0].Payload["input_tokens"]); !ok || n != 21 {
		t.Fatalf("input_tokens = %v (%T), want integral 21", batch[0].Payload["input_tokens"], batch[0].Payload["input_tokens"])
	}
	if n, ok := toInt(batch[0].Payload["request_count"]); !ok || n != 3 {
		t.Fatalf("request_count = %v, want integral 3", batch[0].Payload["request_count"])
	}
}

// TestOutboxDisabledIsNoop — a main node (or any node without MAIN_DB_URL) must
// buffer nothing.
func TestOutboxDisabledIsNoop(t *testing.T) {
	db, err := Open(t.TempDir() + "/off.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(false)

	if err := EnqueuePut(db, "provider", "p1", map[string]any{"enabled": 1}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := EnqueueDelta(db, "account", "a1", map[string]any{"id": "a1", "balance": 0.5}); err != nil {
		t.Fatalf("delta: %v", err)
	}
	rows, _, err := OutboxStats(db)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if rows != 0 {
		t.Fatalf("buffered %d rows with the outbox disabled, want 0", rows)
	}
}

// TestOutboxPutDropsAdditiveColumns — a balance must never travel as an absolute
// put, or an admin profile edit would clobber concurrent deductions.
func TestOutboxPutDropsAdditiveColumns(t *testing.T) {
	db, err := Open(t.TempDir() + "/strip.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if err := EnqueuePut(db, "account", "acc1", map[string]any{
		"name": "renamed", "balance": 999.0, // stale absolute balance
	}); err != nil {
		t.Fatalf("put: %v", err)
	}
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries, want 1", len(batch))
	}
	if _, has := batch[0].Payload["balance"]; has {
		t.Fatalf("put carried an absolute balance %v; it must travel as a delta only", batch[0].Payload["balance"])
	}
	if batch[0].Payload["name"] != "renamed" {
		t.Fatalf("name = %v, want renamed", batch[0].Payload["name"])
	}
}

// TestOutboxAckKeepsNewerWork — acknowledging a batch must not discard entries
// buffered after it was read.
func TestOutboxAckKeepsNewerWork(t *testing.T) {
	db, err := Open(t.TempDir() + "/ack.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	for _, id := range []string{"r1", "r2"} {
		if err := EnqueuePut(db, "model", id, map[string]any{"input_price": 1.0}); err != nil {
			t.Fatalf("put %s: %v", id, err)
		}
	}
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 2 {
		t.Fatalf("got %d entries, want 2", len(batch))
	}
	// A third change lands while the first batch is in flight.
	if err := EnqueuePut(db, "model", "r3", map[string]any{"input_price": 1.0}); err != nil {
		t.Fatalf("put r3: %v", err)
	}

	if err := OutboxAck(db, batch[len(batch)-1].Seq); err != nil {
		t.Fatalf("ack: %v", err)
	}
	rest, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch after ack: %v", err)
	}
	if len(rest) != 1 || rest[0].RowID != "r3" {
		t.Fatalf("after ack, buffer = %v, want just r3", rest)
	}
	got, err := GetNodeState(db, "last_pushed_seq")
	if err != nil {
		t.Fatalf("node state: %v", err)
	}
	wantSeq := fmt.Sprintf("%d", batch[len(batch)-1].Seq)
	if got != wantSeq {
		t.Fatalf("last_pushed_seq = %q, want %q", got, wantSeq)
	}
}

// TestOutboxBatchRespectsByteCap — one push must stay a bounded body, with the
// remainder left for the next cycle.
func TestOutboxBatchRespectsByteCap(t *testing.T) {
	db, err := Open(t.TempDir() + "/cap.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	blob := make([]byte, 400)
	for i := range blob {
		blob[i] = 'x'
	}
	for _, id := range []string{"r1", "r2", "r3"} {
		if err := EnqueuePut(db, "model", id, map[string]any{"alias": string(blob)}); err != nil {
			t.Fatalf("put %s: %v", id, err)
		}
	}
	batch, err := OutboxBatch(db, 100, 500) // room for one ~430-byte payload
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries under a 500-byte cap, want 1", len(batch))
	}
	// Always at least one entry per batch, or an oversized row would stall the
	// queue forever.
	if len(batch) == 0 {
		t.Fatal("batch is empty; an oversized row must still be sent")
	}
}

// TestApplyOutboxPutCreatesAndUpdates — the main database side of a put.
func TestApplyOutboxPutCreatesAndUpdates(t *testing.T) {
	db, err := Open(t.TempDir() + "/apply.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if err := ApplyOutbox(db, OutboxEntry{
		Table: "model", RowID: "m1", Op: "put",
		Payload: map[string]any{"alias": "alpha", "input_price": 1.0},
	}); err != nil {
		t.Fatalf("apply create: %v", err)
	}
	m, err := ModelFindOne(db, "m1")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if m.Alias != "alpha" || m.InputPrice != 1.0 {
		t.Fatalf("created row = %+v", m)
	}

	if err := ApplyOutbox(db, OutboxEntry{
		Table: "model", RowID: "m1", Op: "put",
		Payload: map[string]any{"input_price": 4.5},
	}); err != nil {
		t.Fatalf("apply update: %v", err)
	}
	m, err = ModelFindOne(db, "m1")
	if err != nil {
		t.Fatalf("find after update: %v", err)
	}
	if m.InputPrice != 4.5 || m.Alias != "alpha" {
		t.Fatalf("updated row = %+v, want price 4.5 and alias kept", m)
	}
}

// TestApplyOutboxSettingsMatchesByKey — settings rows are keyed by their name,
// not by id. Each node generates its own id for the same setting, so an
// id-based upsert would insert a second row and trip the unique index on
// settings(key).
func TestApplyOutboxSettingsMatchesByKey(t *testing.T) {
	db, err := Open(t.TempDir() + "/applysettings.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// The main database already has the setting under its own row id.
	if _, err := db.Exec(`INSERT INTO settings (id, key, value, create_time, update_time, delete_time)
		VALUES ('main-row-id','fallback_model_alias','old',1,1,NULL)`); err != nil {
		t.Fatalf("seed setting: %v", err)
	}

	// A replica's put arrives keyed by name, as SettingsSet buffers it.
	if err := ApplyOutbox(db, OutboxEntry{
		Table: "settings", RowID: "fallback_model_alias", Op: "put",
		Payload: map[string]any{"key": "fallback_model_alias", "value": "new"},
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}

	var rows int64
	if err := db.QueryRow("SELECT COUNT(*) FROM settings WHERE key = 'fallback_model_alias'").Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("got %d rows for the setting, want 1 (the replica's put forked it)", rows)
	}
	var id, value string
	if err := db.QueryRow("SELECT id, value FROM settings WHERE key = 'fallback_model_alias'").Scan(&id, &value); err != nil {
		t.Fatalf("read: %v", err)
	}
	if value != "new" {
		t.Fatalf("value = %q, want \"new\"", value)
	}
	if id != "main-row-id" {
		t.Fatalf("id = %q, want the existing row's id (main-row-id)", id)
	}
}

// TestSettingsSetBuffersByKey — the enqueue side must key on the setting name,
// so replicas' rows collapse onto one entry.
func TestSettingsSetBuffersByKey(t *testing.T) {
	db, err := Open(t.TempDir() + "/settingsbuf.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if err := SettingsSet(db, "fallback_model_alias", "first"); err != nil {
		t.Fatalf("set 1: %v", err)
	}
	if err := SettingsSet(db, "fallback_model_alias", "second"); err != nil {
		t.Fatalf("set 2: %v", err)
	}

	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries, want 1 collapsed entry", len(batch))
	}
	if batch[0].Table != "settings" || batch[0].RowID != "fallback_model_alias" {
		t.Fatalf("entry = %s/%s, want settings/fallback_model_alias", batch[0].Table, batch[0].RowID)
	}
	if batch[0].Payload["value"] != "second" {
		t.Fatalf("value = %v, want the later \"second\"", batch[0].Payload["value"])
	}
}

// TestAccountAdminEditsAreBuffered — admin edits that go through the targeted
// field helper must reach the main database too, not just the generic helpers.
func TestAccountAdminEditsAreBuffered(t *testing.T) {
	db, err := Open(t.TempDir() + "/adminedit.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if _, err := GenericInsert(db, "account", map[string]any{
		"id": "acc1", "name": "old", "email": "a@example.com", "api_key": "sk-1", "balance": 5.0,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// GenericInsert itself buffers a put; clear it so the assertion below is
	// about the field update.
	if err := OutboxAck(db, 1<<40); err != nil {
		t.Fatalf("clear: %v", err)
	}

	if err := AccountSetField(db, "acc1", "name", "renamed"); err != nil {
		t.Fatalf("set field: %v", err)
	}
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 || batch[0].Table != "account" || batch[0].Payload["name"] != "renamed" {
		t.Fatalf("field edit not buffered: %v", batch)
	}
}

// TestApplyOutboxDeltaAccumulatesAndFloorsAtZero — the main database side of a
// balance delta: increments add up across nodes, and the balance can never go
// negative even if several nodes each deduct to the limit.
func TestApplyOutboxDeltaAccumulatesAndFloorsAtZero(t *testing.T) {
	db, err := Open(t.TempDir() + "/applydelta.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := GenericInsert(db, "account", map[string]any{
		"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 1.0,
	}); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// Two nodes each report a deduction (a negative balance delta); both land.
	for _, amt := range []float64{-0.25, -0.5} {
		if err := ApplyOutbox(db, OutboxEntry{
			Table: "account", RowID: "acc1", Op: "delta",
			Payload: map[string]any{"id": "acc1", "balance": amt},
		}); err != nil {
			t.Fatalf("apply delta %v: %v", amt, err)
		}
	}
	bal, err := AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if diff := bal - 0.25; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 0.25 (1.0 - 0.75)", bal)
	}

	// A delayed batch that would overdraw is floored at zero, matching the
	// local deduction's MAX(balance - ?, 0).
	if err := ApplyOutbox(db, OutboxEntry{
		Table: "account", RowID: "acc1", Op: "delta",
		Payload: map[string]any{"id": "acc1", "balance": -99.0},
	}); err != nil {
		t.Fatalf("apply overdraw: %v", err)
	}
	bal, err = AccountGetBalance(db, "acc1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 0 {
		t.Fatalf("balance = %v, want 0 (floored)", bal)
	}
}

// TestApplyOutboxBucketDeltaMergesByWindow — replica bucket deltas merge into
// the main database's window row, not the replica's node-local id.
func TestApplyOutboxBucketDeltaMergesByWindow(t *testing.T) {
	db, err := Open(t.TempDir() + "/applybucket.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	entry := func(in int64, cost float64) OutboxEntry {
		return OutboxEntry{
			Table: "usage_bucket", RowID: BucketDeltaRowID("acc", "alias", "prov", "1m", 60000),
			Op: "delta",
			Payload: map[string]any{
				"account_id": "acc", "model_alias": "alias", "provider_id": "prov",
				"granularity": "1m", "bucket_time": int64(60000),
				"input_tokens": in, "output_tokens": int64(1), "cost": cost, "request_count": int64(1),
			},
		}
	}
	for _, e := range []OutboxEntry{entry(100, 0.5), entry(300, 1.5)} {
		if err := ApplyOutbox(db, e); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}

	var rows, it, ot, rc int64
	var cost float64
	if err := db.QueryRow(`SELECT COUNT(*) FROM usage_bucket WHERE account_id='acc' AND granularity='1m'`).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("got %d window rows, want 1", rows)
	}
	if err := db.QueryRow(`SELECT input_tokens, output_tokens, cost, request_count FROM usage_bucket
		WHERE account_id='acc' AND granularity='1m'`).Scan(&it, &ot, &cost, &rc); err != nil {
		t.Fatalf("read: %v", err)
	}
	if it != 400 || ot != 2 || rc != 2 {
		t.Fatalf("merged window = in:%d out:%d count:%d, want 400/2/2", it, ot, rc)
	}
	if diff := cost - 2.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("merged cost = %v, want 2.0", cost)
	}
}

// TestApplyOutboxDeltaArrivingBeforeRow — a delta for a row the main database
// has not seen yet must still apply (the replica created it locally).
func TestApplyOutboxDeltaArrivingBeforeRow(t *testing.T) {
	db, err := Open(t.TempDir() + "/applyorder.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	err = ApplyOutbox(db, OutboxEntry{
		Table: "account", RowID: "newacc", Op: "delta",
		Payload: map[string]any{"id": "newacc", "balance": 0.75},
	})
	if err != nil {
		t.Fatalf("apply delta to absent row: %v", err)
	}
	var bal float64
	if err := db.QueryRow("SELECT balance FROM account WHERE id = 'newacc'").Scan(&bal); err != nil {
		t.Fatalf("read: %v", err)
	}
	if diff := bal - 0.75; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("balance = %v, want 0.75", bal)
	}
}

// TestOutboxSurvivesReopen — the buffer is on disk, so a replica restart does
// not lose unsent changes.
func TestOutboxSurvivesReopen(t *testing.T) {
	path := t.TempDir() + "/persist.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)

	if err := EnqueuePut(db, "provider", "p1", map[string]any{"enabled": 0}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()
	batch, err := OutboxBatch(db2, 100, 0)
	if err != nil {
		t.Fatalf("batch after reopen: %v", err)
	}
	if len(batch) != 1 || batch[0].RowID != "p1" {
		t.Fatalf("buffer after reopen = %v, want the p1 put", batch)
	}
	// A new change must sequence after the restored maximum.
	if err := EnqueuePut(db2, "provider", "p2", map[string]any{"enabled": 1}); err != nil {
		t.Fatalf("put after reopen: %v", err)
	}
	batch, err = OutboxBatch(db2, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 2 || batch[0].Seq >= batch[1].Seq {
		t.Fatalf("sequences not restored: %v", batch)
	}
}
