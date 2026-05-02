import { Card, CardBody, CardHeader } from "@heroui/react";
import { Locale } from "../../methods/locale";

export default function TermsPage() {
    const locale = Locale("TermsPage");

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
            <main className="mx-auto max-w-4xl px-6 py-16">
                {/* Title */}
                <div className="text-center mb-12">
                    <h1 className="text-3xl font-bold text-gray-900 mb-3">{locale.Title}</h1>
                    <p className="text-gray-500 text-sm">{locale.Subtitle}</p>
                </div>

                <div className="space-y-6">
                    {/* 1. Service Overview */}
                    <Card className="shadow-sm border border-gray-100">
                        <CardHeader className="px-6 pt-6 pb-0">
                            <h2 className="text-lg font-semibold text-gray-900">{locale.Section1Title}</h2>
                        </CardHeader>
                        <CardBody className="px-6 pb-6 pt-3">
                            <p className="text-sm leading-7 text-gray-600 whitespace-pre-line">{locale.Section1Body}</p>
                        </CardBody>
                    </Card>

                    {/* 2. User Responsibilities */}
                    <Card className="shadow-sm border border-gray-100">
                        <CardHeader className="px-6 pt-6 pb-0">
                            <h2 className="text-lg font-semibold text-gray-900">{locale.Section2Title}</h2>
                        </CardHeader>
                        <CardBody className="px-6 pb-6 pt-3">
                            <p className="text-sm leading-7 text-gray-600 whitespace-pre-line">{locale.Section2Body}</p>
                        </CardBody>
                    </Card>

                    {/* 3. Fair Use Policy */}
                    <Card className="shadow-sm border border-gray-100">
                        <CardHeader className="px-6 pt-6 pb-0">
                            <h2 className="text-lg font-semibold text-gray-900">{locale.Section3Title}</h2>
                        </CardHeader>
                        <CardBody className="px-6 pb-6 pt-3">
                            <p className="text-sm leading-7 text-gray-600 whitespace-pre-line">{locale.Section3Body}</p>
                        </CardBody>
                    </Card>

                    {/* 4. Disclaimer */}
                    <Card className="shadow-sm border border-gray-100">
                        <CardHeader className="px-6 pt-6 pb-0">
                            <h2 className="text-lg font-semibold text-gray-900">{locale.Section4Title}</h2>
                        </CardHeader>
                        <CardBody className="px-6 pb-6 pt-3">
                            <p className="text-sm leading-7 text-gray-600 whitespace-pre-line">{locale.Section4Body}</p>
                        </CardBody>
                    </Card>

                    {/* 5. Contact */}
                    <Card className="shadow-sm border border-gray-100">
                        <CardHeader className="px-6 pt-6 pb-0">
                            <h2 className="text-lg font-semibold text-gray-900">{locale.Section5Title}</h2>
                        </CardHeader>
                        <CardBody className="px-6 pb-6 pt-3">
                            <p className="text-sm leading-7 text-gray-600 whitespace-pre-line">{locale.Section5Body}</p>
                        </CardBody>
                    </Card>
                </div>

                {/* Footer */}
                <div className="text-center mt-16 pb-8">
                    <div className="border-t border-gray-100 pt-8">
                        <a href="/home" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">{locale.BackToHome}</a>
                    </div>
                </div>
            </main>
        </div>
    );
}
