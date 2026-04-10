// @ts-nocheck
import { Database } from "bun:sqlite";
import path from "path";
import { nanoid } from "nanoid";
import fs from "fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { eq, and, isNull, sql } from "drizzle-orm";

const DB_DIR = "data";
const DB_FILE = "tiny_web.db";

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR);
}

const sqlite = new Database(path.join(DB_DIR, DB_FILE));

export const db = drizzle(sqlite, { schema });

// Automatically map all tables from schema
const tables: Record<string, any> = {};
Object.entries(schema).forEach(([key, val]) => {
    if (key.endsWith("Table")) {
        const tableName = key.replace("Table", "").toLowerCase();
        tables[tableName] = val;
    }
});

class Repository<
    T extends { id?: string; create_time?: number | null; update_time?: number | null; delete_time?: number | null },
> {
    private table: any;
    private static instances = new Map<string, any>();

    private constructor(entityName: string) {
        const key = entityName.toLowerCase().replace("entity", "");
        this.table = tables[key];
        if (!this.table) {
            throw new Error(
                `Table for ${entityName} not found in schema. Ensure it is exported as '${key}Table' in schema.ts`,
            );
        }
    }

    public static instance<
        T extends {
            id?: string;
            create_time?: number | null;
            update_time?: number | null;
            delete_time?: number | null;
        },
    >(entityName: string): Repository<T> {
        const key = entityName.toLowerCase();
        if (!Repository.instances.has(key)) {
            Repository.instances.set(key, new Repository(entityName));
        }
        return Repository.instances.get(key);
    }

    async find(where?: Partial<T>, config?: { limit?: number; offset?: number }): Promise<T[]> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }
        let query = db
            .select()
            .from(this.table)
            .where(and(...filters));

        const result = await query.execute();
        return result as T[];
    }

    async findOne(where: Partial<T>): Promise<T | null> {
        const results = await this.find(where, { limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    async insert(entity: Partial<T>): Promise<T> {
        const id = entity.id || nanoid(6);
        const now = Date.now();
        const data = {
            ...entity,
            id,
            create_time: now,
            update_time: now,
        };

        const result = await db
            .insert(this.table)
            .values(data as any)
            .returning()
            .get();
        return result as T;
    }

    async update(where: Partial<T>, updateData: Partial<T>): Promise<boolean> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }

        const now = Date.now();
        const data = {
            ...updateData,
            update_time: now,
        };

        await db
            .update(this.table)
            .set(data as any)
            .where(and(...filters))
            .execute();

        return true;
    }

    async delete(where: Partial<T>): Promise<boolean> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }

        const now = Date.now();
        await db
            .update(this.table)
            .set({ delete_time: now } as any)
            .where(and(...filters))
            .execute();

        return true;
    }

    async count(where?: Partial<T>): Promise<number> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }

        const result = await db
            .select({ count: sql`count(*)` })
            .from(this.table)
            .where(and(...filters))
            .get();

        return Number(result?.count || 0);
    }
}

export default Repository;
