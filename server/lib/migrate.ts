// @ts-nocheck
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const DB_DIR = "data";
const DB_FILE = "onekey.db";

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, DB_FILE);
const sqlite = new Database(dbPath);

sqlite.exec("PRAGMA journal_mode=WAL;");
sqlite.exec("PRAGMA foreign_keys=ON;");

const db = drizzle(sqlite);

/**
 * Run database migrations on startup.
 *
 * Reads drizzle/meta/_journal.json for the ordered list of migrations,
 * checks which have already been applied via the __drizzle_migrations table,
 * and runs any pending ones sequentially.
 *
 * This correctly handles ALL statement types: CREATE TABLE, ALTER TABLE ADD/DROP COLUMN,
 * and Drizzle's recreate-table pattern (CREATE __new + INSERT + DROP + RENAME).
 */
export function runMigrations() {
    const _dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(_dirname, "../../drizzle");
    const journalPath = path.join(migrationsFolder, "meta/_journal.json");

    if (!fs.existsSync(journalPath)) {
        console.log("No migration journal found. Run 'bun run db:generate' first.");
        return;
    }

    // Ensure the tracking table exists
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash TEXT NOT NULL,
            created_at TEXT
        )
    `);

    // Read journal
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

    // Get already-applied migration tags
    const applied = new Set(
        sqlite
            .prepare("SELECT hash FROM __drizzle_migrations")
            .all()
            .map((r: any) => r.hash),
    );

    // Find pending entries, sorted by idx
    const pending = journal.entries
        .filter((entry: any) => !applied.has(entry.tag))
        .sort((a: any, b: any) => a.idx - b.idx);

    if (pending.length === 0) {
        console.log("Database is up to date.");
        return;
    }

    console.log(`Found ${pending.length} pending migration(s): ${pending.map((e: any) => e.tag).join(", ")}`);

    const insertStmt = sqlite.prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    );

    for (const entry of pending) {
        const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlFile)) {
            console.error(`  Migration file not found: ${sqlFile}`);
            continue;
        }

        console.log(`  Applying: ${entry.tag}...`);
        const content = fs.readFileSync(sqlFile, "utf-8");
        const statements = content.split(/-->\s*statement-breakpoint\s*/);

        for (const stmt of statements) {
            const trimmed = stmt.trim();
            if (!trimmed) continue;

            // Temporarily enable foreign_keys for recreate-table migrations
            if (trimmed.startsWith("PRAGMA foreign_keys=OFF")) {
                sqlite.exec("PRAGMA foreign_keys=OFF;");
                continue;
            }
            if (trimmed.startsWith("PRAGMA foreign_keys=ON")) {
                sqlite.exec("PRAGMA foreign_keys=ON;");
                continue;
            }

            try {
                sqlite.exec(trimmed);
            } catch (err) {
                console.error(`  Error in ${entry.tag}:`, err.message);
                console.error(`  Statement: ${trimmed.slice(0, 120)}`);
                throw err;
            }
        }

        insertStmt.run(entry.tag, new Date(entry.when).toISOString());
        console.log(`  Done: ${entry.tag}`);
    }

    console.log("All pending migrations applied successfully.");
}

export { sqlite, db };