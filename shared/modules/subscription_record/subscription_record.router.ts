import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    SubscriptionRecordListRequest, SubscriptionRecordListResponse,
    SubscriptionCreatePaymentRequest, SubscriptionCreatePaymentResponse,
    } from "./subscription_record.interface";

export class SubscriptionRecordRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/subscription";
    router = [
        { path: "/records", handler: Function },
        { path: "/createpayment", handler: Function },
        { path: "/ipnwebhook", handler: Function },
    ];

    records!: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>;
    createpayment!: (query: SubscriptionCreatePaymentRequest) => Promise<SubscriptionCreatePaymentResponse>;
    ipnwebhook!: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>;

    constructor(inject: Function, functions?: {
        records: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>,
        createpayment: (query: SubscriptionCreatePaymentRequest) => Promise<SubscriptionCreatePaymentResponse>,
        ipnwebhook: (query: Record<string, unknown>) => Promise<{ success: boolean; message: string }>,
    }) {
        super();
        inject(this, functions);
    }
}
