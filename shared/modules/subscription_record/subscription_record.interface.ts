import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { SubscriptionRecordEntity, TxStatus } from "./subscription_record.entity";

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

export class SubscriptionRecordDTO {
    public id: string;
    public account_id: string;
    public plan_name: string;
    public txid: string;
    public amount: number;
    public status: TxStatus;
    public create_time: number;
    public payment_id: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: SubscriptionRecordEntity) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.plan_name = origin.plan_name;
        this.txid = origin.txid;
        this.amount = origin.amount;
        this.status = origin.status;
        this.create_time = origin.create_time;
        this.payment_id = origin.payment_id;
    }
}

export class SubscriptionRecordListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<SubscriptionRecordListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: SubscriptionRecordListRequest) {
        return new SubscriptionRecordListRequest(unsafe);
    }
}

export class SubscriptionRecordListResponse implements BaseResponse<SubscriptionRecordDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: SubscriptionRecordDTO[]
    };

    constructor(origin: SubscriptionRecordListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionCreatePaymentRequest implements BaseRequest {
    public auth?: string;
    public plan_name?: string;
    public pay_currency?: string;

    constructor(origin: Partial<SubscriptionCreatePaymentRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.plan_name && (this.plan_name = origin.plan_name);
        origin.pay_currency && (this.pay_currency = origin.pay_currency);
    }
    static self(unsafe: SubscriptionCreatePaymentRequest) {
        return new SubscriptionCreatePaymentRequest(unsafe);
    }
}

export class SubscriptionCreatePaymentResponse implements BaseResponse<{ invoice_url: string; payment_id: string }> {
    public success: boolean;
    public message: string;
    public data: {
        invoice_url: string;
        payment_id: string;
    };

    constructor(origin: SubscriptionCreatePaymentResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionRedeemGiftCardRequest implements BaseRequest {
    public auth?: string;
    public code?: string;

    constructor(origin: Partial<SubscriptionRedeemGiftCardRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.code && (this.code = origin.code);
    }
    static self(unsafe: SubscriptionRedeemGiftCardRequest) {
        return new SubscriptionRedeemGiftCardRequest(unsafe);
    }
}

export class SubscriptionRedeemGiftCardResponse implements BaseResponse<undefined> {
    public success: boolean;
    public message: string;
    public data?: undefined;

    constructor(origin: SubscriptionRedeemGiftCardResponse) {
        this.success = origin.success;
        this.message = origin.message;
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
