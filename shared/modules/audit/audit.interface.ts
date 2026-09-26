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
    /** Whether this attempt still holds a request/response summary to fetch.
     *  The list does not carry the bodies; see AuditDetailRequest. */
    has_detail: boolean;
    /** Output tokens per second, derived server-side from tokens/duration. */
    tps: number;
}

/** What was sent upstream and what came back, as a field summary: the JSON
 *  structure with each string leaf previewed — failed attempts only. Fetched
 *  per row when an admin expands it. */
export interface AuditDetailDTO {
    id: string;
    request_body: string;
    response_body: string;
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

export class AuditDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<AuditDetailRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id || "";
    }
    static self(unsafe: AuditDetailRequest) {
        return new AuditDetailRequest(unsafe);
    }
}

export class AuditDetailResponse implements BaseResponse<AuditDetailDTO> {
    public success: boolean;
    public message: string;
    // Declared inline rather than as AuditDetailDTO: BaseResponse constrains
    // data to a record, and an interface has no implicit index signature.
    public data: { id: string; request_body: string; response_body: string };

    constructor(origin: AuditDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
