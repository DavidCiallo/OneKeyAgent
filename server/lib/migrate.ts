// @ts-nocheck
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
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
 * Get all table names currently in the database.
 */
function getExistingTables(): Set<string> {
    const rows = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
}

/**
 * Parse CREATE TABLE table_name from a SQL migration line.
 */
function extractTableName(sql: string): string | null {
    // Matches: CREATE TABLE `tablename` ( ... )
    //     or: CREATE TABLE tablename ( ... )
    const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i);
    return match ? match[1] : null;
}

/**
 * Get the set of tables that should exist according to the migration files.
 */
function getMigrationTables(): Set<string> {
    const _dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(_dirname, "../../drizzle");
    const tables = new Set<string>();

    const entries = fs.readdirSync(migrationsFolder);
    const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();
    for (const file of sqlFiles) {
        const content = fs.readFileSync(path.join(migrationsFolder, file), "utf-8");
        const statements = content.split(/-->\s*statement-breakpoint\s*/);
        for (const stmt of statements) {
            const tableName = extractTableName(stmt);
            if (tableName) tables.add(tableName);
        }
    }
    return tables;
}

/**
 * Run database migrations on startup.
 *
 * This uses Drizzle's migration system. Each migration is an SQL file
 * in the drizzle/ folder that is applied incrementally.
 *
 * HOW TO USE:
 *  1. Edit a .schema.ts file (e.g. shared/modules/xxx/xxx.schema.ts)
 *  2. Run: bun run db:generate
 *  3. Restart the server – migrations run automatically on startup
 *
 * Adding a new table only generates a new migration file without
 * affecting existing tables or data.
 */
export function runMigrations() {
    const _dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = path.resolve(_dirname, "../../drizzle");

    if (!fs.existsSync(migrationsFolder)) {
        console.log("No migrations folder found. Run 'bun run db:generate' to create initial migration.");
        return;
    }

    const entries = fs.readdirSync(migrationsFolder);
    const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();
    if (sqlFiles.length === 0) {
        console.log("No migration files found. Run 'bun run db:generate' to create initial migration.");
        return;
    }

    // Check if any tables from the migration files are missing.
    // This handles two cases:
    //   1. Fresh legacy database (no __drizzle_migrations) – transition from old db-init.ts
    //   2. Already-migrated database where some tables were never created
    //      (e.g. a table was added to the schema but the migration was already marked as applied)
    const existingTables = getExistingTables();
    const migrationTables = getMigrationTables();
    const missingTables: string[] = [];

    for (const tbl of migrationTables) {
        if (!existingTables.has(tbl)) {
            missingTables.push(tbl);
        }
    }

    if (missingTables.length > 0) {
        console.log(`Missing tables found: ${missingTables.join(", ")}`);
        console.log("Creating missing tables without affecting existing data...");

        // Ensure the drizzle migration tracking table exists
        if (!existingTables.has("__drizzle_migrations")) {
            sqlite.exec(`
                CREATE TABLE IF NOT EXISTS __drizzle_migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    hash TEXT NOT NULL,
                    created_at TEXT
                )
            `);
        }

        // Apply migration files but only create tables that are missing
        for (const file of sqlFiles) {
            const filePath = path.join(migrationsFolder, file);
            const content = fs.readFileSync(filePath, "utf-8");
            const statements = content.split(/-->\s*statement-breakpoint\s*/);

            for (const stmt of statements) {
                const trimmed = stmt.trim();
                if (!trimmed) continue;

                const tableName = extractTableName(trimmed);
                if (tableName && existingTables.has(tableName)) {
                    // Table already exists – skip
                    continue;
                }
                if (tableName && !missingTables.includes(tableName)) {
                    // Table is not missing – skip
                    continue;
                }
                try {
                    sqlite.exec(trimmed);
                    if (tableName) {
                        console.log(`  Created table '${tableName}'.`);
                    }
                } catch (err) {
                    console.error(`  Error creating table '${tableName}':`, err.message);
                }
            }
        }

        // Mark all migrations as applied
        if (!existingTables.has("__drizzle_migrations")) {
            const journalPath = path.join(migrationsFolder, "meta/_journal.json");
            if (fs.existsSync(journalPath)) {
                const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
                const insertStmt = sqlite.prepare(
                    "INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
                );
                const insertMany = sqlite.transaction((entries) => {
                    for (const entry of entries) {
                        insertStmt.run(entry.tag, new Date(entry.when).toISOString());
                    }
                });
                insertMany(journal.entries);
                console.log(`Marked ${journal.entries.length} migration(s) as applied.`);
            }
        }

        console.log("Database migration completed successfully.");
    } else {
        // Normal path: use Drizzle's built-in migrator for incremental migrations
        try {
            migrate(db, { migrationsFolder });
            console.log("Database migrations applied successfully.");
        } catch (err) {
            console.error("Migration error:", err);
            throw err;
        }
    }
}
export { sqlite, db };