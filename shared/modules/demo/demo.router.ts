import { BaseRouterInstance } from "../../lib/default/decorator";
import { DemoListRequest, DemoListResponse, DemoCreateRequest, DemoCreateResponse } from "./demo.interface";

export class DemoRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/demo";
    router = [
        { path: "/list", handler: Function },
        { path: "/create", handler: Function },
    ];

    list!: (request: DemoListRequest) => Promise<DemoListResponse>;
    create!: (request: DemoCreateRequest) => Promise<DemoCreateResponse>;

    constructor(
        inject: Function,
        functions?: {
            list: (request: DemoListRequest) => Promise<DemoListResponse>;
            create: (request: DemoCreateRequest) => Promise<DemoCreateResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}
