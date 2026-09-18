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

// TestAuditDetailWindowClearsOldBodies — bodies live on the newest
// AuditDetailKeep failures only; older rows keep their error text but lose the
// payloads. A repeat of a request whose body was already aged out is recorded
// again (suppression only applies while a recent copy holds the body), while a
// repeat of one still holding its body stays folded away.
func TestAuditDetailWindowClearsOldBodies(t *testing.T) {
	db, err := Open(t.TempDir() + "/audit2.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	body := func(i int) string {
		// Distinct within the first 1000 characters, so each is its own request.
		return fmt.Sprintf("msg-%03d ", i) + strings.Repeat("x", 1050)
	}
	for i := 0; i < AuditDetailKeep+2; i++ {
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
	if len(rows) != AuditDetailKeep+2 {
		t.Fatalf("got %d rows, want %d — distinct failures must all be kept", len(rows), AuditDetailKeep+2)
	}
	withBody := 0
	for _, r := range rows {
		if r.RequestBody != "" {
			withBody++
			if !strings.Contains(r.RequestBody, "xxxxx") {
				t.Fatalf("stored body unexpected: %q", r.RequestBody[:20])
			}
		}
	}
	if withBody != AuditDetailKeep {
		t.Fatalf("%d rows still carry bodies, want %d", withBody, AuditDetailKeep)
	}

	// The two rows aged out of the window lost only their bodies, not their
	// summary or error text.
	stripped := 0
	for _, r := range rows {
		if r.RequestBody == "" && r.ResponseBody == "" && r.Err == "err" && r.StatusCode == 400 {
			stripped++
		}
	}
	if stripped != 2 {
		t.Fatalf("%d aged-out rows lost their bodies, want 2", stripped)
	}

	// A repeat of a body still inside the window is folded into the existing row…
	if err := AuditInsert(db, failRow("dup-live", body(5), "err")); err != nil {
		t.Fatalf("dup-live: %v", err)
	}
	// …while a repeat of an aged-out body earns a fresh detailed row.
	fresh := failRow("dup-old", body(0), "err")
	fresh.Ts = 99999
	if err := AuditInsert(db, fresh); err != nil {
		t.Fatalf("dup-old: %v", err)
	}

	var live, old int
	if err := db.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE id = 'dup-live'`).Scan(&live); err != nil {
		t.Fatalf("count live: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE id = 'dup-old'`).Scan(&old); err != nil {
		t.Fatalf("count old: %v", err)
	}
	if live != 0 {
		t.Fatalf("identical retry inside the detail window was stored as a new log")
	}
	if old != 1 {
		t.Fatalf("repeat of an aged-out body was not recorded again")
	}
	if fresh := func() *AuditLog {
		for _, r := range mustAuditRows(db) {
			if r.ID == "dup-old" {
				return r
			}
		}
		return nil
	}(); fresh == nil || fresh.RequestBody == "" {
		t.Fatalf("the re-recorded row came back without its request body")
	}
}

func mustAuditRows(db *sql.DB) []*AuditLog {
	rows, err := AuditList(db)
	if err != nil {
		panic(err)
	}
	return rows
}
