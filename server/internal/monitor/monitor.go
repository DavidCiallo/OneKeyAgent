// Payment monitor — polls NowPayments for pending invoices every minute
// (subscription/monitor.ts).
package monitor

import (
	"database/sql"
	"fmt"
	"time"

	"onekey/server/internal/service"
	"onekey/server/internal/store"
)

func Start(db *sql.DB, settings *service.Settings) {
	fmt.Println("[Monitor] Starting payment monitor...")
	go func() {
		runOnce(db, settings)
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			runOnce(db, settings)
		}
	}()
}

func runOnce(db *sql.DB, settings *service.Settings) {
	if err := checkPendingPayments(db, settings); err != nil {
		fmt.Println("[Monitor] Error:", err)
	}
}

func checkPendingPayments(db *sql.DB, settings *service.Settings) error {
	pending, err := store.TxPending(db)
	if err != nil {
		return err
	}
	for _, record := range pending {
		if record.PaymentID == "" {
			if store.Now()-record.CreateTime > 30*60*1000 {
				_ = store.TxUpdateByTxid(db, record.Txid, map[string]any{"status": "expired"})
				fmt.Println(time.Now(), "[Monitor] Payment expired for", record.AccountID)
			}
			continue
		}
		status, _, err := service.NowPaymentsStatus(settings, record.PaymentID)
		if err != nil {
			fmt.Println("[Monitor] Check payment", record.PaymentID, "failed:", err)
			continue
		}
		switch status {
		case "confirmed":
			_ = store.TxUpdateByTxid(db, record.Txid, map[string]any{
				"status": "confirmed", "confirmations": 1,
			})
			if err := store.AccountAddBalance(db, record.AccountID, record.Amount); err != nil {
				fmt.Println("[Monitor] balance update failed:", err)
				continue
			}
			fmt.Println("[Monitor] Payment confirmed for", record.AccountID)
		case "expired":
			_ = store.TxUpdateByTxid(db, record.Txid, map[string]any{"status": "expired"})
			fmt.Println("[Monitor] Payment expired for", record.AccountID)
		}
	}
	return nil
}
