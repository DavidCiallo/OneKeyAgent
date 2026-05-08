import {
    GiftCardCreateRequest, GiftCardCreateResponse,
    GiftCardListRequest, GiftCardListResponse,
    GiftCardRedeemRequest, GiftCardRedeemResponse,
    GiftCardCleanupRequest, GiftCardCleanupResponse,
    GiftCardDTO,
} from "../../../shared/modules/gift_card/gift_card.interface";
import { GiftCardRouterInstance } from "../../../shared/modules/gift_card/gift_card.router";
import { inject } from "../../lib/inject";
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
const REDEEM_WINDOW_MS = 60_000; // 1 minute
const REDEEM_MAX_ATTEMPTS = 5;   // max 5 attempts per window

function checkRedeemRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = redeemAttempts.get(key);

    if (!entry || now - entry.windowStart > REDEEM_WINDOW_MS) {
        redeemAttempts.set(key, { count: 1, windowStart: now });
        return true;
    }

    if (entry.count >= REDEEM_MAX_ATTEMPTS) {
        return false;
    }

    entry.count++;
    return true;
}

// Clean up stale entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of redeemAttempts) {
        if (now - entry.windowStart > REDEEM_WINDOW_MS) {
            redeemAttempts.delete(key);
        }
    }
}, 120_000);

// ─── Admin: Create a gift card ───

async function create(request: GiftCardCreateRequest): Promise<GiftCardCreateResponse> {
    request = GiftCardCreateRequest.self(request);
    await requireAdmin(request.auth);

    const card = await GiftCardService.create(request.plan_name, request.duration_days);
    return new GiftCardCreateResponse({
        success: true,
        message: "success",
        data: { card: new GiftCardDTO(card) },
    });
}

// ─── Admin: List all gift cards ───

async function list(request: GiftCardListRequest): Promise<GiftCardListResponse> {
    request = GiftCardListRequest.self(request);
    await requireAdmin(request.auth);

    const cards = await GiftCardService.list();
    return new GiftCardListResponse({
        success: true,
        message: "success",
        data: { list: cards.map(c => new GiftCardDTO(c)) },
    });
}

// ─── User: Redeem a gift card ───

async function redeem(request: GiftCardRedeemRequest): Promise<GiftCardRedeemResponse> {
    request = GiftCardRedeemRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    // Rate limit: max 5 attempts per minute per account
    if (!checkRedeemRateLimit(`redeem:${account.id}`)) {
        return new GiftCardRedeemResponse({
            success: false,
            message: "Too many attempts, please try again later",
        });
    }

    const card = await GiftCardService.findByCode(request.code);
    if (!card || card.status !== "unused") {
        // Deliberately vague error — don't reveal whether the code exists or is just already used
        return new GiftCardRedeemResponse({
            success: false,
            message: "Invalid or already redeemed gift card code",
        });
    }

    await GiftCardService.redeem(card, account.id);

    return new GiftCardRedeemResponse({
        success: true,
        message: "Gift card redeemed successfully",
    });
}

// ─── Admin: Cleanup expired unused cards ───

async function cleanup(request: GiftCardCleanupRequest): Promise<GiftCardCleanupResponse> {
    request = GiftCardCleanupRequest.self(request);
    await requireAdmin(request.auth);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const deleted = await GiftCardService.cleanupExpired(thirtyDaysAgo);

    return new GiftCardCleanupResponse({
        success: true,
        message: "success",
        data: { deleted_count: deleted },
    });
}

// ─── Export ───

export const giftCardController = new GiftCardRouterInstance(inject, {
    create,
    list,
    redeem,
    cleanup,
});