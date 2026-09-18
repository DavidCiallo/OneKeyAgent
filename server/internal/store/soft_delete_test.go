package store

import (
	"testing"
)

// TestProviderListExcludesSoftDeleted — a deleted provider must leave the
// admin list. It used to stay listed forever, so delete looked like a no-op
// and editing the ghost row failed.
func TestProviderListExcludesSoftDeleted(t *testing.T) {
	db, err := Open(t.TempDir() + "/providers.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache()

	if _, err := GenericInsert(db, "provider", map[string]any{
		"model_alias": "alpha", "priority": 1, "name": "keep",
		"base_url": "http://a", "model": "m", "enabled": 1,
	}); err != nil {
		t.Fatalf("insert keep: %v", err)
	}
	stored, err := GenericInsert(db, "provider", map[string]any{
		"model_alias": "alpha", "priority": 1, "name": "drop",
		"base_url": "http://b", "model": "m", "enabled": 1,
	})
	if err != nil {
		t.Fatalf("insert drop: %v", err)
	}
	if err := GenericSoftDelete(db, "provider", stored["id"].(string)); err != nil {
		t.Fatalf("delete: %v", err)
	}

	list, total, err := ProviderListPage(db, 1, nil, nil)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("list total=%d len=%d, want 1/1 — the deleted provider is still served", total, len(list))
	}
	if list[0].Name != "keep" {
		t.Fatalf("listed %q, want the live provider", list[0].Name)
	}
	// And editing the ghost row is refused instead of silently writing.
	if err := GenericUpdateByID(db, "provider", stored["id"].(string), map[string]any{"name": "ghost"}); err != ErrNotFound {
		t.Fatalf("update of deleted row = %v, want ErrNotFound", err)
	}
	p, err := ProviderFindOne(db, stored["id"].(string), true)
	if err != nil {
		t.Fatalf("ignore-delete lookup: %v", err)
	}
	if p.Name != "drop" {
		t.Fatalf("deleted row was modified to %q by the refused update", p.Name)
	}
	// Deleting it again is a no-op, reported as such.
	if err := GenericSoftDelete(db, "provider", stored["id"].(string)); err != ErrNotFound {
		t.Fatalf("second delete = %v, want ErrNotFound", err)
	}
}

// TestModelRestoreOrInsertRevives — re-creating a deleted alias brings the row
// back. It used to clear nothing, so the follow-up read still saw it deleted
// and the create API returned "not found" forever.
func TestModelRestoreOrInsertRevives(t *testing.T) {
	db, err := Open(t.TempDir() + "/models.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	InvalidateRefCache()

	stored, err := GenericInsert(db, "model", map[string]any{
		"alias": "dup", "input_price": 1.0, "cache_price": 0.5, "output_price": 2.0, "is_public": 1,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	id := stored["id"].(string)
	if err := GenericSoftDelete(db, "model", id); err != nil {
		t.Fatalf("delete: %v", err)
	}

	m, err := ModelRestoreOrInsert(db, map[string]any{
		"alias": "dup", "input_price": 3.0, "cache_price": 0.5, "output_price": 4.0, "is_public": 1,
	})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if m.ID != id {
		t.Fatalf("revive made a new row %s, want the original %s", m.ID, id)
	}
	if m.DeleteTime != nil {
		t.Fatalf("revived row is still deleted (delete_time=%v)", *m.DeleteTime)
	}
	if m.InputPrice != 3.0 {
		t.Fatalf("revived input_price = %v, want 3.0", m.InputPrice)
	}
	if _, err := ModelFindOne(db, id); err != nil {
		t.Fatalf("find after revive: %v", err)
	}
}
