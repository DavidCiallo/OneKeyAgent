import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { SubscriptionRecordEntity, TxStatus } from "./subscription_record.entity";

export class SubscriptionRecordDTO {
    public id: string;
    public account_id: string;
    public plan_name: string;
    public txid: string;
    public from_address: string;
    public to_address: string;
    public chain: string;
    public amount: number;
    public status: TxStatus;
    public create_time: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: SubscriptionRecordEntity) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.plan_name = origin.plan_name;
        this.txid = origin.txid;
        this.from_address = origin.from_address;
        this.to_address = origin.to_address;
        this.chain = origin.chain;
        this.amount = origin.amount;
        this.status = origin.status;
        this.create_time = origin.create_time;
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

export class SubscriptionAddressRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<SubscriptionAddressRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: SubscriptionAddressRequest) {
        return new SubscriptionAddressRequest(unsafe);
    }
}

export class SubscriptionAddressResponse implements BaseResponse<{ address: string; chain: string }> {
    public success: boolean;
    public message: string;
    public data: {
        address: string;
        chain: string;
    };

    constructor(origin: SubscriptionAddressResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
