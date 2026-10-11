import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// DOM globals are the browser set minus what Node and plain ECMAScript also provide, so
// `src/core` stays runnable under Vitest in Node (SPEC §5). `navigator` and the storage
// objects exist in Node too but are host state, so they are restricted explicitly.
const shared = new Set([
    ...Object.keys(globals.nodeBuiltin),
    ...Object.keys(globals["shared-node-browser"]),
    ...Object.keys(globals.es2022),
]);
const domGlobals = [
    ...new Set([
        ...Object.keys(globals.browser).filter((name) => !shared.has(name)),
        "navigator",
        "localStorage",
        "sessionStorage",
    ]),
];

const ngne = {
    group: ["@ngne/core", "@ngne/core/*"],
    message: "Only src/engine imports @ngne/core (SPEC §5).",
};

export default tseslint.config(
    { ignores: ["dist", "node_modules", "test-results", "playwright-report", "coverage"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        plugins: { "react-hooks": reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "@typescript-eslint/consistent-type-imports": "error",
        },
    },
    {
        files: ["*.config.{js,ts}", "tests/unit/**", "tests/e2e/*.ts"],
        languageOptions: { globals: globals.node },
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        ignores: ["src/engine/**", "src/core/**"],
        rules: { "no-restricted-imports": ["error", { patterns: [ngne] }] },
    },
    {
        files: ["src/core/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        ngne,
                        {
                            group: ["react", "react/*", "react-dom", "react-dom/*"],
                            message: "src/core does not import React (SPEC §5).",
                        },
                        {
                            regex: "(^|/)(app|engine|ui)(/|$)",
                            message: "src/core imports nothing from outside src/core (SPEC §5).",
                        },
                    ],
                },
            ],
            "no-restricted-globals": [
                "error",
                ...domGlobals.map((name) => ({
                    name,
                    message: "src/core uses no DOM global (SPEC §5).",
                })),
            ],
        },
    },
);
