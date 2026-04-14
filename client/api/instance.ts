import { inject } from "../lib/inject";

import { AuthRouterInstance } from "../../shared/modules/auth/auth.router";
import { DemoRouterInstance } from "../../shared/modules/demo/demo.router";
import { AiRouterInstance } from "../../shared/modules/ai/ai.router";
import { ModelRouterInstance } from "../../shared/modules/model/model.router";
import { UsageRouterInstance } from "../../shared/modules/usage/usage.router";

export const AuthRouter = new AuthRouterInstance(inject);
export const DemoRouter = new DemoRouterInstance(inject);
export const AiRouter = new AiRouterInstance(inject);
export const ModelRouter = new ModelRouterInstance(inject);
export const UsageRouter = new UsageRouterInstance(inject);
