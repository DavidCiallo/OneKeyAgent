import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    SubscriptionRecordListRequest, SubscriptionRecordListResponse,
    SubscriptionCreatePaymentRequest, SubscriptionCreatePaymentResponse,
    SubscriptionTopupRequest, SubscriptionTopupResponse,
    } from "./subscription_record.interface";

export class SubscriptionRecordRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/subscription";
    router = [
        { path: "/records", handler: Function },
        { path: "/createpayment", handler: Function },
        { path: "/createtopup", handler: Function },
        { path: "/ipnwebhook", handler: Function },
    ];

    records!: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>;
    createpayment!: (query: SubscriptionCreatePaymentRequest) => Promise<SubscriptionCreatePaymentResponse>;
    createtopup!: (query: SubscriptionTopupRequest) => Promise<SubscriptionTopupResponse>;
    ipnwebhook!: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>;

    constructor(inject: Function, functions?: {
        records: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>,
        createpayment: (query: SubscriptionCreatePaymentRequest) => Promise<SubscriptionCreatePaymentResponse>,
        createtopup: (query: SubscriptionTopupRequest) => Promise<SubscriptionTopupResponse>,
        ipnwebhook: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>,
    }) {
        super();
        inject(this, functions);
    }
}
