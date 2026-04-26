import { Button } from "@heroui/react";
import { AuthStatus, getAuthStatus } from "../../methods/auth";
import { Locale } from "../../methods/locale";

const Component = () => {
    const locale = Locale("HomePage");
    const auth = getAuthStatus();
    function changeLan() {
        const lanList = ["cn", "en"];
        const locale = localStorage.getItem("locale") || "cn";
        const index = lanList.indexOf(locale);
        const nextIndex = (index + 1) % lanList.length;
        localStorage.setItem("locale", lanList[nextIndex]);
        window.location.reload();
    }

    function Language() {
        const l = localStorage.getItem("locale") || "cn";
        let lan = "";
        switch (l) {
            case "cn": lan = "中文"; break;
            case "en": lan = "EN"; break;
            default: lan = "中文";
        }
        return (
            <Button size="sm" variant="bordered" className="text-xs text-gray-500 w-16" onClick={changeLan}>
                {lan}
            </Button>
        );
    }

    const features = [
        {
            title: locale.Feature1Title,
            desc: locale.Feature1Desc,
            icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
            ),
        },
        {
            title: locale.Feature2Title,
            desc: locale.Feature2Desc,
            icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            ),
        },
        {
            title: locale.Feature3Title,
            desc: locale.Feature3Desc,
            icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
            ),
        },
        {
            title: locale.Feature4Title,
            desc: locale.Feature4Desc,
            icon: (
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
            ),
        },
    ];

    const stats = [
        { value: locale.StatTokensValue, label: locale.StatTokens },
        { value: locale.StatRegionsValue, label: locale.StatRegions },
        { value: locale.StatUptimeValue, label: locale.StatUptime },
    ];

    return (
        <div className="min-h-screen bg-white">
            <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 bg-white`}>
                <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 lg:px-8" aria-label="Global">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-sm font-bold text-white">H</div>
                        <span className="text-lg font-bold text-gray-900">EHEX</span>
                    </div>
                    <div className="flex items-center gap-6">
                        {auth === AuthStatus.AUTH ? (
                            <a href="/model" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                                {locale.NavConsole}
                            </a>
                        ) : (
                            <a href="/auth" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                                {locale.NavSignIn}
                            </a>
                        )}
                        <Language />
                    </div>
                </nav>
            </header>

            {/* ===== Hero ===== */}
            <section className="relative isolate overflow-hidden pt-54 pb-32 sm:pb-36">
                <div className="mx-auto max-w-4xl px-6">
                    <div className="text-center">
                        <h1 className="text-6xl font-bold tracking-tight text-gray-900 sm:text-7xl lg:text-8xl">
                            {locale.MainText}
                        </h1>
                        <p className="mt-6 text-lg leading-8 text-gray-500 max-w-xl mx-auto">
                            {locale.Slogan}
                        </p>
                        <div className="mt-10">
                            <a href={auth === AuthStatus.AUTH ? "/model" : "/auth"}
                                className="inline-block rounded-lg bg-gray-900 text-white px-12 py-3.5 text-base font-medium hover:bg-gray-800 transition-all">
                                {locale.StartFree}
                            </a>
                        </div>
                    </div>
                </div>
            </section>

            {/* ===== Stats ===== */}
            <section className="border-y border-gray-100">
                <div className="mx-auto max-w-4xl px-6 py-16">
                    <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto">
                        {stats.map((stat) => (
                            <div key={stat.label} className="text-center">
                                <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                                <div className="mt-1 text-sm text-gray-400">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ===== Features ===== */}
            <section className="py-28">
                <div className="mx-auto max-w-4xl px-6">
                    <h2 className="text-2xl font-bold text-center text-gray-900 mb-16">
                        {locale.FeatureTitle}
                    </h2>
                    <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
                        {features.map((feature) => (
                            <div
                                key={feature.title}
                                className="group"
                            >
                                <div className="flex items-center gap-4 mb-3">
                                    <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center shrink-0 group-hover:bg-gray-200 transition-colors">
                                        {feature.icon}
                                    </div>
                                    <h3 className="text-base font-semibold text-gray-900">{feature.title}</h3>
                                </div>
                                <p className="text-sm leading-6 text-gray-500">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ===== Footer ===== */}
            <footer className="border-t border-gray-100 py-8">
                <div className="mx-auto max-w-4xl px-6">
                    <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">© 2024 ehex.</span>
                        </div>
                        <p className="text-xs text-gray-400 text-center max-w-md">
                            {locale.FooterDesc}
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Component;
