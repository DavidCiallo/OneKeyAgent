package store

import (
	"fmt"
	"path/filepath"
	"testing"
)

// TestAuditRetention — the audit table keeps only the newest AuditKeep rows per
// outcome, so a chatty failure loop can't grow it without bound.
func TestAuditRetention(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	const n = AuditKeep + 37
	for i := 0; i < n; i++ {
		// Distinct ts values make "newest" unambiguous.
		if err := AuditInsert(db, AuditLog{
			Ts: int64(1000 + i), Success: 1, ModelAlias: fmt.Sprintf("ok-%d", i),
			ProviderName: "p", StatusCode: 200,
		}); err != nil {
			t.Fatalf("insert ok-%d: %v", i, err)
		}
		if err := AuditInsert(db, AuditLog{
			Ts: int64(2000 + i), Success: 0, ModelAlias: fmt.Sprintf("bad-%d", i),
			ProviderName: "p", StatusCode: 500, Err: "boom",
		}); err != nil {
			t.Fatalf("insert bad-%d: %v", i, err)
		}
	}

	rows, err := AuditList(db)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	var okAliases, badAliases []string
	for _, r := range rows {
		if r.Success == 1 {
			okAliases = append(okAliases, r.ModelAlias)
		} else {
			badAliases = append(badAliases, r.ModelAlias)
		}
	}

	if len(okAliases) != AuditKeep || len(badAliases) != AuditKeep {
		t.Fatalf("kept success=%d failed=%d, want %d each", len(okAliases), len(badAliases), AuditKeep)
	}
	// Newest first: the newest survives, the oldest beyond the window is gone.
	if okAliases[0] != fmt.Sprintf("ok-%d", n-1) || okAliases[len(okAliases)-1] != fmt.Sprintf("ok-%d", n-AuditKeep) {
		t.Errorf("success window = %s..%s, want ok-%d..ok-%d",
			okAliases[0], okAliases[len(okAliases)-1], n-1, n-AuditKeep)
	}
	if badAliases[0] != fmt.Sprintf("bad-%d", n-1) || badAliases[len(badAliases)-1] != fmt.Sprintf("bad-%d", n-AuditKeep) {
		t.Errorf("failed window = %s..%s, want bad-%d..bad-%d",
			badAliases[0], badAliases[len(badAliases)-1], n-1, n-AuditKeep)
	}
}
