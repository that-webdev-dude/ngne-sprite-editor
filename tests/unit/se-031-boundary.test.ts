import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayFrame, OverlayLayer } from "../../src/app/overlay/types";
import { createSelectionAntsLayer } from "../../src/app/selection/selectionAnts.overlay";
import { createPendingStore } from "../../src/app/selection/tools/pendingShape";
import { createSelectionPreviewLayer } from "../../src/app/selection/tools/selectionPreview.overlay";
import { createWand } from "../../src/app/selection/tools/wand";
import { CONTIGUOUS } from "../../src/app/tools/bucket/bucket";
import { createViewMapping } from "../../src/app/view/coordinates";
import { selectionBoundary } from "../../src/core/selection/boundary";
import type * as BoundaryModule from "../../src/core/selection/boundary";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { FRAME, layerId, sprite } from "./se-010-support";
import { at, harness } from "./se-014-support";
import type { Harness } from "./se-014-support";
import { fakeOverlay, surfaceMaker } from "./se-031-support";
import type { CallLog } from "./se-031-support";

// SE-031 review (A): a magic-wand pick's boundary is worked out once. The preview draws the
// pick's ring at the press from the boundaries the overlay shares; the release makes the pick
// the selection with its very mask (Replace), so the ants' first draw of it finds that
// boundary. `selectionBoundary` is watched through the module that defines it.

vi.mock("../../src/core/selection/boundary", async (importOriginal) => {
    const actual = await importOriginal<typeof BoundaryModule>();
    return { ...actual, selectionBoundary: vi.fn(actual.selectionBoundary) };
});

const SIDE = 64;
const SIZE = { width: 300, height: 290 };

/** A `SIDE`² checkerboard of two opaque colours: the wand's dithered worst case. */
function dithered() {
    const pixels: [number, number, number, number][] = [];
    for (let y = 0; y < SIDE; y++) {
        for (let x = 0; x < SIDE; x++) {
            pixels.push((x + y) % 2 === 0 ? [40, 40, 60, 255] : [220, 210, 160, 255]);
        }
    }
    const doc = sprite(SIDE, SIDE, [{ pixels }]);
    return { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
}

function setUp() {
    const h = harness([]);
    const pending = createPendingStore();
    h.registry.register({ ...createWand({ composites: h.composites }, pending), id: "t.wand" });
    h.tools.select("t.wand");
    h.tools.setOption(h.tools.active()!, CONTIGUOUS.key, false);
    const log: CallLog = [];
    const surfaces = surfaceMaker(log);
    const preview = createSelectionPreviewLayer(pending, surfaces.make);
    const { layer: ants } = createSelectionAntsLayer({
        sessions: h.sessions,
        motion: { allowed: () => false, subscribe: () => () => {} },
        every: () => () => {},
        surface: surfaces.make,
    });
    h.open(dithered(), { scale: 4, originX: 10, originY: 10 });
    const draw = (layer: OverlayLayer) => {
        const document = h.document();
        const overlay = fakeOverlay(SIZE, log);
        const from = log.length;
        layer.draw({
            context: overlay.context,
            size: SIZE,
            document,
            mapping: createViewMapping({
                view: document.view,
                docWidth: SIDE,
                docHeight: SIDE,
                ratio: 1,
                left: 0,
                top: 0,
            }),
            cursor: null,
            theme: { outline: 0, ink: 0 },
        } satisfies OverlayFrame);
        return log.slice(from);
    };
    return { h, pending, preview, ants, draw };
}

/** Texel (1, 0): one of the two colours, every other pixel. */
const ONE = { x: 1, y: 0 };
const press = (h: Harness, fields: Partial<PointerInput> = {}, texel = ONE) =>
    h.pipeline.down(at(h, texel, { button: 0, ...fields }));
const release = (h: Harness, fields: Partial<PointerInput> = {}, texel = ONE) =>
    h.pipeline.up(at(h, texel, { button: 0, buttons: 0, ...fields }));

beforeEach(() => {
    vi.mocked(selectionBoundary).mockClear();
});

describe("a magic-wand pick's boundary", () => {
    it("is worked out once through the press, the release and the ants' first draw", () => {
        const t = setUp();
        press(t.h);
        const picked = t.pending.get();
        expect(picked?.shape.kind).toBe("mask");
        expect(t.draw(t.preview)).toContain("drawImage");
        expect(selectionBoundary).toHaveBeenCalledTimes(1);
        release(t.h);
        const { selection } = t.h.document().session;
        // The selection keeps the pick's very mask.
        expect(picked?.shape.kind === "mask" && picked.shape.mask).toBe(selection?.mask);
        expect(t.draw(t.preview)).toEqual([]);
        expect(t.draw(t.ants)).toContain("drawImage");
        // Further redraws, of the ants and of a pan, work nothing out again.
        expect(t.draw(t.ants)).toEqual(["drawImage"]);
        t.h.sessions.getState().setView(t.h.document().id, { originX: 13, originY: 8 });
        expect(t.draw(t.ants)).toContain("drawImage");
        expect(selectionBoundary).toHaveBeenCalledTimes(1);
        expect(t.h.errors).toEqual([]);
    });

    it("is worked out once when no redraw came between the press and the release", () => {
        const t = setUp();
        press(t.h);
        release(t.h);
        t.draw(t.ants);
        t.draw(t.ants);
        expect(selectionBoundary).toHaveBeenCalledTimes(1);
    });

    it("is the result's own when the mode makes another mask of it (Shift: add)", () => {
        const t = setUp();
        press(t.h);
        release(t.h);
        t.draw(t.ants);
        expect(selectionBoundary).toHaveBeenCalledTimes(1);
        // Another pick, added: texel (0, 0) alone, of the other colour. The preview's boundary
        // is the pick's; the union is another mask, whose boundary the ants work out.
        t.h.tools.setOption(t.h.tools.active()!, CONTIGUOUS.key, true);
        const origin = { x: 0, y: 0 };
        press(t.h, { shiftKey: true }, origin);
        t.draw(t.preview);
        expect(selectionBoundary).toHaveBeenCalledTimes(2);
        release(t.h, { shiftKey: true }, origin);
        t.draw(t.ants);
        expect(selectionBoundary).toHaveBeenCalledTimes(3);
        expect(t.h.document().history.undoCount).toBe(2);
    });
});
