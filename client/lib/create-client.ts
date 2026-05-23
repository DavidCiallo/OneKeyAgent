import { HttpClientService } from "./webhttp";

type RouteDef<Req, Res> = { path: string; request: Req; response: Res };

type ApiClient<T> = {
    [K in keyof T]: T[K] extends RouteDef<infer Req, infer Res>
        ? (body: Req) => Promise<Res>
        : never;
};

export function createClient<T extends { base: string; prefix: string }>(def: T): ApiClient<T> {
    const http = HttpClientService.getInstance();
    const client = {} as any;
    for (const [key, val] of Object.entries(def)) {
        if (key === "base" || key === "prefix") continue;
        const route = val as any;
        const url = `${def.base}${def.prefix}${route.path}`;
        client[key] = (body: any) => http.post(url, { ...body, auth: body.auth || localStorage.getItem("access_token") || "" });
    }
    return client;
}
