import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { initialize } from "./initialize";
import { startMonitor } from "../modules/subscription/monitor";


config();

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

import { mounthttp, mountstatic } from "../lib/mount";
import { authMount } from "../modules/auth/auth.controller";
import { aiMount } from "../modules/ai/ai.controller";
import { modelMount } from "../modules/model/model.controller";
import { usageMount } from "../modules/usage/usage.controller";
import { accountMount } from "../modules/account/account.controller";
import { roleMount } from "../modules/role/role.controller";
import { providerMount } from "../modules/provider/provider.controller";
import { taskMount } from "../modules/task/task.controller";
import { telegramMount } from "../modules/telegram/telegram.controller";
import { subscriptionMount } from "../modules/subscription/subscription.controller";
import { giftCardMount } from "../modules/subscription/gift_card.controller";
import { settingsMount } from "../modules/settings/settings.controller";
const PORT = parseInt(process.env.SERVER_PORT || "3300");
await initialize();
startMonitor();

// @ts-ignore
Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;

        const apiResponse = await mounthttp(req, [
            authMount,
            aiMount,
            modelMount,
            usageMount,
            accountMount,
            roleMount,
            providerMount,
            taskMount,
            telegramMount,
            subscriptionMount,
            giftCardMount,
            settingsMount,
        ]);
        if (apiResponse) return apiResponse;
        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
