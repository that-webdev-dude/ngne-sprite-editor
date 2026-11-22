import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { appInfoDefines } from "@ngne/editor-ui/about/build";

export default defineConfig({
    // The app's facts from package.json, as the app's build has them (vite.config.ts).
    define: appInfoDefines(fileURLToPath(new URL("package.json", import.meta.url))),
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts"],
    },
});
