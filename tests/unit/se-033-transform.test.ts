import { describe, expect, it } from "vitest";
import {
    contentOfImage,
    flipContent,
    FloatingSelection,
    normalizeAngle,
    renderTransform,
    rotateBox,
    rotateContent,
} from "../../src/core/floating";
import type { FloatingContent, FreeTransform } from "../../src/core/floating";
import { History } from "../../src/core/history";
import {
    assertInvariants,
    celAt,
    celKey,
    createDocument,
    sequentialIds,
} from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { createMask, maskHas, rectMask, selectionOf, setMaskPixel } from "../../src/core/selection";

// SE-033: the transforms of floating content (SPEC §7.2). Golden tests: flips and quarter
// turns are exact permutations, four quarter turns give the content back, a checker scaled 2×
// and then by ½ is the original, and a turn by an angle that is not a right angle only shows
// colours of the source (nearest-neighbour). The expected buffers are worked out here pixel by
// pixel from the definitions, not by the module. Then the float of `core/floating` with its
// transforms: one undo step on apply, the cel byte-identical on cancel, clipped on apply.

/** Content whose every pixel differs from every other, with a hole in its mask. */
function content(width: number, height: number, hole = true): FloatingContent {
    const data = new Uint8ClampedArray(width * height * 4);
    const mask = createMask(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const inMask = !hole || x !== 1 || y !== 0;
            if (inMask) {
                data.set(
                    [10 + x * 17, 20 + y * 23, (x * 31 + y * 7) & 255, 255],
                    (y * width + x) * 4,
                );
                setMaskPixel(mask, x, y);
            }
        }
    }
    return { pixels: { width, height, data }, mask };
}

function pixel(c: FloatingContent, x: number, y: number): number[] {
    const at = (y * c.pixels.width + x) * 4;
    return Array.from(c.pixels.data.slice(at, at + 4));
}

/** `width × height` content built pixel by pixel from `source(x, y)`: [x, y] of the source. */
function mapped(
    from: FloatingContent,
    width: number,
    height: number,
    source: (x: number, y: number) => [number, number],
): FloatingContent {
    const data = new Uint8ClampedArray(width * height * 4);
    const mask = createMask(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [sx, sy] = source(x, y);
            data.set(pixel(from, sx, sy), (y * width + x) * 4);
            if (maskHas(from.mask, sx, sy)) setMaskPixel(mask, x, y);
        }
    }
    return { pixels: { width, height, data }, mask };
}

function same(a: FloatingContent, b: FloatingContent): void {
    expect(a.pixels.width).toBe(b.pixels.width);
    expect(a.pixels.height).toBe(b.pixels.height);
    expect(Array.from(a.pixels.data)).toEqual(Array.from(b.pixels.data));
    expect(Array.from(a.mask.data)).toEqual(Array.from(b.mask.data));
}

/** Every distinct RGBA of a content's mask, as strings. */
function colours(c: FloatingContent): Set<string> {
    const found = new Set<string>();
    for (let y = 0; y < c.pixels.height; y++) {
        for (let x = 0; x < c.pixels.width; x++) {
            if (maskHas(c.mask, x, y)) found.add(pixel(c, x, y).join(","));
        }
    }
    return found;
}

describe("flips and quarter turns (golden)", () => {
    const source = content(5, 3);

    it("Flip Horizontal and Flip Vertical are exact permutations, and their own inverses", () => {
        const h = flipContent(source, "horizontal");
        same(
            h,
            mapped(source, 5, 3, (x, y) => [4 - x, y]),
        );
        const v = flipContent(source, "vertical");
        same(
            v,
            mapped(source, 5, 3, (x, y) => [x, 2 - y]),
        );
        same(flipContent(h, "horizontal"), source);
        same(flipContent(v, "vertical"), source);
    });

    it("Rotate 90° CW, 90° CCW and 180° are exact permutations; width and height swap", () => {
        const cw = rotateContent(source, 1);
        // Clockwise: the left column becomes the top row, read bottom to top.
        same(
            cw,
            mapped(source, 3, 5, (x, y) => [y, 2 - x]),
        );
        const ccw = rotateContent(source, -1);
        same(
            ccw,
            mapped(source, 3, 5, (x, y) => [4 - y, x]),
        );
        const half = rotateContent(source, 2);
        same(
            half,
            mapped(source, 5, 3, (x, y) => [4 - x, 2 - y]),
        );
        // 180° is both flips, and two quarter turns.
        same(half, flipContent(flipContent(source, "horizontal"), "vertical"));
        same(rotateContent(cw, 1), half);
        same(rotateContent(cw, -1), source);
    });

    it("four quarter turns either way give the original back, the box included", () => {
        let turned = source;
        let box = { x: 3, y: -2, width: 5, height: 2 };
        for (let turn = 0; turn < 4; turn++) {
            turned = rotateContent(turned, 1);
            box = rotateBox(box, 1);
        }
        same(turned, source);
        expect(box).toEqual({ x: 3, y: -2, width: 5, height: 2 });
        let back = source;
        for (let turn = 0; turn < 4; turn++) back = rotateContent(back, -1);
        same(back, source);
        // An odd difference of the sides: the corner moves by the truncated half of it.
        expect(rotateBox({ x: 0, y: 0, width: 5, height: 2 }, 1)).toEqual({
            x: 1,
            y: -1,
            width: 2,
            height: 5,
        });
        expect(rotateBox({ x: 0, y: 0, width: 4, height: 1 }, -1)).toEqual({
            x: 1,
            y: -1,
            width: 1,
            height: 4,
        });
    });
});

describe("the free transform (nearest-neighbour)", () => {
    /** A checker of 1 px cells in two colours. */
    function checker(width: number, height: number): FloatingContent {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                data.set(
                    (x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255],
                    (y * width + x) * 4,
                );
            }
        }
        return contentOfImage({ width, height, data });
    }

    it("is the source itself when it leaves the content as it is", () => {
        const source = content(4, 3);
        const rendered = renderTransform(source, { x: 2, y: 5, width: 4, height: 3, angle: 0 });
        expect(rendered.content).toBe(source);
        expect([rendered.x, rendered.y]).toEqual([2, 5]);
    });

    it("scales a checker by 2 and the result by ½: the original, pixel for pixel", () => {
        const source = checker(6, 4);
        const twice = renderTransform(source, { x: 0, y: 0, width: 12, height: 8, angle: 0 });
        // Each source pixel becomes a 2 × 2 block.
        same(
            twice.content,
            mapped(source, 12, 8, (x, y) => [x >> 1, y >> 1]),
        );
        const back = renderTransform(twice.content, { x: 0, y: 0, width: 6, height: 4, angle: 0 });
        same(back.content, source);
    });

    it("a box scaled to the source's size again renders the source anew, nothing lost", () => {
        const { session, history, target } = setUp();
        const float = FloatingSelection.lift(history, {
            ...target,
            selection: selectionOf(rectMask(W, H, { x: 1, y: 1, width: 3, height: 2 })),
        });
        const lifted = Array.from(float.content.pixels.data);
        float.setTransform({ x: 1, y: 1, width: 6, height: 4, angle: 0 });
        expect(float.content.pixels.width).toBe(6);
        float.setTransform({ x: 1, y: 1, width: 1, height: 1, angle: 37 });
        float.setTransform({ x: 1, y: 1, width: 3, height: 2, angle: 0 });
        expect(Array.from(float.content.pixels.data)).toEqual(lifted);
        float.cancel();
        expect(session.selection).toBeNull();
    });

    it("turned by an angle that is not a right angle, it shows only colours of the source", () => {
        const source = content(7, 5, false);
        const allowed = colours(source);
        for (const angle of [10, 30, 45, -60, 137, 179]) {
            const rendered = renderTransform(source, { x: 0, y: 0, width: 7, height: 5, angle });
            const found = colours(rendered.content);
            expect(found.size).toBeGreaterThan(0);
            for (const colour of found) expect(allowed.has(colour)).toBe(true);
            // And a pixel outside the mask is transparent.
            const { pixels, mask } = rendered.content;
            for (let y = 0; y < pixels.height; y++) {
                for (let x = 0; x < pixels.width; x++) {
                    if (!maskHas(mask, x, y))
                        expect(pixel(rendered.content, x, y)).toEqual([0, 0, 0, 0]);
                }
            }
        }
        // Scaled and turned at once, a checker keeps its two colours only.
        const scaled = renderTransform(checker(4, 4), {
            x: 0,
            y: 0,
            width: 9,
            height: 5,
            angle: 22,
        });
        expect([...colours(scaled.content)].sort()).toEqual(["0,0,255,255", "255,0,0,255"]);
    });

    it("a square box typed at 90° gives the quarter turn exactly", () => {
        const source = content(4, 4);
        const typed = renderTransform(source, { x: 2, y: 3, width: 4, height: 4, angle: 90 });
        same(typed.content, rotateContent(source, 1));
        expect([typed.x, typed.y]).toEqual([2, 3]);
        const back = renderTransform(source, { x: 2, y: 3, width: 4, height: 4, angle: -90 });
        same(back.content, rotateContent(source, -1));
        const half = renderTransform(source, { x: 2, y: 3, width: 4, height: 4, angle: 180 });
        same(half.content, rotateContent(source, 2));
    });

    it("angles are kept in (−180, 180]", () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
        expect(normalizeAngle(-180)).toBe(180);
        expect(normalizeAngle(270)).toBe(-90);
        expect(normalizeAngle(-450)).toBe(-90);
        expect(normalizeAngle(540)).toBe(180);
        expect(() => normalizeAngle(Number.NaN)).toThrow(RangeError);
    });
});

const W = 8;
const H = 6;

function image(): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            data.set([10 + x * 20, 10 + y * 30, (x * 7 + y * 13) & 255, 255], (y * W + x) * 4);
        }
    }
    return { width: W, height: H, data };
}

function setUp() {
    const session: DocSession = createDocument(
        { name: "t", width: W, height: H },
        sequentialIds("t-"),
    );
    session.doc.images.set("img", image());
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "img",
        opacity: 255,
    });
    const history = new History(session);
    const target = { layerId: session.activeLayerId, frameId: session.activeFrameId };
    return { session, history, target };
}

function bytes(session: DocSession): number[] {
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId)!;
    return Array.from(session.doc.images.get(cel.imageId)!.data);
}

function rgba(data: number[], x: number, y: number): number[] {
    return data.slice((y * W + x) * 4, (y * W + x) * 4 + 4);
}

describe("a float transformed (core/floating)", () => {
    const rect = { x: 2, y: 1, width: 3, height: 2 };

    it("flipped in place and applied: the selected pixels mirrored, one undo step; undo restores", () => {
        const { session, history, target } = setUp();
        const before = bytes(session);
        const selection = selectionOf(rectMask(W, H, rect));
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.flip("horizontal");
        expect(float.transform).toEqual({ ...rect, angle: 0 });
        const command = float.apply();
        expect(command).not.toBeNull();
        expect(history.undoCount).toBe(1);
        const after = bytes(session);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inside = x >= 2 && x < 5 && y >= 1 && y < 3;
                expect(rgba(after, x, y)).toEqual(rgba(before, inside ? 2 + 4 - x : x, y));
            }
        }
        expect(session.selection?.bounds).toEqual(rect);
        history.undo();
        expect(bytes(session)).toEqual(before);
        assertInvariants(session);
    });

    it("turned 90° CW, scaled and turned freely, then cancelled: the cel byte-identical, the selection as before", () => {
        const { session, history, target } = setUp();
        const before = bytes(session);
        const selection = selectionOf(rectMask(W, H, rect));
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.rotate(1);
        // 3 × 2 turned about its centre (3.5, 2): 2 × 3, the corner moved by the truncated half.
        expect(float.transform).toEqual({ x: 2, y: 1, width: 2, height: 3, angle: 0 });
        float.setTransform({ x: 1, y: 0, width: 5, height: 5, angle: 30 });
        expect(bytes(session)).not.toEqual(before);
        float.cancel();
        expect(bytes(session)).toEqual(before);
        expect(session.selection).toBe(selection);
        expect(history.undoCount).toBe(0);
        expect(history.transaction).toBeNull();
    });

    it("scaled past the canvas and applied: clipped to it; the selection is what lies on it", () => {
        const { session, history, target } = setUp();
        const before = bytes(session);
        const selection = selectionOf(rectMask(W, H, rect));
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        const transform: FreeTransform = { x: 4, y: 3, width: 6, height: 4, angle: 0 };
        float.setTransform(transform);
        float.apply();
        const after = bytes(session);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (x >= 4 && y >= 3) {
                    // 2× of the source, nearest: source pixel (2 + ⌊(x − 4) / 2⌋, 1 + ⌊(y − 3) / 2⌋).
                    const sx = 2 + ((x - 4) >> 1);
                    const sy = 1 + ((y - 3) >> 1);
                    expect(rgba(after, x, y)).toEqual(rgba(before, sx, sy));
                } else if (x >= 2 && x < 5 && y >= 1 && y < 3) {
                    expect(rgba(after, x, y)).toEqual([0, 0, 0, 0]);
                } else {
                    expect(rgba(after, x, y)).toEqual(rgba(before, x, y));
                }
            }
        }
        expect(session.selection?.bounds).toEqual({ x: 4, y: 3, width: 4, height: 3 });
        expect(history.undoCount).toBe(1);
    });

    it("refuses a box that is not whole, empty or too large, and stays as it was", () => {
        const { session, history, target } = setUp();
        const selection = selectionOf(rectMask(W, H, rect));
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        const shown = bytes(session);
        expect(() => float.setTransform({ x: 0.5, y: 0, width: 3, height: 2, angle: 0 })).toThrow(
            RangeError,
        );
        expect(() => float.setTransform({ x: 0, y: 0, width: 0, height: 2, angle: 0 })).toThrow(
            RangeError,
        );
        expect(() => float.setTransform({ x: 0, y: 0, width: 4096, height: 2, angle: 0 })).toThrow(
            RangeError,
        );
        expect(() => float.rotate(0.5)).toThrow(RangeError);
        expect(float.transform).toEqual({ ...rect, angle: 0 });
        expect(bytes(session)).toEqual(shown);
        float.cancel();
    });

    it("a move carries the box: the transform's corner follows the content", () => {
        const { session, history, target } = setUp();
        const selection = selectionOf(rectMask(W, H, rect));
        session.selection = selection;
        const float = FloatingSelection.lift(history, { ...target, selection });
        float.setTransform({ x: 2, y: 1, width: 3, height: 2, angle: 45 });
        const { x, y } = float;
        float.moveBy(2, 1);
        expect(float.transform).toEqual({ x: 4, y: 2, width: 3, height: 2, angle: 45 });
        expect([float.x, float.y]).toEqual([x + 2, y + 1]);
        float.cancel();
    });
});
