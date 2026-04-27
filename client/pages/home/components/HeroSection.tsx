import { AuthStatus } from "../../../methods/auth";
import NeuralLogo from "./NeuralLogo";

export default function HeroSection({
    auth,
    locale,
}: {
    auth: AuthStatus;
    locale: { [key: string]: string };
}) {
    return (
        <section className="relative isolate overflow-hidden md:pt-44 pt-60 md:pb-44 pb-60">
            <div className="mx-auto max-w-4xl px-6">
                <div className="text-center">
                    <div className="relative flex justify-center">
                        <div className="absolute left-1/2 -translate-x-1/2 -top-16 pointer-events-none select-none">
                            <NeuralLogo className="w-[36rem] h-[36rem] text-gray-900/[0.045]" />
                        </div>
                        <div className="relative flex flex-col items-center">
                            <NeuralLogo className="w-16 h-16 sm:w-20 sm:h-20 text-gray-900 mb-6" />
                            <h1 className="text-6xl font-bold tracking-tight text-gray-900 sm:text-7xl lg:text-8xl pt-8 pb-10">
                                {locale.MainText}
                            </h1>
                        </div>
                    </div>
                    <p className="mt-6 text-lg leading-8 text-gray-500 max-w-xl mx-auto flex flex-col md:flex-row md:gap-1.5 items-center justify-center">
                            <span>{locale.Slogan1}</span>
                            <span>{locale.Slogan2}</span>
                        </p>
                    <div className="mt-10">
                        <a
                            href={auth === AuthStatus.AUTH ? "/model" : "/auth"}
                            className="inline-block rounded-lg bg-gray-900 text-white px-12 py-3.5 text-base font-medium hover:bg-gray-800 transition-all"
                        >
                            {locale.StartFree}
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
