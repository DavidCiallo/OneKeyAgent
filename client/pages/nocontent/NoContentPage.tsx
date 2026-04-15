import { Header } from "../../components/header/Header";
import { Locale } from "../../methods/locale";

export default function NoContentPage() {
    const locale = Locale("NoContentPage");
    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={locale.Title} />
            <div className="flex flex-1 items-center justify-center">
                <p className="text-gray-400 text-lg">{locale.Message}</p>
            </div>
        </div>
    );
}