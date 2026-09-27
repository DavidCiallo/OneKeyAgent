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
		// The list carries no bodies, only whether one is worth fetching.
		if r.RequestBody != "" || r.ResponseBody != "" {
			t.Fatalf("row %s shipped its body in the list", r.ID)
		}
		if !r.HasDetail {
			t.Fatalf("row %s is not flagged as having a body", r.ID)
		}
	}
	// The body itself comes from the detail lookup the page makes on expand.
	got, err := AuditDetail(db, "a3")
	if err != nil {
		t.Fatalf("detail a3: %v", err)
	}
	if got.RequestBody != body {
		t.Fatalf("row a3 lost its request body")
	}
	if got.ResponseBody != "resp-of-a3" {
		t.Fatalf("row a3 lost its response body: %q", got.ResponseBody)
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
	// Every surviving row still carries its body summary, reachable through the
	// detail lookup rather than in the list.
	for _, r := range rows {
		if !r.HasDetail {
			t.Fatalf("row %s is not flagged as having a body", r.ID)
		}
		got, err := AuditDetail(db, r.ID)
		if err != nil {
			t.Fatalf("detail %s: %v", r.ID, err)
		}
		if got.RequestBody == "" {
			t.Fatalf("row %s lost its request body", r.ID)
		}
		if !strings.Contains(got.RequestBody, "xxxxx") {
			t.Fatalf("stored body unexpected: %q", got.RequestBody[:20])
		}
	}
}

// TestAuditListIsBoundedPerOutcome — the list caps each outcome at AuditKeep
// even when the table holds far more, which is what a table that grew before
// retention existed (or one whose trim failed after its insert) looks like.
// Without the cap the endpoint scanned and returned the whole table to show the
// admin ten rows per tab.
func TestAuditListIsBoundedPerOutcome(t *testing.T) {
	db, err := Open(t.TempDir() + "/audit3.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// Raw SQL, so AuditInsert's trim never runs.
	const n = 500
	for i := 0; i < n; i++ {
		if _, err := db.Exec(`INSERT INTO audit_log (id,ts,success,err,request_body,response_body)
			VALUES (?,?,?,?,?,?)`, fmt.Sprintf("s%03d", i), int64(1000+i), 1, "", "", ""); err != nil {
			t.Fatalf("insert success %d: %v", i, err)
		}
		if _, err := db.Exec(`INSERT INTO audit_log (id,ts,success,err,request_body,response_body)
			VALUES (?,?,?,?,?,?)`, fmt.Sprintf("f%03d", i), int64(1000+i), 0, "boom", "body", "resp"); err != nil {
			t.Fatalf("insert failed %d: %v", i, err)
		}
	}

	rows, err := AuditList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2*AuditKeep {
		t.Fatalf("got %d rows from a %d-row table, want %d", len(rows), 2*n, 2*AuditKeep)
	}
	success, failed := 0, 0
	for _, r := range rows {
		if r.Success == 1 {
			success++
		} else {
			failed++
		}
		// The cap must not be bought by shipping bodies after all.
		if r.RequestBody != "" || r.ResponseBody != "" {
			t.Fatalf("row %s shipped a body in the list", r.ID)
		}
		// has_detail is computed in SQL, so the button still appears.
		if want := r.Success != 1; r.HasDetail != want {
			t.Fatalf("row %s has_detail=%v, want %v", r.ID, r.HasDetail, want)
		}
	}
	if success != AuditKeep || failed != AuditKeep {
		t.Fatalf("kept success=%d failed=%d, want %d each", success, failed, AuditKeep)
	}
	// Capping per outcome keeps the newest of each, not just the newest overall.
	if rows[0].Ts != int64(1000+n-1) {
		t.Fatalf("newest row ts=%d, want %d", rows[0].Ts, 1000+n-1)
	}
}

// TestAuditDetailMissingRow — an id that has been trimmed away is a not-found,
// not a server error: the list an admin is looking at can be a refresh behind.
func TestAuditDetailMissingRow(t *testing.T) {
	db, err := Open(t.TempDir() + "/audit4.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := AuditDetail(db, "nope"); err != ErrNotFound {
		t.Fatalf("AuditDetail(missing) = %v, want ErrNotFound", err)
	}
}

func mustAuditRows(db *sql.DB) []*AuditLog {
	rows, err := AuditList(db)
	if err != nil {
		panic(err)
	}
	return rows
}
