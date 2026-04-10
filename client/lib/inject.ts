import { BaseRouterInstance, Route } from "../../shared/lib/default/decorator";
import { HttpClientService } from "./webhttp";

export function inject(instance: BaseRouterInstance) {
    const http = HttpClientService.getInstance();
    const { base, prefix, router } = instance;
    router.forEach((route: Route) => {
        route.handler = null;
        const { path } = route;
        const url = base + prefix + path;
        const name = path.replace(/\//g, "");
        instance[name] = async (body: Record<string, any>) => {
            return http.post(url, body);
        };
    });
}
