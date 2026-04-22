import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { initialize } from "./initialize";

config();

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

import { mounthttp, mountstatic } from "../lib/mount";
import { authController } from "../modules/auth/auth.controller";
import { aiController, aiOldController } from "../modules/ai/ai.controller";
import { modelController } from "../modules/model/model.controller";
import { usageController } from "../modules/usage/usage.controller";
import { accountController } from "../modules/account/account.controller";
import { roleController } from "../modules/role/role.controller";
import { chatSessionController, chatMessageController } from "../modules/chat/chat.controller";

const PORT = parseInt(process.env.SERVER_PORT || "3300");
initialize();
// @ts-ignore
Bun.serve({
    port: PORT,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;
        // API 路由处理
        const apiResponse = await mounthttp(req, [
            authController,
            aiController,
            aiOldController,
            modelController,
            usageController,
            accountController,
            roleController,
            chatSessionController,
            chatMessageController,
        ]);
        if (apiResponse) return apiResponse;
        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
