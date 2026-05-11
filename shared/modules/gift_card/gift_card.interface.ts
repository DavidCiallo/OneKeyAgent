import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { GiftCardEntity, GiftCardStatus } from "./gift_card.entity";

export class GiftCardDTO {
    public id: string;
    public code: string;
    public token_amount: number;
    public status: GiftCardStatus;
    public redeemed_by: string | null;
    public redeemed_at: number | null;
    public create_time: number;

    constructor(origin: GiftCardEntity) {
        this.id = origin.id;
        this.code = origin.code;
        this.token_amount = origin.token_amount;
        this.status = origin.status;
        this.redeemed_by = origin.redeemed_by;
        this.redeemed_at = origin.redeemed_at;
        this.create_time = origin.create_time;
    }
}

// ─── Create (admin) ───

export class GiftCardCreateRequest implements BaseRequest {
    public auth?: string;
    public token_amount: number;

    constructor(origin: Partial<GiftCardCreateRequest>) {
        if (!origin.token_amount || origin.token_amount <= 0) throw new Error("token_amount is required and must be positive");
        origin.auth && (this.auth = origin.auth);
        this.token_amount = origin.token_amount;
    }
    static self(unsafe: GiftCardCreateRequest) {
        return new GiftCardCreateRequest(unsafe);
    }
}

export class GiftCardCreateResponse implements BaseResponse<GiftCardDTO> {
    public success: boolean;
    public message: string;
    public data: {
        card: GiftCardDTO | null;
    };

    constructor(origin: GiftCardCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ─── List (admin) ───

export class GiftCardListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<GiftCardListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: GiftCardListRequest) {
        return new GiftCardListRequest(unsafe);
    }
}

export class GiftCardListResponse implements BaseResponse<GiftCardDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: GiftCardDTO[];
    };

    constructor(origin: GiftCardListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ─── Redeem (user) ───

export class GiftCardRedeemRequest implements BaseRequest {
    public auth?: string;
    public code: string;

    constructor(origin: Partial<GiftCardRedeemRequest>) {
        if (!origin.code) throw new Error("code is required");
        origin.auth && (this.auth = origin.auth);
        this.code = origin.code;
    }
    static self(unsafe: GiftCardRedeemRequest) {
        return new GiftCardRedeemRequest(unsafe);
    }
}

export class GiftCardRedeemResponse implements BaseResponse<undefined> {
    public success: boolean;
    public message: string;
    public data?: undefined;

    constructor(origin: GiftCardRedeemResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

// ─── Cleanup expired (admin) ───

export class GiftCardCleanupRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<GiftCardCleanupRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: GiftCardCleanupRequest) {
        return new GiftCardCleanupRequest(unsafe);
    }
}

export class GiftCardCleanupResponse implements BaseResponse<{ deleted_count: number }> {
    public success: boolean;
    public message: string;
    public data: {
        deleted_count: number;
    };

    constructor(origin: GiftCardCleanupResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}