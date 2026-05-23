import { createClient } from "../lib/create-client";

import { authRoutes } from "../../shared/modules/auth/auth.router";
import { aiRoutes } from "../../shared/modules/ai/ai.router";
import { modelRoutes } from "../../shared/modules/model/model.router";
import { usageRoutes } from "../../shared/modules/usage/usage.router";
import { accountRoutes } from "../../shared/modules/account/account.router";
import { roleRoutes } from "../../shared/modules/role/role.router";
import { providerRoutes } from "../../shared/modules/provider/provider.router";
import { subscriptionRoutes } from "../../shared/modules/subscription_record/subscription_record.router";
import { giftCardRoutes } from "../../shared/modules/gift_card/gift_card.router";
import { settingsRoutes } from "../../shared/modules/settings/settings.router";

export const authApi = createClient(authRoutes);
export const aiApi = createClient(aiRoutes);
export const modelApi = createClient(modelRoutes);
export const usageApi = createClient(usageRoutes);
export const accountApi = createClient(accountRoutes);
export const roleApi = createClient(roleRoutes);
export const providerApi = createClient(providerRoutes);
export const subscriptionApi = createClient(subscriptionRoutes);
export const giftCardApi = createClient(giftCardRoutes);
export const settingsApi = createClient(settingsRoutes);
