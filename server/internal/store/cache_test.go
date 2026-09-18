package store

import (
	"strings"
	"testing"
)

func TestRefCacheServesUntilInvalidated(t *testing.T) {
	db, err := Open(t.TempDir() + "/cache.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	if _, err := db.Exec(`INSERT INTO model (id,alias,input_price,cache_price,output_price,is_public,create_time)
		VALUES ('m1','alpha',1,0,2,1,1)`); err != nil {
		t.Fatalf("insert model: %v", err)
	}

	first, err := ModelAllActiveCached(db)
	if err != nil {
		t.Fatalf("first read: %v", err)
	}
	if len(first) != 1 {
		t.Fatalf("first read: got %d models, want 1", len(first))
	}

	// A raw write (bypassing the generic helpers) must NOT be visible until the
	// TTL lapses — this is the documented replica lag, not a bug.
	if _, err := db.Exec(`INSERT INTO model (id,alias,input_price,cache_price,output_price,is_public,create_time)
		VALUES ('m2','beta',1,0,2,1,1)`); err != nil {
		t.Fatalf("insert model 2: %v", err)
	}
	stillCached, err := ModelAllActiveCached(db)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if len(stillCached) != 1 {
		t.Fatalf("cached read returned %d models, want 1 (stale by design)", len(stillCached))
	}

	// An explicit invalidation makes it visible at once.
	InvalidateRefCache()
	fresh, err := ModelAllActiveCached(db)
	if err != nil {
		t.Fatalf("third read: %v", err)
	}
	if len(fresh) != 2 {
		t.Fatalf("after invalidate: got %d models, want 2", len(fresh))
	}
}

// TestGenericWriteInvalidatesRefCache — the write helpers must drop the cache,
// so an admin edit is visible on the very next relayed request.
func TestGenericWriteInvalidatesRefCache(t *testing.T) {
	db, err := Open(t.TempDir() + "/cachewrite.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	if _, err := GenericInsert(db, "provider", map[string]any{
		"model_alias": "alpha", "name": "p1", "base_url": "https://x.invalid",
		"model": "m", "api_key": "k", "enabled": 1, "priority": 1,
	}); err != nil {
		t.Fatalf("insert provider: %v", err)
	}

	got, err := ProviderGetByAliasCached(db, "alpha")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d providers, want 1", len(got))
	}

	// Disabling through the generic update must invalidate.
	providers, err := ProviderWhere(db, "model_alias = ?", []any{"alpha"})
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if err := GenericUpdateByID(db, "provider", providers[0].ID, map[string]any{"enabled": 0}); err != nil {
		t.Fatalf("update: %v", err)
	}
	after, err := ProviderGetByAliasCached(db, "alpha")
	if err != nil {
		t.Fatalf("read after update: %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("after disabling, got %d providers, want 0", len(after))
	}
}

// TestCachedProviderOrderAndCopyIsolation — the cache serves the query's own
// order (priority ordering is the query's job, tested separately), that order
// stays stable across calls, and every call gets its own copy so a caller's
// shuffle can't leak back into the cached master.
func TestCachedProviderOrderAndCopyIsolation(t *testing.T) {
	db, err := Open(t.TempDir() + "/cacheorder.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	// Distinct priorities: no two adjacent providers are equal, so the per-call
	// shuffle can never reorder anything and the returned order must match the
	// query exactly, whichever sort the query uses.
	for _, row := range []struct {
		id   string
		prio int
	}{{"pid-c", 3}, {"pid-a", 1}, {"pid-b", 2}} {
		if _, err := db.Exec(`INSERT INTO provider
			(id,model_alias,priority,name,base_url,model,api_key,api_type,enabled,create_time)
			VALUES (?,?,?,?,?,?,?,?,1,1)`,
			row.id, "shared", row.prio, row.id, "https://x.invalid", "m", "k", "openai"); err != nil {
			t.Fatalf("insert %s: %v", row.id, err)
		}
	}

	baseline, err := providerListForAlias(db, "shared")
	if err != nil {
		t.Fatalf("baseline query: %v", err)
	}
	wantOrder := idsOf(baseline)

	for i := 0; i < 20; i++ {
		got, err := ProviderGetByAliasCached(db, "shared")
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if gotIDs := idsOf(got); !equalStrings(gotIDs, wantOrder) {
			t.Fatalf("read %d: order = %v, want %v", i, gotIDs, wantOrder)
		}
	}

	// Mutating a returned slice must not disturb the cached master.
	first, err := ProviderGetByAliasCached(db, "shared")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	first[0], first[len(first)-1] = first[len(first)-1], first[0]
	second, err := ProviderGetByAliasCached(db, "shared")
	if err != nil {
		t.Fatalf("read again: %v", err)
	}
	if gotIDs := idsOf(second); !equalStrings(gotIDs, wantOrder) {
		t.Fatalf("cache master was mutated by a caller: order = %v, want %v", gotIDs, wantOrder)
	}
}

// TestCachedProvidersStillShuffleEachCall — equal-priority providers are
// randomized per call (load spreading), while the cached master keeps a fixed
// order so the shuffle never accumulates into the cache itself.
func TestCachedProvidersStillShuffleEachCall(t *testing.T) {
	db, err := Open(t.TempDir() + "/cacheshuffle.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	for _, id := range []string{"p1", "p2", "p3"} {
		if _, err := db.Exec(`INSERT INTO provider
			(id,model_alias,priority,name,base_url,model,api_key,api_type,enabled,create_time)
			VALUES (?,?,9,?,?,?,?,?,1,1)`,
			id, "shared", id, "https://x.invalid", "m", "k", "openai"); err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}

	// The cached master order is fixed...
	master, err := providerListForAlias(db, "shared")
	if err != nil {
		t.Fatalf("master query: %v", err)
	}
	masterOrder := idsOf(master)

	// ...while calls vary: with 3 equal-priority rows, 60 reads producing only
	// one ordering would mean the shuffle stopped happening.
	orders := map[string]bool{}
	for i := 0; i < 60; i++ {
		got, err := ProviderGetByAliasCached(db, "shared")
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if len(got) != 3 {
			t.Fatalf("read %d: got %d providers, want 3", i, len(got))
		}
		orders[strings.Join(idsOf(got), ",")] = true
	}
	if len(orders) < 2 {
		t.Fatalf("60 reads produced a single ordering %v — the per-call shuffle is gone", masterOrder)
	}

	after, err := providerListForAlias(db, "shared")
	if err != nil {
		t.Fatalf("master requery: %v", err)
	}
	if gotIDs := idsOf(after); !equalStrings(gotIDs, masterOrder) {
		t.Fatalf("per-call shuffles leaked into the cached master: %v -> %v", masterOrder, gotIDs)
	}
}

func idsOf(list []*Provider) []string {
	out := make([]string, len(list))
	for i, p := range list {
		out[i] = p.ID
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestNonReferenceWritesKeepCache — hot-path writes (usage buckets, audit rows)
// must not invalidate, or every relayed request would defeat the cache.
func TestNonReferenceWritesKeepCache(t *testing.T) {
	db, err := Open(t.TempDir() + "/cachenonref.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	if _, err := db.Exec(`INSERT INTO model (id,alias,input_price,cache_price,output_price,is_public,create_time)
		VALUES ('m1','alpha',1,0,2,1,1)`); err != nil {
		t.Fatalf("insert model: %v", err)
	}
	if _, err := ModelAllActiveCached(db); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	refCache.mu.Lock()
	gen := refCache.gen
	refCache.mu.Unlock()

	if _, err := GenericInsert(db, "usage_bucket", map[string]any{
		"account_id": "a", "model_alias": "alpha", "provider_id": "p",
		"bucket_time": 1, "granularity": "1m", "cost": 0.1,
	}); err != nil {
		t.Fatalf("insert bucket: %v", err)
	}
	if err := AuditInsert(db, AuditLog{Success: 1, Ts: Now()}); err != nil {
		t.Fatalf("insert audit: %v", err)
	}

	refCache.mu.Lock()
	after := refCache.gen
	refCache.mu.Unlock()
	if after != gen {
		t.Fatalf("hot-path writes bumped the ref cache generation (%d -> %d)", gen, after)
	}
}

// TestRolesByAccountCachedInvalidates — role assignment goes through raw SQL in
// AssignPermissions, so the explicit invalidation there is load-bearing.
func TestRolesByAccountCachedInvalidates(t *testing.T) {
	db, err := Open(t.TempDir() + "/cacheroles.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache() // the cache is process-global; isolate this test

	if _, err := GenericInsert(db, "account", map[string]any{
		"name": "u", "email": "u@example.com", "api_key": "sk-u", "is_admin": 0, "balance": 10.0,
	}); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acc, err := AccountFindByEmail(db, "u@example.com", false)
	if err != nil {
		t.Fatalf("find account: %v", err)
	}

	if roles, err := RolesByAccountCached(db, acc.ID); err != nil || len(roles) != 0 {
		t.Fatalf("empty roles: got %d, err %v", len(roles), err)
	}

	if err := AssignPermissions(db, acc.ID, [][2]string{{"usage", "menu"}, {"model", "menu"}}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	roles, err := RolesByAccountCached(db, acc.ID)
	if err != nil {
		t.Fatalf("read roles: %v", err)
	}
	if len(roles) != 2 {
		t.Fatalf("after assign: got %d roles, want 2", len(roles))
	}

	if err := AssignPermissions(db, acc.ID, nil); err != nil {
		t.Fatalf("clear: %v", err)
	}
	roles, err = RolesByAccountCached(db, acc.ID)
	if err != nil {
		t.Fatalf("read roles after clear: %v", err)
	}
	if len(roles) != 0 {
		t.Fatalf("after clearing: got %d roles, want 0", len(roles))
	}
}
