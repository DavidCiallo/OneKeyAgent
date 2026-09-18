package store

import (
	"database/sql"
	"testing"
)

// TestAuditUpgradeFromSchemaWithoutBodies — a database created before the
// request/response body columns existed must come back readable: reconcile
// adds the columns, existing rows must not surface NULL into the audit list
// (a plain TEXT upgrade left NULL there and took the whole endpoint down),
// and new inserts must work alongside the legacy rows.
func TestAuditUpgradeFromSchemaWithoutBodies(t *testing.T) {
	path := t.TempDir() + "/upgrade.db"
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	// The exact audit_log shape from before body capture.
	_, err = legacy.Exec(`CREATE TABLE audit_log (
		id TEXT PRIMARY KEY,
		ts INTEGER NOT NULL DEFAULT 0,
		success INTEGER NOT NULL DEFAULT 0,
		account_id TEXT NOT NULL DEFAULT '',
		account_name TEXT NOT NULL DEFAULT '',
		model_alias TEXT NOT NULL DEFAULT '',
		provider_id TEXT NOT NULL DEFAULT '',
		provider_name TEXT NOT NULL DEFAULT '',
		api_type TEXT NOT NULL DEFAULT '',
		endpoint TEXT NOT NULL DEFAULT '',
		status_code INTEGER NOT NULL DEFAULT 0,
		duration_ms INTEGER NOT NULL DEFAULT 0,
		input_tokens INTEGER NOT NULL DEFAULT 0,
		cached_input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0,
		cost REAL NOT NULL DEFAULT 0,
		stream INTEGER NOT NULL DEFAULT 0,
		err TEXT NOT NULL DEFAULT '',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`)
	if err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if _, err := legacy.Exec(`INSERT INTO audit_log
		(id, ts, success, account_name, model_alias, endpoint, status_code, create_time)
		VALUES ('legacy1', 1, 1, '历史用户', 'old-alias', '/api/chat/completions', 200, 1)`); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy: %v", err)
	}

	db, err := Open(path)
	if err != nil {
		t.Fatalf("open upgraded: %v", err)
	}
	defer db.Close()

	// The legacy row must read back with empty (not NULL) bodies.
	rows, err := AuditList(db)
	if err != nil {
		t.Fatalf("list after upgrade: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != "legacy1" {
		t.Fatalf("upgraded list = %+v, want the legacy row", rows)
	}
	if rows[0].RequestBody != "" || rows[0].ResponseBody != "" {
		t.Fatalf("legacy bodies = %q/%q, want empty strings", rows[0].RequestBody, rows[0].ResponseBody)
	}

	// And new inserts — including a detailed failure — coexist with it.
	if err := AuditInsert(db, AuditLog{ID: "new1", Success: 0, StatusCode: 400,
		Err: "upstream http 400", RequestBody: `{"messages":[]}`, ResponseBody: "bad"}); err != nil {
		t.Fatalf("insert new: %v", err)
	}
	rows, err = AuditList(db)
	if err != nil {
		t.Fatalf("list after insert: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
}
