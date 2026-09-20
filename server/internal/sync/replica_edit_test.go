// Replica-side edit propagation: prompt push via TriggerPush, no duplication,
// and no double-applied deltas when flushes overlap.
package sync_test

import (
"sync"
"testing"
"time"

"onekey/server/internal/store"
)

// TestTwoEditsFromReplicaBothReachMain - each partial edit must land on the main
// database, and repeated edits must not duplicate the row.
func TestTwoEditsFromReplicaBothReachMain(t *testing.T) {
t.Setenv("SYNC_SECRET", "test-secret")
t.Setenv("NODE_ID", "replica-test")

main := newMain(t)
replica := newReplica(t, main.srv.URL)

if _, err := store.GenericInsert(main.db, "provider", map[string]any{
"id": "p1", "model_alias": "alpha", "name": "Old", "base_url": "https://old",
"model": "gpt-4", "priority": 1, "enabled": 1,
}); err != nil {
t.Fatalf("seed provider: %v", err)
}
if err := replica.app.Syncer.Bootstrap(); err != nil {
t.Fatalf("bootstrap: %v", err)
}

syncer := replica.app.Syncer

// Edit 1 -> flush -> main should have name=First.
if err := store.GenericUpdateByID(replica.db, "provider", "p1", map[string]any{"name": "First"}); err != nil {
t.Fatalf("edit 1: %v", err)
}
if err := syncer.Flush(); err != nil {
t.Fatalf("flush 1: %v", err)
}
p, err := store.ProviderFindOne(main.db, "p1", false)
if err != nil {
t.Fatalf("find after flush 1: %v", err)
}
if p.Name != "First" {
t.Fatalf("after edit 1: name = %q, want First", p.Name)
}

// Edit 2 -> flush -> main should also have priority=9.
if err := store.GenericUpdateByID(replica.db, "provider", "p1", map[string]any{"priority": 9}); err != nil {
t.Fatalf("edit 2: %v", err)
}
if err := syncer.Flush(); err != nil {
t.Fatalf("flush 2: %v", err)
}
p, err = store.ProviderFindOne(main.db, "p1", false)
if err != nil {
t.Fatalf("find after flush 2: %v", err)
}
if p.Name != "First" {
t.Errorf("name = %q, want First (first edit lost)", p.Name)
}
if p.Priority != 9 {
t.Errorf("priority = %d, want 9 (second edit lost)", p.Priority)
}
if p.BaseURL != "https://old" {
t.Errorf("base_url = %q, want https://old (untouched column cleared)", p.BaseURL)
}
var n int
if err := main.db.QueryRow(`SELECT COUNT(*) FROM provider WHERE id = 'p1'`).Scan(&n); err != nil {
t.Fatalf("count: %v", err)
}
if n != 1 {
t.Errorf("main provider rows = %d, want 1", n)
}
}

// TestTriggerPushCausesPromptFlush - with a 30s interval, nothing flushes on its
// own for the life of the test; TriggerPush must be what drives it. One edit,
// one signal, and the change appears on the main database promptly.
func TestTriggerPushCausesPromptFlush(t *testing.T) {
t.Setenv("SYNC_SECRET", "test-secret")
t.Setenv("NODE_ID", "replica-test")

main := newMain(t)
replica := newReplica(t, main.srv.URL)

if _, err := store.GenericInsert(main.db, "provider", map[string]any{
"id": "p1", "model_alias": "alpha", "name": "Old", "base_url": "https://old",
"model": "gpt-4", "priority": 1, "enabled": 1,
}); err != nil {
t.Fatalf("seed provider: %v", err)
}
if err := replica.app.Syncer.Bootstrap(); err != nil {
t.Fatalf("bootstrap: %v", err)
}

replica.app.Syncer.Start()

if err := store.GenericUpdateByID(replica.db, "provider", "p1", map[string]any{"name": "Triggered"}); err != nil {
t.Fatalf("edit: %v", err)
}
replica.app.Syncer.TriggerPush()

deadline := time.Now().Add(5 * time.Second)
for time.Now().Before(deadline) {
p, err := store.ProviderFindOne(main.db, "p1", false)
if err == nil && p.Name == "Triggered" {
return // reached the main database promptly
}
time.Sleep(50 * time.Millisecond)
}
t.Fatal("TriggerPush did not cause a flush within 5s (interval is 30s)")
}

// TestConcurrentFlushDoesNotDoubleApply - Flush has no mutual exclusion and is
// reachable from three goroutines (interval loop, threshold loop, manual
// endpoint). If two overlap, both can read the same batch before either acks it
// and both push it; for a delta (balance/usage) the main database would then
// apply the increment twice. Flush must serialize so the deduction lands once.
func TestConcurrentFlushDoesNotDoubleApply(t *testing.T) {
t.Setenv("SYNC_SECRET", "test-secret")
t.Setenv("NODE_ID", "replica-test")

main := newMain(t)
replica := newReplica(t, main.srv.URL)

if _, err := store.GenericInsert(main.db, "account", map[string]any{
"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0,
}); err != nil {
t.Fatalf("seed account: %v", err)
}
if err := replica.app.Syncer.Bootstrap(); err != nil {
t.Fatalf("bootstrap: %v", err)
}

// A single 4.0 deduction, buffered as one delta.
if _, err := store.AccountDeductBalance(replica.db, "acc1", 4.0); err != nil {
t.Fatalf("deduct: %v", err)
}

// Fire several flushes at once; without a lock they can race.
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
wg.Add(1)
go func() {
defer wg.Done()
_ = replica.app.Syncer.Flush()
}()
}
wg.Wait()

bal, err := store.AccountGetBalance(main.db, "acc1")
if err != nil {
t.Fatalf("main balance: %v", err)
}
if diff := bal - 6.0; diff > 1e-9 || diff < -1e-9 {
t.Fatalf("main balance = %v, want 6.0  concurrent flushes double-applied the delta", bal)
}
}