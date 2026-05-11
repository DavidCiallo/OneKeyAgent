import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    GiftCardCreateRequest, GiftCardCreateResponse,
    GiftCardListRequest, GiftCardListResponse,
    GiftCardRedeemRequest, GiftCardRedeemResponse,
    GiftCardCleanupRequest, GiftCardCleanupResponse,
} from "./gift_card.interface";

export class GiftCardRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/gift_card";
    router = [
        { path: "/create", handler: Function },
        { path: "/list", handler: Function },
        { path: "/redeem", handler: Function },
        { path: "/cleanup", handler: Function },
    ];

    create!: (body: GiftCardCreateRequest) => Promise<GiftCardCreateResponse>;
    list!: (query: GiftCardListRequest) => Promise<GiftCardListResponse>;
    redeem!: (body: GiftCardRedeemRequest) => Promise<GiftCardRedeemResponse>;
    cleanup!: (body: GiftCardCleanupRequest) => Promise<GiftCardCleanupResponse>;

    constructor(inject: Function, functions?: {
        create: (body: GiftCardCreateRequest) => Promise<GiftCardCreateResponse>,
        list: (query: GiftCardListRequest) => Promise<GiftCardListResponse>,
        redeem: (body: GiftCardRedeemRequest) => Promise<GiftCardRedeemResponse>,
        cleanup: (body: GiftCardCleanupRequest) => Promise<GiftCardCleanupResponse>,
    }) {
        super();
        inject(this, functions);
    }
}