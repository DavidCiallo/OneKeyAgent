import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DB_DIR = "data";
const DB_FILE = "tiny_web.db";

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, DB_FILE);
const db = new Database(dbPath);

db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA foreign_keys=ON;");

db.exec(`
    CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password TEXT NOT NULL,
        api_key TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        create_time INTEGER NOT NULL,
        update_time INTEGER,
        delete_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS model (
        id TEXT PRIMARY KEY,
        tier INTEGER NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key TEXT,
        proxy_url TEXT,
        create_time INTEGER,
        update_time INTEGER,
        delete_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_session (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        model_id TEXT NOT NULL,
        context TEXT NOT NULL,
        create_time INTEGER,
        update_time INTEGER,
        delete_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS usage_log (
        id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        create_time INTEGER,
        update_time INTEGER,
        delete_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS role (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        create_time INTEGER NOT NULL,
        update_time INTEGER,
        delete_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS account_role (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        create_time INTEGER NOT NULL,
        update_time INTEGER,
        delete_time INTEGER
    );
`);

// Migrate: add 'is_admin' column to account if missing (replaces 'role')
const accountCols = db.prepare("PRAGMA table_info(account)").all() as { name: string }[];
if (!accountCols.some((c: { name: string }) => c.name === "is_admin")) {
    db.exec("ALTER TABLE account ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;");
    console.log("Migrated: added 'is_admin' column to account table");
}
// Migrate: convert existing 'role' column values to 'is_admin'
if (accountCols.some((c: { name: string }) => c.name === "role")) {
    try {
        db.exec("UPDATE account SET is_admin = 1 WHERE role = 'admin';");
        console.log("Migrated: converted admin role to is_admin");
    } catch { /* ignore if already migrated */ }
}

console.log("Database initialized at", dbPath);
db.close();