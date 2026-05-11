import "./App.css";

import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { JSX, useEffect } from "react";
import AuthPage from "./pages/auth/AuthPage";
import VerifyPage from "./pages/auth/VerifyPage";
import HomePage from "./pages/home/HomePage";
import { AuthStatus, clearAuthData, getAuthStatus, setUserInfo } from "./methods/auth";
import ModelPage from "./pages/model/ModelPage";
import ProviderPage from "./pages/provider/ProviderPage";
import UsagePage from "./pages/usage/UsagePage";
import AccountPage from "./pages/account/AccountPage";
import ProfilePage from "./pages/profile/ProfilePage";
import TermsPage from "./pages/terms/TermsPage";
import NoContentPage from "./pages/nocontent/NoContentPage";
import SubscriptionPage from "./pages/subscription/SubscriptionPage";
import { AuthRouter } from "./api/instance";
import { AliveRequest } from "../shared/modules/auth/auth.interface";
import { AuthProvider, useAuth } from "./methods/auth-context";

const PrivateRoute = ({ redirectPath = "/auth" }) => {
    const isAuthenticated = getAuthStatus() == AuthStatus.AUTH;
    const { setAuthInfo, resetAuth } = useAuth();

    useEffect(() => {
        if (!isAuthenticated) {
            clearAuthData();
            resetAuth();
            return;
        }
        AuthRouter.alive(new AliveRequest({ auth: localStorage.getItem("access_token")! })).then(({ success, data }) => {
            if (!success) {
                clearAuthData();
                resetAuth();
            } else if (data) {
                setUserInfo({ email: localStorage.getItem("user_email") || "", is_admin: data.is_admin, roles: data.roles });
                setAuthInfo({ is_admin: data.is_admin, roles: data.roles });
            }
        });
    }, []);

    if (!isAuthenticated) return <Navigate to={redirectPath} replace />;
    return <Outlet />;
};

const ProtectedRoute = ({ name, children }: { name: string; children: JSX.Element }) => {
    const { hasPermission } = useAuth();
    return hasPermission(name, "menu") ? children : <Navigate to="/nocontent" replace />;
};

const TITLE_MAP: Record<string, string> = {
    "/home": "Home",
    "/auth": "Login",
    "/model": "Model",
    "/provider": "Provider",
    "/usage": "Usage",
    "/account": "Account",
    "/profile": "Profile",
    "/subscription": "Subscription",
    "/nocontent": "No Content",
    "/terms": "Terms",
};

const TitleUpdater = () => {
    const location = useLocation();
    useEffect(() => {
        const pageName = TITLE_MAP[location.pathname];
        document.title = pageName ? `EHEX - ${pageName}` : "EHEX";
    }, [location.pathname]);
    return null;
};

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route element={<PrivateRoute />}>
                <Route path="/nocontent" element={<NoContentPage />} />
                <Route path="/model" element={<ProtectedRoute name="model"><ModelPage /></ProtectedRoute>} />
                <Route path="/provider" element={<ProtectedRoute name="provider"><ProviderPage /></ProtectedRoute>} />
                <Route path="/usage" element={<ProtectedRoute name="usage"><UsagePage /></ProtectedRoute>} />
                <Route path="/account" element={<ProtectedRoute name="account"><AccountPage /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute name="profile"><ProfilePage /></ProtectedRoute>} />
                <Route path="/subscription" element={<ProtectedRoute name="subscription"><SubscriptionPage /></ProtectedRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
    );
};

const App = () => {
    return (
        <Router>
            <AuthProvider>
                <TitleUpdater />
                <AppRoutes />
            </AuthProvider>
        </Router>
    );
};

export default App;
