// @ts-ignore
import fs from "fs";

// 模型池：只存储 URL 和用量
export interface Model {
    baseURL: string;
    model: string;
    apiKey?: string;
    inputCount: number;
    outCount: number;
    lastReset: number; // 上次重置时间戳
}

let models: Model[] = JSON.parse(fs.readFileSync("./model.json").toString());

// 初始化 lastReset 字段（兼容旧数据）
for (const m of models) {
    if (!m.lastReset) {
        m.lastReset = Date.now();
    }
}

// 检查是否到达本周一 0 点 (UTC)
function shouldReset(): boolean {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=周日, 1=周一...
    const hours = now.getUTCHours();

    // 每周一 0 点重置
    if (dayOfWeek === 1 && hours === 0) {
        return true;
    }
    return false;
}

// 检查并重置用量
function checkAndResetUsage() {
    if (!shouldReset()) return;

    // 所有模型的 lastReset 必须是上周的才重置
    const now = Date.now();
    const monday0 = getThisMonday0UTC();

    for (const m of models) {
        if (m.lastReset < monday0) {
            m.inputCount = 0;
            m.outCount = 0;
            m.lastReset = now;
            console.log(`[AI] Reset usage for model: ${m.model}`);
        }
    }
    saveModels();
    console.log(`[AI] Weekly reset at ${new Date().toISOString()}`);
}

// 获取本周一 0 点 UTC 时间戳
function getThisMonday0UTC(): number {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=周日
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - diff,
        0, 0, 0, 0
    ));
    return monday.getTime();
}

function saveModels() {
    fs.writeFileSync("./model.json", JSON.stringify(models), null, 2);
}

// 启动时检查一次
checkAndResetUsage();

// 定期检查（每分钟）
setInterval(checkAndResetUsage, 60 * 1000);

// Session 池：只管理上下文
export interface Session {
    context: number[];
    modelIdx: number;
}

const sessions: Map<string, Session> = new Map();
const sessionOrder: string[] = [];
const MAX_SESSIONS = 100;
const OUT_COUNT_THRESHOLD = 100000;

export function evictLRU() {
    if (sessionOrder.length >= MAX_SESSIONS) {
        sessions.delete(sessionOrder.shift()!);
    }
}

export function touchSession(sid: string) {
    const idx = sessionOrder.indexOf(sid);
    if (idx !== -1) sessionOrder.splice(idx, 1);
    sessionOrder.push(sid);
}

export function getSessionId(body: Record<string, any>): string {
    const msgs = body.messages || [];
    const key = msgs.slice(0, 3).map((m: { role: string; content: string }) => m.role + ":" + (m.content || "")).join("|");
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = Math.imul(31, h) + key.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
}

export function getSession(sid: string): Session | undefined {
    return sessions.get(sid);
}

export function createSession(sid: string, modelIdx: number, context: number[]) {
    evictLRU();
    sessions.set(sid, { context, modelIdx });
    sessionOrder.push(sid);
}

export function pickModel(session: Session): Model {
    checkAndResetUsage(); // 每次使用时检查是否需要重置
    // 检查当前模型的 outCount 是否超过阈值，超过则换模型
    if (models[session.modelIdx].outCount > OUT_COUNT_THRESHOLD) {
        session.modelIdx = (session.modelIdx + 1) % models.length;
    }
    return models[session.modelIdx];
}

export function updateUsage(sid: string, prompt_tokens: number, completion_tokens: number) {
    const session = sessions.get(sid);
    if (!session) return;
    const m = models[session.modelIdx];
    m.inputCount += prompt_tokens;
    m.outCount += completion_tokens;
    saveModels();
}

export function getAllModels() {
    return models;
}
