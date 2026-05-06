import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { SubscriptionRecordEntity, TxStatus } from "./subscription_record.entity";

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

    constructor(origin: Partial<SubscriptionCreatePaymentRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.plan_name && (this.plan_name = origin.plan_name);
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
