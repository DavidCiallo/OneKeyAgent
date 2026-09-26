package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"onekey/server/internal/cryptox"
)

var ErrNotFound = errors.New("not found")

// ─────────────────────────── Account ───────────────────────────

const accountCols = "id,name,email,password,api_key,is_admin,tg_chat_id,last_daily_time,balance,create_time,update_time,delete_time"

type Account struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Email         string   `json:"email"`
	Password      string   `json:"password"`
	ApiKey        string   `json:"api_key"`
	IsAdmin       int64    `json:"is_admin"`
	TgChatID      *string  `json:"tg_chat_id"`
	LastDailyTime *int64   `json:"last_daily_time"`
	Balance       float64  `json:"balance"`
	CreateTime    int64    `json:"create_time"`
	UpdateTime    *int64   `json:"update_time"`
	DeleteTime    *int64   `json:"delete_time"`
}

func scanAccount(row interface{ Scan(...any) error }) (*Account, error) {
	a := &Account{}
	err := row.Scan(&a.ID, &a.Name, &a.Email, &a.Password, &a.ApiKey, &a.IsAdmin,
		&a.TgChatID, &a.LastDailyTime, &a.Balance, &a.CreateTime, &a.UpdateTime, &a.DeleteTime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// AccountDTO — password never leaves the server (AccountDTO in TS).
func (a *Account) DTO() map[string]any {
	return map[string]any{
		"id": a.ID, "name": a.Name, "email": a.Email, "api_key": a.ApiKey,
		"is_admin": a.IsAdmin, "tg_chat_id": a.TgChatID, "last_daily_time": a.LastDailyTime,
		"balance": a.Balance, "create_time": a.CreateTime, "update_time": a.UpdateTime,
		"delete_time": a.DeleteTime,
	}
}

func AccountFindByEmail(db *sql.DB, email string, ignoreDelete bool) (*Account, error) {
	q := "SELECT " + accountCols + " FROM account WHERE email = ?"
	if !ignoreDelete {
		q += " AND delete_time IS NULL"
	}
	q += " ORDER BY rowid DESC LIMIT 1"
	return scanAccount(db.QueryRow(q, email))
}

func AccountFindOne(db *sql.DB, id string) (*Account, error) {
	return scanAccount(db.QueryRow(
		"SELECT "+accountCols+" FROM account WHERE id = ? AND delete_time IS NULL", id))
}

func AccountFindByApiKey(db *sql.DB, key string) (*Account, error) {
	return scanAccount(db.QueryRow(
		"SELECT "+accountCols+" FROM account WHERE api_key = ? AND delete_time IS NULL ORDER BY rowid DESC LIMIT 1", key))
}

func AccountFindByLogin(db *sql.DB, email, passwordHash string) (*Account, error) {
	return scanAccount(db.QueryRow(
		"SELECT "+accountCols+" FROM account WHERE email = ? AND password = ? AND delete_time IS NULL ORDER BY rowid DESC LIMIT 1",
		email, passwordHash))
}

func AccountListPage(db *sql.DB, page int64, name, email *string) ([]*Account, int64, error) {
	conds := []string{"delete_time IS NULL"}
	args := []any{}
	if name != nil && *name != "" {
		conds = append(conds, "name = ?")
		args = append(args, *name)
	}
	if email != nil && *email != "" {
		conds = append(conds, "email = ?")
		args = append(args, *email)
	}
	where := strings.Join(conds, " AND ")
	offset := (page - 1) * 10
	if offset < 0 {
		offset = 0
	}
	rows, err := db.Query("SELECT "+accountCols+" FROM account WHERE "+where+" ORDER BY rowid DESC LIMIT 10 OFFSET ?", append(args, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []*Account
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, a)
	}
	var total int64
	if err := db.QueryRow("SELECT COUNT(*) FROM account WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// ── balance (the atomic core that replaces the TS check-then-act) ──

func AccountGetBalance(db *sql.DB, id string) (float64, error) {
	a, err := AccountFindOne(db, id)
	if errors.Is(err, ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return a.Balance, nil
}

// AccountDeductBalance — single atomic UPDATE with a floor at 0.
// Returns the amount actually deducted. Concurrent requests can never
// overdraft past zero (the TS version could).
//
// The deduction and its outbox delta commit together, so a crash cannot record
// a charge that the main database never hears about.
func AccountDeductBalance(db *sql.DB, id string, cost float64) (float64, error) {
	if cost <= 0 {
		return 0, nil
	}
	a, err := AccountFindOne(db, id)
	if errors.Is(err, ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	// A local money write must always reach the buffer while this node syncs —
	// a deduction that commits without its delta is money nobody ever
	// collects. (The outbox's old "suppress during import" switch used to make
	// this branch skip the buffer for deductions landing mid-refresh; see the
	// note in outbox.go.)
	buffer := OutboxOn() && syncDeltaTables["account"]
	if !buffer {
		res, err := db.Exec(
			"UPDATE account SET balance = MAX(balance - ?, 0), update_time = ? WHERE id = ?",
			cost, Now(), id)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, nil
		}
		deducted := a.Balance - cost
		if deducted < 0 {
			deducted = 0
		}
		return deducted, nil
	}

	outboxSeqMu.Lock()
	tx, err := db.Begin()
	if err != nil {
		outboxSeqMu.Unlock()
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		"UPDATE account SET balance = MAX(balance - ?, 0), update_time = ? WHERE id = ?",
		cost, Now(), id); err != nil {
		outboxSeqMu.Unlock()
		return 0, err
	}
	// A negative balance delta: the main database applies the same floor.
	if err := mergeOutboxEntryTx(tx, "account", id, "delta",
		map[string]any{"id": id, "balance": -cost}, true); err != nil {
		outboxSeqMu.Unlock()
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		outboxSeqMu.Unlock()
		return 0, err
	}
	outboxSeqMu.Unlock()

	deducted := a.Balance - cost
	if deducted < 0 {
		deducted = 0
	}
	return deducted, nil
}

// AccountAddBalance — atomic add (topups / bonuses / gift cards).
func AccountAddBalance(db *sql.DB, id string, delta float64) error {
	if delta == 0 {
		return nil
	}
	if OutboxOn() && syncDeltaTables["account"] {
		outboxSeqMu.Lock()
		defer outboxSeqMu.Unlock()
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := tx.Exec("UPDATE account SET balance = balance + ?, update_time = ? WHERE id = ?", delta, Now(), id); err != nil {
			return err
		}
		if err := mergeOutboxEntryTx(tx, "account", id, "delta",
			map[string]any{"id": id, "balance": delta}, true); err != nil {
			return err
		}
		return tx.Commit()
	}
	_, err := db.Exec("UPDATE account SET balance = balance + ?, update_time = ? WHERE id = ?", delta, Now(), id)
	return err
}

// ─────────────────────────── generic row helpers ───────────────────────────

// Column whitelist per table — only these keys may be written dynamically.
var updatable = map[string][]string{
	"account":  {"name", "email", "password", "api_key", "is_admin", "tg_chat_id", "last_daily_time", "balance"},
	"model":    {"alias", "input_price", "cache_price", "output_price", "is_public"},
	"provider": {"model_alias", "priority", "name", "base_url", "model", "api_key", "auth_type", "api_type", "proxy_url", "supports_thinking", "supports_reasoning_effort", "replay_reasoning", "enable_search", "extra_json", "enabled", "max_context", "daily_quota", "active_from", "active_to"},
	"role":     {"name", "type"},
	"settings": {"key", "value"},
	"gift_card": {"code", "token_amount", "status", "redeemed_by", "redeemed_at"},
	"account_role": {"account_id", "role_id"},
	"usage_bucket": {"account_id", "model_alias", "provider_id", "bucket_time", "granularity", "input_tokens", "cached_input_tokens", "output_tokens", "cost", "request_count"},
	"transaction": {"account_id", "txid", "amount", "confirmations", "status", "payment_id", "type"},
	"session_reasoning": {"session_key", "tool_call_id", "reasoning_content"},
	"audit_log": {"ts", "success", "account_id", "account_name", "model_alias", "provider_id", "provider_name", "api_type", "endpoint", "status_code", "duration_ms", "input_tokens", "cached_input_tokens", "output_tokens", "cost", "stream", "err", "request_body", "response_body"},
}

// GenericInsert mirrors the JSONL insert: generates id + timestamps when
// absent, returns the stored row (with generated id) as a map.
func GenericInsert(db *sql.DB, table string, data map[string]any) (map[string]any, error) {
	cols, ok := updatable[table]
	if !ok {
		return nil, fmt.Errorf("unknown table %s", table)
	}
	now := Now()
	row := map[string]any{}
	for k, v := range data {
		row[k] = v
	}
	id, _ := row["id"].(string)
	if id == "" {
		id = cryptox.Nanoid(6)
		row["id"] = id
	}
	if _, ok := row["create_time"]; !ok {
		row["create_time"] = now
	}
	if _, ok := row["update_time"]; !ok {
		row["update_time"] = now
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
		return nil, err
	}
	invalidateForTable(table)
	row["id"] = id
	if syncPutTables[table] {
		_ = EnqueuePut(db, table, id, row)
	}
	return row, nil
}

// GenericUpdateByID — partial update restricted to the whitelist.
//
// A soft-deleted row is never patched: the caller reports the change as
// successful while the row stays invisible, which is how a deleted provider
// came to be edited into a state nobody could see. Returns ErrNotFound when no
// live row matches.
func GenericUpdateByID(db *sql.DB, table, id string, data map[string]any) error {
	return genericUpdateByID(db, table, id, data, false)
}

// GenericUpdateByIDIgnoreDelete — same, but also matches a soft-deleted row.
// Only for reviving one; the caller must clear delete_time itself.
func GenericUpdateByIDIgnoreDelete(db *sql.DB, table, id string, data map[string]any) error {
	return genericUpdateByID(db, table, id, data, true)
}

func genericUpdateByID(db *sql.DB, table, id string, data map[string]any, includeDeleted bool) error {
	cols, ok := updatable[table]
	if !ok {
		return fmt.Errorf("unknown table %s", table)
	}
	sets := []string{"update_time = ?"}
	args := []any{Now()}
	for _, c := range cols {
		if v, ok := data[c]; ok {
			sets = append(sets, c+" = ?")
			args = append(args, v)
		}
	}
	// delete_time sits outside the whitelist; a revive clears it.
	if v, ok := data["delete_time"]; ok {
		sets = append(sets, "delete_time = ?")
		args = append(args, v)
	}
	if len(sets) == 1 {
		return nil
	}
	where := "WHERE id = ?"
	if !includeDeleted {
		where += " AND delete_time IS NULL"
	}
	args = append(args, id)
	res, err := db.Exec(fmt.Sprintf("UPDATE \"%s\" SET %s %s", table, strings.Join(sets, ", "), where), args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	invalidateForTable(table)
	if syncPutTables[table] {
		// Only the patched columns need to travel: the main database keeps the
		// rest. Additive columns are stripped by EnqueuePut.
		_ = EnqueuePut(db, table, id, data)
	}
	return nil
}

// GenericSoftDelete — set delete_time.
func GenericSoftDelete(db *sql.DB, table, id string) error {
	now := Now()
	res, err := db.Exec(fmt.Sprintf("UPDATE \"%s\" SET delete_time = ?, update_time = ? WHERE id = ? AND delete_time IS NULL", table), now, now, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	invalidateForTable(table)
	if syncPutTables[table] {
		_ = EnqueuePut(db, table, id, map[string]any{"delete_time": now})
	}
	return nil
}

// GenericRowToMap — read a whole row as a JSON-ready map (export/import, detail).
func GenericRowToMap(db *sql.DB, table, id string, ignoreDelete bool) (map[string]any, error) {
	q := fmt.Sprintf("SELECT * FROM \"%s\" WHERE id = ?", table)
	if !ignoreDelete {
		q += " AND delete_time IS NULL"
	}
	rows, err := db.Query(q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, ErrNotFound
	}
	return rowsToMap(rows)
}

func rowsToMap(rows *sql.Rows) (map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	m := map[string]any{}
	for i, c := range cols {
		v := vals[i]
		if b, ok := v.([]byte); ok {
			m[c] = string(b)
		} else {
			m[c] = v
		}
	}
	return m, nil
}

// CountSince — COUNT(*) with create_time >= since (daily register limit).
func CountAccountSince(db *sql.DB, since int64) (int64, error) {
	var n int64
	err := db.QueryRow("SELECT COUNT(*) FROM account WHERE create_time >= ?", since).Scan(&n)
	return n, err
}

// ExecSetField — small helper for targeted field updates on account.
func AccountSetField(db *sql.DB, id, field string, value any) error {
	switch field {
	case "balance":
		// An absolute balance cannot travel as a put (EnqueuePut strips
		// additive columns) and a refresh would overwrite it with the
		// reconciled value — the set would exist nowhere. Route it through the
		// delta path instead: the change travels to the main database and
		// survives reconciliation here.
		target, ok := toFloat(value)
		if !ok {
			return fmt.Errorf("balance %v is not numeric", value)
		}
		current, err := AccountGetBalance(db, id)
		if err != nil {
			return err
		}
		return AccountAddBalance(db, id, target-current)
	case "name", "email", "password", "api_key", "is_admin", "tg_chat_id", "last_daily_time":
		if _, err := db.Exec("UPDATE account SET "+field+" = ?, update_time = ? WHERE id = ?", value, Now(), id); err != nil {
			return err
		}
		if syncPutTables["account"] {
			_ = EnqueuePut(db, "account", id, map[string]any{field: value})
		}
		return nil
	}
	return fmt.Errorf("field %s not updatable", field)
}

// AccountByIDIgnoreDelete — findOne({ id }, ignore delete) for display names.
func AccountByIDIgnoreDelete(db *sql.DB, id string) (*Account, error) {
	return scanAccount(db.QueryRow("SELECT "+accountCols+" FROM account WHERE id = ?", id))
}
