import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { runMigrations } from "../lib/migrate";
import { initialize } from "./initialize";

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
const PORT = parseInt(process.env.SERVER_PORT || "3300");
initialize();
// @ts-ignore
Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;

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
        ]);
        if (apiResponse) return apiResponse;
        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
