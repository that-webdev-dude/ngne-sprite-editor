import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin, PluginOption } from "vite";
import { appInfoDefines } from "./scripts/appInfo.ts";
import {
    LICENCES_FILE,
    LicenceError,
    buildLicencesFile,
    excludedCodeIn,
    packageDirsOf,
    runtimePackageDirs,
    strayPackages,
} from "./scripts/licences.ts";

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
    injectManifest: { globPatterns: string[]; maximumFileSizeToCacheInBytes: number };
    manifest: Record<string, unknown>;
}
const PWA_PLUGIN: string = "vite-plugin-pwa";
const { VitePWA } = (await import(PWA_PLUGIN)) as {
    VitePWA(options: PwaOptions): PluginOption;
};

/** A colour of the design tokens' default (dark) set, as `#rrggbb` (DESIGN §3.1). */
function tokenColour(name: string): string {
    const css = readFileSync(new URL("src/ui/styles/tokens.css", import.meta.url), "utf8");
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

/** The ids of the modules the build's chunks render, the web workers' included. */
const bundledModules = new Set<string>();

/** An output of a build, as far as `noteModules` and `rejectExcluded` read it. */
type BundleOutput =
    | {
          type: "chunk";
          fileName: string;
          code: string;
          modules: Record<string, { renderedLength: number }>;
      }
    | { type: "asset"; fileName: string; source: string | Uint8Array };

/** The JavaScript of an output of a build: a chunk's code, a `.js` asset's text, otherwise "". */
function javaScriptOf(output: BundleOutput): string {
    if (output.type === "chunk") return output.code;
    if (output.fileName.endsWith(".js") && typeof output.source === "string") return output.source;
    return "";
}

/**
 * Fails the build when a JavaScript file of `bundle` holds code the build must leave out
 * (`EXCLUDED_CODE` of scripts/licences.ts), such as gifenc's quantizer without the alias below.
 */
function rejectExcluded(
    bundle: Record<string, BundleOutput>,
    fail: (message: string) => never,
): void {
    for (const output of Object.values(bundle)) {
        const found = excludedCodeIn(javaScriptOf(output));
        if (found.length > 0) {
            fail(
                `The build bundles code it must leave out, in ${output.fileName}: ${found.join("; ")}.`,
            );
        }
    }
}

/** Notes the modules of every chunk of `bundle` that renders code. */
function noteModules(bundle: Record<string, BundleOutput>): void {
    for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, module] of Object.entries(output.modules)) {
            if (module.renderedLength > 0) bundledModules.add(id);
        }
    }
}

/** Notes the modules of a web worker's build; the workers are built before the app's chunks. */
function collectModules(): Plugin {
    return {
        name: "ngne-licences-collect",
        apply: "build",
        generateBundle(_options, bundle) {
            noteModules(bundle);
            rejectExcluded(bundle, (message) => this.error(message));
        },
    };
}

/**
 * The open-source licences file (scripts/licences.ts): `licences.txt` beside `index.html`,
 * with the licence of every package whose code the build bundled, each of them a runtime
 * dependency of package-lock.json. The development server answers the same address with the
 * runtime dependencies' licences. A package without an allowed licence fails the build.
 */
function licencesFile(): Plugin {
    const runtime = () =>
        runtimePackageDirs(readFileSync(join(ROOT, "package-lock.json"), "utf8"), ROOT);
    return {
        name: "ngne-licences",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = (request.url ?? "").split("?")[0];
                if (path !== `${server.config.base}${LICENCES_FILE}`) return next();
                try {
                    const text = buildLicencesFile(ROOT, runtime(), TITLE);
                    response.setHeader("Content-Type", "text/plain; charset=utf-8");
                    response.end(text);
                } catch (error) {
                    next(error);
                }
            });
        },
        generateBundle: {
            order: "post",
            handler(_options, bundle) {
                noteModules(bundle);
                rejectExcluded(bundle, (message) => this.error(message));
                const dirs = packageDirsOf(bundledModules);
                const strays = strayPackages(dirs, runtime());
                if (strays.length > 0) {
                    this.error(
                        "The build bundles code of packages that are not runtime dependencies " +
                            `in package-lock.json: ${strays.join(", ")}.`,
                    );
                }
                try {
                    this.emitFile({
                        type: "asset",
                        fileName: LICENCES_FILE,
                        source: buildLicencesFile(ROOT, dirs, TITLE),
                    });
                } catch (error) {
                    if (error instanceof LicenceError) this.error(error.message);
                    throw error;
                }
            },
        },
    };
}

export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        // The open-source licences of what the build ships (licences.txt).
        licencesFile(),
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
        ...appInfoDefines(ROOT),
    },
    resolve: {
        // gifenc's `main` and `browser` fields name its CommonJS build, which the bundler
        // keeps whole, its colour quantizer included; its ES module build lets the bundler
        // keep only the encoder that core/gif uses. The build fails if the quantizer comes back
        // (`rejectExcluded`).
        alias: [{ find: /^gifenc$/, replacement: "gifenc/dist/gifenc.esm.js" }],
    },
    // The web workers' builds note their modules for the licences file.
    worker: { plugins: () => [collectModules()] },
    build: { target: "es2022" },
}));
