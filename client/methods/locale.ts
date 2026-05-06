import CN from "../locales/cn.json";
import EN from "../locales/en.json";
import RU from "../locales/ru.json";
import JA from "../locales/ja.json";
import ES from "../locales/es.json";
import PT_BR from "../locales/pt-BR.json";

export function Locale(page: string): { [key: string]: string } {
    const language = localStorage.getItem("locale") || "en";
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
        case "ja":
            if (page in JA) {
                strMap = JA[page as keyof typeof JA];
            }
            break;
        case "es":
            if (page in ES) {
                strMap = ES[page as keyof typeof ES];
            }
            break;
        case "pt-BR":
            if (page in PT_BR) {
                strMap = PT_BR[page as keyof typeof PT_BR];
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
