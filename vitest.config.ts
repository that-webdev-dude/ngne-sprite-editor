import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { appInfoDefines } from "@ngne/editor-ui/about/build";

export default defineConfig({
    // The app's facts from package.json, as the app's build has them (vite.config.ts).
    define: appInfoDefines(fileURLToPath(new URL("package.json", import.meta.url))),
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts"],
        // Tests that reset modules (`vi.resetModules`) start from a fresh page, the module-level
        // services of @ngne/editor-ui included (its MIGRATION §2 step 9): the package is
        // inlined, so a reset evaluates it again instead of keeping one page's state.
        server: { deps: { inline: ["@ngne/editor-ui"] } },
    },
});
