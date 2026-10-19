import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, paint, settle } from "./se-011-support";
import { geometry, twoFrames } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlaySettled, setGrids } from "./se-013-support";
import { selectTool, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";
import {
    addReference,
    changeReference,
    referenceLayers,
    setOpacity,
    setVisible,
} from "./se-045-support";

// SE-045, from the SE-015 review: the overlay stroke echo (SPEC §6.6) is drawn opaque over the
// composite's place, while NGNE draws a reference behind (quad layer 2) under the composite's
// pixels that are not opaque and one in front (6) over everything. The echo gives way: over a
// reference in front it draws nothing, over one behind only opaque pixels. With the viewport's
// uploads held back, the overlay is read back during the stroke; once they are let through,
// NGNE shows the stroke and the references where the echo left them out.

const WIDTH = 32;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 8, originY: 8 };
const GREY = [90, 90, 90, 255];
const RED = [210, 30, 30, 255];
const GREEN = [30, 200, 60, 255];
/** The reference in front covers the columns from here to the right edge. */
const FRONT_FROM = 24;

declare global {
    interface Window {
        __se045Gate?: { open(): void };
    }
}

function holdUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        let open = () => {};
        const gate = new Promise<void>((resolve) => (open = resolve));
        window.__se045Gate = { open };
        window.__ngneTest!.viewport!.uploadGate = () => gate;
    });
}

function openUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__ngneTest!.viewport!.uploadGate = null;
        window.__se045Gate?.open();
    });
}

async function overlayDrawn(page: Page): Promise<void> {
    await page.waitForFunction(() => window.__ngneTest?.overlay?.pending === false, undefined, {
        polling: 20,
    });
    await twoFrames(page);
}

/** The largest overlay alpha over each texel of `texels`, read from the overlay canvas now. */
function overlayAlphas(page: Page, texels: readonly Point[]): Promise<number[]> {
    return page.evaluate(
        ({ view, texels }) => {
            const canvas = document.querySelector<HTMLCanvasElement>(
                "[data-viewport] > canvas[data-viewport-overlay]",
            );
            const context = canvas?.getContext("2d");
            if (!context) throw new Error("se-045: no overlay");
            return texels.map(({ x, y }) => {
                const { data } = context.getImageData(
                    view.originX + x * view.scale,
                    view.originY + y * view.scale,
                    view.scale,
                    view.scale,
                );
                let most = 0;
                for (let at = 3; at < data.length; at += 4) most = Math.max(most, data[at]!);
                return most;
            });
        },
        { view: VIEW, texels: [...texels] },
    );
}

/** The colour NGNE shows at the centre of a texel, read back now. */
function ngneAt(page: Page, texel: Point): Promise<number[]> {
    return page.evaluate(
        ({ view, texel }) => {
            const image = window.__ngneTest!.viewport!.readCanvas()!;
            const x = view.originX + texel.x * view.scale + view.scale / 2;
            const y = view.originY + texel.y * view.scale + view.scale / 2;
            const at = (y * image.width + x) * 4;
            return Array.from(image.data.slice(at, at + 4));
        },
        { view: VIEW, texel },
    );
}

const row = (y: number, from: number, to: number): Point[] =>
    Array.from({ length: to - from + 1 }, (_, index) => ({ x: from + index, y }));

/** Texels of `texels` far enough from `last` that the brush cursor's rings do not cover them. */
const awayFrom = (texels: readonly Point[], last: Point) =>
    texels.filter((texel) => Math.max(Math.abs(texel.x - last.x), Math.abs(texel.y - last.y)) > 1);

async function setUp(page: Page) {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    // The left half opaque grey, the right half transparent.
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) pixels.push(...(x < WIDTH / 2 ? GREY : [0, 0, 0, 0]));
    }
    await paint(page, document.id, pixels);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await setColours(page, 0x2040e0ff, 0xffffffff);
    // Behind: the whole canvas, opaque. In front: the last eight columns, at 50%.
    const behind = await addReference(page, { kind: "flat", width: 32, height: 16, rgba: RED });
    await setOpacity(page, behind!, 255);
    const front = await addReference(page, { kind: "flat", width: 8, height: 16, rgba: GREEN });
    expect(
        await changeReference(page, front!, { x: FRONT_FROM, y: 0, scale: 1, placement: "front" }),
    ).toBe(true);
    await settle(page);
    await overlaySettled(page);
    const layout = await geometry(page);
    return { document, clientOf: (texel: Point) => texelClient(layout, VIEW, texel) };
}

/** Presses at `path[0]` with the uploads held and drags through the rest, button held. */
async function heldStroke(
    page: Page,
    clientOf: (texel: Point) => Point,
    path: readonly Point[],
): Promise<void> {
    await holdUploads(page);
    const start = clientOf(path[0]!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const texel of path.slice(1)) {
        const client = clientOf(texel);
        await page.mouse.move(client.x, client.y, { steps: 2 });
    }
    await overlayDrawn(page);
    expect(await page.evaluate(() => window.__ngneTest!.strokeEcho!.regions)).toBeGreaterThan(0);
}

test("the echo draws nothing over a reference in front, and over one behind only opaque pixels", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, clientOf } = await setUp(page);

    // A pencil stroke along row 4: opaque pixels over the reference behind, then under the
    // one in front.
    await selectTool(page, "pencil");
    const pencil = row(4, 1, 30);
    await heldStroke(page, clientOf, [pencil[0]!, pencil.at(-1)!]);
    const last = pencil.at(-1)!;
    const shown = awayFrom(pencil, last);
    const alphas = await overlayAlphas(page, shown);
    const echoed = shown.filter((_, index) => alphas[index] !== 0).map((texel) => texel.x);
    // Echoed where no reference is in front, and nowhere it is.
    expect(echoed).toEqual(shown.filter((texel) => texel.x < FRONT_FROM).map((t) => t.x));
    // NGNE has not had the stroke: under the reference in front it still shows the reference
    // over the transparent half, which the echo leaves alone.
    const underFront = await ngneAt(page, { x: 26, y: 4 });
    await openUploads(page);
    await page.mouse.up();
    await settle(page);
    await overlayDrawn(page);
    // Then NGNE shows the stroke under the reference in front.
    expect(await ngneAt(page, { x: 26, y: 4 })).not.toEqual(underFront);

    // An eraser stroke along row 8 through the grey half: the erased pixels are transparent,
    // where NGNE shows the reference behind; the echo leaves them to NGNE.
    await selectTool(page, "eraser");
    const before = (await celBytes(page, document.id))!;
    const eraser = row(8, 1, 14);
    await heldStroke(page, clientOf, [eraser[0]!, eraser.at(-1)!]);
    const during = (await celBytes(page, document.id))!;
    const erased = eraser.filter(({ x, y }) => {
        const at = (y * WIDTH + x) * 4 + 3;
        return before[at] === 255 && during[at] === 0;
    });
    expect(erased.length).toBeGreaterThan(8);
    const left = awayFrom(erased, eraser.at(-1)!);
    expect(await overlayAlphas(page, left)).toEqual(left.map(() => 0));
    await openUploads(page);
    await page.mouse.up();
    await settle(page);
    await overlayDrawn(page);
    // Through NGNE the erased pixels show the reference behind them.
    expect((await ngneAt(page, left[0]!)).slice(0, 3)).toEqual(RED.slice(0, 3));
    expect(errors).toEqual([]);
});

test("without references the eraser's transparent pixels are echoed", async ({ page }) => {
    // The same eraser stroke with the references hidden: the echo draws the erased pixels over
    // the checkerboard (SE-015), so the test above sees the references' effect.
    const errors = collectErrors(page);
    const { clientOf } = await setUp(page);
    for (const layer of await referenceLayers(page)) await setVisible(page, layer.id, false);
    await settle(page);
    await overlaySettled(page);
    await selectTool(page, "eraser");
    const eraser = row(8, 1, 14);
    await heldStroke(page, clientOf, [eraser[0]!, eraser.at(-1)!]);
    const left = awayFrom(eraser.slice(1, -1), eraser.at(-1)!);
    expect((await overlayAlphas(page, left)).every((alpha) => alpha === 255)).toBe(true);
    await openUploads(page);
    await page.mouse.up();
    expect(errors).toEqual([]);
});
