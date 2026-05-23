import {
    TransactionListRequest, TransactionListResponse,
    SubscriptionTopupRequest, SubscriptionTopupResponse,
    StatementRequest, StatementResponse,
} from "./subscription_record.interface";

export const subscriptionRoutes = {
    base: "/api",
    prefix: "/subscription",
    records:     { path: "/records",     request: {} as TransactionListRequest,       response: {} as TransactionListResponse },
    createtopup: { path: "/createtopup", request: {} as SubscriptionTopupRequest,     response: {} as SubscriptionTopupResponse },
    ipnwebhook:  { path: "/ipnwebhook",  request: {} as Record<string, unknown>,      response: {} as { success: boolean; message: string }, raw: true },
    statement:   { path: "/statement",   request: {} as StatementRequest,             response: {} as StatementResponse },
} as const;
