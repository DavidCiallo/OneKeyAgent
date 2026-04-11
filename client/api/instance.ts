import { inject } from "../lib/inject";

import { AuthRouterInstance } from "../../shared/modules/auth/auth.router";
import { DemoRouterInstance } from "../../shared/modules/demo/demo.router";

export const AuthRouter = new AuthRouterInstance(inject);
export const DemoRouter = new DemoRouterInstance(inject);
