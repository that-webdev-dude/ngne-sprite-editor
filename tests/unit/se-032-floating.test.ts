import { describe, expect, it } from "vitest";
import {
    clearSelected,
    contentOfImage,
    copySelected,
    fillSelected,
    FloatingSelection,
} from "../../src/core/floating";
import type { FloatingContent } from "../../src/core/floating";
import { AllocationError, History } from "../../src/core/history";
import type { PixelAllocator } from "../../src/core/history";
import {
    assertInvariants,
    celAt,
    celKey,
    createDocument,
    sequentialIds,
} from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import {
    createMask,
    maskHas,
    rectMask,
    selectionOf,
    selectionsEqual,
    setMaskPixel,
} from "../../src/core/selection";

// SE-032: the floating selection of `core/floating` (SPEC §5.2, §7.2). Pixels lifted from a
// cel or pasted float inside one transaction of the history: cancelled, the cel is
// byte-identical; applied, they land where they are, clipped to the canvas, with the source
// transparent and the selection moved along, as one undo step. Copy, Delete and Fill of the
// selected pixels. Expected images are worked out here pixel by pixel, not by the module.

const W = 8;
const H = 6;

/** An opaque image whose every pixel differs from every other. */
function pattern(width = W, height = H): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set([10 + x * 20, 10 + y * 30, (x * 7 + y * 13) & 255, 255], (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

/** A document whose active cel holds `image` (none: an empty cel), and its history. */
function setUp(image: PixelBuffer | null = pattern(), options: { allocate?: PixelAllocator } = {}) {
    const session: DocSession = createDocument(
        { name: "float", width: image?.width ?? W, height: image?.height ?? H },
        sequentialIds("f-"),
    );
    if (image) {
        session.doc.images.set("img", image);
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "img",
            opacity: 255,
        });
    }
    const history = new History(session, { allocate: options.allocate });
    const target = { layerId: session.activeLayerId, frameId: session.activeFrameId };
    return { session, history, target };
}

/** The active cel's image as bytes; null for an empty cel. */
function bytes(session: DocSession): number[] | null {
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
    const image = cel ? session.doc.images.get(cel.imageId) : undefined;
    return image ? Array.from(image.data) : null;
}

function rgba(image: number[] | PixelBuffer, x: number, y: number, width = W): number[] {
    const data = Array.isArray(image) ? image : Array.from(image.data);
    const at = (y * width + x) * 4;
    return data.slice(at, at + 4);
}

/** A selection of the rectangle `x0..x1` × `y0..y1` (both included) of a W × H canvas. */
function rectSelection(x0: number, y0: number, x1: number, y1: number, width = W, height = H) {
    return selectionOf(
        rectMask(width, height, { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }),
    );
}

/** The selected pixels of a mask as "x,y" strings, row by row. */
function selectedPixels(session: DocSession): string[] {
    const mask = session.selection?.mask;
    if (!mask) return [];
    const found: string[] = [];
    for (let y = 0; y < mask.height; y++) {
        for (let x = 0; x < mask.width; x++) {
            const bit = y * mask.width + x;
            if (mask.data[bit >> 3]! & (1 << (bit & 7))) found.push(`${x},${y}`);
        }
    }
    return found;
}

/**
 * The image after the pixels `selected` of `before` moved by `dx`, `dy`: the moved pixels
 * replace what is under them (on the canvas only), the places they left are transparent.
 */
function moved(
    before: number[],
    selected: (x: number, y: number) => boolean,
    dx: number,
    dy: number,
    width = W,
    height = H,
): number[] {
    const after = [...before];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (selected(x, y)) after.splice((y * width + x) * 4, 4, 0, 0, 0, 0);
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!selected(x, y)) continue;
            const tx = x + dx;
            const ty = y + dy;
            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
            after.splice((ty * width + tx) * 4, 4, ...rgba(before, x, y, width));
        }
    }
    return after;
}

describe("lift and cancel", () => {
    it("leaves the cel byte-identical, whatever the float did, and records nothing", () => {
        const { session, history, target } = setUp();
        // An irregular selection: an L and a lone pixel.
        const mask = createMask(W, H);
        for (const [x, y] of [
            [1, 1],
            [1, 2],
            [1, 3],
            [2, 3],
            [3, 3],
            [6, 0],
        ] as const) {
            setMaskPixel(mask, x, y);
        }
        const selection = selectionOf(mask);
        session.selection = selection;
        const before = bytes(session);

        const float = FloatingSelection.lift(history, { ...target, selection });
        expect(history.transaction).toBe(float.transaction);
        // Lifted where they are, the image has not changed yet.
        expect(bytes(session)).toEqual(before);
        float.moveTo(4, -1);
        float.moveBy(-9, 3);
        float.moveBy(30, 30);
        expect(bytes(session)).not.toEqual(before);
        float.cancel();

        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(float.open).toBe(false);
        expect(() => float.moveTo(0, 0)).toThrow(/applied or cancelled/);
        assertInvariants(session);
    });

    it("removes the cel it made for a lift from an empty cel", () => {
        const { session, history, target } = setUp(null);
        session.selection = rectSelection(2, 2, 4, 3);
        const float = FloatingSelection.lift(history, { ...target, selection: session.selection });
        expect(bytes(session)).not.toBeNull();
        float.moveBy(1, 1);
        float.cancel();
        expect(bytes(session)).toBeNull();
        expect(session.doc.images.size).toBe(0);
        assertInvariants(session);
    });
});

describe("lift, move and apply", () => {
    it("moves the pixels by (3, −2) exactly, leaves the source transparent, as one undo step", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(1, 3, 3, 5);
        session.selection = selection;
        const before = bytes(session)!;

        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(3, -2);
        expect(float.x).toBe(4);
        expect(float.y).toBe(1);
        const command = float.apply();

        const inRect = (x: number, y: number) => x >= 1 && x <= 3 && y >= 3 && y <= 5;
        const expected = moved(before, inRect, 3, -2);
        expect(bytes(session)).toEqual(expected);
        // The pixel from (1, 3) is at (4, 1); (1, 4) and (1, 5), not covered, are transparent.
        expect(rgba(bytes(session)!, 4, 1)).toEqual(rgba(before, 1, 3));
        expect(rgba(bytes(session)!, 1, 4)).toEqual([0, 0, 0, 0]);
        expect(rgba(bytes(session)!, 1, 5)).toEqual([0, 0, 0, 0]);
        // The selection moved with the pixels.
        expect(session.selection?.bounds).toEqual({ x: 4, y: 1, width: 3, height: 3 });
        // One step, labelled Move.
        expect(command?.label).toBe("Move");
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move");
        expect(history.transaction).toBeNull();
        assertInvariants(session);

        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        history.redo();
        expect(bytes(session)).toEqual(expected);
        expect(session.selection?.bounds).toEqual({ x: 4, y: 1, width: 3, height: 3 });
    });

    it("lifts the whole cel without a selection and leaves the selection alone", () => {
        const { session, history, target } = setUp();
        const before = bytes(session)!;
        const float = FloatingSelection.lift(history, { ...target, selection: null });
        expect(float.selects).toBe(false);
        float.moveBy(-2, 1);
        expect(session.selection).toBeNull();
        float.apply();
        expect(bytes(session)).toEqual(moved(before, () => true, -2, 1));
        expect(session.selection).toBeNull();
        expect(history.undoCount).toBe(1);
    });

    it("clips content moved partly off the canvas when it is applied; until then it stays whole", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(4, 1, 7, 3);
        session.selection = selection;
        const before = bytes(session)!;
        const inRect = (x: number, y: number) => x >= 4 && x <= 7 && y >= 1 && y <= 3;

        const float = FloatingSelection.lift(history, { ...target, selection });
        // Past the right edge and back: nothing is lost while it floats.
        float.moveBy(3, 0);
        expect(float.placed).toEqual({ x: 7, y: 1, width: 1, height: 3 });
        expect(selectedPixels(session)).toEqual(["7,1", "7,2", "7,3"]);
        float.moveBy(-3, 0);
        expect(bytes(session)).toEqual(before);
        // Over the top-right corner, then applied.
        float.moveBy(2, -2);
        float.apply();
        expect(bytes(session)).toEqual(moved(before, inRect, 2, -2));
        // Only the part on the canvas stays selected.
        expect(selectedPixels(session)).toEqual(["6,0", "7,0", "6,1", "7,1"]);
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
    });

    it("may move the content off the canvas altogether: applied, it is gone and so is the selection", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(0, 0, 1, 1);
        session.selection = selection;
        const before = bytes(session)!;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveTo(-5, 2);
        expect(float.placed).toBeNull();
        expect(session.selection).toBeNull();
        expect(float.contains(-5, 2)).toBe(true);
        float.apply();
        expect(bytes(session)).toEqual(moved(before, (x, y) => x <= 1 && y <= 1, -5, 2));
        expect(session.selection).toBeNull();
        history.undo();
        expect(session.selection).toBe(selection);
    });

    it("records nothing for a float applied where it was lifted", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(2, 2, 3, 3);
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(1, 0);
        float.moveBy(-1, 0);
        expect(float.apply()).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(session.selection).toBe(selection);
        expect(history.transaction).toBeNull();
    });

    it("records the selection's move alone when no pixel changed (transparent pixels moved over transparent ones)", () => {
        const { session, history, target } = setUp(null);
        const selection = rectSelection(0, 0, 1, 1);
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(4, 2);
        const command = float.apply();
        expect(command?.label).toBe("Move");
        expect(command?.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        // The cel the lift made is not kept: nothing was written.
        expect(bytes(session)).toBeNull();
        expect(session.selection?.bounds).toEqual({ x: 4, y: 2, width: 2, height: 2 });
        history.undo();
        expect(session.selection).toBe(selection);
        assertInvariants(session);
    });

    it("knows which document pixels hold the float: its mask, where it is", () => {
        const { session, history, target } = setUp();
        const mask = createMask(W, H);
        setMaskPixel(mask, 2, 2);
        setMaskPixel(mask, 3, 3);
        session.selection = selectionOf(mask);
        const float = FloatingSelection.lift(history, { ...target, selection: session.selection });
        expect(float.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
        expect(float.contains(2, 2)).toBe(true);
        expect(float.contains(3, 2)).toBe(false);
        float.moveBy(10, 0);
        expect(float.contains(12, 2)).toBe(true);
        expect(float.contains(13, 3)).toBe(true);
        expect(float.contains(2, 2)).toBe(false);
        float.cancel();
    });

    it("puts pixels and selection back when the step cannot be stored (AllocationError)", () => {
        let failing = false;
        const allocate: PixelAllocator = (length) => {
            if (failing) throw new RangeError("out of memory");
            return new Uint8ClampedArray(length);
        };
        const { session, history, target } = setUp(pattern(), { allocate });
        const selection = rectSelection(1, 1, 2, 2);
        session.selection = selection;
        const before = bytes(session);
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(2, 2);
        failing = true;
        expect(() => float.apply()).toThrow(AllocationError);
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
    });
});

describe("paste", () => {
    /** A 3 × 2 content whose middle column is outside its mask. */
    function content(): FloatingContent {
        const pixels: PixelBuffer = {
            width: 3,
            height: 2,
            data: new Uint8ClampedArray([
                ...[1, 2, 3, 255, 0, 0, 0, 0, 7, 8, 9, 128],
                ...[11, 12, 13, 255, 0, 0, 0, 0, 17, 18, 19, 0],
            ]),
        };
        const mask = createMask(3, 2);
        for (const [x, y] of [
            [0, 0],
            [2, 0],
            [0, 1],
            [2, 1],
        ] as const) {
            setMaskPixel(mask, x, y);
        }
        return { pixels, mask };
    }

    it("creates the cel of an empty cel; cancelled, the cel is gone", () => {
        const { session, history, target } = setUp(null);
        const float = FloatingSelection.paste(history, {
            ...target,
            content: content(),
            x: 2,
            y: 1,
        });
        expect(float.label).toBe("Paste");
        expect(bytes(session)).not.toBeNull();
        expect(selectedPixels(session)).toEqual(["2,1", "4,1", "2,2", "4,2"]);
        float.cancel();
        expect(bytes(session)).toBeNull();
        expect(session.selection).toBeNull();
        assertInvariants(session);
    });

    it("writes the pixels of its mask over the cel, transparent ones included, as one Paste step", () => {
        const { session, history, target } = setUp();
        const before = bytes(session)!;
        const pasted = content();
        const float = FloatingSelection.paste(history, { ...target, content: pasted, x: 2, y: 1 });
        float.moveBy(1, 1);
        float.apply();
        const after = bytes(session)!;
        expect(rgba(after, 3, 2)).toEqual([1, 2, 3, 255]);
        expect(rgba(after, 5, 2)).toEqual([7, 8, 9, 128]);
        expect(rgba(after, 3, 3)).toEqual([11, 12, 13, 255]);
        // A pixel of the mask of alpha 0 replaces what was there.
        expect(rgba(after, 5, 3)).toEqual([17, 18, 19, 0]);
        // Outside the mask, the cel is as it was; nothing was cut.
        expect(rgba(after, 4, 2)).toEqual(rgba(before, 4, 2));
        expect(rgba(after, 2, 1)).toEqual(rgba(before, 2, 1));
        expect(history.undoLabel).toBe("Paste");
        expect(selectedPixels(session)).toEqual(["3,2", "5,2", "3,3", "5,3"]);
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBeNull();
    });

    it("floats an image larger than the canvas whole and clips it when it is applied", () => {
        const { session, history, target } = setUp(null);
        const big = pattern(12, 9);
        const float = FloatingSelection.paste(history, {
            ...target,
            content: contentOfImage(big),
            x: -2,
            y: -1,
        });
        expect(float.bounds).toEqual({ x: -2, y: -1, width: 12, height: 9 });
        expect(session.selection?.bounds).toEqual({ x: 0, y: 0, width: W, height: H });
        float.moveBy(-1, -1);
        float.moveBy(1, 1);
        float.apply();
        const after = bytes(session)!;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                expect(rgba(after, x, y), `${x},${y}`).toEqual(rgba(big, x + 2, y + 1, 12));
            }
        }
        assertInvariants(session);
    });

    it("refuses content whose mask does not match its pixels, with the session unchanged", () => {
        const { session, history, target } = setUp();
        const bad = { pixels: pattern(3, 2), mask: createMask(2, 2) };
        expect(() =>
            FloatingSelection.paste(history, { ...target, content: bad, x: 0, y: 0 }),
        ).toThrow(RangeError);
        expect(history.transaction).toBeNull();
        expect(() =>
            FloatingSelection.paste(history, { ...target, content: content(), x: 0.5, y: 0 }),
        ).toThrow(RangeError);
        expect(history.transaction).toBeNull();
        expect(session.selection).toBeNull();
    });
});

describe("copy, delete and fill of the selected pixels", () => {
    it("copies the selection's rectangle with the unselected pixels transparent, and its shape", () => {
        const { session, target } = setUp();
        const mask = createMask(W, H);
        setMaskPixel(mask, 2, 1);
        setMaskPixel(mask, 4, 2);
        const selection = selectionOf(mask)!;
        const copied = copySelected(session, target, selection);
        expect(copied.pixels.width).toBe(3);
        expect(copied.pixels.height).toBe(2);
        const image = session.doc.images.get("img")!;
        expect(rgba(copied.pixels, 0, 0, 3)).toEqual(rgba(image, 2, 1));
        expect(rgba(copied.pixels, 2, 1, 3)).toEqual(rgba(image, 4, 2));
        expect(rgba(copied.pixels, 1, 0, 3)).toEqual([0, 0, 0, 0]);
        expect(Array.from(copied.mask.data)).toEqual([0b100001]);
        // An empty cel copies transparent pixels.
        const empty = setUp(null);
        const none = copySelected(empty.session, empty.target, selection);
        expect(Array.from(none.pixels.data).every((value) => value === 0)).toBe(true);
    });

    it("Delete makes only the selected pixels transparent, as one step; nothing to delete records nothing", () => {
        const { session, history, target } = setUp();
        const before = bytes(session)!;
        const selection = rectSelection(2, 2, 3, 4)!;
        const command = clearSelected(history, target, selection);
        expect(command?.label).toBe("Delete");
        expect(bytes(session)).toEqual(
            moved(before, (x, y) => x >= 2 && x <= 3 && y >= 2 && y <= 4, 100, 0),
        );
        expect(clearSelected(history, target, selection)).toBeNull();
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(bytes(session)).toEqual(before);
        // An empty cel: no cel is made, nothing recorded.
        const empty = setUp(null);
        expect(clearSelected(empty.history, empty.target, selection)).toBeNull();
        expect(empty.session.doc.cels.size).toBe(0);
    });

    it("Fill writes the colour into the selected pixels only, creating an empty cel; alpha 0 writes 0, 0, 0, 0", () => {
        const { session, history, target } = setUp(null);
        const mask = createMask(W, H);
        setMaskPixel(mask, 1, 1);
        setMaskPixel(mask, 3, 2);
        const selection = selectionOf(mask)!;
        expect(fillSelected(history, target, selection, 0x11223344)?.label).toBe("Fill");
        const after = bytes(session)!;
        expect(rgba(after, 1, 1)).toEqual([0x11, 0x22, 0x33, 0x44]);
        expect(rgba(after, 3, 2)).toEqual([0x11, 0x22, 0x33, 0x44]);
        expect(rgba(after, 2, 1)).toEqual([0, 0, 0, 0]);
        expect(rgba(after, 1, 2)).toEqual([0, 0, 0, 0]);
        expect(fillSelected(history, target, selection, 0x11223344)).toBeNull();
        expect(fillSelected(history, target, selection, 0xffffff00)?.label).toBe("Fill");
        expect(rgba(bytes(session)!, 1, 1)).toEqual([0, 0, 0, 0]);
        expect(history.undoCount).toBe(2);
        assertInvariants(session);
    });
});

// SE-032 review (H): Delete and Cut while pixels float discard them, as Aseprite's
// `PixelsMovement::discardImage` does: the image keeps what lies under the float and nothing
// is selected, in one step, or none when the document is as it was before the float.
describe("discard (Delete and Cut while floating)", () => {
    it("keeps what lies under the float: the lifted place transparent, the place it floats over as it was; nothing selected; one step that undoes and redoes exactly", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(1, 1, 2, 2);
        session.selection = selection;
        const before = bytes(session)!;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(3, 2);
        // The float is over (4..5, 3..4) now.
        expect(rgba(bytes(session)!, 4, 3)).toEqual(rgba(before, 1, 1));
        const command = float.discard("Delete");
        expect(float.open).toBe(false);
        const lifted = (x: number, y: number) => x >= 1 && x <= 2 && y >= 1 && y <= 2;
        // The lifted pixels are cleared, and nothing is written anywhere else.
        const expected = moved(before, lifted, 100, 0);
        expect(bytes(session)).toEqual(expected);
        expect(rgba(bytes(session)!, 4, 3)).toEqual(rgba(before, 4, 3));
        expect(rgba(bytes(session)!, 5, 4)).toEqual(rgba(before, 5, 4));
        expect(session.selection).toBeNull();
        expect(command?.label).toBe("Delete");
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Delete");
        expect(history.transaction).toBeNull();
        assertInvariants(session);

        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        history.redo();
        expect(bytes(session)).toEqual(expected);
        expect(session.selection).toBeNull();
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
    });

    it("records nothing for a paste with nothing selected before it, and removes the cel the paste made", () => {
        const { session, history, target } = setUp(null);
        const float = FloatingSelection.paste(history, {
            ...target,
            content: contentOfImage(pattern(3, 2)),
            x: 1,
            y: 1,
        });
        float.moveBy(1, 1);
        expect(float.discard("Delete")).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(history.transaction).toBeNull();
        expect(bytes(session)).toBeNull();
        expect(session.doc.images.size).toBe(0);
        expect(session.selection).toBeNull();
        assertInvariants(session);
    });

    it("a paste over a selection, then Cut: the cel as it was and the selection gone, a step of the selection alone", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(0, 0, 1, 1);
        session.selection = selection;
        const before = bytes(session)!;
        const float = FloatingSelection.paste(history, {
            ...target,
            content: contentOfImage(pattern(2, 2)),
            x: 4,
            y: 2,
        });
        expect(bytes(session)).not.toEqual(before);
        const command = float.discard("Cut");
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBeNull();
        expect(command?.label).toBe("Cut");
        expect(command?.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        history.undo();
        expect(session.selection).toBe(selection);
        expect(bytes(session)).toEqual(before);
        history.redo();
        expect(session.selection).toBeNull();
        expect(bytes(session)).toEqual(before);
    });

    it("a whole cel lifted without a selection is cleared, and the selection is left alone", () => {
        const { session, history, target } = setUp();
        const before = bytes(session)!;
        const float = FloatingSelection.lift(history, { ...target, selection: null });
        float.moveBy(2, 1);
        expect(float.discard("Delete")?.label).toBe("Delete");
        expect(bytes(session)!.every((value) => value === 0)).toBe(true);
        expect(session.selection).toBeNull();
        history.undo();
        expect(bytes(session)).toEqual(before);
    });

    it("puts pixels and selection back when the step cannot be stored (AllocationError)", () => {
        let failing = false;
        const allocate: PixelAllocator = (length) => {
            if (failing) throw new RangeError("out of memory");
            return new Uint8ClampedArray(length);
        };
        const { session, history, target } = setUp(pattern(), { allocate });
        const selection = rectSelection(2, 1, 3, 3);
        session.selection = selection;
        const before = bytes(session);
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(-1, 1);
        failing = true;
        expect(() => float.discard("Delete")).toThrow(AllocationError);
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
    });
});

// SE-032 review (F): a throw after the entry was recorded (a listener of the history) is not
// a failed commit: the step and its selection stay, and undo takes both back.
describe("a listener of the history that throws at the apply", () => {
    it("leaves the recorded step and its selection; undo and redo stay exact", () => {
        const { session, history, target } = setUp();
        const selection = rectSelection(0, 0, 2, 0);
        session.selection = selection;
        const before = bytes(session)!;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(2, 3);
        const stop = history.subscribe(() => {
            throw new Error("listener failed");
        });
        expect(() => float.apply()).toThrow("listener failed");
        stop();
        const inRow = (x: number, y: number) => x <= 2 && y === 0;
        const expected = moved(before, inRow, 2, 3);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move");
        expect(history.transaction).toBeNull();
        expect(bytes(session)).toEqual(expected);
        // Not put back: the selection is the entry's, where the pixels went.
        expect(session.selection?.bounds).toEqual({ x: 2, y: 3, width: 3, height: 1 });
        history.undo();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        history.redo();
        expect(bytes(session)).toEqual(expected);
        expect(session.selection?.bounds).toEqual({ x: 2, y: 3, width: 3, height: 1 });
    });
});

// SE-032 review (J): do/undo symmetry of every command (SPEC §11) for the steps of this ticket.
describe("do and undo of the steps", () => {
    it("a Paste onto an empty cel: undo removes the cel it made and restores the selection; redo brings both back", () => {
        const { session, history, target } = setUp(null);
        const selection = rectSelection(5, 4, 6, 5);
        session.selection = selection;
        const float = FloatingSelection.paste(history, {
            ...target,
            content: contentOfImage(pattern(3, 2)),
            x: 2,
            y: 1,
        });
        float.moveBy(1, 0);
        expect(float.apply()?.label).toBe("Paste");
        const after = bytes(session)!;
        const pasted = session.selection;
        expect(selectedPixels(session)).toEqual(["3,1", "4,1", "5,1", "3,2", "4,2", "5,2"]);
        expect(session.doc.cels.size).toBe(1);
        assertInvariants(session);

        history.undo();
        expect(bytes(session)).toBeNull();
        expect(session.doc.cels.size).toBe(0);
        expect(session.doc.images.size).toBe(0);
        expect(session.selection).toBe(selection);
        assertInvariants(session);
        history.redo();
        expect(bytes(session)).toEqual(after);
        expect(session.selection).toBe(pasted);
        assertInvariants(session);
        history.undo();
        expect(bytes(session)).toBeNull();
        expect(session.selection).toBe(selection);
    });

    it("Fill and Cut (a clear labelled Cut): undo restores the bytes, redo repeats them", () => {
        const { session, history, target } = setUp();
        const before = bytes(session)!;
        const mask = createMask(W, H);
        for (const [x, y] of [
            [1, 1],
            [2, 1],
            [5, 4],
        ] as const) {
            setMaskPixel(mask, x, y);
        }
        const selection = selectionOf(mask)!;
        expect(fillSelected(history, target, selection, 0x0a141eff)?.label).toBe("Fill");
        const filled = bytes(session)!;
        expect(rgba(filled, 5, 4)).toEqual([10, 20, 30, 255]);
        expect(clearSelected(history, target, selection, "Cut")?.label).toBe("Cut");
        const cut = bytes(session)!;
        expect(rgba(cut, 2, 1)).toEqual([0, 0, 0, 0]);
        expect(rgba(cut, 3, 1)).toEqual(rgba(before, 3, 1));
        history.undo();
        expect(bytes(session)).toEqual(filled);
        history.undo();
        expect(bytes(session)).toEqual(before);
        history.redo();
        expect(bytes(session)).toEqual(filled);
        history.redo();
        expect(bytes(session)).toEqual(cut);
    });

    it("a Move of the selection alone (transparent pixels over transparent ones) redoes exactly", () => {
        const { session, history, target } = setUp(null);
        const selection = rectSelection(0, 0, 1, 1);
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.moveBy(4, 2);
        float.apply();
        const movedSelection = session.selection;
        history.undo();
        expect(session.selection).toBe(selection);
        history.redo();
        expect(session.selection).toBe(movedSelection);
        expect(session.selection?.bounds).toEqual({ x: 4, y: 2, width: 2, height: 2 });
        expect(bytes(session)).toBeNull();
        assertInvariants(session);
    });
});

/** mulberry32: a small seeded generator, the same numbers on every run. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A `width` × `height` document whose active cel holds `image` (none: empty), its history. */
function documentOf(width: number, height: number, image: PixelBuffer | null) {
    const session: DocSession = createDocument(
        { name: "random", width, height },
        sequentialIds("r-"),
    );
    if (image) {
        session.doc.images.set("img", image);
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "img",
            opacity: 255,
        });
    }
    const history = new History(session);
    const target = { layerId: session.activeLayerId, frameId: session.activeFrameId };
    return { session, history, target };
}

// SE-032 review (J): random masks moved at random, off the canvas included, against an oracle
// worked out here: a cancel leaves the cel byte-identical; an apply equals the oracle; undo and
// redo give back exactly the states before and after.
describe("property: random selections moved at random", () => {
    it("cancel is byte-identical, apply equals the oracle, undo and redo are exact (400 cases)", () => {
        const next = random(0x5e032);
        const int = (below: number) => Math.floor(next() * below);
        let applied = 0;
        let cancelled = 0;
        let offCanvas = 0;
        for (let run = 0; run < 400; run++) {
            const width = 1 + int(9);
            const height = 1 + int(7);
            // Opaque, translucent and transparent pixels, some transparent with a colour; an
            // empty cel now and then.
            const empty = int(8) === 0;
            const data = new Uint8ClampedArray(width * height * 4);
            for (let at = 0; at < data.length; at++) {
                data[at] = at % 4 === 3 ? [0, 255, 255, 90][int(4)]! : int(256);
            }
            const { session, history, target } = documentOf(
                width,
                height,
                empty ? null : { width, height, data },
            );
            const mask = createMask(width, height);
            const density = next();
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) if (next() < density) setMaskPixel(mask, x, y);
            }
            const selection = selectionOf(mask);
            if (!selection) continue;
            session.selection = selection;
            const before = bytes(session);
            const label = `run ${run}`;

            // Moves anywhere, partly or wholly off the canvas too; the last one counts.
            let dx = 0;
            let dy = 0;
            const float = FloatingSelection.lift(history, { ...target, selection });
            const moves = 1 + int(4);
            for (let step = 0; step < moves; step++) {
                dx = int(2 * width + 5) - width - 2;
                dy = int(2 * height + 5) - height - 2;
                float.moveTo(selection.bounds.x + dx, selection.bounds.y + dy);
            }
            if (float.placed === null) offCanvas++;
            if (int(3) === 0) {
                cancelled++;
                float.cancel();
                expect(bytes(session), label).toEqual(before);
                expect(session.selection, label).toBe(selection);
                expect(history.undoCount, label).toBe(0);
                expect(history.transaction, label).toBeNull();
                assertInvariants(session);
                continue;
            }
            applied++;
            const command = float.apply();

            // The oracle: the selected pixels cleared, then written moved, on the canvas only.
            const source = before ?? new Array<number>(width * height * 4).fill(0);
            const selected = (x: number, y: number) => maskHas(mask, x, y);
            const expected = moved(source, selected, dx, dy, width, height);
            const expectedMask = createMask(width, height);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    if (!selected(x, y) || tx < 0 || ty < 0 || tx >= width || ty >= height) {
                        continue;
                    }
                    setMaskPixel(expectedMask, tx, ty);
                }
            }
            const expectedSelection = selectionOf(expectedMask);
            const pixelsChanged = expected.some((value, index) => value !== source[index]);
            const selectionChanged = !selectionsEqual(selection, expectedSelection);

            const after = bytes(session);
            // An empty cel that nothing was written into stays empty.
            if (before === null && !pixelsChanged) expect(after, label).toBeNull();
            else expect(after, label).toEqual(expected);
            if (selectionChanged) {
                expect(session.selection?.bounds, label).toEqual(expectedSelection?.bounds);
                expect(session.selection?.mask.data, label).toEqual(expectedSelection?.mask.data);
            } else {
                expect(session.selection, label).toBe(selection);
            }
            expect(command !== null, label).toBe(pixelsChanged || selectionChanged);
            expect(history.undoCount, label).toBe(command ? 1 : 0);
            expect(history.transaction, label).toBeNull();
            assertInvariants(session);
            if (!command) continue;

            const landed = session.selection;
            history.undo();
            expect(bytes(session), label).toEqual(before);
            expect(session.selection, label).toBe(selection);
            assertInvariants(session);
            history.redo();
            expect(bytes(session), label).toEqual(after);
            expect(session.selection, label).toBe(landed);
            assertInvariants(session);
        }
        // The cases cover each path.
        expect(applied).toBeGreaterThan(150);
        expect(cancelled).toBeGreaterThan(60);
        expect(offCanvas).toBeGreaterThan(10);
    });
});
