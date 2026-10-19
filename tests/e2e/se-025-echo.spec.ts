import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares the stroke echo's probe on `window.__ngneTest` (SE-015).
import type {} from "../../src/app/tools/strokeEcho.overlay";
import type { OnionSettings } from "../../src/core/model";
import { collectErrors } from "./se-006-support";
import { addFrame, openDocument, openViewportEditor, paint, settle } from "./se-011-support";
import { geometry, twoFrames } from "./se-012-support";
import type { Point, View } from "./se-012-support";
import { overlaySettled, setGrids } from "./se-013-support";
import { selectTool, texelClient } from "./se-014-support";
import { celBytes, setColours } from "./se-015-support";

// SE-025 review (B, E): the overlay stroke echo (SPEC §6.6) gives way to onion skins as it does
// to references, over the bounds of each ghost's content only: over a ghost in front it draws
// nothing, over one behind only opaque pixels, and away from the ghosts' content every pixel.
// The registered overlay layer is read back during a stroke with the viewport's uploads held.

const WIDTH = 32;
const HEIGHT = 16;
const VIEW: View = { scale: 8, originX: 8, originY: 8 };
const GREY = [90, 90, 90, 255];
const RED = [210, 30, 30, 255];
/** The ghost (frame 1) has content in the columns before this one, on every row. */
const GHOST_TO = 12;

declare global {
    interface Window {
        __se025Gate?: { open(): void };
    }
}

function holdUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        let open = () => {};
        const gate = new Promise<void>((resolve) => (open = resolve));
        window.__se025Gate = { open };
        window.__ngneTest!.viewport!.uploadGate = () => gate;
    });
}

function openUploads(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__ngneTest!.viewport!.uploadGate = null;
        window.__se025Gate?.open();
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
            if (!context) throw new Error("se-025: no overlay");
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

const row = (y: number, from: number, to: number): Point[] =>
    Array.from({ length: to - from + 1 }, (_, index) => ({ x: from + index, y }));

/** Texels of `texels` far enough from `last` that the brush cursor's rings do not cover them. */
const awayFrom = (texels: readonly Point[], last: Point) =>
    texels.filter((texel) => Math.max(Math.abs(texel.x - last.x), Math.abs(texel.y - last.y)) > 1);

function setOnion(page: Page, id: string, onion: Partial<OnionSettings>): Promise<void> {
    return page.evaluate(
        ({ id, onion }) =>
            window.__ngneTest!.sessions.getState().updateDocSettings(id, (settings) => {
                settings.onion = { ...settings.onion, ...onion };
            }),
        { id, onion },
    );
}

/**
 * A document of two frames, the second active: frame 1 opaque red in its first `GHOST_TO`
 * columns, frame 2 opaque grey in its left half. Onion skin as `onion`.
 */
async function setUp(page: Page, onion: Partial<OnionSettings>) {
    await openViewportEditor(page);
    const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, VIEW);
    const image = (left: number, colour: readonly number[]) => {
        const pixels: number[] = [];
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) pixels.push(...(x < left ? colour : [0, 0, 0, 0]));
        }
        return pixels;
    };
    await paint(page, document.id, image(GHOST_TO, RED));
    const second = await addFrame(page, document.id);
    await paint(page, document.id, image(WIDTH / 2, GREY), second);
    await setGrids(page, document.id, { pixelGrid: false, grid: { visible: false } });
    await setColours(page, 0x2040e0ff, 0xffffffff);
    await setOnion(page, document.id, {
        before: 1,
        after: 0,
        opacity: 255,
        tint: false,
        withinTag: false,
        ...onion,
    });
    await settle(page);
    await overlaySettled(page);
    const ghosts = await page.evaluate(() => window.__ngneTest!.viewport!.onion.length);
    expect(ghosts).toBe(onion.enabled === false ? 0 : 1);
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

async function release(page: Page): Promise<void> {
    await openUploads(page);
    await page.mouse.up();
    await settle(page);
}

/** The x of the texels of `texels` the overlay shows something over. */
async function echoedColumns(page: Page, texels: readonly Point[]): Promise<number[]> {
    const alphas = await overlayAlphas(page, texels);
    return texels.filter((_, index) => alphas[index] !== 0).map((texel) => texel.x);
}

test("over a ghost in front the echo draws nothing, away from its content every pixel", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { clientOf } = await setUp(page, { enabled: true, placement: "front" });
    await selectTool(page, "pencil");
    const pencil = row(4, 1, 30);
    await heldStroke(page, clientOf, [pencil[0]!, pencil.at(-1)!]);
    const shown = awayFrom(pencil, pencil.at(-1)!);
    expect(await echoedColumns(page, shown)).toEqual(
        shown.filter((texel) => texel.x >= GHOST_TO).map((texel) => texel.x),
    );
    await release(page);
    expect(errors).toEqual([]);
});

test("over a ghost behind the echo draws only opaque pixels: erased ones are left to NGNE", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const { document, clientOf } = await setUp(page, { enabled: true, placement: "behind" });
    await selectTool(page, "eraser");
    const before = (await celBytes(page, document.id))!;
    // Through the grey half: inside the ghost's content, then outside it.
    const eraser = row(8, 1, 15);
    await heldStroke(page, clientOf, [eraser[0]!, eraser.at(-1)!]);
    const during = (await celBytes(page, document.id))!;
    const erased = eraser.filter(({ x, y }) => {
        const at = (y * WIDTH + x) * 4 + 3;
        return before[at] === 255 && during[at] === 0;
    });
    expect(erased.length).toBeGreaterThan(8);
    const shown = awayFrom(erased, eraser.at(-1)!);
    expect(shown.some((texel) => texel.x >= GHOST_TO)).toBe(true);
    // Erased pixels are transparent: over the ghost NGNE shows it there, so the echo does not.
    expect(await echoedColumns(page, shown)).toEqual(
        shown.filter((texel) => texel.x >= GHOST_TO).map((texel) => texel.x),
    );
    await release(page);
    expect(errors).toEqual([]);
});

test("with onion skin off the echo draws every pixel of the stroke", async ({ page }) => {
    const errors = collectErrors(page);
    const { clientOf } = await setUp(page, { enabled: false, placement: "front" });
    await selectTool(page, "pencil");
    const pencil = row(4, 1, 30);
    await heldStroke(page, clientOf, [pencil[0]!, pencil.at(-1)!]);
    const shown = awayFrom(pencil, pencil.at(-1)!);
    expect(await echoedColumns(page, shown)).toEqual(shown.map((texel) => texel.x));
    await release(page);
    expect(errors).toEqual([]);
});
