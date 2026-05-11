import { Locale } from "../../methods/locale";
import { getAuthStatus } from "../../methods/auth";
import SiteHeader from "./components/SiteHeader";
import HeroSection from "./components/HeroSection";
import StatsSection from "./components/StatsSection";
import FeaturesSection from "./components/FeaturesSection";
import SiteFooter from "./components/SiteFooter";

const Component = () => {
    const locale = Locale("HomePage");
    const auth = getAuthStatus();

    return (
        <div className="min-h-screen bg-white">
            <SiteHeader auth={auth} locale={locale} />
            <HeroSection auth={auth} locale={locale} />
            <StatsSection locale={locale} />
            <FeaturesSection locale={locale} />
            <SiteFooter />
        </div>
    );
};

export default Component;
