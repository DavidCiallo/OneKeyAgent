package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// TestReconcileAddsMissingColumns — Open must upgrade a database created by an
// older build. Regression: CREATE TABLE IF NOT EXISTS skips an existing table,
// so a column added later (last_daily_time, tg_chat_id) never reached an
// existing data volume and startup failed with "no such column".
func TestReconcileAddsMissingColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")

	// Simulate the old schema: account without tg_chat_id/last_daily_time.
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	if _, err := raw.Exec(`CREATE TABLE account (
		id TEXT PRIMARY KEY, name TEXT, email TEXT, password TEXT, api_key TEXT,
		is_admin INTEGER DEFAULT 0, balance REAL DEFAULT 0,
		create_time INTEGER, update_time INTEGER, delete_time INTEGER)`); err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO account (id,name,email,password,api_key,is_admin,balance,create_time)
		VALUES ('old1','legacy','old@test.local','x','sk-old',1,5,1)`); err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw: %v", err)
	}

	// Open must reconcile rather than fail.
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open on legacy db: %v", err)
	}
	defer db.Close()

	cols, err := tableColumns(db, "account")
	if err != nil {
		t.Fatalf("tableColumns: %v", err)
	}
	for _, want := range []string{"tg_chat_id", "last_daily_time", "balance"} {
		if !cols[want] {
			t.Errorf("column %q missing after reconciliation (have %v)", want, cols)
		}
	}

	// Existing data must survive and be readable through the normal path
	// (accountCols selects the added columns).
	acc, err := AccountFindByEmail(db, "old@test.local", false)
	if err != nil {
		t.Fatalf("AccountFindByEmail after upgrade: %v", err)
	}
	if acc.ID != "old1" || acc.Balance != 5 {
		t.Errorf("legacy row = %+v, want id=old1 balance=5", acc)
	}
	if acc.LastDailyTime != nil {
		t.Errorf("added column should default to NULL, got %v", *acc.LastDailyTime)
	}
}

// TestReconcileIsIdempotent — running Open repeatedly must not error or
// duplicate work, so container restarts are safe.
func TestReconcileIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "repeat.db")
	for i := 0; i < 3; i++ {
		db, err := Open(path)
		if err != nil {
			t.Fatalf("Open #%d: %v", i+1, err)
		}
		if _, err := db.Exec(`INSERT INTO account (id,name,email,password,api_key,is_admin,balance,create_time)
			VALUES (?,?,'e@test.local','x','k',0,1,1)`, "id"+string(rune('a'+i)), "n"); err != nil {
			t.Fatalf("insert #%d: %v", i+1, err)
		}
		db.Close()
	}
	db, err := Open(path)
	if err != nil {
		t.Fatalf("final Open: %v", err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM account").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 3 {
		t.Errorf("account rows = %d, want 3", n)
	}
}

// TestRolesByAccountDedupes — a link table can hold repeated (account, role)
// rows; the sidebar must not repeat the entry for a role.
func TestRolesByAccountDedupes(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "roles.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`INSERT INTO role (id,name,type,create_time) VALUES ('r1','profile','menu',1)`); err != nil {
		t.Fatalf("insert role: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO role (id,name,type,create_time) VALUES ('r2','usage','menu',1)`); err != nil {
		t.Fatalf("insert role: %v", err)
	}
	// Duplicate link rows for the same account+role, as legacy data has.
	for _, id := range []string{"ar1", "ar2"} {
		if _, err := db.Exec(`INSERT INTO account_role (id,account_id,role_id,create_time) VALUES (?,?,?,1)`,
			id, "acc1", "r1"); err != nil {
			t.Fatalf("insert link %s: %v", id, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO account_role (id,account_id,role_id,create_time) VALUES ('ar3','acc1','r2',1)`); err != nil {
		t.Fatalf("insert link ar3: %v", err)
	}

	roles, err := RolesByAccount(db, "acc1")
	if err != nil {
		t.Fatalf("RolesByAccount: %v", err)
	}
	if len(roles) != 2 {
		names := make([]string, len(roles))
		for i, r := range roles {
			names[i] = r.Name
		}
		t.Fatalf("got %d roles %v, want 2 (deduped)", len(roles), names)
	}
}

// TestAssignPermissionsDedupes — repeated (name,type) pairs collapse to one
// link row.
func TestAssignPermissionsDedupes(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "assign.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if err := AssignPermissions(db, "acc1", [][2]string{
		{"profile", "menu"},
		{"usage", "menu"},
		{"profile", "menu"}, // duplicate input
	}); err != nil {
		t.Fatalf("AssignPermissions: %v", err)
	}

	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM account_role WHERE account_id='acc1' AND delete_time IS NULL").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 2 {
		t.Errorf("link rows = %d, want 2 (profile deduped)", n)
	}

	roles, err := RolesByAccount(db, "acc1")
	if err != nil {
		t.Fatalf("RolesByAccount: %v", err)
	}
	if len(roles) != 2 {
		t.Errorf("roles = %d, want 2", len(roles))
	}
}
