package store

import (
	"testing"
)

// TestProviderPriorityOrder — routing must honor priority (lower value first),
// not insertion order. Regression: ProviderWhere used to compare ModelAlias,
// which is constant within an alias, so the sort was a no-op and providers
// were tried in creation order regardless of the priority set in the UI.
func TestProviderPriorityOrder(t *testing.T) {
	db, err := Open(t.TempDir() + "/prio.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// Insert with priorities deliberately opposite to insertion order.
	insert := func(id string, priority int) {
		t.Helper()
		_, err := db.Exec(`INSERT INTO provider
			(id, model_alias, priority, name, base_url, model, api_key, api_type, enabled, create_time)
			VALUES (?,?,?,?,?,?,?,?,1,1)`,
			id, "shared-alias", priority, id, "https://example.invalid/v1", "m", "k", "openai")
		if err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	insert("pid-c", 3)
	insert("pid-b", 2)
	insert("pid-a", 1)

	got, err := ProviderGetByAlias(db, "shared-alias")
	if err != nil {
		t.Fatalf("get by alias: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d providers, want 3", len(got))
	}
	want := []string{"pid-a", "pid-b", "pid-c"}
	for i, p := range got {
		if p.ID != want[i] {
			ids := make([]string, len(got))
			for k, g := range got {
				ids[k] = g.ID
			}
			t.Fatalf("order = %v, want %v (priority ASC)", ids, want)
		}
	}

	// Disabling the top provider must promote the next one, not fall back to
	// creation order.
	if _, err := db.Exec("UPDATE provider SET enabled = 0 WHERE id = 'pid-a'"); err != nil {
		t.Fatalf("disable: %v", err)
	}
	got, err = ProviderGetByAlias(db, "shared-alias")
	if err != nil {
		t.Fatalf("get by alias: %v", err)
	}
	if len(got) != 2 || got[0].ID != "pid-b" {
		ids := make([]string, len(got))
		for k, g := range got {
			ids[k] = g.ID
		}
		t.Fatalf("after disabling pid-a, order = %v, want [pid-b pid-c]", ids)
	}
}

// TestProviderWhereGroupsByAlias — the admin list still groups by alias, with
// priority as the tiebreak inside each alias.
func TestProviderWhereGroupsByAlias(t *testing.T) {
	db, err := Open(t.TempDir() + "/group.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	insert := func(id, alias string, priority int) {
		t.Helper()
		_, err := db.Exec(`INSERT INTO provider
			(id, model_alias, priority, name, base_url, model, api_key, api_type, enabled, create_time)
			VALUES (?,?,?,?,?,?,?,?,1,1)`,
			id, alias, priority, id, "https://example.invalid/v1", "m", "k", "openai")
		if err != nil {
			t.Fatalf("insert %s: %v", id, err)
		}
	}
	insert("b2", "beta", 2)
	insert("a1", "alpha", 2)
	insert("a0", "alpha", 1)
	insert("b1", "beta", 1)

	got, err := ProviderWhere(db, "1=1", nil)
	if err != nil {
		t.Fatalf("where: %v", err)
	}
	want := []string{"a0", "a1", "b1", "b2"}
	for i, p := range got {
		if p.ID != want[i] {
			ids := make([]string, len(got))
			for k, g := range got {
				ids[k] = g.ID
			}
			t.Fatalf("order = %v, want %v (alias ASC, priority ASC)", ids, want)
		}
	}
}
