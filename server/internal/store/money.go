package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"onekey/server/internal/cryptox"
)

// Money is a bare REAL in one unit for the whole database. This file carries
// the one-way switch of that unit from USD to CNY, run by an admin from the
// settings page at whatever rate is configured there.

// MoneyCurrencyKey — "CNY" once the switch has run. Its absence is what makes
// MigrateMoneyToCNY run at all; the rows cannot be converted twice.
const MoneyCurrencyKey = "money_currency"

type moneyColumn struct {
	table string // as written in SQL ("transaction" is reserved)
	name  string // table_name as the outbox stores it
	cols  []string
}

var moneyColumns = []moneyColumn{
	{"account", "account", []string{"balance"}},
	{"model", "model", []string{"input_price", "cache_price", "output_price"}},
	{"gift_card", "gift_card", []string{"token_amount"}},
	{`"transaction"`, "transaction", []string{"amount"}},
	{"usage_bucket", "usage_bucket", []string{"cost"}},
	{"audit_log", "audit_log", []string{"cost"}},
}

// MigrateMoneyToCNY multiplies every money column by rate and marks the
// database as CNY. A second call is a no-op.
//
// A replica runs it too, and its buffered deltas are scaled here as well: the
// replica's balance is reconciled as the main database's value plus its own
// unpushed deltas, so a dollar delta left in the buffer would be added to a CNY
// balance on the next refresh.
func MigrateMoneyToCNY(db *sql.DB, rate float64) (bool, error) {
	cur, err := moneyCurrency(db)
	if err != nil {
		return false, err
	}
	if cur == "CNY" {
		return false, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	for _, t := range moneyColumns {
		for _, col := range t.cols {
			if _, err := tx.Exec(`UPDATE `+t.table+` SET `+col+` = ROUND(`+col+` * ?, 6)`, rate); err != nil {
				tx.Rollback()
				return false, fmt.Errorf("scale %s.%s: %w", t.table, col, err)
			}
		}
	}
	if err := scaleOutboxMoney(tx, rate); err != nil {
		tx.Rollback()
		return false, err
	}
	if err := setSettingTx(tx, MoneyCurrencyKey, "CNY"); err != nil {
		tx.Rollback()
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func moneyCurrency(db *sql.DB) (string, error) {
	var cur string
	err := db.QueryRow(`SELECT value FROM settings WHERE key = ?`, MoneyCurrencyKey).Scan(&cur)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(cur), nil
}

// MoneyCurrency — the unit the stored rows are in: "CNY" after the conversion
// has run, "USD" until an admin runs it.
func MoneyCurrency(db *sql.DB) string {
	cur, err := moneyCurrency(db)
	if err != nil || cur != "CNY" {
		return "USD"
	}
	return "CNY"
}

// scaleOutboxMoney — rewrite the buffered payloads that carry money, so a
// replica's unpushed deltas and admin edits land on the main database in the
// same unit as the rows they merge into.
func scaleOutboxMoney(tx *sql.Tx, rate float64) error {
	cols := map[string][]string{}
	for _, t := range moneyColumns {
		cols[t.name] = t.cols
	}

	type rewrite struct{ id, payload string }
	var changed []rewrite

	rows, err := tx.Query("SELECT id, table_name, payload FROM outbox")
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, table, payload string
		if err := rows.Scan(&id, &table, &payload); err != nil {
			rows.Close()
			return err
		}
		moneyCols, ok := cols[table]
		if !ok {
			continue
		}
		m := decodePayload(payload)
		touched := false
		for _, col := range moneyCols {
			if f, ok := payloadNumber(m[col]); ok {
				// Round6 is the settlement helper and truncates toward zero, which
				// leaves a 1e-6 on negative deltas; math.Round does not.
				m[col] = math.Round(f*rate*1e6) / 1e6
				touched = true
			}
		}
		if !touched {
			continue
		}
		encoded, err := encodePayload(m)
		if err != nil {
			rows.Close()
			return err
		}
		changed = append(changed, rewrite{id, encoded})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range changed {
		if _, err := tx.Exec("UPDATE outbox SET payload = ? WHERE id = ?", r.payload, r.id); err != nil {
			return err
		}
	}
	return nil
}

func payloadNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case float64:
		return n, true
	}
	return 0, false
}

// setSettingTx — plain-SQL upsert for the migration markers: they describe this
// database, not an admin edit, so they must not be queued for the main database.
func setSettingTx(tx *sql.Tx, key, value string) error {
	_, err := tx.Exec(`INSERT INTO settings (id, key, value, create_time, update_time, delete_time)
		VALUES (?, ?, ?, ?, ?, NULL)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, update_time = excluded.update_time`,
		cryptox.Nanoid(6), key, value, Now(), Now())
	return err
}
