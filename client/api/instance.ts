import { inject } from "../lib/inject";

import { AuthRouterInstance } from "../../shared/modules/auth/auth.router";
import { AiRouterInstance } from "../../shared/modules/ai/ai.router";
import { ModelRouterInstance } from "../../shared/modules/model/model.router";
import { UsageRouterInstance } from "../../shared/modules/usage/usage.router";
import { AccountRouterInstance } from "../../shared/modules/account/account.router";
import { RoleRouterInstance } from "../../shared/modules/role/role.router";
import { ChatSessionRouterInstance } from "../../shared/modules/chat_session/chat_session.router";
import { ChatMessageRouterInstance } from "../../shared/modules/chat_message/chat_message.router";

export const AuthRouter = new AuthRouterInstance(inject);
export const AiRouter = new AiRouterInstance(inject);
export const ModelRouter = new ModelRouterInstance(inject);
export const UsageRouter = new UsageRouterInstance(inject);
export const AccountRouter = new AccountRouterInstance(inject);
export const RoleRouter = new RoleRouterInstance(inject);
export const ChatSessionRouter = new ChatSessionRouterInstance(inject);
export const ChatMessageRouter = new ChatMessageRouterInstance(inject);
