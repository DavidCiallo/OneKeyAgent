import { BaseRequest, BaseResponse } from "../../lib/default/decorator";

/** One relayed upstream attempt. Summaries only — no prompt/response bodies. */
export interface AuditDTO {
    id: string;
    ts: number;
    success: number;
    account_id: string;
    account_name: string;
    model_alias: string;
    provider_id: string;
    provider_name: string;
    api_type: string;
    endpoint: string;
    status_code: number;
    duration_ms: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    cost: number;
    stream: number;
    err: string;
    /** Output tokens per second, derived server-side from tokens/duration. */
    tps: number;
}

export class AuditListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<AuditListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: AuditListRequest) {
        return new AuditListRequest(unsafe);
    }
}

export class AuditListResponse implements BaseResponse<AuditDTO> {
    public success: boolean;
    public message: string;
    public data: { list: AuditDTO[]; keep: number };

    constructor(origin: AuditListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
