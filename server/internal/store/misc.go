package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"onekey/server/internal/cryptox"
)

// ─────────────────────────── Transaction ───────────────────────────

const txCols = "id,account_id,txid,amount,confirmations,status,payment_id,type,create_time,update_time,delete_time"

type Transaction struct {
	ID            string   `json:"id"`
	AccountID     string   `json:"account_id"`
	Txid          string   `json:"txid"`
	Amount        float64  `json:"amount"`
	Confirmations int64    `json:"confirmations"`
	Status        string   `json:"status"`
	PaymentID     string   `json:"payment_id"`
	Type          string   `json:"type"`
	CreateTime    int64    `json:"create_time"`
	UpdateTime    *int64   `json:"update_time"`
	DeleteTime    *int64   `json:"delete_time"`
}

func scanTx(row interface{ Scan(...any) error }) (*Transaction, error) {
	t := &Transaction{}
	err := row.Scan(&t.ID, &t.AccountID, &t.Txid, &t.Amount, &t.Confirmations, &t.Status, &t.PaymentID, &t.Type,
		&t.CreateTime, &t.UpdateTime, &t.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return t, nil
}

func TxByAccount(db *sql.DB, accountID string) ([]*Transaction, error) {
	rows, err := db.Query(`SELECT `+txCols+` FROM "transaction" WHERE account_id = ? AND delete_time IS NULL ORDER BY rowid DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Transaction
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func TxPending(db *sql.DB) ([]*Transaction, error) {
	rows, err := db.Query(`SELECT ` + txCols + ` FROM "transaction" WHERE status = 'pending' AND delete_time IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Transaction
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TxUpdateByTxid — patch subset of fields by invoice id.
//
// The change is buffered like any other admin write: an invoice confirmed on a
// replica has to reach the main database, or the two nodes disagree about
// whether the payment happened and the monitor re-confirms it there.
func TxUpdateByTxid(db *sql.DB, txid string, patch map[string]any) error {
	sets := []string{"update_time = ?"}
	args := []any{Now()}
	travel := map[string]any{}
	for _, key := range []string{"payment_id", "status", "confirmations", "amount"} {
		if v, ok := patch[key]; ok {
			sets = append(sets, key+" = ?")
			args = append(args, v)
			travel[key] = v
		}
	}
	if len(sets) == 1 {
		return nil
	}
	args = append(args, txid)
	if _, err := db.Exec(fmt.Sprintf(`UPDATE "transaction" SET %s WHERE txid = ?`, strings.Join(sets, ", ")), args...); err != nil {
		return err
	}
	if syncPutTables["transaction"] {
		if id, err := txIDByTxid(db, txid); err == nil && id != "" {
			_ = EnqueuePut(db, "transaction", id, travel)
		}
	}
	return nil
}

// txIDByTxid — the local row id behind an invoice id, used as the outbox
// collapse key so repeated status patches fold into one entry.
func txIDByTxid(db *sql.DB, txid string) (string, error) {
	var id string
	err := db.QueryRow(`SELECT id FROM "transaction" WHERE txid = ? ORDER BY rowid DESC LIMIT 1`, txid).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// ─────────────────────────── Gift card ───────────────────────────

const cardCols = "id,code,token_amount,status,redeemed_by,redeemed_at,create_time,update_time,delete_time"

type GiftCard struct {
	ID          string   `json:"id"`
	Code        string   `json:"code"`
	TokenAmount float64  `json:"token_amount"`
	Status      string   `json:"status"`
	RedeemedBy  *string  `json:"redeemed_by"`
	RedeemedAt  *int64   `json:"redeemed_at"`
	CreateTime  int64    `json:"create_time"`
	UpdateTime  *int64   `json:"update_time"`
	DeleteTime  *int64   `json:"delete_time"`
}

func scanCard(row interface{ Scan(...any) error }) (*GiftCard, error) {
	c := &GiftCard{}
	err := row.Scan(&c.ID, &c.Code, &c.TokenAmount, &c.Status, &c.RedeemedBy, &c.RedeemedAt,
		&c.CreateTime, &c.UpdateTime, &c.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (c *GiftCard) DTO() map[string]any {
	return map[string]any{
		"id": c.ID, "code": c.Code, "token_amount": c.TokenAmount, "status": c.Status,
		"redeemed_by": c.RedeemedBy, "redeemed_at": c.RedeemedAt, "create_time": c.CreateTime,
		"update_time": c.UpdateTime, "delete_time": c.DeleteTime,
	}
}

func CardFindByCode(db *sql.DB, code string) (*GiftCard, error) {
	return scanCard(db.QueryRow(
		"SELECT "+cardCols+" FROM gift_card WHERE code = ? AND delete_time IS NULL ORDER BY rowid DESC LIMIT 1", code))
}

func CardAllActive(db *sql.DB) ([]*GiftCard, error) {
	rows, err := db.Query("SELECT " + cardCols + " FROM gift_card WHERE delete_time IS NULL")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*GiftCard
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func CardRedeemedBy(db *sql.DB, accountID string) ([]*GiftCard, error) {
	rows, err := db.Query(
		"SELECT "+cardCols+" FROM gift_card WHERE redeemed_by = ? AND status = 'redeemed' AND delete_time IS NULL", accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*GiftCard
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CardMarkRedeemed — atomic claim, only flips while still unused. Also fixes
// the TS double-redeem race (check-then-update there).
//
// The claim is buffered so the main database learns the card is spent. Without
// it a card redeemed on a replica still reads as unused on the main node, which
// can hand the same code out again — and a replica that re-bootstraps from the
// main database gets the unused row straight back.
func CardMarkRedeemed(db *sql.DB, id, accountID string) (bool, error) {
	now := Now()
	res, err := db.Exec(
		`UPDATE gift_card SET status = 'redeemed', redeemed_by = ?, redeemed_at = ?, update_time = ?
		 WHERE id = ? AND status = 'unused'`,
		accountID, now, now, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 && syncPutTables["gift_card"] {
		_ = EnqueuePut(db, "gift_card", id, map[string]any{
			"status": "redeemed", "redeemed_by": accountID, "redeemed_at": now,
		})
	}
	return n > 0, nil
}

// CardCleanupExpired — drop unused cards older than the cutoff.
//
// Each removed card is buffered as a delete so the main database retires it
// too; a hard local delete plus a live row on the main node would leave the
// code redeemable there.
func CardCleanupExpired(db *sql.DB, before int64) (int64, error) {
	rows, err := db.Query(
		"SELECT id FROM gift_card WHERE status = 'unused' AND delete_time IS NULL AND create_time < ?", before)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	now := Now()
	for _, id := range ids {
		if _, err := db.Exec("DELETE FROM gift_card WHERE id = ?", id); err != nil {
			return 0, err
		}
		if syncPutTables["gift_card"] {
			_ = EnqueuePut(db, "gift_card", id, map[string]any{"delete_time": now})
		}
	}
	return int64(len(ids)), nil
}

// ─────────────────────────── Export / Import helpers ───────────────────────────

// AllRowsIgnoreDelete — full table read as JSON-ready maps (export).
func AllRowsIgnoreDelete(db *sql.DB, table string) ([]map[string]any, error) {
	rows, err := db.Query(fmt.Sprintf("SELECT * FROM \"%s\"", table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		m, err := rowsToMap(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Truncate — wipe a collection (import).
func Truncate(db *sql.DB, table string) error {
	_, err := db.Exec(fmt.Sprintf("DELETE FROM \"%s\"", table))
	if err == nil {
		invalidateForTable(table)
	}
	return err
}

// BatchInsertRows — insert pre-shaped rows preserving ids (import).
func BatchInsertRows(db *sql.DB, table string, items []map[string]any) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	cols, ok := updatable[table]
	if !ok {
		return 0, fmt.Errorf("unknown table %s", table)
	}
	count := 0
	for _, item := range items {
		row := map[string]any{}
		for k, v := range item {
			row[k] = v
		}
		id, _ := row["id"].(string)
		if id == "" {
			id = cryptox.Nanoid(6)
			row["id"] = id
		}
		if _, ok := row["create_time"]; !ok {
			row["create_time"] = Now()
		}
		if _, ok := row["update_time"]; !ok {
			row["update_time"] = Now()
		}
		if _, ok := row["delete_time"]; !ok {
			row["delete_time"] = nil
		}
		names := []string{"id"}
		args := []any{id}
		for _, c := range cols {
			if v, ok := row[c]; ok {
				names = append(names, c)
				args = append(args, v)
			}
		}
		for _, c := range []string{"create_time", "update_time", "delete_time"} {
			names = append(names, c)
			args = append(args, row[c])
		}
		ph := strings.TrimSuffix(strings.Repeat("?,", len(names)), ",")
		q := fmt.Sprintf("INSERT OR REPLACE INTO \"%s\" (%s) VALUES (%s)", table, strings.Join(names, ","), ph)
		if _, err := db.Exec(q, args...); err != nil {
			return count, err
		}
		count++
	}
	invalidateForTable(table)
	return count, nil
}

// DTO — transaction payload for the frontend.
func (t *Transaction) DTO() map[string]any {
	return map[string]any{
		"id": t.ID, "account_id": t.AccountID, "txid": t.Txid, "amount": t.Amount,
		"confirmations": t.Confirmations, "status": t.Status, "payment_id": t.PaymentID,
		"type": t.Type, "create_time": t.CreateTime, "update_time": t.UpdateTime,
		"delete_time": t.DeleteTime,
	}
}
