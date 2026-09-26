/// <reference types="@rsbuild/core/types" />
declare module '*.css';

// Injected into index.html by the server. Absent when the frontend is served by
// the dev server, where every flag falls back to its default.
interface Window {
    __APP_CONFIG__?: {
        show_home_page?: boolean;
    };
}
