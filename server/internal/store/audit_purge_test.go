package store

import (
	"strings"
	"testing"
)

// TestAuditBodiesSurviveRestart — the legacy-body purge is a one-off. Its
// statement matches every row that has a body, so reopening the database must
// not clear what the current build just wrote: otherwise every restart leaves
// nothing to show for a retained failure.
func TestAuditBodiesSurviveRestart(t *testing.T) {
	path := t.TempDir() + "/audit_purge.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := AuditInsert(db, failRow("k1", `{"a":1}`, "boom")); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()

	var body string
	if err := reopened.QueryRow(`SELECT request_body FROM audit_log WHERE id = 'k1'`).Scan(&body); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if body != `{"a":1}` {
		t.Fatalf("restart cleared the body: %q", body)
	}
}

// TestLegacyBodiesPurgedOnce — a database upgraded from a build that stored
// whole prompts still gets its bodies cleared, so the smaller-retention change
// reaches data that already exists. The purge is not skipped by the guard.
func TestLegacyBodiesPurgedOnce(t *testing.T) {
	path := t.TempDir() + "/audit_legacy.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// Stand in for a row an older build wrote, after the first boot has already
	// consumed the one-off purge.
	if _, err := db.Exec(`INSERT INTO audit_log (id,ts,success,err,request_body,response_body)
		VALUES ('legacy',1,0,'boom',?,'')`, strings.Repeat("x", 4096)); err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM node_state WHERE id = ?`, auditBodiesPurgedKey); err != nil {
		t.Fatalf("clear flag: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()

	var body string
	if err := reopened.QueryRow(`SELECT request_body FROM audit_log WHERE id = 'legacy'`).Scan(&body); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if body != "" {
		t.Fatalf("legacy body was not purged: %d bytes left", len(body))
	}
}
