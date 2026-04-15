import { defineConfig } from "drizzle-kit";

export default defineConfig({
    out: "./drizzle",
    schema: "./server/lib/schema.ts",
    dialect: "sqlite",
    dbCredentials: {
        url: "data/onekey.db",
    },
});
