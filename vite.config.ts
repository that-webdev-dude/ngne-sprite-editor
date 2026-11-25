import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appInfoDefines } from "@ngne/editor-ui/about/build";
import { generateLicences } from "@ngne/editor-ui/licences/build";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin, PluginOption } from "vite";
import { BUILD_PACKAGES, EXCLUDED_CODE } from "./scripts/licenceRules.ts";

// SE-072: the PWA build plugin (vite-plugin-pwa, a development dependency). Its declarations
// do not compile under this project's `skipLibCheck: false`: they import the types of an
// optional peer that is not installed (@vite-pwa/assets-generator) and Workbox's, which need
// the WebWorker library. So the plugin is loaded without its declarations, by a specifier the
// compiler does not follow, and the options passed are typed here.
interface PwaOptions {
    strategies: "injectManifest";
    srcDir: string;
    filename: string;
    injectRegister: false;
    includeManifestIcons: boolean;
    injectManifest: {
        globPatterns: string[];
        maximumFileSizeToCacheInBytes: number;
        buildPlugins: { vite: Plugin[] };
    };
    manifest: Record<string, unknown>;
}
const PWA_PLUGIN: string = "vite-plugin-pwa";
const { VitePWA } = (await import(PWA_PLUGIN)) as {
    VitePWA(options: PwaOptions): PluginOption;
};

/**
 * A colour of the design tokens' default (dark) set, as `#rrggbb` (DESIGN §3.1): the first
 * `:root` rule of the package's stylesheet, which starts with its tokens.
 */
function tokenColour(name: string): string {
    const css = readFileSync(
        new URL("node_modules/@ngne/editor-ui/dist/styles.css", import.meta.url),
        "utf8",
    );
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const value = new RegExp(String.raw`${name}:\s*(#[0-9a-f]{6})\s*;`).exec(root)?.[1];
    if (!value) throw new Error(`vite.config: no colour token ${name}`);
    return value;
}

const colours = {
    /** The installed window's title bar: the menu bar's panel colour. */
    theme: tokenColour("--bg-panel"),
    /** Behind the icon while the installed app starts: the workspace colour. */
    background: tokenColour("--bg-workspace"),
};

/** The icons scripts/icons.ts draws: public/icons/{icon,maskable}-<size>.png. */
const icons = readdirSync(new URL("public/icons/", import.meta.url))
    // By code unit, as the default sort: the order does not depend on the machine's locale.
    .sort((a, b) => Number(a > b) - Number(a < b))
    .flatMap((file) => {
        const match = /^(icon|maskable)-(\d+)\.png$/.exec(file);
        if (!match) return [];
        const [, kind, size] = match;
        return [
            {
                src: `icons/${file}`,
                sizes: `${size}x${size}`,
                type: "image/png",
                purpose: kind === "icon" ? "any" : "maskable",
            },
        ];
    });

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const TITLE = "NGNE Sprite Editor";

/**
 * The open-source licences file (@ngne/editor-ui/licences/build): `licences.txt` beside
 * `index.html`, with the licence of every package whose code the build bundled, each of them a
 * runtime dependency of package-lock.json; the web workers' builds note their modules for it.
 * The development server answers the same address. A package without an allowed licence, or
 * code the build must leave out (`EXCLUDED_CODE`), fails the build, and so does a service
 * worker that bundles code of a package the file does not list.
 */
const licences = generateLicences({
    root: ROOT,
    title: TITLE,
    buildPackages: BUILD_PACKAGES,
    excludedCode: EXCLUDED_CODE,
});

export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        // The open-source licences of what the build ships (licences.txt).
        licences.plugin as unknown as Plugin,
        // The colour of the browser's chrome around the page, as the installed window's.
        {
            name: "ngne-theme-color",
            apply: "build",
            transformIndexHtml: () => [
                {
                    tag: "meta",
                    attrs: { name: "theme-color", content: colours.theme },
                    injectTo: "head",
                },
            ],
        },
        // SE-072: installable app and offline use. Only `vite build` emits the service worker
        // and the web manifest (the plugin's `devOptions` stay off): the dev server, which the
        // E2E suite runs on, registers no worker and links no manifest.
        VitePWA({
            strategies: "injectManifest",
            srcDir: "src/app/pwa",
            filename: "sw.ts",
            // The app registers the worker itself (src/app/pwa/updates.ts).
            injectRegister: false,
            // The icons are among the files the patterns find.
            includeManifestIcons: false,
            injectManifest: {
                // The whole build: the shell, every chunk, both web workers, the icons and the
                // licences file.
                globPatterns: ["**/*.{html,js,css,png,webmanifest,txt}"],
                // The main chunk holds NGNE and React; a build with the development test hooks
                // (tests/e2e/se-072-support.ts) is several times larger.
                maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
                // The worker's own build checks its packages against licences.txt.
                buildPlugins: { vite: [licences.serviceWorkerPlugin as unknown as Plugin] },
            },
            manifest: {
                // The app's identity. Browsers resolve `id` against the origin, not against the
                // manifest's path, so a relative "./" names the origin's root, which the
                // tilemap editor on the same GitHub Pages origin would share: the browser then
                // takes both for one app and offers to install only the first. This id names
                // this app alone, whatever the `base`.
                id: "/ngne-sprite-editor/",
                // Relative to the manifest, which lies at Vite's `base`: the app works at a
                // nested path (`base: "/sub/path/"`).
                start_url: "./",
                scope: "./",
                name: "NGNE Sprite Editor",
                short_name: "NGNE Sprites",
                description: "Pixel-art sprite editor rendered by the NGNE engine",
                lang: "en",
                display: "standalone",
                theme_color: colours.theme,
                background_color: colours.background,
                icons,
                // The installed app opens `.ngsprite` files (src/app/pwa/launchQueue.ts). An
                // open window takes the file in a tab of its own instead of a second window.
                file_handlers: [
                    {
                        action: "./",
                        accept: { "application/x-ngsprite": [".ngsprite"] },
                    },
                ],
                launch_handler: { client_mode: ["focus-existing", "auto"] },
            },
        }),
    ],
    define: {
        // Whether this is a build with the service worker beside it (src/main.tsx).
        "import.meta.env.SERVICE_WORKER": JSON.stringify(command === "build"),
        // The app's name, version and licence and the engine's version, from package.json
        // (the About dialog, src/app/about/appInfo.ts).
        ...appInfoDefines(fileURLToPath(new URL("package.json", import.meta.url))),
    },
    resolve: {
        // gifenc's `main` and `browser` fields name its CommonJS build, which the bundler
        // keeps whole, its colour quantizer included; its ES module build lets the bundler
        // keep only the encoder that core/gif uses. The build fails if the quantizer comes back
        // (`rejectExcluded`).
        alias: [{ find: /^gifenc$/, replacement: "gifenc/dist/gifenc.esm.js" }],
    },
    // The web workers' builds note their modules for the licences file.
    worker: { plugins: () => [licences.workerPlugin as unknown as Plugin] },
    // No module-preload polyfill: every browser with WebGPU preloads modules itself, and the
    // bundle then holds no code of Vite's beyond Rolldown's runtime (BUILD_PACKAGES).
    build: { target: "es2022", modulePreload: { polyfill: false } },
}));
