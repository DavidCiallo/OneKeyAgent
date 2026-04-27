export default function StatsSection({
    locale,
}: {
    locale: { [key: string]: string };
}) {
    const stats = [
        { value: locale.StatTokensValue, label: locale.StatTokens },
        { value: locale.StatRegionsValue, label: locale.StatRegions },
        { value: locale.StatUptimeValue, label: locale.StatUptime },
    ];

    return (
        <section className="border-y border-gray-100">
            <div className="mx-auto max-w-4xl px-6 py-12">
                <div className="grid grid-cols-3 gap-4 max-w-3xl mx-auto">
                    {stats.map((stat) => (
                        <div key={stat.label} className="text-center">
                            <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                            <div className="mt-1 text-sm text-gray-400">{stat.label}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
