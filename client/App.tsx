import "./App.css";

import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import AuthPage from "./pages/auth/AuthPage";
import HomePage from "./pages/home/HomePage";
import { AuthStatus, clearAuthData, getAuthStatus, setUserInfo } from "./methods/auth";
import ModelPage from "./pages/model/ModelPage";
import UsagePage from "./pages/usage/UsagePage";
import AccountPage from "./pages/account/AccountPage";
import { AuthRouter } from "./api/instance";
import { AliveRequest } from "../shared/modules/auth/auth.interface";

const PrivateRoute = ({ redirectPath = "/auth" }) => {
    const isAuthenticated = getAuthStatus() == AuthStatus.AUTH;
    if (!isAuthenticated) {
        clearAuthData();
    }
    AuthRouter.alive(new AliveRequest({ auth: localStorage.getItem("access_token")! })).then(({ success, data }) => {
        if (!success) {
            clearAuthData();
        } else if (data?.role) {
            setUserInfo({ email: localStorage.getItem("user_email") || "", role: data.role });
        }
    })
    return isAuthenticated ? <Outlet /> : <Navigate to={redirectPath} replace />;
};

const App = () => {
    return (
        <Router>
            <Routes>
                <Route path="/home" element={<HomePage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route element={<PrivateRoute />}>
                    <Route path="/model" element={<ModelPage />} />
                    <Route path="/usage" element={<UsagePage />} />
                    <Route path="/account" element={<AccountPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
        </Router>
    );
};

export default App;
