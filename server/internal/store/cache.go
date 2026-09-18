package store

import (
	"database/sql"
	"sync"
	"time"
)

// Reference-data cache.
//
// The relay hot path re-read the same slowly-changing rows on every request:
// the active model list twice (access check + pricing), the provider list for
// an alias, and the account's roles. Those tables change only when an admin
// edits them, so they are memoized here and any write through the generic
// helpers drops the whole cache.
//
// Every accessor returns a copy, so a caller may sort or otherwise reorder the
// result without disturbing the cached master or a concurrent reader.
//
// The TTL is not the invalidation mechanism — a local write invalidates
// immediately. It is the safety net for deployments where another node owns
// the write: a peer's edit becomes visible within refCacheTTL at the latest.

const refCacheTTL = 30 * time.Second

type refEntry[T any] struct {
	gen uint64
	exp int64
	val T
}

// refTables — writes to these drop the cache. Everything else (usage buckets,
// audit rows, balances) must not, or the cache would be invalidated by the
// very traffic it exists to speed up.
var refTables = map[string]bool{
	"model": true, "provider": true, "role": true, "account_role": true,
}

var refCache = struct {
	mu        sync.Mutex
	gen       uint64
	models    refEntry[[]*Model]
	providers map[string]refEntry[[]*Provider]
	roles     map[string]refEntry[[]*Role]
}{
	providers: map[string]refEntry[[]*Provider]{},
	roles:     map[string]refEntry[[]*Role]{},
}

func nowMs() int64 { return time.Now().UnixMilli() }

// InvalidateRefCache drops every cached reference row. Called from the write
// helpers and the few places that issue raw SQL against a reference table.
func InvalidateRefCache() {
	refCache.mu.Lock()
	refCache.gen++
	refCache.models = refEntry[[]*Model]{}
	refCache.providers = map[string]refEntry[[]*Provider]{}
	refCache.roles = map[string]refEntry[[]*Role]{}
	refCache.mu.Unlock()
}

// invalidateForTable — the generic write helpers call this with the table they
// touched; only reference tables invalidate.
func invalidateForTable(table string) {
	if refTables[table] {
		InvalidateRefCache()
	}
}

// ModelAllActiveCached — ModelAllActive with memoization.
func ModelAllActiveCached(db *sql.DB) ([]*Model, error) {
	refCache.mu.Lock()
	if e := refCache.models; e.gen == refCache.gen && nowMs() < e.exp {
		val := e.val
		refCache.mu.Unlock()
		return copyModels(val), nil
	}
	refCache.mu.Unlock()

	val, err := ModelAllActive(db)
	if err != nil {
		return nil, err
	}
	refCache.mu.Lock()
	refCache.models = refEntry[[]*Model]{gen: refCache.gen, exp: nowMs() + refCacheTTL.Milliseconds(), val: val}
	refCache.mu.Unlock()
	return copyModels(val), nil
}

// ProviderGetByAliasCached — enabled providers for an alias in priority order,
// with the per-call random tiebreak inside equal-priority groups applied to the
// copy (the cached order itself stays stable).
func ProviderGetByAliasCached(db *sql.DB, alias string) ([]*Provider, error) {
	refCache.mu.Lock()
	if e, ok := refCache.providers[alias]; ok && e.gen == refCache.gen && nowMs() < e.exp {
		val := e.val
		refCache.mu.Unlock()
		out := copyProviders(val)
		shuffleEqualPriority(out)
		return out, nil
	}
	refCache.mu.Unlock()

	val, err := providerListForAlias(db, alias)
	if err != nil {
		return nil, err
	}
	refCache.mu.Lock()
	refCache.providers[alias] = refEntry[[]*Provider]{gen: refCache.gen, exp: nowMs() + refCacheTTL.Milliseconds(), val: val}
	refCache.mu.Unlock()
	out := copyProviders(val)
	shuffleEqualPriority(out)
	return out, nil
}

// RolesByAccountCached — RolesByAccount with memoization.
func RolesByAccountCached(db *sql.DB, accountID string) ([]*Role, error) {
	refCache.mu.Lock()
	if e, ok := refCache.roles[accountID]; ok && e.gen == refCache.gen && nowMs() < e.exp {
		val := e.val
		refCache.mu.Unlock()
		return copyRoles(val), nil
	}
	refCache.mu.Unlock()

	val, err := RolesByAccount(db, accountID)
	if err != nil {
		return nil, err
	}
	refCache.mu.Lock()
	refCache.roles[accountID] = refEntry[[]*Role]{gen: refCache.gen, exp: nowMs() + refCacheTTL.Milliseconds(), val: val}
	refCache.mu.Unlock()
	return copyRoles(val), nil
}

// ── copies ──
//
// nil stays nil: allowedAliases treats a nil role list as "no roles", and
// callers distinguish that from an empty slice.

func copyModels(in []*Model) []*Model {
	if in == nil {
		return nil
	}
	return append([]*Model(nil), in...)
}

func copyProviders(in []*Provider) []*Provider {
	if in == nil {
		return nil
	}
	return append([]*Provider(nil), in...)
}

func copyRoles(in []*Role) []*Role {
	if in == nil {
		return nil
	}
	return append([]*Role(nil), in...)
}
