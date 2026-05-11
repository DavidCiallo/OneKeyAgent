import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    TransactionListRequest, TransactionListResponse,
    SubscriptionTopupRequest, SubscriptionTopupResponse,
    } from "./subscription_record.interface";

export class TransactionRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/subscription";
    router = [
        { path: "/records", handler: Function },
        { path: "/createtopup", handler: Function },
        { path: "/ipnwebhook", handler: Function },
    ];

    records!: (query: TransactionListRequest) => Promise<TransactionListResponse>;
    createtopup!: (query: SubscriptionTopupRequest) => Promise<SubscriptionTopupResponse>;
    ipnwebhook!: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>;

    constructor(inject: Function, functions?: {
        records: (query: TransactionListRequest) => Promise<TransactionListResponse>,
        createtopup: (query: SubscriptionTopupRequest) => Promise<SubscriptionTopupResponse>,
        ipnwebhook: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>,
    }) {
        super();
        inject(this, functions);
    }
}