import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { bundle } from "../../src/core/export";
import type { Bundle } from "../../src/core/export";
import type { SpriteDoc } from "../../src/core/model";
import { decodePng } from "../../src/core/png";
import { bytesOf, exportSettings, grid, heroWalk, noise, sprite, textOf } from "./se-051-support";

// `<name>.preview.config.mjs` (SPEC §9.5) against NGNE itself: the test loads the file with
// `loadAdapter` of the installed package (dist/preview/host.js), the function `ngne-preview`
// starts with, and checks the result with the functions its page runs before it draws
// (dist/preview/model.js).

interface Preview {
    images: { id: string; src: string }[];
    frames: {
        id: string;
        image: string;
        x: number;
        y: number;
        width: number;
        height: number;
        destinationWidth: number;
        destinationHeight: number;
    }[];
    animations: { id: string; playback: string; entries: { frame: string; ms: number }[] }[];
    display: { density: number; scale: number; pixelSnap: boolean };
}

interface Host {
    loadAdapter(filename: string): Promise<Preview>;
    /** What the `ngne-preview` command runs: a server on a loopback port for one adapter. */
    startPreview(filename: string): Promise<{ url: string; close(): Promise<void> }>;
}

interface Model {
    /** What the preview's page runs on the adapter data it is served. */
    validate(value: unknown): Preview;
    stageSize(preview: Preview): { width: number; height: number };
    validateBounds(
        preview: Preview,
        dimensions: Map<string, { width: number; height: number }>,
    ): void;
}

const PACKAGE = new URL("../../node_modules/@ngne/core/dist/preview/", import.meta.url);

async function ngne(): Promise<Host & Model> {
    const host = (await import(
        pathToFileURL(fileURLToPath(new URL("host.js", PACKAGE))).href
    )) as Host;
    const model = (await import(
        pathToFileURL(fileURLToPath(new URL("model.js", PACKAGE))).href
    )) as Model;
    return {
        loadAdapter: host.loadAdapter,
        startPreview: host.startPreview,
        validate: model.validate,
        stageSize: model.stageSize,
        validateBounds: model.validateBounds,
    };
}

const directories: string[] = [];

afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** A new temporary directory, removed when the tests of this file are done. */
function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "se-051-preview-"));
    directories.push(directory);
    return directory;
}

/**
 * Writes the image and the adapter of a bundle to a new directory, as an export does, and
 * returns the path of the adapter. `rewrite` changes the adapter's text on the way.
 */
function written(made: Bundle, rewrite: (text: string) => string = (text) => text): string {
    const directory = temporaryDirectory();
    const [image, , , config] = made.files;
    expect(image.name.endsWith(".png")).toBe(true);
    expect(config.name.endsWith(".preview.config.mjs")).toBe(true);
    writeFileSync(join(directory, image.name), image.bytes);
    const path = join(directory, config.name);
    writeFileSync(path, rewrite(textOf(made, ".preview.config.mjs")));
    return path;
}

describe("<name>.preview.config.mjs under NGNE's loadAdapter", { timeout: 60_000 }, () => {
    it("is accepted, written with its PNG to a temporary directory", async () => {
        const { loadAdapter } = await ngne();
        const made = bundle(heroWalk());
        const path = written(made);
        const preview = await loadAdapter(path);

        // What NGNE read: the image as a file URL beside the adapter, and the lists.
        expect(preview.images).toEqual([
            { id: "hero-walk", src: pathToFileURL(join(path, "..", "hero-walk.png")).href },
        ]);
        expect(preview.display).toEqual({ density: 1, scale: 1, pixelSnap: true });
        // One frame per frame of the atlas, shown by its whole even rectangle at its size.
        expect(preview.frames).toEqual(
            Object.entries(made.meta.frames).map(([id, { x, y, w, h }]) => ({
                id,
                image: "hero-walk",
                x,
                y,
                width: w,
                height: h,
                destinationWidth: w,
                destinationHeight: h,
            })),
        );
        expect(preview.frames[1]).toEqual({
            id: "hero-walk-1",
            image: "hero-walk",
            x: 8,
            y: 1,
            width: 4,
            height: 2,
            destinationWidth: 4,
            destinationHeight: 2,
        });
        // The animations with every entry of the atlas: the adapter has no repeat count.
        expect(preview.animations).toEqual(
            Object.entries(made.meta.animations).map(([id, { playback, entries }]) => ({
                id,
                playback,
                entries,
            })),
        );
        expect(preview.animations[2]).toEqual({
            id: "walk-2",
            playback: "once",
            entries: [
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
                { frame: "hero-walk-4", ms: 65535 },
                { frame: "hero-walk-3", ms: 1 },
            ],
        });
    });

    it("is rejected by the same call when `src` is a relative string", async () => {
        const { loadAdapter } = await ngne();
        const url = 'new URL("./hero-walk.png", import.meta.url)';
        const path = written(bundle(heroWalk()), (text) => {
            expect(text).toContain(`src: ${url} }`);
            return text.replace(url, '"./hero-walk.png"');
        });

        await expect(loadAdapter(path)).rejects.toThrow(/image hero-walk\.src/);
    });

    it("is rejected when its image is not beside it", async () => {
        // The control of the first test: the call does look for the file.
        const { loadAdapter } = await ngne();
        const made = bundle(heroWalk());
        const directory = temporaryDirectory();
        const path = join(directory, "hero-walk.preview.config.mjs");
        writeFileSync(path, textOf(made, ".preview.config.mjs"));

        await expect(loadAdapter(path)).rejects.toThrow(/image hero-walk\.src/);
        writeFileSync(join(directory, "hero-walk.png"), bytesOf(made, ".png"));
        // A module is loaded once: the second attempt reads a copy under another name.
        const copy = join(directory, "copy.preview.config.mjs");
        writeFileSync(copy, textOf(made, ".preview.config.mjs"));
        await expect(loadAdapter(copy)).resolves.toMatchObject({ images: [{ id: "hero-walk" }] });
    });

    it("is accepted for other documents: no tag, one frame, an odd size, a name that leaves nothing", async () => {
        const { loadAdapter } = await ngne();
        const documents: SpriteDoc[] = [
            sprite({ name: "Loop", frames: [grid("AB", "CD"), grid("EF", "GH")] }),
            sprite({ name: "Icon", frames: [grid("A")] }),
            sprite({
                name: "Odd",
                frames: [noise(33, 17, 1), noise(33, 17, 2)],
                settings: { trim: true, extrude: 1 },
            }),
            sprite({ name: "★★", frames: [null], size: [3, 3] }),
            sprite({
                name: "con",
                frames: [grid("AB", "CD")],
                tags: [{ name: "__proto__", from: 0, to: 0, repeat: 2 }],
            }),
        ];
        for (const doc of documents) {
            const made = bundle(doc);
            const preview = await loadAdapter(written(made));

            expect(
                preview.frames.map((frame) => frame.id),
                doc.name,
            ).toEqual(Object.keys(made.meta.frames));
            expect(
                preview.animations.map((animation) => animation.id),
                doc.name,
            ).toEqual(Object.keys(made.meta.animations));
        }
        // A document of one frame has no animation: the list is empty, which NGNE accepts.
        const icon = await loadAdapter(written(bundle(documents[1])));
        expect(icon.animations).toEqual([]);
        expect(icon.frames).toHaveLength(1);
    });

    it("points at the image beside it, wherever the folder is", async () => {
        const { loadAdapter } = await ngne();
        const made = bundle(heroWalk());
        const first = written(made);
        const second = written(made);
        const sources = [
            (await loadAdapter(first)).images[0].src,
            (await loadAdapter(second)).images[0].src,
        ];

        expect(sources[0]).not.toBe(sources[1]);
        expect(sources.map((src) => fileURLToPath(src))).toEqual([
            join(first, "..", "hero-walk.png"),
            join(second, "..", "hero-walk.png"),
        ]);
        // The text itself names no folder.
        const text = textOf(made, ".preview.config.mjs");
        expect(text).not.toMatch(/file:|[A-Za-z]:[\\/]|\/tmp|Temp/);
        expect(text.match(/import\.meta\.url/g)).toHaveLength(1);
    });
});

describe("ngne-preview started on a bundle", { timeout: 60_000 }, () => {
    it("starts, and serves its page the adapter and the image of the bundle", async () => {
        // `startPreview` is what the command `ngne-preview <config>` calls: it loads the
        // adapter, reads the image and listens on a loopback port. The page it serves asks
        // for `/config` and for the image, and checks both before it draws (browser.js);
        // the same checks are made here on what the server hands out. SE-053 opens the page.
        const { startPreview, validate, validateBounds } = await ngne();
        const made = bundle(heroWalk());
        const server = await startPreview(written(made));
        try {
            expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
            const config: unknown = await (await fetch(new URL("config", server.url))).json();
            const preview = validate(config);
            expect(preview.frames.map((frame) => frame.id)).toEqual(Object.keys(made.meta.frames));
            expect(preview.animations.map((animation) => animation.id)).toEqual(
                Object.keys(made.meta.animations),
            );
            // The image is served under a route of its own, byte for byte.
            expect(preview.images).toEqual([{ id: "hero-walk", src: "/images/0" }]);
            const response = await fetch(new URL("images/0", server.url));
            const image = new Uint8Array(await response.arrayBuffer());
            expect(Buffer.compare(Buffer.from(image), Buffer.from(bytesOf(made, ".png")))).toBe(0);
            // Every source rectangle lies inside the image the page would decode.
            const size = await decodePng(image);
            expect([size.width, size.height]).toEqual([made.meta.width, made.meta.height]);
            expect(() => validateBounds(preview, new Map([["hero-walk", size]]))).not.toThrow();
        } finally {
            await server.close();
        }
        // Closed: the port no longer answers.
        await expect(fetch(new URL("config", server.url))).rejects.toThrow();
    });
});

describe("the adapter under the checks of NGNE's preview page", () => {
    it("has every source rectangle inside the image", async () => {
        const { loadAdapter, validateBounds } = await ngne();
        const made = bundle(heroWalk());
        const preview = await loadAdapter(written(made));
        const size = new Map([
            ["hero-walk", { width: made.atlas.width, height: made.atlas.height }],
        ]);

        expect(() => validateBounds(preview, size)).not.toThrow();
        // The control: in an image of 9 rows, frame 4 (rows 6 to 10) does not fit; the
        // frames before it end at row 8 at most.
        expect(() =>
            validateBounds(preview, new Map([["hero-walk", { width: 22, height: 9 }]])),
        ).toThrow(/frame hero-walk-4: source rectangle outside image/);
    });

    it("gives a stage on which every frame lies on whole pixels", async () => {
        const { loadAdapter, stageSize } = await ngne();
        const preview = await loadAdapter(written(bundle(heroWalk())));
        const stage = stageSize(preview);

        // NGNE makes the stage even and at least 2 larger than the largest frame, 6 × 4:
        // 8 × 6. It draws a frame centred on the stage, so an even frame has integer edges.
        expect(stage).toEqual({ width: 8, height: 6 });
        for (const frame of preview.frames) {
            expect(Number.isInteger((stage.width - frame.destinationWidth) / 2), frame.id).toBe(
                true,
            );
            expect(Number.isInteger((stage.height - frame.destinationHeight) / 2), frame.id).toBe(
                true,
            );
            expect([frame.width % 2, frame.height % 2], frame.id).toEqual([0, 0]);
        }
    });
});

describe("the text of <name>.preview.config.mjs", () => {
    it("has one default export and nothing else that runs", () => {
        const text = textOf(bundle(heroWalk()), ".preview.config.mjs");
        const code = text.split("\n").filter((line) => !line.startsWith("//") && line !== "");

        expect(code[0]).toBe("export default {");
        expect(code[code.length - 1]).toBe("};");
        expect(code.join("\n").match(/\bexport\b/g)).toHaveLength(1);
        expect(code.join("\n")).not.toMatch(/\bimport\s|\brequire\b|\bawait\b|=>|\bfunction\b/);
        expect(text.endsWith("};\n")).toBe(true);
        // The comment at its head says how to run it.
        expect(text).toContain("npx ngne-preview ./hero-walk.preview.config.mjs\n");
    });

    it("writes an empty list of animations as []", () => {
        const text = textOf(
            bundle(sprite({ name: "Icon", frames: [grid("A")] })),
            ".preview.config.mjs",
        );

        expect(text).toContain("    animations: [],\n");
        expect(text).toContain(
            '    frames: [\n        { id: "icon-0", image: "icon", x: 1, y: 1, width: 2, height: 2, ' +
                "destinationWidth: 2, destinationHeight: 2 },\n    ],\n",
        );
    });

    it("is not written when the settings switch it off", () => {
        const made = bundle(heroWalk(), exportSettings({ files: { previewConfig: false } }));
        expect(made.files.map((file) => file.name)).toEqual([
            "hero-walk.png",
            "hero-walk.atlas.json",
            "hero-walk.sprites.ts",
        ]);
    });
});

describe("the temporary directories of this file", () => {
    it("are removed again", () => {
        // Each holds only what the tests wrote; `afterAll` removes them. Until then they
        // are where the operating system keeps temporary files.
        expect(directories.length).toBeGreaterThan(5);
        for (const directory of directories) {
            expect(directory.startsWith(tmpdir())).toBe(true);
            expect(readdirSync(directory).every((name) => /\.(png|mjs)$/.test(name))).toBe(true);
        }
    });
});
