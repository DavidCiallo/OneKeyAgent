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
        role TEXT NOT NULL DEFAULT 'user',
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
`);

// Migrate: add 'role' column to account if missing (for existing databases)
const accountCols = db.prepare("PRAGMA table_info(account)").all() as { name: string }[];
if (!accountCols.some((c: { name: string }) => c.name === "role")) {
    db.exec("ALTER TABLE account ADD COLUMN role TEXT NOT NULL DEFAULT 'user';");
    console.log("Migrated: added 'role' column to account table");
}

console.log("Database initialized at", dbPath);
db.close();