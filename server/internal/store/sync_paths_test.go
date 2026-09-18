package store

import (
	"database/sql"
	"testing"
)

// mustBatch — drain the local outbox, the way the Syncer does before a push.
func mustBatch(t *testing.T, db *sql.DB) []OutboxEntry {
	t.Helper()
	batch, err := OutboxBatch(db, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	return batch
}

// TestGiftCardRedemptionIsBuffered — a card redeemed on a replica must reach
// the main database as spent, otherwise the main node still reads the code as
// unused and can hand it out a second time (or a re-bootstrapping replica gets
// the unused row straight back).
func TestGiftCardRedemptionIsBuffered(t *testing.T) {
	local, err := Open(t.TempDir() + "/local.db")
	if err != nil {
		t.Fatalf("open local: %v", err)
	}
	defer local.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := GenericInsert(local, "gift_card", map[string]any{
		"code": "CARD1234", "token_amount": 5.0, "status": "unused",
		"redeemed_by": nil, "redeemed_at": nil,
	}); err != nil {
		t.Fatalf("create card: %v", err)
	}
	card, err := CardFindByCode(local, "CARD1234")
	if err != nil {
		t.Fatalf("find card: %v", err)
	}
	ok, err := CardMarkRedeemed(local, card.ID, "acc1")
	if err != nil || !ok {
		t.Fatalf("redeem: ok=%v err=%v", ok, err)
	}

	main, err := Open(t.TempDir() + "/main.db")
	if err != nil {
		t.Fatalf("open main: %v", err)
	}
	defer main.Close()

	batch, err := OutboxBatch(local, 100, 0)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(batch) != 1 {
		t.Fatalf("got %d entries, want 1 (create and redeem fold into one row)", len(batch))
	}
	if err := ApplyOutbox(main, batch[0]); err != nil {
		t.Fatalf("apply: %v", err)
	}
	spent, err := CardFindByCode(main, "CARD1234")
	if err != nil {
		t.Fatalf("main find card: %v", err)
	}
	if spent.Status != "redeemed" {
		t.Fatalf("main card status = %q, want redeemed", spent.Status)
	}
	if spent.RedeemedBy == nil || *spent.RedeemedBy != "acc1" {
		t.Fatalf("main card redeemed_by = %v, want acc1", spent.RedeemedBy)
	}
	// The main node now refuses a second claim of the same code.
	again, err := CardMarkRedeemed(main, spent.ID, "acc2")
	if err != nil {
		t.Fatalf("main re-redeem: %v", err)
	}
	if again {
		t.Fatalf("main let an already-spent card be redeemed again")
	}
}

// TestCardCleanupRetiresOnMain — dropping expired unused cards on a replica
// must retire them on the main database too, or the code stays redeemable
// there and comes back on the next bootstrap.
func TestCardCleanupRetiresOnMain(t *testing.T) {
	local, err := Open(t.TempDir() + "/local.db")
	if err != nil {
		t.Fatalf("open local: %v", err)
	}
	defer local.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := GenericInsert(local, "gift_card", map[string]any{
		"code": "OLD12345", "token_amount": 2.0, "status": "unused",
		"create_time": Now() - 40*24*60*60*1000,
	}); err != nil {
		t.Fatalf("create card: %v", err)
	}
	n, err := CardCleanupExpired(local, Now()-30*24*60*60*1000)
	if err != nil || n != 1 {
		t.Fatalf("cleanup: n=%d err=%v", n, err)
	}
	if _, err := CardFindByCode(local, "OLD12345"); err != ErrNotFound {
		t.Fatalf("local lookup after cleanup = %v, want ErrNotFound", err)
	}

	main, err := Open(t.TempDir() + "/main.db")
	if err != nil {
		t.Fatalf("open main: %v", err)
	}
	defer main.Close()
	for _, e := range mustBatch(t, local) {
		if err := ApplyOutbox(main, e); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}
	if _, err := CardFindByCode(main, "OLD12345"); err != ErrNotFound {
		t.Fatalf("main lookup after cleanup = %v, want ErrNotFound", err)
	}
}

// TestTransactionStatusPatchIsBuffered — an invoice confirmed on a replica has
// to carry its state to the main database, or the main's monitor treats it as
// still pending and re-confirms it.
func TestTransactionStatusPatchIsBuffered(t *testing.T) {
	local, err := Open(t.TempDir() + "/local.db")
	if err != nil {
		t.Fatalf("open local: %v", err)
	}
	defer local.Close()
	SetOutboxEnabled(true)
	defer SetOutboxEnabled(false)
	InvalidateRefCache()

	if _, err := GenericInsert(local, "transaction", map[string]any{
		"account_id": "acc1", "txid": "inv-1", "amount": 9.5,
		"confirmations": 0, "status": "pending", "type": "topup",
	}); err != nil {
		t.Fatalf("create tx: %v", err)
	}
	if err := TxUpdateByTxid(local, "inv-1", map[string]any{
		"payment_id": "pay-1", "status": "confirmed", "confirmations": 1,
	}); err != nil {
		t.Fatalf("patch tx: %v", err)
	}

	main, err := Open(t.TempDir() + "/main.db")
	if err != nil {
		t.Fatalf("open main: %v", err)
	}
	defer main.Close()
	for _, e := range mustBatch(t, local) {
		if err := ApplyOutbox(main, e); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}
	pending, err := TxPending(main)
	if err != nil {
		t.Fatalf("main pending: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("main still lists %d pending invoices; the confirmation never landed", len(pending))
	}
}
