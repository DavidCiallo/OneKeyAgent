import NeuralLogo from "./NeuralLogo";

export default function SiteFooter() {
    return (
        <footer className="border-t border-gray-100 py-8">
            <div className="mx-auto max-w-4xl px-6">
                <div className="flex flex-col items-center justify-center gap-3">
                    <div className="flex items-center gap-4">
                        <a href="/terms" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Terms of Service</a>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-400">Privacy</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <NeuralLogo className="w-4 h-4 text-gray-300" />
                        <span className="text-sm text-gray-400">© 2023-{new Date().getFullYear()} ehex</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
