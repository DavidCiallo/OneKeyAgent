// Package store — SQLite storage. One real table per collection (was one
// JSONL file per collection): indexed single-row SQL everywhere, atomic
// balance updates, no whole-file rewrites.
//
// Schema is declared as data (tables → columns) rather than raw CREATE TABLE
// strings so that Open can reconcile an existing database against it: CREATE
// TABLE IF NOT EXISTS silently skips a table that already exists, which would
// otherwise leave databases created by an older build permanently missing any
// column added since (observed as "no such column: last_daily_time" on a
// redeploy over an existing data volume).
package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// colDef — one column: its name and the definition that follows it.
type colDef struct {
	name string
	ddl  string
}

type tableDef struct {
	name string // may be quoted, e.g. `"transaction"` (SQL reserved word)
	cols []colDef
}

// tables — every collection's column definitions, in creation order.
var tables = []tableDef{
	{"account", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"name", "TEXT NOT NULL DEFAULT ''"},
		{"email", "TEXT NOT NULL DEFAULT ''"},
		{"password", "TEXT NOT NULL DEFAULT ''"},
		{"api_key", "TEXT NOT NULL DEFAULT ''"},
		{"is_admin", "INTEGER NOT NULL DEFAULT 0"},
		{"tg_chat_id", "TEXT"},
		{"last_daily_time", "INTEGER"},
		{"balance", "REAL NOT NULL DEFAULT 0"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"model", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"alias", "TEXT NOT NULL DEFAULT ''"},
		{"input_price", "REAL NOT NULL DEFAULT 0"},
		{"cache_price", "REAL NOT NULL DEFAULT 0"},
		{"output_price", "REAL NOT NULL DEFAULT 0"},
		{"is_public", "INTEGER NOT NULL DEFAULT 0"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"provider", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"model_alias", "TEXT NOT NULL DEFAULT ''"},
		{"priority", "INTEGER NOT NULL DEFAULT 0"},
		{"name", "TEXT NOT NULL DEFAULT ''"},
		{"base_url", "TEXT NOT NULL DEFAULT ''"},
		{"model", "TEXT NOT NULL DEFAULT ''"},
		{"api_key", "TEXT"},
		{"auth_type", "TEXT"},
		{"api_type", "TEXT"},
		{"proxy_url", "TEXT"},
		{"supports_thinking", "INTEGER"},
		{"supports_reasoning_effort", "INTEGER"},
		{"replay_reasoning", "INTEGER"},
		{"enable_search", "INTEGER"},
		{"extra_json", "TEXT"},
		{"enabled", "INTEGER NOT NULL DEFAULT 1"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"role", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"name", "TEXT NOT NULL DEFAULT ''"},
		{"type", "TEXT NOT NULL DEFAULT 'menu'"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"account_role", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"account_id", "TEXT NOT NULL DEFAULT ''"},
		{"role_id", "TEXT NOT NULL DEFAULT ''"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"settings", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"key", "TEXT NOT NULL DEFAULT ''"},
		{"value", "TEXT NOT NULL DEFAULT ''"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"usage_bucket", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"account_id", "TEXT NOT NULL DEFAULT ''"},
		{"model_alias", "TEXT NOT NULL DEFAULT ''"},
		{"provider_id", "TEXT NOT NULL DEFAULT ''"},
		{"bucket_time", "INTEGER NOT NULL DEFAULT 0"},
		{"granularity", "TEXT NOT NULL DEFAULT '1m'"},
		{"input_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"cached_input_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"output_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"cost", "REAL NOT NULL DEFAULT 0"},
		{"request_count", "INTEGER NOT NULL DEFAULT 0"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"gift_card", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"code", "TEXT NOT NULL DEFAULT ''"},
		{"token_amount", "REAL NOT NULL DEFAULT 0"},
		{"status", "TEXT NOT NULL DEFAULT 'unused'"},
		{"redeemed_by", "TEXT"},
		{"redeemed_at", "INTEGER"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	// "transaction" is an SQL reserved word — quoted table name.
	{`"transaction"`, []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"account_id", "TEXT NOT NULL DEFAULT ''"},
		{"txid", "TEXT NOT NULL DEFAULT ''"},
		{"amount", "REAL NOT NULL DEFAULT 0"},
		{"confirmations", "INTEGER NOT NULL DEFAULT 0"},
		{"status", "TEXT NOT NULL DEFAULT 'pending'"},
		{"payment_id", "TEXT NOT NULL DEFAULT ''"},
		{"type", "TEXT NOT NULL DEFAULT 'topup'"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"session_reasoning", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"session_key", "TEXT NOT NULL DEFAULT ''"},
		{"tool_call_id", "TEXT NOT NULL DEFAULT ''"},
		{"reasoning_content", "TEXT NOT NULL DEFAULT ''"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	{"audit_log", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"ts", "INTEGER NOT NULL DEFAULT 0"},
		{"success", "INTEGER NOT NULL DEFAULT 0"},
		{"account_id", "TEXT NOT NULL DEFAULT ''"},
		{"account_name", "TEXT NOT NULL DEFAULT ''"},
		{"model_alias", "TEXT NOT NULL DEFAULT ''"},
		{"provider_id", "TEXT NOT NULL DEFAULT ''"},
		{"provider_name", "TEXT NOT NULL DEFAULT ''"},
		{"api_type", "TEXT NOT NULL DEFAULT ''"},
		{"endpoint", "TEXT NOT NULL DEFAULT ''"},
		{"status_code", "INTEGER NOT NULL DEFAULT 0"},
		{"duration_ms", "INTEGER NOT NULL DEFAULT 0"},
		{"input_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"cached_input_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"output_tokens", "INTEGER NOT NULL DEFAULT 0"},
		{"cost", "REAL NOT NULL DEFAULT 0"},
		{"stream", "INTEGER NOT NULL DEFAULT 0"},
		{"err", "TEXT NOT NULL DEFAULT ''"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
}

// indexes — created after column reconciliation, so an index over a column
// that had to be added to an older database still succeeds.
var indexes = []string{
	`CREATE INDEX IF NOT EXISTS idx_account_email ON account(email)`,
	`CREATE INDEX IF NOT EXISTS idx_account_api_key ON account(api_key)`,
	`CREATE INDEX IF NOT EXISTS idx_account_tg_chat ON account(tg_chat_id)`,
	`CREATE INDEX IF NOT EXISTS idx_model_alias ON model(alias)`,
	`CREATE INDEX IF NOT EXISTS idx_provider_alias_enabled ON provider(model_alias, enabled)`,
	`CREATE INDEX IF NOT EXISTS idx_role_name_type ON role(name, type)`,
	`CREATE INDEX IF NOT EXISTS idx_account_role_account ON account_role(account_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_gt ON usage_bucket(granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_acct ON usage_bucket(account_id, granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_window ON usage_bucket(account_id, model_alias, provider_id, granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_code ON gift_card(code)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_redeemed_by ON gift_card(redeemed_by)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_status ON "transaction"(status)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_account ON "transaction"(account_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_txid ON "transaction"(txid)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_success_ts ON audit_log(success, ts)`,
}

// createDDL — the CREATE TABLE statement for this table.
func (t tableDef) createDDL() string {
	parts := make([]string, 0, len(t.cols))
	for _, c := range t.cols {
		parts = append(parts, c.name+" "+c.ddl)
	}
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n\t\t%s\n\t)",
		t.name, strings.Join(parts, ",\n\t\t"))
}

func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(0)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	for _, t := range tables {
		if _, err := db.Exec(t.createDDL()); err != nil {
			return nil, fmt.Errorf("schema %s: %w", t.name, err)
		}
	}
	if err := reconcileColumns(db); err != nil {
		return nil, err
	}
	for _, stmt := range indexes {
		if _, err := db.Exec(stmt); err != nil {
			return nil, fmt.Errorf("index: %w", err)
		}
	}

	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	return db, nil
}

// reconcileColumns adds any column declared in the schema but missing from an
// existing table. This is what makes upgrading in place safe: a database
// created by an older build keeps its data and gains the new columns.
func reconcileColumns(db *sql.DB) error {
	for _, t := range tables {
		existing, err := tableColumns(db, t.name)
		if err != nil {
			return err
		}
		if len(existing) == 0 {
			continue // table absent despite CREATE above; nothing to reconcile
		}
		for _, c := range t.cols {
			if existing[c.name] {
				continue
			}
			// SQLite forbids adding a PRIMARY KEY column, and every table
			// already has one, so id is never a candidate.
			if c.name == "id" {
				continue
			}
			stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", t.name, c.name, c.ddl)
			if _, err := db.Exec(stmt); err != nil {
				return fmt.Errorf("add column %s.%s: %w", t.name, c.name, err)
			}
		}
	}
	return nil
}

// tableColumns — the set of column names present in a table.
func tableColumns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, fmt.Errorf("table_info %s: %w", table, err)
	}
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var cid, notNull, pk int
		var name, typ string
		var dflt any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols[name] = true
	}
	return cols, rows.Err()
}

func Now() int64 { return time.Now().UnixMilli() }

func Round6(x float64) float64 { return float64(int64(x*1e6+0.5)) / 1e6 }
