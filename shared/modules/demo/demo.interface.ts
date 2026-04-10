import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { DemoDTO } from "./demo.entity";

// 请求参数接口
export interface DemoCreateParams {
    name: string;
}

export interface DemoFilterParams {
    name?: string;
}

// 请求类
export class DemoListRequest implements BaseRequest {
    public page: number;
    public filter?: DemoFilterParams;
    public auth?: string;

    constructor(data: any) {
        this.page = data.page || 1;
        this.filter = data.filter;
        this.auth = data.auth;
    }

    static self(data: any): DemoListRequest {
        return new DemoListRequest(data);
    }
}

export class DemoCreateRequest implements BaseRequest {
    public items: DemoCreateParams[];
    public auth?: string;

    constructor(data: any) {
        if (!data.items || !data.items.length) throw new Error("Items are required");
        this.items = data.items;
        this.auth = data.auth;
    }

    static self(data: any): DemoCreateRequest {
        return new DemoCreateRequest(data);
    }
}

// 响应类型定义（用于 Service 返回）
export interface DemoServiceListResponse {
    success: boolean;
    data?: { list: DemoDTO[]; total: number };
    message?: string;
}

export interface DemoServiceCreateResponse {
    success: boolean;
    data?: { list: DemoDTO[] };
    message?: string;
}

// 响应类
export class DemoListResponse implements BaseResponse<DemoDTO> {
    success: boolean;
    data?: { list: DemoDTO[]; total: number };
    message?: string;

    constructor(data: DemoServiceListResponse) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class DemoCreateResponse implements BaseResponse<DemoDTO> {
    success: boolean;
    data?: { list: DemoDTO[] };
    message?: string;

    constructor(data: DemoServiceCreateResponse) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

// Service 接口类型（用于 Service 返回值类型）
export interface DemoService {
    list: (page: number, filter: any, auth?: string) => Promise<DemoServiceListResponse>;
    create: (items: DemoCreateParams[], auth?: string) => Promise<DemoServiceCreateResponse>;
}
