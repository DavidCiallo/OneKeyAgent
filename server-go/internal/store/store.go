// Package store — SQLite storage. One real table per collection (was one
// JSONL file per collection): indexed single-row SQL everywhere, atomic
// balance updates, no whole-file rewrites.
package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

var Schema = []string{
	`CREATE TABLE IF NOT EXISTS account (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		email TEXT NOT NULL DEFAULT '',
		password TEXT NOT NULL DEFAULT '',
		api_key TEXT NOT NULL DEFAULT '',
		is_admin INTEGER NOT NULL DEFAULT 0,
		tg_chat_id TEXT,
		last_daily_time INTEGER,
		balance REAL NOT NULL DEFAULT 0,
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_account_email ON account(email)`,
	`CREATE INDEX IF NOT EXISTS idx_account_api_key ON account(api_key)`,
	`CREATE INDEX IF NOT EXISTS idx_account_tg_chat ON account(tg_chat_id)`,
	`CREATE TABLE IF NOT EXISTS model (
		id TEXT PRIMARY KEY,
		alias TEXT NOT NULL DEFAULT '',
		input_price REAL NOT NULL DEFAULT 0,
		cache_price REAL NOT NULL DEFAULT 0,
		output_price REAL NOT NULL DEFAULT 0,
		is_public INTEGER NOT NULL DEFAULT 0,
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_model_alias ON model(alias)`,
	`CREATE TABLE IF NOT EXISTS provider (
		id TEXT PRIMARY KEY,
		model_alias TEXT NOT NULL DEFAULT '',
		priority INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL DEFAULT '',
		base_url TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT '',
		api_key TEXT,
		auth_type TEXT,
		api_type TEXT,
		proxy_url TEXT,
		supports_thinking INTEGER,
		supports_reasoning_effort INTEGER,
		replay_reasoning INTEGER,
		enable_search INTEGER,
		enabled INTEGER NOT NULL DEFAULT 1,
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_provider_alias_enabled ON provider(model_alias, enabled)`,
	`CREATE TABLE IF NOT EXISTS role (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		type TEXT NOT NULL DEFAULT 'menu',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_role_name_type ON role(name, type)`,
	`CREATE TABLE IF NOT EXISTS account_role (
		id TEXT PRIMARY KEY,
		account_id TEXT NOT NULL DEFAULT '',
		role_id TEXT NOT NULL DEFAULT '',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_account_role_account ON account_role(account_id)`,
	`CREATE TABLE IF NOT EXISTS settings (
		id TEXT PRIMARY KEY,
		key TEXT NOT NULL DEFAULT '',
		value TEXT NOT NULL DEFAULT '',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)`,
	`CREATE TABLE IF NOT EXISTS usage_bucket (
		id TEXT PRIMARY KEY,
		account_id TEXT NOT NULL DEFAULT '',
		model_alias TEXT NOT NULL DEFAULT '',
		provider_id TEXT NOT NULL DEFAULT '',
		bucket_time INTEGER NOT NULL DEFAULT 0,
		granularity TEXT NOT NULL DEFAULT '1m',
		input_tokens INTEGER NOT NULL DEFAULT 0,
		cached_input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0,
		cost REAL NOT NULL DEFAULT 0,
		request_count INTEGER NOT NULL DEFAULT 0,
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_gt ON usage_bucket(granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_acct ON usage_bucket(account_id, granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_bucket_window ON usage_bucket(account_id, model_alias, provider_id, granularity, bucket_time)`,
	`CREATE TABLE IF NOT EXISTS gift_card (
		id TEXT PRIMARY KEY,
		code TEXT NOT NULL DEFAULT '',
		token_amount REAL NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'unused',
		redeemed_by TEXT,
		redeemed_at INTEGER,
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_code ON gift_card(code)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_redeemed_by ON gift_card(redeemed_by)`,
	// "transaction" is an SQL reserved word — quoted table name.
	`CREATE TABLE IF NOT EXISTS "transaction" (
		id TEXT PRIMARY KEY,
		account_id TEXT NOT NULL DEFAULT '',
		txid TEXT NOT NULL DEFAULT '',
		amount REAL NOT NULL DEFAULT 0,
		confirmations INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'pending',
		payment_id TEXT NOT NULL DEFAULT '',
		type TEXT NOT NULL DEFAULT 'topup',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_status ON "transaction"(status)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_account ON "transaction"(account_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_txid ON "transaction"(txid)`,
	`CREATE TABLE IF NOT EXISTS session_reasoning (
		id TEXT PRIMARY KEY,
		session_key TEXT NOT NULL DEFAULT '',
		tool_call_id TEXT NOT NULL DEFAULT '',
		reasoning_content TEXT NOT NULL DEFAULT '',
		create_time INTEGER NOT NULL DEFAULT 0,
		update_time INTEGER,
		delete_time INTEGER
	)`,
}

func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(0)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	for _, stmt := range Schema {
		if _, err := db.Exec(stmt); err != nil {
			return nil, fmt.Errorf("schema: %w", err)
		}
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	return db, nil
}

func Now() int64 { return time.Now().UnixMilli() }

func Round6(x float64) float64 { return float64(int64(x*1e6+0.5)) / 1e6 }
