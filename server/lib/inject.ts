import { BaseRouterInstance } from "../../shared/lib/default/decorator";

export function inject(instance: BaseRouterInstance, functions: Record<string, Function>) {
    instance.router.forEach((route) => {
        const { path } = route;
        const name = path.replace(/\//g, "");
        const targetFc = functions?.[name];
        if (targetFc) {
            instance[name] = targetFc;
            route.handler = targetFc;
        } else {
            throw new Error(`${name} is not defined in functions`);
        }
    });
}
