import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    SubscriptionPlanListRequest, SubscriptionPlanListResponse,
    SubscriptionPlanCreateRequest, SubscriptionPlanCreateResponse,
    SubscriptionPlanUpdateRequest, SubscriptionPlanUpdateResponse,
    SubscriptionPlanDeleteRequest, SubscriptionPlanDeleteResponse,
} from "./subscription_plan.interface";

export class SubscriptionPlanRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/subscription_plan";
    router = [
        { path: "/list", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (query: SubscriptionPlanListRequest) => Promise<SubscriptionPlanListResponse>;
    create!: (body: SubscriptionPlanCreateRequest) => Promise<SubscriptionPlanCreateResponse>;
    update!: (body: SubscriptionPlanUpdateRequest) => Promise<SubscriptionPlanUpdateResponse>;
    delete!: (body: SubscriptionPlanDeleteRequest) => Promise<SubscriptionPlanDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (query: SubscriptionPlanListRequest) => Promise<SubscriptionPlanListResponse>,
        create: (body: SubscriptionPlanCreateRequest) => Promise<SubscriptionPlanCreateResponse>,
        update: (body: SubscriptionPlanUpdateRequest) => Promise<SubscriptionPlanUpdateResponse>,
        delete: (body: SubscriptionPlanDeleteRequest) => Promise<SubscriptionPlanDeleteResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
