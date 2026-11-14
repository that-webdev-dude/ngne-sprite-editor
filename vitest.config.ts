import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { appInfoDefines } from "./scripts/appInfo.ts";

export default defineConfig({
    // The app's facts from package.json, as the app's build has them (vite.config.ts).
    define: appInfoDefines(fileURLToPath(new URL(".", import.meta.url))),
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts"],
    },
});
