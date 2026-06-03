import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { TransactionEntity, TxStatus, TxType } from "./subscription_record.entity";

export const PAYMENT_CURRENCIES = [
    { token: "USDT", chain: "ETH", pay_currency: "USDTERC20", localeKey: "CurrencyETHUSDT", iconKey: "USDTERC20" },
    { token: "USDT", chain: "ARB", pay_currency: "USDTARB", localeKey: "CurrencyARBUSDT", iconKey: "USDTARB" },
    { token: "USDT", chain: "SOL", pay_currency: "USDTSOL", localeKey: "CurrencySOLUSDT", iconKey: "USDTSOL" },
    { token: "USDT", chain: "OP", pay_currency: "USDTOP", localeKey: "CurrencyOPUSDT", iconKey: "USDTOP" },
    { token: "USDT", chain: "BSC", pay_currency: "USDTBSC", localeKey: "CurrencyBSCUSDT", iconKey: "USDTBSC" },
    { token: "USDT", chain: "ALGO", pay_currency: "USDTALGO", localeKey: "CurrencyALGOUSDT", iconKey: "USDTALGO" },
    { token: "USDC", chain: "ETH", pay_currency: "USDC", localeKey: "CurrencyETHUSDC", iconKey: "USDC" },
    { token: "USDC", chain: "ARB", pay_currency: "USDCARB", localeKey: "CurrencyARBUSDC", iconKey: "USDCARB" },
    { token: "USDC", chain: "SOL", pay_currency: "USDCSOL", localeKey: "CurrencySOLUSDC", iconKey: "USDCSOL" },
    { token: "USDC", chain: "OP", pay_currency: "USDCOP", localeKey: "CurrencyOPUSDC", iconKey: "USDCOP" },
    { token: "USDC", chain: "BSC", pay_currency: "USDCBSC", localeKey: "CurrencyBSCUSDC", iconKey: "USDCBSC" },
    { token: "USDC", chain: "ALGO", pay_currency: "USDCALGO", localeKey: "CurrencyALGOUSDC", iconKey: "USDCALGO" },
] as const;

export type PaymentCurrency = typeof PAYMENT_CURRENCIES[number]["pay_currency"];

export class TransactionDTO {
    public id: string;
    public account_id: string;
    public txid: string;
    public amount: number;
    public status: TxStatus;
    public type: TxType;
    public create_time: number;
    public payment_id: string;

    constructor(origin: TransactionEntity) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.txid = origin.txid;
        this.amount = origin.amount;
        this.status = origin.status;
        this.type = origin.type;
        this.create_time = origin.create_time;
        this.payment_id = origin.payment_id;
    }
}

export class TransactionListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<TransactionListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: TransactionListRequest) {
        return new TransactionListRequest(unsafe);
    }
}

export class TransactionListResponse implements BaseResponse<TransactionDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: TransactionDTO[]
    };

    constructor(origin: TransactionListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ─── Statement (unified balance history) ───

export type StatementType = "topup" | "bonus" | "gift_card" | "usage";

export class StatementItem {
    public type: StatementType;
    public amount: number;      // positive for income, negative for expense
    public description: string; // "Topup", "Daily Bonus", "Gift Card Redeemed", "AI Usage"
    public remark?: string;     // e.g. model name for usage
    public create_time: number;
    public id: string;

    constructor(origin: StatementItem) {
        this.type = origin.type;
        this.amount = origin.amount;
        this.description = origin.description;
        origin.remark && (this.remark = origin.remark);
        this.create_time = origin.create_time;
        this.id = origin.id;
    }
}

export class StatementRequest implements BaseRequest {
    public auth?: string;
    public page?: number;

    constructor(origin: Partial<StatementRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        if (origin.page && origin.page > 0) this.page = origin.page;
    }
    static self(unsafe: StatementRequest) {
        return new StatementRequest(unsafe);
    }
}

export class StatementResponse implements BaseResponse<StatementItem[]> {
    public success: boolean;
    public message: string;
    public data: { list: StatementItem[]; total: number };

    constructor(origin: StatementResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionIpnWebhookBody {
    public payment_id?: string;
    public payment_status?: string;
    public invoice_id?: string;
    public order_id?: string;
    public actually_paid?: string;
    public pay_amount?: string;
    public price_amount?: string;
    public price_currency?: string;
    public pay_currency?: string;

    constructor(origin: Partial<SubscriptionIpnWebhookBody>) {
        Object.assign(this, origin);
    }
}

export class SubscriptionTopupRequest implements BaseRequest {
    public auth?: string;
    public token_amount?: number; // how many raw tokens to purchase
    public pay_currency?: string;

    constructor(origin: Partial<SubscriptionTopupRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.token_amount && (this.token_amount = origin.token_amount);
        origin.pay_currency && (this.pay_currency = origin.pay_currency);
    }
    static self(unsafe: SubscriptionTopupRequest) {
        return new SubscriptionTopupRequest(unsafe);
    }
}

export class SubscriptionTopupResponse implements BaseResponse<{ invoice_url: string; payment_id: string; token_amount: number; price_dollars: number }> {
    public success: boolean;
    public message: string;
    public data: {
        invoice_url: string;
        payment_id: string;
        token_amount: number;
        price_dollars: number;
    };

    constructor(origin: SubscriptionTopupResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}