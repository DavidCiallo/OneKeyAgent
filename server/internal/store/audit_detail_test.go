package store

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func failRow(id, body, errText string) AuditLog {
	return AuditLog{ID: id, Success: 0, StatusCode: 400, Err: errText, RequestBody: body, ResponseBody: "resp-of-" + id}
}

// TestAuditDetailRetentionAndDedupe — failed attempts carry what was sent and
// what came back, but only for the newest few: identical retries must not pile
// up duplicate rows, and bodies older than the detail window are cleared while
// the row itself stays for its summary.
func TestAuditDetailRetentionAndDedupe(t *testing.T) {
	db, err := Open(t.TempDir() + "/audit.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	body := `{"model":"deepseek-chat","messages":[{"role":"user","content":"问"}]}`

	// First occurrence is recorded with its bodies.
	if err := AuditInsert(db, failRow("a1", body, "upstream http 400: bad tool messages")); err != nil {
		t.Fatalf("insert 1: %v", err)
	}
	// A retry of the same request failing the same way is not a new log.
	if err := AuditInsert(db, failRow("a2", body, "upstream http 400: bad tool messages")); err != nil {
		t.Fatalf("insert 2: %v", err)
	}
	// The same request failing differently IS a new log.
	if err := AuditInsert(db, failRow("a3", body, "upstream http 401: bad key")); err != nil {
		t.Fatalf("insert 3: %v", err)
	}

	rows, err := AuditList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	failed := 0
	for _, r := range rows {
		if r.Success == 0 {
			failed++
		}
	}
	if failed != 2 {
		t.Fatalf("got %d failed rows, want 2 (the identical retry must be folded away)", failed)
	}
	for _, r := range rows {
		if r.ID == "a2" {
			t.Fatalf("duplicate retry a2 was stored")
		}
		if r.ID == "a3" && r.RequestBody != body {
			t.Fatalf("row a3 lost its request body")
		}
	}
}

// TestAuditBodyKeptForAllRetainedFailures — every retained failure keeps its
// body summary. There is no separate detail window any more: the row count is
// small enough (AuditKeep) that bodies simply live as long as the row does.
func TestAuditBodyKeptForAllRetainedFailures(t *testing.T) {
	db, err := Open(t.TempDir() + "/audit2.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	body := func(i int) string {
		// Distinct within the first 1000 characters, so each is its own request.
		return fmt.Sprintf("msg-%03d ", i) + strings.Repeat("x", 1050)
	}
	for i := 0; i < AuditKeep+2; i++ {
		row := failRow(fmt.Sprintf("r%02d", i), body(i), "err")
		row.Ts = int64(1000 + i)
		if err := AuditInsert(db, row); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}

	rows, err := AuditList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// Retention is the only bound: exactly AuditKeep failures survive.
	if len(rows) != AuditKeep {
		t.Fatalf("got %d rows, want %d — retention must hold the newest only", len(rows), AuditKeep)
	}
	if rows[0].ID != fmt.Sprintf("r%02d", AuditKeep+1) {
		t.Fatalf("newest row is %s, want r%02d", rows[0].ID, AuditKeep+1)
	}
	// Every surviving row still carries its body summary.
	for _, r := range rows {
		if r.RequestBody == "" {
			t.Fatalf("row %s lost its request body", r.ID)
		}
		if !strings.Contains(r.RequestBody, "xxxxx") {
			t.Fatalf("stored body unexpected: %q", r.RequestBody[:20])
		}
	}
}

func mustAuditRows(db *sql.DB) []*AuditLog {
	rows, err := AuditList(db)
	if err != nil {
		panic(err)
	}
	return rows
}
