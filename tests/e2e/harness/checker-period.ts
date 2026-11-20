import { bitmapFromPixels } from "../../../src/engine/bitmaps";
import {
    CHECKER_SAMPLING,
    checkerPeriod,
    checkerPixels,
    checkerQuad,
} from "../../../src/engine/viewport/checker";
import { imageQuad, QUAD_LAYER, tiledCopies } from "../../../src/engine/viewport/geometry";
import type { Quad } from "../../../src/engine/viewport/geometry";
import type { ViewportChecker } from "../../../src/engine/viewport/types";
import { adapterName } from "./adapter";
import { draw, unsnapped, withRenderer } from "./renderer";

// gh-13: the checkerboard as the viewport draws it — one period with repeat addressing over
// the document rectangle (`checkerQuad`) — against the document-sized image with NGNE's
// default clamp sampling that it replaces, on one bare renderer: the same views, the same
// tiled-mode copies, the canvas read back after each (SPEC §6.7). Returns plain numbers for
// `tests/e2e/checker-period.spec.ts`.

const SIDE = 512;
const CLEAR = 0x000000;

export interface PeriodCase {
    width: number;
    height: number;
    size: number;
    scale: number;
}

export interface PeriodResult extends PeriodCase {
    /** Canvas pixels where the two drawings differ. */
    differing: number;
    /** Canvas pixels the checkerboard covers in the document-sized drawing. */
    covered: number;
}

/** The quad and its tiled-mode copies (SE-062) on both axes. */
const tiled = (quad: Quad) => [quad, ...tiledCopies(quad, "both")];

function compare(cases: readonly PeriodCase[]) {
    return withRenderer(SIDE, SIDE, async (renderer, canvas, errors) => {
        const results: PeriodResult[] = [];
        for (const c of cases) {
            const checker: ViewportChecker = { a: 0x2060a0, b: 0xe0c040, size: c.size };
            const image = checkerPixels(c.width, c.height, checker);
            const period = checkerPeriod(checker);
            await renderer.texture("whole", await bitmapFromPixels(image));
            await renderer.texture("period", await bitmapFromPixels(period), undefined, {
                ...CHECKER_SAMPLING,
            });
            // Off the canvas's origin, with the tiled-mode copies (SE-062) on both axes.
            const view = { scale: c.scale, originX: 7, originY: 5 };
            const document = { width: c.width, height: c.height };
            const whole = imageQuad("whole", QUAD_LAYER.checker, view, document);
            const repeated = checkerQuad(
                "period",
                QUAD_LAYER.checker,
                view,
                document,
                period.width,
            );
            const before = draw(renderer, canvas, unsnapped(), tiled(whole), CLEAR);
            const after = draw(renderer, canvas, unsnapped(), tiled(repeated), CLEAR);
            let differing = 0;
            let covered = 0;
            for (let at = 0; at < before.data.length; at += 4) {
                const a = before.data;
                const b = after.data;
                if (a[at] !== 0 || a[at + 1] !== 0 || a[at + 2] !== 0) covered++;
                if (
                    a[at] !== b[at] ||
                    a[at + 1] !== b[at + 1] ||
                    a[at + 2] !== b[at + 2] ||
                    a[at + 3] !== b[at + 3]
                ) {
                    differing++;
                }
            }
            renderer.releaseTexture("whole");
            renderer.releaseTexture("period");
            results.push({ ...c, differing, covered });
        }
        return { results, errors };
    });
}

(window as unknown as { checkerPeriod: unknown }).checkerPeriod = { compare };
const adapterOutput = document.querySelector("#adapter");
const adapter = await adapterName();
if (adapterOutput) adapterOutput.textContent = adapter;
