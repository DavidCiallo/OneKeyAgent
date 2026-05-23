import {
    GiftCardCreateRequest,
    GiftCardListRequest,
    GiftCardRedeemRequest,
    GiftCardCleanupRequest,
    GiftCardDTO,
} from "../../../shared/modules/gift_card/gift_card.interface";
import { giftCardRoutes } from "../../../shared/modules/gift_card/gift_card.router";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { GiftCardService } from "./gift_card.service";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

async function resolveAccount(auth: string) {
    const email = getIdentifyByVerify(auth);
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    return account;
}

// ─── Brute-force protection ───

const redeemAttempts = new Map<string, { count: number; windowStart: number }>();
const REDEEM_WINDOW_MS = 60_000;
const REDEEM_MAX_ATTEMPTS = 5;

function checkRedeemRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = redeemAttempts.get(key);

    if (!entry || now - entry.windowStart > REDEEM_WINDOW_MS) {
        redeemAttempts.set(key, { count: 1, windowStart: now });
        return true;
    }

    if (entry.count >= REDEEM_MAX_ATTEMPTS) return false;

    entry.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of redeemAttempts) {
        if (now - entry.windowStart > REDEEM_WINDOW_MS) {
            redeemAttempts.delete(key);
        }
    }
}, 120_000);

// ─── Admin: Create a gift card ───

async function create(request: GiftCardCreateRequest) {
    request = GiftCardCreateRequest.self(request);
    await requireAdmin(request.auth);

    const card = await GiftCardService.create(request.token_amount);
    return { card: new GiftCardDTO(card) };
}

// ─── Admin: List all gift cards ───

async function list(request: GiftCardListRequest) {
    request = GiftCardListRequest.self(request);
    await requireAdmin(request.auth);

    const cards = await GiftCardService.list();
    return { list: cards.filter(c => c.token_amount > 1).map(c => new GiftCardDTO(c)) };
}

// ─── User: Redeem a gift card ───

async function redeem(request: GiftCardRedeemRequest) {
    request = GiftCardRedeemRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    if (!checkRedeemRateLimit(`redeem:${account.id}`)) {
        throw "Too many attempts, please try again later";
    }

    const card = await GiftCardService.findByCode(request.code);
    if (!card || card.status !== "unused") {
        throw "Invalid or already redeemed gift card code";
    }

    await GiftCardService.redeem(card, account.id);

    return { token_amount: card.token_amount };
}

// ─── Admin: Cleanup expired unused cards ───

async function cleanup(request: GiftCardCleanupRequest) {
    request = GiftCardCleanupRequest.self(request);
    await requireAdmin(request.auth);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const deleted = await GiftCardService.cleanupExpired(thirtyDaysAgo);

    return { deleted_count: deleted };
}

export const giftCardMount = {
    routes: giftCardRoutes,
    handlers: { create, list, redeem, cleanup },
};
