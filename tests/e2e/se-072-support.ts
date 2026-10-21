import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { build, preview } from "vite";
import type { Plugin, PreviewServer } from "vite";
import { compositeFrame } from "../../src/core/composite";
import type { SpriteDoc } from "../../src/core/model";
import { region } from "./se-006-support";
import type { DocumentSummary } from "./se-070-support";

// Shared helpers of the SE-072 specs: the app built by `vite build` with the project's
// configuration (so with its service worker and web manifest) into a folder of its own, served
// by `vite preview` on a free port from inside the test, as tests/perf/se-070-cold-load.perf.ts
// does. No spec needs `npm run build` first, and the dev server of the other specs is untouched.
//
// Two kinds of build:
// - the production build, as `npm run build` makes it;
// - the same with the development test hooks (`window.__ngneTest`), for the golden path, which
//   reads the stores through them: `vite build --mode development` with NODE_ENV=development,
//   under which `import.meta.env.DEV` is true and the app installs its hooks. Everything else is
//   a build like the production one: bundled files served by `vite preview`, the service worker
//   and its precache, the manifest. React is its development build there.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface BuildOptions {
    /** With the development test hooks (`window.__ngneTest`); the default is without. */
    hooks?: boolean;
    /** Vite's `base`; the default is "/". */
    base?: string;
    /**
     * Marks the build as a deployment of its own, so two builds differ as two deployments of
     * the app do: its `index.html` carries `<meta name="se-072-deployment" content="…">`, and
     * its entry chunk starts by setting `window.__se072Deployment` to the name, so the chunk's
     * content and hashed name are the deployment's own too, and a page tells which one it
     * runs, by its shell and by its code.
     */
    deployment?: string;
}

const builds = new Map<string, Promise<string>>();
const folders: string[] = [];
process.once("exit", () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

declare global {
    interface Window {
        /** The deployment whose entry chunk runs the page (`BuildOptions.deployment`). */
        __se072Deployment?: string;
    }
}

function deploymentMarker(name: string): Plugin {
    return {
        name: "se-072-deployment",
        renderChunk: (code, chunk) =>
            chunk.isEntry ? `window.__se072Deployment = ${JSON.stringify(name)};\n${code}` : null,
        transformIndexHtml: () => [
            {
                tag: "meta",
                attrs: { name: "se-072-deployment", content: name },
                injectTo: "head",
            },
        ],
    };
}

/** Builds the app (once per worker for the same options); returns the output folder. */
export function buildApp(options: BuildOptions = {}): Promise<string> {
    const key = JSON.stringify([options.hooks ?? false, options.base ?? "/", options.deployment]);
    let built = builds.get(key);
    if (!built) {
        built = runBuild(options);
        builds.set(key, built);
    }
    return built;
}

async function runBuild({ hooks = false, base = "/", deployment }: BuildOptions) {
    const outDir = mkdtempSync(join(tmpdir(), "se-072-build-"));
    folders.push(outDir);
    const mode = hooks ? "development" : "production";
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = mode;
    try {
        await build({
            root: ROOT,
            mode,
            base,
            logLevel: "error",
            plugins: deployment ? [deploymentMarker(deployment)] : [],
            build: { outDir, emptyOutDir: true },
        });
    } finally {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
    }
    return outDir;
}

export interface Served {
    /** The app's address: the origin and the base. */
    url: string;
    port: number;
    close(): Promise<void>;
}

/** Serves the build in `outDir` with `vite preview` at `base`, on `port` or a free one. */
export async function serve(outDir: string, base = "/", port = 0): Promise<Served> {
    const server: PreviewServer = await preview({
        root: ROOT,
        base,
        logLevel: "warn",
        build: { outDir },
        preview: { host: "127.0.0.1", port, strictPort: port !== 0, open: false },
    });
    const address = server.httpServer.address();
    if (typeof address !== "object" || !address) throw new Error("se-072: no preview address");
    return {
        url: `http://127.0.0.1:${address.port}${base}`,
        port: address.port,
        close: () => server.close(),
    };
}

/** Waits until a service worker controls the page: the app's files are all in its cache. */
export async function waitForWorkerControl(page: Page): Promise<void> {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** The deployment whose entry chunk runs the page (`BuildOptions.deployment`). */
export function deploymentCodeOf(page: Page): Promise<string | null> {
    return page.evaluate(() => window.__se072Deployment ?? null);
}

/**
 * The URL of every file of the build in `outDir` the service worker keeps: the list the build
 * put into `sw.js` in place of `self.__WB_MANIFEST`, relative to the base.
 */
export function precacheListOf(outDir: string): string[] {
    const worker = readFileSync(join(outDir, "sw.js"), "utf8");
    return [...worker.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]!);
}

/** Every file in `outDir` and its folders, by its path relative to `outDir` with "/". */
export function filesOf(outDir: string): string[] {
    return readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .sort();
}

/** The deployment marker of the page's `index.html` (`BuildOptions.deployment`). */
export function deploymentOf(page: Page): Promise<string | null> {
    return page.evaluate(
        () =>
            document.querySelector('meta[name="se-072-deployment"]')?.getAttribute("content") ??
            null,
    );
}

/** Opens the editor of a build with test hooks at `url`, as `openEditor` does on the dev server. */
export function openBuiltEditor(url: string): (page: Page) => Promise<void> {
    return async (page) => {
        await page.goto(url);
        await expect(region(page, "viewport")).toBeVisible();
        await page.waitForFunction(() => window.__ngneTest !== undefined);
    };
}

/** A document of the page as the structured clone carries it: the maps as arrays of entries. */
interface ClonedDocument {
    doc: Omit<SpriteDoc, "cels" | "images"> & {
        cels: [string, unknown][];
        images: [string, { width: number; height: number; data: number[] }][];
    };
    sources: [string, number[]][];
}

/**
 * What the open document `id` holds, as `documentSummary` (se-070-support) reads it, for a
 * build: the build has none of the dev server's modules for the page to import, so the page
 * hands over the document and its composites are made here, in Node, by the same
 * `compositeFrame`.
 */
export async function builtDocumentSummary(page: Page, id: string): Promise<DocumentSummary> {
    const cloned: ClonedDocument = await page.evaluate((id) => {
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-072: no open document ${id}`);
        const { doc } = document.session;
        return {
            doc: {
                ...structuredClone({ ...doc, cels: undefined, images: undefined }),
                cels: [...doc.cels].map(([key, cel]) => [key, structuredClone(cel)]),
                images: [...doc.images].map(([key, image]) => [
                    key,
                    { width: image.width, height: image.height, data: Array.from(image.data) },
                ]),
            },
            sources: [...document.referenceSources].map(([key, bytes]) => [key, Array.from(bytes)]),
        } as ClonedDocument;
    }, id);
    const doc = {
        ...cloned.doc,
        cels: new Map(cloned.doc.cels),
        images: new Map(
            cloned.doc.images.map(([key, image]) => [
                key,
                { ...image, data: Uint8ClampedArray.from(image.data) },
            ]),
        ),
    } as unknown as SpriteDoc;
    const sources = new Map(cloned.sources);
    const frameIndex = (frameId: string) => doc.frames.findIndex((f) => f.id === frameId) + 1;
    return {
        name: doc.name,
        size: [doc.width, doc.height],
        pivot: { ...doc.pivot },
        palette: [...doc.palette.colors],
        layers: doc.layers.map((layer) => {
            const { id: _id, ...rest } = layer as unknown as Record<string, unknown>;
            void _id;
            if (layer.kind === "reference") delete rest.sourceId;
            return rest;
        }),
        durations: doc.frames.map((frame) => frame.durationMs),
        tags: doc.tags.map((tag) => ({
            name: tag.name,
            from: frameIndex(tag.fromFrameId),
            to: frameIndex(tag.toFrameId),
            direction: tag.direction,
            repeat: tag.repeat,
        })),
        exportSettings: structuredClone(doc.exportSettings),
        cels: doc.layers.map((layer) =>
            doc.frames.map((frame) => {
                const cel = doc.cels.get(`${layer.id}:${frame.id}`);
                const image = cel && doc.images.get(cel.imageId);
                return image ? Array.from(image.data) : null;
            }),
        ),
        sources: doc.layers.flatMap((layer) =>
            layer.kind === "reference" ? [sources.get(layer.sourceId) ?? []] : [],
        ),
        composites: doc.frames.map((frame) => Array.from(compositeFrame(doc, frame.id).data)),
    };
}

/**
 * A page for the SE-053 consumer game, in a context of its own on the dev server of the
 * Playwright configuration (the game is a fixture the dev server compiles), online whatever
 * the editor's context is. The context is closed with the test (`closeAfter`).
 */
export function consumerOnDevServer(
    browser: Browser,
    testInfo: TestInfo,
    opened: BrowserContext[],
): () => Promise<Page> {
    return async () => {
        const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
        opened.push(context);
        return context.newPage();
    };
}
