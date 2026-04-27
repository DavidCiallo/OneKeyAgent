import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
    html: {
        title: "HEX.AI",
        favicon: "./public/favicon.svg",
    },
    plugins: [pluginReact()],
    source: {
        entry: {
            index: "./client/index.tsx",
        },
    },
    server: {
        proxy: {
            "/api": {
                target: "http://127.0.0.1:3301",
                changeOrigin: true,
            },
        },
    },
});
