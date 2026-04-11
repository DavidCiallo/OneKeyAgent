// ==================== API Key 验证 ====================
// Key 格式: 随机字符串，长度 >= 16
// 验证算法:
//   1. 取前 4 字符 ASCII 和，记为 A
//   2. 取中间 4 字符 ASCII 和，记为 B
//   3. 取最后 4 字符 ASCII 和，记为 C
//   4. 验证: A + B + C = 1024

/**
 * 生成合法的 API Key
 * @returns 36 字符的随机字符串
 */
export function generateApiKey(): string {
    return manualConstruct();
}

/**
 * 批量生成 API Key
 * @param count 生成数量
 * @returns key 数组
 */
export function generateApiKeys(count: number): string[] {
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
        keys.push(generateApiKey());
    }
    return keys;
}

function manualConstruct(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    // 目标: A + B + C = 1024
    // 方案: A=400, B=300, C=324
    const A = 400, B = 300, C = 324;

    const prefix = constructSum(A, 4)!;
    const middle = constructSum(B, 4)!;
    const suffix = constructSum(C, 4)!;

    // 固定长度 36: prefix(4) + fill1(12) + middle(4) + fill2(12) + suffix(4) = 36
    const fillLen1 = 12;
    const fillLen2 = 12;
    let fill1 = "";
    for (let i = 0; i < fillLen1; i++) {
        fill1 += chars[Math.floor(Math.random() * chars.length)];
    }
    let fill2 = "";
    for (let i = 0; i < fillLen2; i++) {
        fill2 += chars[Math.floor(Math.random() * chars.length)];
    }

    return prefix + fill1 + middle + fill2 + suffix;
}

function constructSum(target: number, len: number): string | null {
    // 有效字符: 0-9(48-57), A-Z(65-90), a-z(97-122)
    const validChars = [
        ...Array.from({ length: 10 }, (_, i) => 48 + i),      // 0-9
        ...Array.from({ length: 26 }, (_, i) => 65 + i),      // A-Z
        ...Array.from({ length: 26 }, (_, i) => 97 + i),      // a-z
    ];

    for (let attempt = 0; attempt < 10000; attempt++) {
        const result: number[] = [];
        let remaining = target;
        for (let i = 0; i < len; i++) {
            // 剩余位置能用的最小/最大值
            const minPossible = validChars[0] * (len - i - 1);
            const maxPossible = validChars[validChars.length - 1] * (len - i - 1);
            const minHere = Math.max(validChars[0], remaining - maxPossible);
            const maxHere = Math.min(validChars[validChars.length - 1], remaining - minPossible);

            // 过滤出在这个范围内且是有效字符的选项
            const validOptions = validChars.filter(c => c >= minHere && c <= maxHere);
            if (validOptions.length === 0) break;

            const char = validOptions[Math.floor(Math.random() * validOptions.length)];
            result.push(char);
            remaining -= char;
        }
        if (result.length === len && result.reduce((a, b) => a + b, 0) === target) {
            return result.map(c => String.fromCharCode(c)).join("");
        }
    }
    return null;
}

/**
 * 验证 API Key
 * @param key 字符串，长度 >= 16
 * @returns true 如果合法
 */
export function validateApiKey(key: string): boolean {
    if (!key || typeof key !== "string" || key.length < 16) {
        return false;
    }

    // 前 4 字符 ASCII 和
    let A = 0;
    for (let i = 0; i < 4; i++) {
        A += key.charCodeAt(i);
    }

    // 中间 4 字符 ASCII 和
    const midStart = Math.floor((key.length - 4) / 2);
    let B = 0;
    for (let i = midStart; i < midStart + 4; i++) {
        B += key.charCodeAt(i);
    }

    // 最后 4 字符 ASCII 和
    let C = 0;
    for (let i = key.length - 4; i < key.length; i++) {
        C += key.charCodeAt(i);
    }

    // 验证: A + B + C = 1024
    return A + B + C === 1024;
}
