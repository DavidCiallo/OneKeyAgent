// Package sync_test — an external test package, because api imports sync and an
// internal test package would create an import cycle.
package sync_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"onekey/server/internal/api"
	"onekey/server/internal/service"
	"onekey/server/internal/store"
	"onekey/server/internal/sync"
)

// Two real nodes over real HTTP: a main database serving the sync API, and a
// replica whose Syncer talks to it. This is the test that proves the two-way
// flow exists end to end, rather than only at the unit level.
type node struct {
	db  *sql.DB
	app *api.App
	srv *httptest.Server
}

func newMain(t *testing.T) *node {
	t.Helper()
	db, err := store.Open(t.TempDir() + "/main.db")
	if err != nil {
		t.Fatalf("open main: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	// The main node is not a replica: it buffers nothing.
	store.SetOutboxEnabled(false)
	settings := service.NewSettings()
	app := api.NewApp(db, settings, t.TempDir(), nil)
	srv := httptest.NewServer(app.Routes())
	t.Cleanup(srv.Close)
	return &node{db: db, app: app, srv: srv}
}

func newReplica(t *testing.T, mainURL string) *node {
	t.Helper()
	db, err := store.Open(t.TempDir() + "/replica.db")
	if err != nil {
		t.Fatalf("open replica: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	store.SetOutboxEnabled(true)
	t.Cleanup(func() { store.SetOutboxEnabled(false) })

	cfg := sync.Config{
		MainURL:   mainURL,
		Secret:    "test-secret",
		MaxRows:   500,
		MaxBytes:  2 << 20,
		Interval:  30_000_000_000,
		Threshold: 256 << 10,
		PullEvery: 0, // the test drives Refresh explicitly
	}
	syncer := sync.New(db, cfg)
	settings := service.NewSettings()
	app := api.NewApp(db, settings, t.TempDir(), syncer)
	return &node{db: db, app: app, srv: nil}
}

// TestTwoWayFlowOverHTTP — the whole point of the feature, exercised over the
// wire: reference data edited on the main database reaches a running replica,
// and the replica's local spend reaches the main database.
func TestTwoWayFlowOverHTTP(t *testing.T) {
	t.Setenv("SYNC_SECRET", "test-secret")
	t.Setenv("NODE_ID", "replica-test")

	main := newMain(t)
	replica := newReplica(t, main.srv.URL)
	syncer := replica.app.Syncer

	// The main database has a model at price 9.0 and an account at balance 10.
	if _, err := store.GenericInsert(main.db, "model", map[string]any{
		"id": "m1", "alias": "alpha", "input_price": 9.0, "cache_price": 0.0, "output_price": 9.0, "is_public": 1,
	}); err != nil {
		t.Fatalf("seed model: %v", err)
	}
	if _, err := store.GenericInsert(main.db, "account", map[string]any{
		"id": "acc1", "name": "u", "email": "u@example.com", "api_key": "sk-1", "balance": 10.0,
	}); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// ── direction 2: main → replica, first-run bootstrap ──
	if err := syncer.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	m, err := store.ModelFindOne(replica.db, "m1")
	if err != nil {
		t.Fatalf("replica model after bootstrap: %v", err)
	}
	if m.InputPrice != 9.0 {
		t.Fatalf("replica input_price = %v, want 9.0", m.InputPrice)
	}

	// ── direction 1: replica → main, a local deduction ──
	if _, err := store.AccountDeductBalance(replica.db, "acc1", 4.0); err != nil {
		t.Fatalf("replica deduct: %v", err)
	}
	if err := syncer.Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	mainBal, err := store.AccountGetBalance(main.db, "acc1")
	if err != nil {
		t.Fatalf("main balance: %v", err)
	}
	if diff := mainBal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("main balance = %v, want 6.0 — the replica's deduction never reached it", mainBal)
	}

	// ── direction 2 again: the running replica picks up a main-database edit ──
	// This is the exact bug that was reported: the main database changes a model
	// price (and adds a provider) after the replica is already up.
	if err := store.GenericUpdateByID(main.db, "model", "m1", map[string]any{"input_price": 2.0, "output_price": 2.0}); err != nil {
		t.Fatalf("main model update: %v", err)
	}
	if _, err := store.GenericInsert(main.db, "provider", map[string]any{
		"id": "p9", "alias": "newprov", "name": "New Provider", "enabled": 1, "priority": 1,
	}); err != nil {
		t.Fatalf("main provider insert: %v", err)
	}

	if err := syncer.Refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	m, err = store.ModelFindOne(replica.db, "m1")
	if err != nil {
		t.Fatalf("replica model after refresh: %v", err)
	}
	if m.InputPrice != 2.0 {
		t.Fatalf("replica input_price = %v, want 2.0 — the main database's edit did NOT reach the running replica", m.InputPrice)
	}
	if _, err := store.ProviderFindOne(replica.db, "p9", false); err != nil {
		t.Fatalf("provider added on the main database is missing on the replica: %v", err)
	}

	// ── the money invariant, end to end ──
	// The replica already spent 4.0 locally, and that has been pushed. Now the
	// main database spends 1.0 more, which the replica has not seen yet. A
	// refresh must not roll the replica's balance back to the main's value.
	if _, err := store.AccountDeductBalance(main.db, "acc1", 1.0); err != nil {
		t.Fatalf("main deduct: %v", err)
	}
	replicaBal, err := store.AccountGetBalance(replica.db, "acc1")
	if err != nil {
		t.Fatalf("replica balance: %v", err)
	}
	if diff := replicaBal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("replica balance = %v, want 6.0 before refresh", replicaBal)
	}
	if err := syncer.Refresh(); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	replicaBal, err = store.AccountGetBalance(replica.db, "acc1")
	if err != nil {
		t.Fatalf("replica balance: %v", err)
	}
	// The main snapshot says 5.0; the replica must keep its own 6.0.
	if diff := replicaBal - 6.0; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("replica balance = %v after refresh, want 6.0 — the refresh overwrote the replica's own state", replicaBal)
	}
}

// TestRefreshReachesReplicaWithoutBootstrap — a replica on a persistent volume
// never bootstraps again, so the refresh loop is the only thing that can bring
// it the main database's edits. Without it the node serves a frozen catalog.
func TestRefreshReachesReplicaWithoutBootstrap(t *testing.T) {
	t.Setenv("SYNC_SECRET", "test-secret")
	t.Setenv("NODE_ID", "replica-test")

	main := newMain(t)
	replica := newReplica(t, main.srv.URL)

	if _, err := store.GenericInsert(main.db, "model", map[string]any{
		"id": "m1", "alias": "alpha", "input_price": 1.0, "cache_price": 0.0, "output_price": 1.0, "is_public": 1,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Simulate an already-bootstrapped node: the first bootstrap records the
	// node as done, so a later Bootstrap call is a no-op.
	if err := replica.app.Syncer.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	if err := store.GenericUpdateByID(main.db, "model", "m1", map[string]any{"input_price": 7.0}); err != nil {
		t.Fatalf("main update: %v", err)
	}

	// A second bootstrap must do nothing (this is why Refresh has to exist).
	if err := replica.app.Syncer.Bootstrap(); err != nil {
		t.Fatalf("second bootstrap: %v", err)
	}
	m, _ := store.ModelFindOne(replica.db, "m1")
	if m.InputPrice == 7.0 {
		t.Fatalf("bootstrap unexpectedly re-imported; the premise of this test is wrong")
	}

	if err := replica.app.Syncer.Refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	m, err := store.ModelFindOne(replica.db, "m1")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if m.InputPrice != 7.0 {
		t.Fatalf("input_price = %v, want 7.0 — the running replica never got the edit", m.InputPrice)
	}
}

// TestSnapshotEndpointAuth — the sync endpoints move whole tables, so a wrong
// secret must be rejected rather than served.
func TestSnapshotEndpointAuth(t *testing.T) {
	t.Setenv("SYNC_SECRET", "test-secret")
	main := newMain(t)

	req, _ := http.NewRequest(http.MethodGet, main.srv.URL+"/api/sync/snapshot", nil)
	req.Header.Set("token", "wrong")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode == http.StatusOK && body["data"] != nil {
		t.Fatalf("a wrong secret was served the snapshot: %v", body)
	}
}

// TestSnapshotExcludesSoftDeleted rows — a deleted model must not be handed to
// a replica, or it would be resurrected there on every refresh.
func TestSnapshotExcludesSoftDeleted(t *testing.T) {
	t.Setenv("SYNC_SECRET", "test-secret")
	main := newMain(t)

	if _, err := store.GenericInsert(main.db, "model", map[string]any{
		"id": "m1", "alias": "alpha", "input_price": 1.0, "cache_price": 0.0, "output_price": 1.0, "is_public": 1,
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := store.GenericSoftDelete(main.db, "model", "m1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	req, _ := http.NewRequest(http.MethodGet, main.srv.URL+"/api/sync/snapshot", nil)
	req.Header.Set("token", "test-secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := json.Marshal(readData(t, resp))
	if strings.Contains(string(raw), `"m1"`) {
		t.Fatalf("the snapshot still carries a soft-deleted model: %s", raw)
	}
}

func readData(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var env struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	return env.Data
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
