import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { runMigrations } from "../lib/migrate";
import { initialize } from "./initialize";
import { seedDefaultModel } from "../modules/ai/ai.session";
import { seedDefaultPlans } from "../modules/subscription/seed";
import { startMonitor } from "../modules/subscription/monitor";

config();

runMigrations();

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

import { mounthttp, mountstatic } from "../lib/mount";
import { authController } from "../modules/auth/auth.controller";
import { aiController } from "../modules/ai/ai.controller";
import { modelController } from "../modules/model/model.controller";
import { usageController } from "../modules/usage/usage.controller";
import { accountController } from "../modules/account/account.controller";
import { roleController } from "../modules/role/role.controller";
import { providerController } from "../modules/provider/provider.controller";
import { taskController } from "../modules/task/task.controller";
import { telegramController } from "../modules/telegram/telegram.controller";
import { subscriptionPlanController, subscriptionRecordController } from "../modules/subscription/subscription.controller";
import { giftCardController } from "../modules/subscription/gift_card.controller";
const PORT = parseInt(process.env.SERVER_PORT || "3300");
await initialize();
await seedDefaultModel();
await seedDefaultPlans();
startMonitor();
// @ts-ignore
Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;
        const method = req.method;
        if (pathName.startsWith("/api")) {
            console.log(`[REQ] ${method} ${pathName} content-type:${req.headers.get("content-type") || "-"}`);
        }
        const apiResponse = await mounthttp(req, [
            authController,
            aiController,
            modelController,
            usageController,
            accountController,
            roleController,
            providerController,
            taskController,
            telegramController,
            subscriptionPlanController,
            subscriptionRecordController,
            giftCardController,
        ]);
        if (apiResponse) return apiResponse;
        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
