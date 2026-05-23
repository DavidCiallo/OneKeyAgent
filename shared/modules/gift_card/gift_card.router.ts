import {
    GiftCardCreateRequest, GiftCardCreateResponse,
    GiftCardListRequest, GiftCardListResponse,
    GiftCardRedeemRequest, GiftCardRedeemResponse,
    GiftCardCleanupRequest, GiftCardCleanupResponse,
} from "./gift_card.interface";

export const giftCardRoutes = {
    base: "/api",
    prefix: "/gift_card",
    create:  { path: "/create",  request: {} as GiftCardCreateRequest,  response: {} as GiftCardCreateResponse },
    list:    { path: "/list",    request: {} as GiftCardListRequest,    response: {} as GiftCardListResponse },
    redeem:  { path: "/redeem",  request: {} as GiftCardRedeemRequest,  response: {} as GiftCardRedeemResponse },
    cleanup: { path: "/cleanup", request: {} as GiftCardCleanupRequest, response: {} as GiftCardCleanupResponse },
} as const;
