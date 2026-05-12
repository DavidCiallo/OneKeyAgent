// @ts-nocheck
import { eq, and, isNull, sql, desc, gte, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./migrate";
import * as schema from "./schema";

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

    async find(where?: Partial<T>, config?: { limit?: number; offset?: number; since?: number }): Promise<T[]> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (config?.since) {
            filters.push(gte(this.table.create_time, config.since));
        }
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
            .where(and(...filters))
            .orderBy(desc(this.table.create_time));

        if (config?.limit !== undefined) query = query.limit(config.limit);
        if (config?.offset !== undefined) query = query.offset(config.offset);

        const result = await query.execute();
        return result as T[];
    }

    async findOne(where: Partial<T>): Promise<T | null> {
        const results = await this.find(where, { limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    async findIgnoreDelete(where: Partial<T>): Promise<T | null> {
        const filters: any[] = [];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }
        const result = await db
            .select()
            .from(this.table)
            .where(filters.length > 0 ? and(...filters) : undefined)
            .limit(1)
            .get();
        return (result as T) || null;
    }

    /** Get ALL records (including soft-deleted) — used for data export */
    async findAllIgnoreDelete(): Promise<T[]> {
        const result = await db
            .select()
            .from(this.table)
            .execute();
        return result as T[];
    }

    async insert(entity: Partial<T>): Promise<T> {
        const now = Date.now();
        const data = {
            ...entity,
            id: entity.id || nanoid(6),
            create_time: entity.create_time || now,
            update_time: entity.update_time || now,
        };

        const result = await db
            .insert(this.table)
            .values(data as any)
            .returning()
            .get();
        return result as T;
    }

    async update(where: Partial<T>, updateData: Partial<T>, includeDeleted = false): Promise<boolean> {
        const filters: any[] = [];
        if (!includeDeleted) {
            filters.push(isNull(this.table.delete_time));
        }
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
            .set(data)
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

    /** Permanently delete records (used for replace during import) */
    async hardDelete(where: Partial<T>): Promise<boolean> {
        const filters: any[] = [];
        if (where) {
            Object.entries(where).forEach(([key, val]) => {
                if (val !== undefined && val !== null && val !== "" && this.table[key]) {
                    filters.push(eq(this.table[key], val));
                }
            });
        }
        await db
            .delete(this.table)
            .where(filters.length > 0 ? and(...filters) : undefined)
            .execute();
        return true;
    }

    async findByIds(ids: string[]): Promise<T[]> {
        if (ids.length === 0) return [];
        const result = await db
            .select()
            .from(this.table)
            .where(and(isNull(this.table.delete_time), inArray(this.table.id, ids)))
            .execute();
        return result as T[];
    }

    /** Stream all records in batches (including soft-deleted) — avoids loading entire table into memory */
    async *findAllIgnoreDeleteBatch(batchSize = 1000): AsyncGenerator<T[], void, void> {
        let offset = 0;
        while (true) {
            const result = await db
                .select()
                .from(this.table)
                .limit(batchSize)
                .offset(offset)
                .execute();
            if (result.length === 0) break;
            yield result as T[];
            offset += result.length;
        }
    }

    /** Insert multiple rows in a single transaction */
    async batchInsert(entities: Partial<T>[]): Promise<number> {
        if (entities.length === 0) return 0;
        const now = Date.now();
        const rows = entities.map(e => ({
            ...e,
            id: e.id || nanoid(6),
            create_time: e.create_time || now,
            update_time: e.update_time || now,
        }));
        await db.insert(this.table).values(rows as any).execute();
        return rows.length;
    }

    async count(where?: Partial<T>, since?: number): Promise<number> {
        const filters: any[] = [isNull(this.table.delete_time)];
        if (since) {
            filters.push(gte(this.table.create_time, since));
        }
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