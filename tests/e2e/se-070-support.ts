import { join, relative, sep } from "node:path";
import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as CompositeModule from "../../src/core/composite";
import type { PixelBuffer } from "../../src/core/model";
import { createPixelBuffer } from "../../src/core/pixels";
import { geometry, activeView } from "./se-012-support";
import type { Point } from "./se-012-support";
import { texelClient } from "./se-014-support";
import { fileOf } from "./se-053-documents";
import type { FileBytes } from "./se-053-documents";
import { writeBundle } from "./se-053-support";

// Shared helpers of the SE-070 specs: strokes of the real mouse at the active document's view,
// images painted here by hand to hold the app against, what a document holds as a file keeps
// it, and the SE-053 consumer game opened on a bundle the editor exported.

export type Rgba = readonly [number, number, number, number];

/** The undo steps of the active document. */
export function undoCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const state = window.__ngneTest!.sessions.getState();
        const document = state.documents.find((entry) => entry.id === state.activeId);
        return document?.history.undoCount ?? -1;
    });
}

/**
 * One stroke of the real mouse through the centres of `texels` at the active document's view
 * (a zoom step of 1 or more): a press on the first, a move onto each next one, the release on
 * the last. Waits until the stroke is one more undo step.
 */
export async function strokeThrough(page: Page, texels: readonly Point[]): Promise<void> {
    const layout = await geometry(page);
    const view = await activeView(page);
    expect(view.scale).toBeGreaterThanOrEqual(1);
    const [first, ...rest] = texels.map((texel) => texelClient(layout, view, texel));
    if (!first) throw new Error("se-070: a stroke needs a texel");
    const before = await undoCount(page);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of rest) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await expect.poll(() => undoCount(page)).toBe(before + 1);
}

/** The texels from `a` to `b` along a row, a column or a diagonal, both ends included. */
export function run(a: Point, b: Point): Point[] {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    if ((dx !== 0 && dy !== 0 && Math.abs(b.x - a.x) !== Math.abs(b.y - a.y)) || steps === 0) {
        throw new Error("se-070: a run is straight or diagonal and at least two texels long");
    }
    return Array.from({ length: steps + 1 }, (_, index) => ({
        x: a.x + dx * index,
        y: a.y + dy * index,
    }));
}

/** A transparent image with `texels` set to `rgba`, painted in order. */
export function painted(
    width: number,
    height: number,
    strokes: readonly { texels: readonly Point[]; rgba: Rgba }[],
): PixelBuffer {
    const image = createPixelBuffer(width, height);
    for (const { texels, rgba } of strokes) {
        for (const { x, y } of texels) image.data.set(rgba, (y * width + x) * 4);
    }
    return image;
}

/** `width` × `height` pixels whose colour at (x, y) is `colour(x, y)`. */
export function imageOf(
    width: number,
    height: number,
    colour: (x: number, y: number) => Rgba,
): PixelBuffer {
    const image = createPixelBuffer(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) image.data.set(colour(x, y), (y * width + x) * 4);
    }
    return image;
}

/** `image` with the rectangle `rect` mirrored left to right in place. */
export function mirroredIn(
    image: PixelBuffer,
    rect: { x: number; y: number; width: number; height: number },
): PixelBuffer {
    const out = { width: image.width, height: image.height, data: image.data.slice() };
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const from = (y * image.width + (2 * rect.x + rect.width - 1 - x)) * 4;
            out.data.set(image.data.subarray(from, from + 4), (y * image.width + x) * 4);
        }
    }
    return out;
}

/** What a document's file keeps of it, without the ids a new open gives it. */
export interface DocumentSummary {
    name: string;
    size: [number, number];
    pivot: { x: number; y: number };
    palette: number[];
    layers: Record<string, unknown>[];
    durations: number[];
    tags: { name: string; from: number; to: number; direction: string; repeat: number }[];
    exportSettings: unknown;
    /** The pixels of every cel, by layer (bottom to top) then frame; null for an empty cel. */
    cels: (number[] | null)[][];
    /** The bytes of each reference layer's source image, as stored in the document. */
    sources: number[][];
    /** The composite of every frame (`compositeFrame`). */
    composites: number[][];
}

/** What the open document `id` holds, for comparing it before a save and after an open. */
export function documentSummary(page: Page, id: string): Promise<DocumentSummary> {
    return page.evaluate(async (id) => {
        const path = "/src/core/composite/index.ts";
        const { compositeFrame } = (await import(
            /* @vite-ignore */ path
        )) as typeof CompositeModule;
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-070: no open document ${id}`);
        const { doc } = document.session;
        const frameIndex = (frameId: string) => doc.frames.findIndex((f) => f.id === frameId) + 1;
        return {
            name: doc.name,
            size: [doc.width, doc.height] as [number, number],
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
                layer.kind === "reference"
                    ? [Array.from(document.referenceSources.get(layer.sourceId) ?? [])]
                    : [],
            ),
            composites: doc.frames.map((frame) => Array.from(compositeFrame(doc, frame.id).data)),
        };
    }, id);
}

/** The id of the active document. */
export function activeDocumentId(page: Page): Promise<string> {
    return page.evaluate(() => {
        const id = window.__ngneTest!.sessions.getState().activeId;
        if (!id) throw new Error("se-070: no active document");
        return id;
    });
}

/**
 * Writes a bundle the editor exported into the output folder of the test, which lies in the
 * checkout the dev server serves, and opens the SE-053 consumer page on its `<name>.sprites.ts`
 * (tests/fixtures/ngne-consumer, NGNE's default camera, frames run by the spec). Returns the
 * folder.
 */
export async function openConsumerOn(
    page: Page,
    testInfo: TestInfo,
    files: readonly FileBytes[],
    names: { camel: string; pascal: string },
): Promise<string> {
    const directory = testInfo.outputPath(`bundle-${names.camel}`);
    writeBundle(directory, files);
    const module = join(directory, fileOf(files, ".sprites.ts").name);
    const query = new URLSearchParams({
        module: `/${relative(testInfo.config.rootDir, module).split(sep).join("/")}`,
        camel: names.camel,
        pascal: names.pascal,
        scheduler: "manual",
    });
    await page.goto(`/tests/e2e/harness/se-053-consumer.html?${query.toString()}`);
    await expect(page.locator("#status")).toHaveText("ready");
    return directory;
}
