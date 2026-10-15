import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./se-006-support";
import { openDocument, openViewportEditor, paint, setView } from "./se-011-support";
import { geometry } from "./se-012-support";
import { overlaySettled, setGrids, shot } from "./se-013-support";
import type { Shot } from "./se-013-support";
import { antsState, darkAt, setSelection } from "./se-030-support";

// SE-030: the marching ants against the image NGNE draws, on the screen (SPEC §6.7), with
// reduced motion so that they stand still. Declared by `antsTests` once per device pixel
// ratio: a ratio other than the configured one needs a Chrome of its own, so it has its own
// spec file (se-030-ants-*). The method is that of se-013-grid-cases.
//
// Every texel of the test document has a colour of its own, so the screenshot without a
// selection shows which texel NGNE draws at each device pixel. From that screenshot alone
// the test works out the selected device pixels (those showing a selected texel) and the ring
// the ants must cover (DESIGN §6, as decided in SE-030): every device pixel that is not
// selected and touches a selected one, diagonally too — 1 px outside the selection on every
// side, as the document outline lies outside the document. With the selection, every pixel of
// the ring must be black or white, in dashes of 2 px with a period of 4 along every row and
// column, and every other pixel of the canvases, inside the document and outside it, must be
// as it was.

const WIDTH = 12;
const HEIGHT = 8;
/**
 * A block with a hole, a part beside it across a gap of one texel, a texel touching the
 * block's corner diagonally, and parts on the document's edges, where the ants lie over the
 * outline and outside the document.
 */
const SHAPE = [
    "..........##",
    ".#####....##",
    ".#####.##.##",
    ".##.##.##...",
    ".#####......",
    ".#####......",
    "......#.....",
    "#...........",
];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
/** At most this many differing pixels are listed. */
const LIMIT = 8;

/** Opaque, one colour per texel, none of them black, white or a colour of the workspace. */
function texels(): number[] {
    const pixels: number[] = [];
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            pixels.push(30 + x * 15, 40 + y * 21, 60 + ((x * 5 + y * 3) % 12) * 13, 255);
        }
    }
    return pixels;
}
const PIXELS = texels();

const key = (rgba: readonly number[]) => rgba.slice(0, 4).join(",");

/** Colour → texel, for the texels of the document. */
const TEXEL_OF = new Map<string, { x: number; y: number }>();
for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
        TEXEL_OF.set(key(PIXELS.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)), { x, y });
    }
}

type View = { scale: number; originX: number; originY: number };

/** Where the canvases are on the screen. */
interface Placement {
    /** The screen pixel of the viewport element's corner. */
    left: number;
    top: number;
    /** The canvases' size in device pixels. */
    device: { width: number; height: number };
}

function at(shown: Shot, place: Placement, x: number, y: number): number[] {
    return shown.at(place.left + x, place.top + y);
}

/**
 * Takes the screen without a selection and with `SHAPE` selected, for the document painted
 * with `PIXELS` at `view`, and checks every device pixel of the canvases.
 */
async function expectAntsOnScreen(page: Page, id: string, view: View): Promise<void> {
    // Nothing at the pointer, no grid: the canvases show NGNE's image, the outline and the ants.
    await setGrids(page, id, { pixelGrid: false, grid: { visible: false } });
    await page.mouse.move(1, 1);
    await overlaySettled(page);
    const layout = await geometry(page);
    const place: Placement = {
        left: Math.round(layout.left * layout.ratio),
        top: Math.round(layout.top * layout.ratio),
        device: layout.device,
    };
    const { width, height } = place.device;

    // Without a selection: NGNE's texels, each `scale` × `scale` device pixels from the
    // view's origin (what se-013-grid-cases checks in full), give the texel of every pixel.
    const plain = await shot(page);
    const texelAt: ({ x: number; y: number } | null)[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++)
            texelAt.push(TEXEL_OF.get(key(at(plain, place, x, y))) ?? null);
    }
    const placed: string[] = [];
    for (let y = 0; y < height && placed.length < LIMIT; y++) {
        for (let x = 0; x < width && placed.length < LIMIT; x++) {
            const inside =
                x >= view.originX &&
                x < view.originX + WIDTH * view.scale &&
                y >= view.originY &&
                y < view.originY + HEIGHT * view.scale;
            const texel = texelAt[y * width + x];
            const expected = inside
                ? `${Math.floor((x - view.originX) / view.scale)},${Math.floor((y - view.originY) / view.scale)}`
                : null;
            const found = texel ? `${texel.x},${texel.y}` : null;
            if (found !== expected)
                placed.push(`(${x}, ${y}) shows texel ${found}, not ${expected}`);
        }
    }
    expect(placed).toEqual([]);

    // The selection, through the history as a selection tool makes it.
    await setSelection(page, id, SHAPE);
    await overlaySettled(page);
    expect((await antsState(page)).animating).toBe(false);
    const ants = await shot(page);

    const selected = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const texel = texelAt[y * width + x];
        return texel !== null && texel !== undefined && SHAPE[texel.y]?.[texel.x] === "#";
    };
    const ring: [number, number][] = [];
    const untouched: string[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (selected(x, y)) {
                if (
                    key(at(ants, place, x, y)) !== key(at(plain, place, x, y)) &&
                    untouched.length < LIMIT
                ) {
                    untouched.push(
                        `selected (${x}, ${y}) ${at(plain, place, x, y)} shows ${at(ants, place, x, y)}`,
                    );
                }
                continue;
            }
            let touches = false;
            for (let dy = -1; dy <= 1 && !touches; dy++) {
                for (let dx = -1; dx <= 1 && !touches; dx++) touches = selected(x + dx, y + dy);
            }
            if (touches) ring.push([x, y]);
            else if (
                key(at(ants, place, x, y)) !== key(at(plain, place, x, y)) &&
                untouched.length < LIMIT
            ) {
                untouched.push(
                    `(${x}, ${y}) ${at(plain, place, x, y)} shows ${at(ants, place, x, y)}`,
                );
            }
        }
    }
    // Every pixel off the ring, inside the document and outside it, is as it was.
    expect(untouched).toEqual([]);

    // The ring: the pixels around every selected texel, the hole's border included and the
    // ring's parts on the outline and beyond the document's edges.
    const perimeter = WIDTH * view.scale * 2;
    expect(ring.length).toBeGreaterThan(perimeter);
    expect(ring.some(([x, y]) => y === view.originY - 1 && x >= view.originX)).toBe(true);
    expect(ring.some(([x]) => x === view.originX + WIDTH * view.scale)).toBe(true);
    expect(ring.some(([x]) => x === view.originX - 1)).toBe(true);
    expect(ring.some(([, y]) => y === view.originY + HEIGHT * view.scale)).toBe(true);

    // Each pixel of the ring is black or white, and one phase of the dashes names which.
    const colours = ring.map(([x, y]) => at(ants, place, x, y));
    expect(
        colours
            .map((colour, index) => ({ colour, at: ring[index]! }))
            .filter(({ colour }) => key(colour) !== key(BLACK) && key(colour) !== key(WHITE))
            .slice(0, LIMIT)
            .map(({ colour, at: [x, y] }) => `(${x}, ${y}) ${colour}`),
    ).toEqual([]);
    const wrongAt = (phase: number) =>
        ring.filter(
            ([x, y], index) => darkAt(x, y, phase) !== (key(colours[index]!) === key(BLACK)),
        );
    const phases = [0, 1, 2, 3].filter((phase) => wrongAt(phase).length === 0);
    expect(phases, `first misses at phase 0: ${wrongAt(0).slice(0, LIMIT).join(" ")}`).toHaveLength(
        1,
    );
    expect(phases[0]).toBe((await antsState(page)).phase);
}

/** Declares the alignment tests; the calling spec file has set Chrome up for `ratio`. */
export function antsTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        for (const view of [
            { scale: 1, originX: 37, originY: 23 },
            { scale: 3, originX: 37, originY: 23 },
            { scale: 8, originX: 37, originY: 23 },
        ]) {
            test(`at scale ${view.scale} the ants lie on the device pixels just outside the selected texels of the NGNE image, in 2 px dashes`, async ({
                page,
            }) => {
                const errors = collectErrors(page);
                await page.emulateMedia({ reducedMotion: "reduce" });
                await openViewportEditor(page);
                expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
                const document = await openDocument(page, { width: WIDTH, height: HEIGHT }, view);
                await paint(page, document.id, PIXELS);
                await setView(page, document.id, view);
                await expectAntsOnScreen(page, document.id, view);
                expect(errors).toEqual([]);
            });
        }
    });
}
