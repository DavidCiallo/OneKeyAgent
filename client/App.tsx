import "./App.css";

import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useState, useEffect } from "react";
import AuthPage from "./pages/auth/AuthPage";
import HomePage from "./pages/home/HomePage";
import { AuthStatus, clearAuthData, getAuthStatus, hasPermission, setUserInfo } from "./methods/auth";
import ModelPage from "./pages/model/ModelPage";
import UsagePage from "./pages/usage/UsagePage";
import AccountPage from "./pages/account/AccountPage";
import NoContentPage from "./pages/nocontent/NoContentPage";
import { AuthRouter } from "./api/instance";
import { AliveRequest } from "../shared/modules/auth/auth.interface";

const PrivateRoute = ({ redirectPath = "/auth" }) => {
    const isAuthenticated = getAuthStatus() == AuthStatus.AUTH;
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) {
            clearAuthData();
            setReady(true);
            return;
        }
        AuthRouter.alive(new AliveRequest({ auth: localStorage.getItem("access_token")! })).then(({ success, data }) => {
            if (!success) {
                clearAuthData();
            } else if (data) {
                setUserInfo({ email: localStorage.getItem("user_email") || "", is_admin: data.is_admin, roles: data.roles });
            }
        }).finally(() => setReady(true));
    }, []);

    if (!isAuthenticated) return <Navigate to={redirectPath} replace />;
    if (!ready) return null;
    return <Outlet />;
};

const App = () => {
    return (
        <Router>
            <Routes>
                <Route path="/home" element={<HomePage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route element={<PrivateRoute />}>
                    <Route path="/nocontent" element={<NoContentPage />} />
                    <Route path="/model" element={hasPermission("model", "menu") ? <ModelPage /> : <Navigate to="/nocontent" replace />} />
                    <Route path="/usage" element={hasPermission("usage", "menu") ? <UsagePage /> : <Navigate to="/nocontent" replace />} />
                    <Route path="/account" element={hasPermission("account", "menu") ? <AccountPage /> : <Navigate to="/nocontent" replace />} />
                </Route>
                <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
        </Router>
    );
};

export default App;
