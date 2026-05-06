import {
    SubscriptionPlanListRequest, SubscriptionPlanListResponse,
    SubscriptionPlanCreateRequest, SubscriptionPlanCreateResponse,
    SubscriptionPlanUpdateRequest, SubscriptionPlanUpdateResponse,
    SubscriptionPlanDeleteRequest, SubscriptionPlanDeleteResponse,
    SubscriptionPlanDTO,
} from "../../../shared/modules/subscription_plan/subscription_plan.interface";
import {
    SubscriptionRecordListRequest, SubscriptionRecordListResponse,
    SubscriptionAddressRequest, SubscriptionAddressResponse,
    SubscriptionRecordDTO,
} from "../../../shared/modules/subscription_record/subscription_record.interface";
import { SubscriptionPlanRouterInstance } from "../../../shared/modules/subscription_plan/subscription_plan.router";
import { SubscriptionRecordRouterInstance } from "../../../shared/modules/subscription_record/subscription_record.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { SubscriptionService } from "./subscription.service";
import { AccountService } from "../account/account.service";
import { nanoid } from "nanoid";

// ─── Auth helpers ───

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

// ─── Plan routes ───

async function planList(request: SubscriptionPlanListRequest): Promise<SubscriptionPlanListResponse> {
    request = SubscriptionPlanListRequest.self(request);
    const data = await SubscriptionService.listPlans();
    const list = data.map(item => new SubscriptionPlanDTO(item));
    return new SubscriptionPlanListResponse({
        success: true,
        message: "success",
        data: { list },
    });
}

async function planCreate(request: SubscriptionPlanCreateRequest): Promise<SubscriptionPlanCreateResponse> {
    request = SubscriptionPlanCreateRequest.self(request);
    await requireAdmin(request.auth);
    const data = await SubscriptionService.createPlan(request.plan);
    const plan = new SubscriptionPlanDTO(data);
    return new SubscriptionPlanCreateResponse({
        success: true,
        message: "success",
        data: { plan },
    });
}

async function planUpdate(request: SubscriptionPlanUpdateRequest): Promise<SubscriptionPlanUpdateResponse> {
    request = SubscriptionPlanUpdateRequest.self(request);
    await requireAdmin(request.auth);
    const data = await SubscriptionService.updatePlan(request.id, request.plan);
    if (!data) throw "Plan not found";
    const plan = new SubscriptionPlanDTO(data);
    return new SubscriptionPlanUpdateResponse({
        success: true,
        message: "success",
        data: { plan },
    });
}

async function planDelete(request: SubscriptionPlanDeleteRequest): Promise<SubscriptionPlanDeleteResponse> {
    request = SubscriptionPlanDeleteRequest.self(request);
    await requireAdmin(request.auth);
    await SubscriptionService.deletePlan(request.id);
    return new SubscriptionPlanDeleteResponse({
        success: true,
        message: "success",
    });
}

// ─── Record / Address routes ───

async function records(request: SubscriptionRecordListRequest): Promise<SubscriptionRecordListResponse> {
    request = SubscriptionRecordListRequest.self(request);
    const account = await resolveAccount(request.auth || "");
    const data = await SubscriptionService.getRecordsByAccount(account.id);
    const list = data.map(item => new SubscriptionRecordDTO(item));
    return new SubscriptionRecordListResponse({
        success: true,
        message: "success",
        data: { list },
    });
}

/**
 * Get the user's dedicated deposit address.
 * Generates one if not yet assigned.
 */
async function address(request: SubscriptionAddressRequest): Promise<SubscriptionAddressResponse> {
    request = SubscriptionAddressRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    if (!account.sub_wallet_address) {
        // Generate a unique sub-address
        // In production, this would derive a hierarchical deterministic (HD) wallet address.
        // For now, use a deterministic label scheme:
        //   master address with account_id as memo
        const masterAddress = process.env.TRC20_WALLET_ADDRESS || "";
        if (!masterAddress) throw new Error("TRC20_WALLET_ADDRESS not configured");

        const address = `${masterAddress}?userId=${account.id}`;
        await AccountService.update(account.id, { sub_wallet_address: address });
        account.sub_wallet_address = address;
    }

    return new SubscriptionAddressResponse({
        success: true,
        message: "success",
        data: {
            address: account.sub_wallet_address,
            chain: "trc20",
        },
    });
}

// ─── Export controllers ───

export const subscriptionPlanController = new SubscriptionPlanRouterInstance(inject, {
    list: planList,
    create: planCreate,
    update: planUpdate,
    delete: planDelete,
});

export const subscriptionRecordController = new SubscriptionRecordRouterInstance(inject, {
    records,
    address,
});
