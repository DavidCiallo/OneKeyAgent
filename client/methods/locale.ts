import CN from "../locales/cn.json";
import EN from "../locales/en.json";
import RU from "../locales/ru.json";

export function Locale(page: string): { [key: string]: string } {
    const language = localStorage.getItem("locale") || "cn";
    let strMap: { [key: string]: string } = {};

    switch (language) {
        case "cn":
            if (page in CN) {
                strMap = CN[page as keyof typeof CN];
            }
            break;
        case "en":
            if (page in EN) {
                strMap = EN[page as keyof typeof EN];
            }
            break;
        case "ru":
            if (page in RU) {
                strMap = RU[page as keyof typeof RU];
            }
            break;
        default:
            strMap = {};
            break;
    }

    const proxyHandler: ProxyHandler<{ [key: string]: string }> = {
        get(target, key, receiver) {
            if (typeof key === "string") {
                const translatedValue = Reflect.get(target, key, receiver);
                if (translatedValue === undefined) {
                    return key;
                }
                return translatedValue;
            }
            return Reflect.get(target, key, receiver);
        },
    };
    return new Proxy(strMap, proxyHandler);
}
