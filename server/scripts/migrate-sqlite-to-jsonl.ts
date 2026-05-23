// @ts-nocheck
/**
 * Migration script: export SQLite data to JSONL files.
 *
 * Usage: bun run server/scripts/migrate-sqlite-to-jsonl.ts
 *
 * This reads the existing onekey.db and writes one .jsonl file per table.
 * Columns are mapped from SQLite snake_case to the JS-side property names
 * used by the Drizzle ORM schemas and entity interfaces.
 */
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const _filename = fileURLToPath(import.meta.url);
const DATA_DIR = path.resolve(path.dirname(_filename), "../../data");
const DB_FILE = path.join(DATA_DIR, "onekey.db");

if (!fs.existsSync(DB_FILE)) {
    console.log("No existing database found at", DB_FILE);
    process.exit(0);
}

const db = new Database(DB_FILE);

/**
 * No column mapping needed — all field names now match SQLite column names exactly (snake_case).
 */

const tables = [
    "account",
    "gift_card",
    "model",
    "provider",
    "role",
    "account_role",
    "settings",
    "transaction",
    "task",
    "usage_log",
];

let total = 0;
for (const tableName of tables) {
    try {
        const rows = db.query(`SELECT * FROM \`${tableName}\``).all();
        if (rows.length === 0) {
            console.log(`  ${tableName}: 0 rows (skipping)`);
            continue;
        }
        const jsonlPath = path.join(DATA_DIR, `${tableName}.jsonl`);
        const lines = rows.map((r: any) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(r)) {
                out[k] = v; // keep SQLite column name as-is (snake_case)
            }
            // Remove drizzle-specific internal columns
            delete out.__drizzle_id;
            return JSON.stringify(out);
        });
        fs.writeFileSync(jsonlPath, lines.join("\n") + "\n");
        console.log(`  ${tableName}: ${rows.length} rows exported`);
        total += rows.length;
    } catch (e: any) {
        console.log(`  ${tableName}: error — ${e.message}`);
    }
}

console.log(`\nMigration complete. ${total} total rows exported.`);
db.close();
