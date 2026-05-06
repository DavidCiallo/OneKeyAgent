import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    SubscriptionRecordListRequest, SubscriptionRecordListResponse,
    SubscriptionAddressRequest, SubscriptionAddressResponse,
} from "./subscription_record.interface";

export class SubscriptionRecordRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/subscription";
    router = [
        { path: "/records", handler: Function },
        { path: "/address", handler: Function },
    ];

    records!: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>;
    address!: (query: SubscriptionAddressRequest) => Promise<SubscriptionAddressResponse>;

    constructor(inject: Function, functions?: {
        records: (query: SubscriptionRecordListRequest) => Promise<SubscriptionRecordListResponse>,
        address: (query: SubscriptionAddressRequest) => Promise<SubscriptionAddressResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
