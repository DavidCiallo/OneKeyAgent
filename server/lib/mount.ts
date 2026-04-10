import { BaseRouterInstance } from "../../shared/lib/default/decorator";
import path from "path";

export async function mounthttp(req: Request, controllers: BaseRouterInstance[]): Promise<Response | null> {
    const url = new URL(req.url);
    const pathName = url.pathname;
    const method = req.method.toLowerCase();

    for (const controller of controllers) {
        const { base, prefix, router } = controller;
        for (const item of router) {
            const { path, handler } = item;
            const fullPath = `${base}${prefix}${path}`;

            if (pathName === fullPath) {
                const auth = req.headers.get("token");
                let requestBody: Record<string, any> | null = {};
                try {
                    requestBody = await req.json();
                } catch (e) {
                    requestBody = null;
                }
                try {
                    const result = handler && (await handler({ ...requestBody, auth }));

                    return new Response(JSON.stringify(result), {
                        headers: {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type, token",
                        },
                    });
                } catch (error: any) {
                    console.error(`Error in handler for ${fullPath}:`, error);
                    return new Response(JSON.stringify({
                        success: false,
                        message: error?.message || error?.toString() || "Internal server error",
                        data: null
                    }), {
                        status: 400,
                        headers: {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type, token",
                        },
                    });
                }
            }
        }
    }

    if (method === "options") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, token",
            },
        });
    }

    return null;
}

const validStaticFiles = new Set<string>();

export async function mountstatic(staticPath: string, pathName: string) {
    if (pathName.endsWith(".mjs")) {
        return new Response("Forbidden", { status: 403 });
    }

    let filePath = path.join(staticPath, pathName);
    if (pathName === "/") {
        filePath = path.join(staticPath, "index.html");
    }
    if (!validStaticFiles.has(filePath)) {
        // @ts-ignore
        const file = Bun.file(filePath);
        if (await file.exists()) {
            validStaticFiles.add(filePath);
            return new Response(file);
        }
    } else {
        // @ts-ignore
        const file = Bun.file(filePath);
        return new Response(file);
    }

    if (!pathName.startsWith("/api")) {
        // @ts-ignore
        return new Response(Bun.file(path.join(staticPath, "index.html")));
    }

    return null;
}

export const activeSockets = new Set<any>();

export function mountws(req: Request, server: any): boolean {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
        return server.upgrade(req);
    }
    return false;
}

export const wshandler = {
    open(ws: any) {
        activeSockets.add(ws);
    },
    message(ws: any, message: any) {},
    close(ws: any, code: number, message: string) {
        activeSockets.delete(ws);
    },
};

export function broadcastWsMessage(message: any) {
    const msgString = JSON.stringify(message);
    for (const ws of activeSockets) {
        try {
            ws.send(msgString);
        } catch (e) {
            console.error("Failed to send WebSocket message", e);
        }
    }
}
