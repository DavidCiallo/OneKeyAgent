import NeuralLogo from "./NeuralLogo";

export default function SiteFooter() {
    return (
        <footer className="border-t border-gray-100 py-8">
            <div className="mx-auto max-w-4xl px-6">
                <div className="flex flex-col items-center justify-center">
                    <div className="flex items-center gap-2">
                        <NeuralLogo className="w-4 h-4 text-gray-300" />
                        <span className="text-sm text-gray-400">© 2023-{new Date().getFullYear()} ehex</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
