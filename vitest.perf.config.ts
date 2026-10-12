import { defineConfig } from "vitest/config";

// Node benchmarks (SPEC §11: measured and recorded, not asserted in CI). Not part of
// `npm run check`: npx vitest run --config vitest.perf.config.ts [tests/perf/<file>]
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/perf/**/*.perf.ts"],
        fileParallelism: false,
        testTimeout: 300_000,
    },
});
