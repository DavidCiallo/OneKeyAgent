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
		// max_context — upstream context window in tokens; 0 = unlimited.
		{"max_context", "INTEGER NOT NULL DEFAULT 0"},
		// daily_quota — requests allowed per local day; 0 = unlimited, in-memory.
		{"daily_quota", "INTEGER NOT NULL DEFAULT 0"},
		// active_from / active_to — minutes past local midnight between which the
		// provider may be used (peak/off-peak routing); both 0 = any time.
		{"active_from", "INTEGER NOT NULL DEFAULT 0"},
		{"active_to", "INTEGER NOT NULL DEFAULT 0"},
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
		// Failed attempts carry what was sent upstream and what came back, so a
		// reject (a 400 about tool messages, say) can be debugged from the row.
		// Bodies are a field summary now, bounded at write time; there is no
		// second retention window to age them out of.
		// NOT NULL DEFAULT '' matters: a plain TEXT upgrade would leave NULL in
		// every pre-existing row, and the audit list scan rejects NULL strings.
		{"request_body", "TEXT NOT NULL DEFAULT ''"},
		{"response_body", "TEXT NOT NULL DEFAULT ''"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	// outbox — changes made on this node that the main database has not
	// acknowledged yet. Only populated when the node is a replica
	// (MAIN_DB_URL set); on the main node it stays empty.
	{"outbox", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"table_name", "TEXT NOT NULL DEFAULT ''"},
		{"row_id", "TEXT NOT NULL DEFAULT ''"},
		{"op", "TEXT NOT NULL DEFAULT ''"},
		{"payload", "TEXT NOT NULL DEFAULT ''"},
		{"seq", "INTEGER NOT NULL DEFAULT 0"},
		{"create_time", "INTEGER NOT NULL DEFAULT 0"},
		{"update_time", "INTEGER"},
		{"delete_time", "INTEGER"},
	}},
	// node_state — per-node bookkeeping (last acknowledged outbox seq).
	{"node_state", []colDef{
		{"id", "TEXT PRIMARY KEY"},
		{"value", "TEXT NOT NULL DEFAULT ''"},
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
	// The unique index is what makes BucketLogUsage's ON CONFLICT upsert work:
	// exactly one row per (account, alias, provider, granularity, window). It is
	// created after dedupeBucketRows, because a database written by the previous
	// read-modify-write implementation can already hold duplicates for a window.
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_bucket_unique ON usage_bucket(account_id, model_alias, provider_id, granularity, bucket_time)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_code ON gift_card(code)`,
	`CREATE INDEX IF NOT EXISTS idx_gift_card_redeemed_by ON gift_card(redeemed_by)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_status ON "transaction"(status)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_account ON "transaction"(account_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tx_txid ON "transaction"(txid)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_success_ts ON audit_log(success, ts)`,
	`CREATE INDEX IF NOT EXISTS idx_outbox_seq ON outbox(seq)`,
	// One buffered change per (row, op): a profile patch and a balance delta for
	// the same account are different operations and must both survive.
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_row ON outbox(table_name, row_id, op)`,
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
	if err := dedupeBucketRows(db); err != nil {
		return nil, err
	}
	if err := backfillAuditBodies(db); err != nil {
		return nil, err
	}
	if err := purgeLegacyAuditBodies(db); err != nil {
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

// backfillAuditBodies — heals databases upgraded before the audit body columns
// carried a default: reconcile added them as plain TEXT, leaving NULL in every
// pre-existing row, and reading NULL into the audit list's string fields
// failed the whole endpoint. Empty string is the correct value there — those
// attempts predate body capture.
func backfillAuditBodies(db *sql.DB) error {
	_, err := db.Exec(`UPDATE audit_log SET request_body = '', response_body = ''
		WHERE request_body IS NULL OR response_body IS NULL`)
	return err
}

// purgeLegacyAuditBodies — drop stored audit bodies left by earlier builds.
// Those builds kept whole prompts (up to 64 KiB) on the newest failures, and a
// database upgraded in place would otherwise carry that text indefinitely:
// new rows store a field summary instead, and retention only trims by count.
// Clearing them at startup is what makes the smaller-retention change apply to
// data that already exists.
func purgeLegacyAuditBodies(db *sql.DB) error {
	_, err := db.Exec(`UPDATE audit_log SET request_body = '', response_body = ''
		WHERE request_body <> '' OR response_body <> ''`)
	return err
}

// dedupeBucketRows merges usage_bucket rows that share a window, keeping the
// earliest row and folding the others' counters into it. Required before the
// unique index can be created on a database written by the previous
// SELECT-then-INSERT implementation, which could leave two rows for the same
// window when concurrent settles raced. Only the aggregate columns are summed;
// bucket_time and granularity are equal by definition of the group.
func dedupeBucketRows(db *sql.DB) error {
	rows, err := db.Query(`SELECT account_id, model_alias, provider_id, granularity, bucket_time,
			COUNT(*) FROM usage_bucket
		GROUP BY account_id, model_alias, provider_id, granularity, bucket_time
		HAVING COUNT(*) > 1`)
	if err != nil {
		return fmt.Errorf("dedupe scan: %w", err)
	}
	type group struct {
		account, alias, provider, gran string
		bucketTime                     int64
	}
	var dupes []group
	for rows.Next() {
		var g group
		var n int64
		if err := rows.Scan(&g.account, &g.alias, &g.provider, &g.gran, &g.bucketTime, &n); err != nil {
			rows.Close()
			return err
		}
		dupes = append(dupes, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(dupes) == 0 {
		return nil
	}

	for _, g := range dupes {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		// Sum the duplicate rows, keep the oldest one, and give it the totals.
		var keepID string
		var in, cin, out, rc int64
		var cost float64
		if err := tx.QueryRow(`SELECT id FROM usage_bucket
			WHERE account_id = ? AND model_alias = ? AND provider_id = ? AND granularity = ? AND bucket_time = ?
			ORDER BY create_time ASC, rowid ASC LIMIT 1`,
			g.account, g.alias, g.provider, g.gran, g.bucketTime).Scan(&keepID); err != nil {
			tx.Rollback()
			return fmt.Errorf("dedupe keep row: %w", err)
		}
		if err := tx.QueryRow(`SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(cached_input_tokens),0),
				COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost),0), COALESCE(SUM(request_count),0)
			FROM usage_bucket
			WHERE account_id = ? AND model_alias = ? AND provider_id = ? AND granularity = ? AND bucket_time = ?`,
			g.account, g.alias, g.provider, g.gran, g.bucketTime).Scan(&in, &cin, &out, &cost, &rc); err != nil {
			tx.Rollback()
			return fmt.Errorf("dedupe sum: %w", err)
		}
		// Delete the other rows first, so the unique index (created right after)
		// never sees two rows for this window.
		if _, err := tx.Exec(`DELETE FROM usage_bucket
			WHERE account_id = ? AND model_alias = ? AND provider_id = ? AND granularity = ? AND bucket_time = ? AND id <> ?`,
			g.account, g.alias, g.provider, g.gran, g.bucketTime, keepID); err != nil {
			tx.Rollback()
			return fmt.Errorf("dedupe delete: %w", err)
		}
		if _, err := tx.Exec(`UPDATE usage_bucket SET input_tokens = ?, cached_input_tokens = ?,
				output_tokens = ?, cost = ?, request_count = ? WHERE id = ?`,
			in, cin, out, Round6(cost), rc, keepID); err != nil {
			tx.Rollback()
			return fmt.Errorf("dedupe write back: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		fmt.Printf("[Init] merged duplicate usage_bucket rows for account=%s alias=%s granularity=%s\n",
			g.account, g.alias, g.gran)
	}
	return nil
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
