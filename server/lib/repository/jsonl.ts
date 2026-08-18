// @ts-nocheck
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { RepositoryDriver } from "./driver";

const _filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(_filename), "../..");
const DATA_DIR = path.join(path.resolve(SERVER_DIR, ".."), "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function collectionFile(name: string): string {
    return path.join(DATA_DIR, `${name}.jsonl`);
}

/** Read lines from end to start (newest first) — used for paginated find() with DESC order */
async function* readLinesReverse(name: string): AsyncGenerator<Record<string, any>, void, void> {
    const file = collectionFile(name);
    if (!fs.existsSync(file)) return;

    const stat = fs.statSync(file);
    if (stat.size === 0) return;

    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    let pos = stat.size;
    let remainder = "";

    try {
        while (pos > 0) {
            const readSize = Math.min(65536, pos);
            pos -= readSize;
            fs.readSync(fd, buf, 0, readSize, pos);
            let chunk = buf.toString("utf-8", 0, readSize) + remainder;
            remainder = "";

            const lines = chunk.split("\n");
            remainder = lines[0];
            for (let i = lines.length - 1; i >= 1; i--) {
                const trimmed = lines[i].trim();
                if (!trimmed) continue;
                const row = JSON.parse(trimmed);
                yield row;
            }
        }
        if (remainder.trim()) {
            const row = JSON.parse(remainder.trim());
            yield row;
        }
    } finally {
        fs.closeSync(fd);
    }
}

/** Read lines forward — used for findOne(), count(), findAllIgnoreDelete() */
async function* readLines(name: string): AsyncGenerator<Record<string, any>, void, void> {
    const file = collectionFile(name);
    if (!fs.existsSync(file)) return;

    const stream = Bun.file(file).stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const row = JSON.parse(trimmed);
                yield row;
            }
        }
        if (buffer.trim()) {
            const row = JSON.parse(buffer.trim());
            yield row;
        }
    } finally {
        reader.cancel().catch(() => {});
    }
}

/** Check if a row matches the where conditions. Supports operators: $eq, $ne, $gt, $gte, $lt, $lte, $in. */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
    for (const [key, val] of Object.entries(where)) {
        if (val === undefined || val === "") continue;
        if (val === null) {
            if (row[key] !== null) return false;
            continue;
        }
        if (typeof val === "object" && !Array.isArray(val)) {
            for (const [op, opVal] of Object.entries(val)) {
                const rowVal = row[key];
                if (op === "$eq")  { if (rowVal !== opVal) return false; }
                if (op === "$ne")  { if (rowVal === opVal) return false; }
                if (op === "$gt")  { if (!(rowVal > opVal)) return false; }
                if (op === "$gte") { if (!(rowVal >= opVal)) return false; }
                if (op === "$lt")  { if (!(rowVal < opVal)) return false; }
                if (op === "$lte") { if (!(rowVal <= opVal)) return false; }
                if (op === "$in")  { if (!Array.isArray(opVal) || !opVal.includes(rowVal)) return false; }
            }
        } else {
            if (row[key] !== val) return false;
        }
    }
    return true;
}

/** Write lock per collection */
const writeLocks = new Map<string, Promise<void>>();

async function withLock<R>(collection: string, fn: () => Promise<R>): Promise<R> {
    const prev = writeLocks.get(collection) || Promise.resolve();
    let release: () => void;
    writeLocks.set(
        collection,
        new Promise<void>((resolve) => {
            release = resolve;
        }),
    );
    await prev;
    try {
        return await fn();
    } finally {
        release!();
    }
}

export const JsonlDriver: RepositoryDriver = {
    async find(collection, where, config) {
        const results: Record<string, any>[] = [];
        const since = config?.since;
        const limit = config?.limit;
        const offset = config?.offset || 0;

        for await (const row of readLinesReverse(collection)) {
            if (row.delete_time) continue;
            if (since && row.create_time < since) continue;
            if (where && !matches(row, where)) continue;
            results.push(row);
            if (limit !== undefined && results.length >= offset + limit) break;
        }

        if (offset > 0 || limit !== undefined) {
            return results.slice(offset, limit !== undefined ? offset + limit : undefined);
        }
        return results;
    },

    async findEach(collection, where, callback, config) {
        let count = 0;
        const since = config?.since;
        const limit = config?.limit;

        for await (const row of readLines(collection)) {
            if (row.delete_time) continue;
            if (since && row.create_time < since) continue;
            if (!matches(row, where)) continue;
            callback(row);
            count++;
            if (limit && count >= limit) break;
        }
        return count;
    },

    async sum(collection, field, where, since) {
        let total = 0;
        for await (const row of readLines(collection)) {
            if (row.delete_time) continue;
            if (since && row.create_time < since) continue;
            if (where && !matches(row, where)) continue;
            total += row[field] || 0;
        }
        return total;
    },

    async findOne(collection, where, reverse) {
        const reader = reverse ? readLinesReverse(collection) : readLines(collection);
        for await (const row of reader) {
            if (row.delete_time) continue;
            if (matches(row, where)) return row;
        }
        return null;
    },

    async findIgnoreDelete(collection, where) {
        for await (const row of readLines(collection)) {
            if (matches(row, where)) return row;
        }
        return null;
    },

    async findAllIgnoreDelete(collection) {
        const results: Record<string, any>[] = [];
        for await (const row of readLines(collection)) {
            results.push(row);
        }
        return results;
    },

    async findByIds(collection, ids) {
        if (ids.length === 0) return [];
        const idSet = new Set(ids);
        const results: Record<string, any>[] = [];
        for await (const row of readLines(collection)) {
            if (row.delete_time) continue;
            if (row.id && idSet.has(row.id)) {
                results.push(row);
            }
        }
        return results;
    },

    async *findAllIgnoreDeleteBatch(collection, batchSize = 1000) {
        let batch: Record<string, any>[] = [];
        for await (const row of readLines(collection)) {
            batch.push(row);
            if (batch.length >= batchSize) {
                yield batch;
                batch = [];
            }
        }
        if (batch.length > 0) yield batch;
    },

    async insert(collection, entity) {
        return withLock(collection, async () => {
            const now = Date.now();
            const id = entity.id || nanoid(6);
            const row = {
                ...entity,
                id,
                create_time: entity.create_time || now,
                update_time: entity.update_time || now,
                delete_time: null,
            };
            fs.appendFileSync(collectionFile(collection), JSON.stringify(row) + "\n");
            return row;
        });
    },

    async update(collection, where, updateData, includeDeleted = false) {
        return withLock(collection, async () => {
            const now = Date.now();
            let updated = false;
            const file = collectionFile(collection);
            if (!fs.existsSync(file)) return false;

            const content = fs.readFileSync(file, "utf-8");
            const lines = content.split("\n");
            const out: string[] = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const row = JSON.parse(trimmed);
                if (!includeDeleted && row.delete_time) {
                    out.push(line);
                    continue;
                }

                let match = true;
                for (const [key, val] of Object.entries(where)) {
                    if (row[key] !== val) { match = false; break; }
                }

                if (match) {
                    Object.assign(row, updateData, { update_time: now });
                    out.push(JSON.stringify(row));
                    updated = true;
                } else {
                    out.push(line);
                }
            }

            fs.writeFileSync(file, out.join("\n") + "\n");
            return updated;
        });
    },

    async delete(collection, where) {
        const now = Date.now();
        return this.update(collection, where, { delete_time: now });
    },

    async truncate(collection) {
        return withLock(collection, async () => {
            fs.writeFileSync(collectionFile(collection), "");
        });
    },

    async hardDelete(collection, where) {
        return withLock(collection, async () => {
            const file = collectionFile(collection);
            if (!fs.existsSync(file)) return false;

            let deleted = false;
            const content = fs.readFileSync(file, "utf-8");
            const lines = content.split("\n");
            const out: string[] = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const row = JSON.parse(trimmed);

                let match = true;
                for (const [key, val] of Object.entries(where)) {
                    if (row[key] !== val) { match = false; break; }
                }

                if (match) {
                    deleted = true;
                } else {
                    out.push(line);
                }
            }

            fs.writeFileSync(file, out.join("\n") + "\n");
            return deleted;
        });
    },

    async atomicPatch(collection, where, patch, includeDeleted = false) {
        return withLock(collection, async () => {
            const file = collectionFile(collection);
            if (!fs.existsSync(file)) return false;

            const content = fs.readFileSync(file, "utf-8");
            const lines = content.split("\n");
            const now = Date.now();
            let updated = false;

            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (!trimmed) continue;
                const row = JSON.parse(trimmed);
                if (!includeDeleted && row.delete_time) continue;

                let match = true;
                for (const [key, val] of Object.entries(where)) {
                    if (row[key] !== val) { match = false; break; }
                }

                if (match) {
                    const patchData = patch(row);
                    if (patchData) {
                        Object.assign(row, patchData, { update_time: now });
                        lines[i] = JSON.stringify(row);
                        updated = true;
                    }
                }
            }

            if (updated) {
                fs.writeFileSync(file, lines.join("\n") + "\n");
            }
            return updated;
        });
    },

    async batchInsert(collection, entities) {
        return withLock(collection, async () => {
            if (entities.length === 0) return 0;
            const now = Date.now();
            const rows = entities.map((e) => ({
                ...e,
                id: e.id || nanoid(6),
                create_time: e.create_time || now,
                update_time: e.update_time || now,
                delete_time: null,
            }));
            fs.appendFileSync(collectionFile(collection), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
            return rows.length;
        });
    },

    async count(collection, where, since) {
        let count = 0;
        for await (const row of readLines(collection)) {
            if (row.delete_time) continue;
            if (since && row.create_time < since) continue;
            if (where && !matches(row, where)) continue;
            count++;
        }
        return count;
    },
};
