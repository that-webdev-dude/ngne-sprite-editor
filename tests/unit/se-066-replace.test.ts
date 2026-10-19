import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import { assertInvariants, celKey } from "../../src/core/model";
import type { DocSession, ReferenceLayer, SpriteDoc } from "../../src/core/model";
import { replaceColourCommand } from "../../src/core/palettes";
import type { ReplaceColourOptions, ReplaceScope } from "../../src/core/palettes";
import { createMask, selectionOf, setMaskRun } from "../../src/core/selection";
import { FRAME, addFrame, celImage, imageBytes, layerId, setCel, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

// SE-066: Replace Colour of `core/palettes` — every pixel of one colour, within a tolerance,
// becomes another in the selection, the cel, the frame or the sprite, as one undo step that
// changes only the matching pixels of the layers paint may go to.

const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const NEAR_RED: Rgba = [250, 4, 3, 255];
const RED_HEX = 0xff0000ff;
const BLUE_HEX = 0x0000ffff;

const FRAME_1 = "frame-1";

/** 2 × 2 cels: red and green on layer 0 at both frames, red on layers 1 and 2. */
function scene(): DocSession {
    const doc = sprite(2, 2, [
        { pixels: [RED, GREEN, NEAR_RED, CLEAR] },
        { pixels: [GREEN, RED, RED, RED] },
        { pixels: [RED, RED, CLEAR, GREEN] },
    ]);
    addFrame(doc, FRAME_1);
    setCel(doc, layerId(0), FRAME_1, [RED, RED, GREEN, GREEN]);
    setCel(doc, layerId(1), FRAME_1, [GREEN, GREEN, RED, CLEAR]);
    const session = { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
    assertInvariants(session);
    return session;
}

/** Every cel image's bytes, by image id. */
function snapshot(doc: SpriteDoc): Map<string, number[]> {
    return new Map([...doc.images].map(([id, image]) => [id, Array.from(image.data)]));
}

function pixels(doc: SpriteDoc, layer: number, frame = FRAME): number[][] {
    const { data } = celImage(doc, layerId(layer), frame);
    return Array.from({ length: data.length / 4 }, (_, at) =>
        Array.from(data.subarray(at * 4, at * 4 + 4)),
    );
}

function options(
    scope: ReplaceScope,
    more: Partial<ReplaceColourOptions> = {},
): ReplaceColourOptions {
    return { from: RED_HEX, to: BLUE_HEX, tolerance: 0, scope, ...more };
}

/** Executes the replacement and checks that it is one undo step that undo reverses exactly. */
function replace(session: DocSession, values: ReplaceColourOptions) {
    const before = snapshot(session.doc);
    const result = replaceColourCommand(session, values);
    if ("refused" in result) throw new Error(`refused: ${result.refused}`);
    if (!result.command) return { result, history: null };
    const history = new History(session);
    history.execute(result.command);
    const after = snapshot(session.doc);
    expect(history.undoCount).toBe(1);
    expect(history.undoLabel).toBe("Replace Colour");
    history.undo();
    expect(snapshot(session.doc)).toEqual(before);
    history.redo();
    expect(snapshot(session.doc)).toEqual(after);
    assertInvariants(session);
    return { result, history };
}

describe("scopes", () => {
    it("sprite: one undo step that changes only the matching pixels of every cel", () => {
        const session = scene();
        const { result } = replace(session, options("sprite"));
        expect(result.pixels).toBe(9);
        expect(result.images).toBe(5);
        const { doc } = session;
        expect(pixels(doc, 0)).toEqual([BLUE, GREEN, NEAR_RED, CLEAR]);
        expect(pixels(doc, 1)).toEqual([GREEN, BLUE, BLUE, BLUE]);
        expect(pixels(doc, 2)).toEqual([BLUE, BLUE, CLEAR, GREEN]);
        expect(pixels(doc, 0, FRAME_1)).toEqual([BLUE, BLUE, GREEN, GREEN]);
        expect(pixels(doc, 1, FRAME_1)).toEqual([GREEN, GREEN, BLUE, CLEAR]);
        // The composite of every changed cel can differ: its frames and layers are touched.
        expect(result.command?.touched).toEqual({
            frameIds: [FRAME, FRAME_1],
            layerIds: [layerId(0), layerId(1), layerId(2)],
            structure: false,
        });
    });

    it("frame: every cel of the active frame, no other frame", () => {
        const session = scene();
        session.activeFrameId = FRAME_1;
        const before = snapshot(session.doc);
        const { result } = replace(session, options("frame"));
        expect(result.pixels).toBe(3);
        expect(pixels(session.doc, 0, FRAME_1)).toEqual([BLUE, BLUE, GREEN, GREEN]);
        expect(pixels(session.doc, 1, FRAME_1)).toEqual([GREEN, GREEN, BLUE, CLEAR]);
        for (const layer of [0, 1, 2]) {
            const id = session.doc.cels.get(celKey(layerId(layer), FRAME))!.imageId;
            expect(Array.from(session.doc.images.get(id)!.data)).toEqual(before.get(id));
        }
        expect(result.command?.touched.frameIds).toEqual([FRAME_1]);
    });

    it("cel: the active layer's cel at the active frame only", () => {
        const session = scene();
        session.activeLayerId = layerId(1);
        const before = snapshot(session.doc);
        const { result } = replace(session, options("cel"));
        expect(result.pixels).toBe(3);
        expect(pixels(session.doc, 1)).toEqual([GREEN, BLUE, BLUE, BLUE]);
        const changed = session.doc.cels.get(celKey(layerId(1), FRAME))!.imageId;
        for (const [id, bytes] of snapshot(session.doc)) {
            if (id !== changed) expect(bytes, id).toEqual(before.get(id));
        }
        expect(result.command?.touched).toEqual({
            frameIds: [FRAME],
            layerIds: [layerId(1)],
            structure: false,
        });
    });

    it("selection: pixels outside the selection are untouched", () => {
        const session = scene();
        session.activeLayerId = layerId(1);
        // The right column of the 2 × 2 canvas.
        const mask = createMask(2, 2);
        setMaskRun(mask, 0, 1, 2);
        setMaskRun(mask, 1, 1, 2);
        session.selection = selectionOf(mask);
        const before = snapshot(session.doc);
        const { result } = replace(session, options("selection"));
        expect(result.pixels).toBe(2);
        // (0, 1) is red and outside: it stays red.
        expect(pixels(session.doc, 1)).toEqual([GREEN, BLUE, RED, BLUE]);
        const changed = session.doc.cels.get(celKey(layerId(1), FRAME))!.imageId;
        for (const [id, bytes] of snapshot(session.doc)) {
            if (id !== changed) expect(bytes, id).toEqual(before.get(id));
        }
    });

    it("selection: a pixel inside the selection's bounds but not selected is untouched", () => {
        const session = scene();
        session.activeLayerId = layerId(1);
        // The diagonal (1, 0) and (0, 1): its bounds are the whole canvas.
        const mask = createMask(2, 2);
        setMaskRun(mask, 0, 1, 2);
        setMaskRun(mask, 1, 0, 1);
        session.selection = selectionOf(mask);
        expect(session.selection?.bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
        const { result } = replace(session, options("selection"));
        expect(result.pixels).toBe(2);
        // (1, 1) is red, inside the bounds and not selected: it stays red.
        expect(pixels(session.doc, 1)).toEqual([GREEN, BLUE, BLUE, RED]);
    });

    it("selection without a selection is refused", () => {
        expect(replaceColourCommand(scene(), options("selection"))).toEqual({
            refused: "no-selection",
        });
    });
});

describe("layers", () => {
    it("the frame and the sprite skip locked and hidden layers; the cel and the selection refuse them", () => {
        for (const property of ["locked", "visible"] as const) {
            const session = scene();
            const layer = session.doc.layers[1];
            if (property === "locked") layer.locked = true;
            else layer.visible = false;
            const before = snapshot(session.doc);
            replace(session, options("sprite"));
            for (const frame of [FRAME, FRAME_1]) {
                const id = session.doc.cels.get(celKey(layerId(1), frame))!.imageId;
                expect(Array.from(session.doc.images.get(id)!.data), property).toEqual(
                    before.get(id),
                );
            }
            expect(pixels(session.doc, 0)[0], property).toEqual(BLUE);

            const other = scene();
            other.doc.layers[0][property] = property === "locked";
            other.selection = selectionOf(createMask(2, 2)) ?? {
                mask: createMask(2, 2),
                bounds: { x: 0, y: 0, width: 2, height: 2 },
            };
            const reason = property === "locked" ? "locked" : "hidden";
            expect(replaceColourCommand(other, options("cel"))).toEqual({ refused: reason });
            expect(replaceColourCommand(other, options("selection"))).toEqual({ refused: reason });
        }
    });

    it("a reference layer as the active layer is refused; in the sprite it is no target", () => {
        const session = scene();
        const reference: ReferenceLayer = {
            id: "ref",
            name: "ref",
            kind: "reference",
            visible: true,
            locked: false,
            opacity: 255,
            sourceId: "source",
            x: 0,
            y: 0,
            scale: 1,
            placement: "behind",
        };
        session.doc.layers.push(reference);
        session.activeLayerId = "ref";
        expect(replaceColourCommand(session, options("cel"))).toEqual({ refused: "reference" });
        session.activeLayerId = "gone";
        expect(replaceColourCommand(session, options("cel"))).toEqual({ refused: "missing" });
        const result = replaceColourCommand(session, options("sprite"));
        expect("refused" in result ? null : result.pixels).toBe(9);
    });

    it("an empty cel is skipped and no cel is made, even for a transparent colour", () => {
        const session = scene();
        session.doc.cels.delete(celKey(layerId(2), FRAME));
        session.doc.images.delete(`image-${layerId(2)}-${FRAME}`);
        const cels = session.doc.cels.size;
        const { result } = replace(session, options("sprite", { from: 0x00000000 }));
        // The transparent pixels of the cels there are: layer 0 and layer 1 at frame 1.
        expect(result.pixels).toBe(2);
        expect(session.doc.cels.size).toBe(cels);
        expect(session.doc.cels.has(celKey(layerId(2), FRAME))).toBe(false);
    });
});

describe("linked cels", () => {
    function linked(): DocSession {
        const session = scene();
        // Layer 0 at frame 1 shows the image of layer 0 at frame 0.
        session.doc.images.delete(`image-${layerId(0)}-${FRAME_1}`);
        session.doc.cels.set(celKey(layerId(0), FRAME_1), {
            imageId: `image-${layerId(0)}-${FRAME}`,
            opacity: 255,
        });
        assertInvariants(session);
        return session;
    }

    it("a shared image changes once, and every cel that shows it shows the change", () => {
        const session = linked();
        const { result } = replace(session, options("cel"));
        expect(result.images).toBe(1);
        expect(result.pixels).toBe(1);
        expect(pixels(session.doc, 0, FRAME_1)).toEqual([BLUE, GREEN, NEAR_RED, CLEAR]);
        expect(result.command?.touched).toEqual({
            frameIds: [FRAME, FRAME_1],
            layerIds: [layerId(0)],
            structure: false,
        });
        const sprite = linked();
        const all = replace(sprite, options("sprite")).result;
        // The shared image counts once: 9 pixels less the 2 of the image it replaced.
        expect(all.images).toBe(4);
        expect(all.pixels).toBe(7);
    });

    it("an image a locked layer shows as well is left as it is", () => {
        const session = scene();
        // Layer 2 (locked) at frame 1 shows layer 0's image of frame 0.
        session.doc.cels.set(celKey(layerId(2), FRAME_1), {
            imageId: `image-${layerId(0)}-${FRAME}`,
            opacity: 255,
        });
        session.doc.layers[2].locked = true;
        assertInvariants(session);
        const { result } = replace(session, options("sprite"));
        expect(pixels(session.doc, 0)).toEqual([RED, GREEN, NEAR_RED, CLEAR]);
        expect(pixels(session.doc, 0, FRAME_1)).toEqual([BLUE, BLUE, GREEN, GREEN]);
        // Layer 0's own image of frame 1 and the cels of layer 1.
        expect(result.images).toBe(3);
    });
});

describe("matching", () => {
    it("tolerance compares each channel, alpha included", () => {
        const session = scene();
        const { result } = replace(session, options("cel", { tolerance: 5 }));
        expect(pixels(session.doc, 0)).toEqual([BLUE, GREEN, BLUE, CLEAR]);
        expect(result.pixels).toBe(2);
        const strict = scene();
        replace(strict, options("cel", { tolerance: 4 }));
        expect(pixels(strict.doc, 0)).toEqual([BLUE, GREEN, NEAR_RED, CLEAR]);
        // Alpha differs by 128 (red and near red): matched only from 128 on.
        const half = scene();
        expect(
            replace(half, options("cel", { from: 0xff00007f, tolerance: 127 })).result.pixels,
        ).toBe(0);
        expect(
            replace(half, options("cel", { from: 0xff00007f, tolerance: 128 })).result.pixels,
        ).toBe(2);
    });

    it("a pixel of alpha 0 is 0,0,0,0, and a replacement of alpha 0 is written as 0,0,0,0", () => {
        const session = scene();
        const image = celImage(session.doc, layerId(0), FRAME);
        // A transparent pixel holding colour.
        image.data.set([9, 8, 7, 0], 12);
        const { result } = replace(session, options("cel", { from: 0x12345600, to: 0x00ff0080 }));
        expect(result.pixels).toBe(1);
        expect(pixels(session.doc, 0)[3]).toEqual([0, 255, 0, 128]);
        const erase = scene();
        replace(erase, options("cel", { to: 0xabcdef00 }));
        expect(pixels(erase.doc, 0)[0]).toEqual(CLEAR);
    });

    it("makes no command when no pixel changes: none matches, or each is the replacement already", () => {
        const session = scene();
        const none = replaceColourCommand(session, options("sprite", { from: 0x123456ff }));
        expect(none).toEqual({ command: null, pixels: 0, images: 0 });
        const same = replaceColourCommand(session, options("sprite", { to: RED_HEX }));
        expect(same).toEqual({ command: null, pixels: 0, images: 0 });
    });

    it("keeps the pixels of the changed rectangle only", () => {
        const doc = sprite(8, 8, [{ pixels: Array.from({ length: 64 }, () => GREEN) }]);
        const image = celImage(doc, layerId(0), FRAME);
        image.data.set(RED, (2 * 8 + 3) * 4);
        image.data.set(RED, (4 * 8 + 5) * 4);
        const session = { doc, selection: null, activeLayerId: layerId(0), activeFrameId: FRAME };
        const result = replaceColourCommand(session, options("cel"));
        if ("refused" in result) throw new Error("refused");
        // 3 × 3 pixels before and after.
        expect(result.command?.bytes).toBe(2 * 3 * 3 * 4);
    });

    it("refuses colours and tolerances out of range", () => {
        const session = scene();
        for (const bad of [
            { from: -1 },
            { to: 0x1_0000_0000 },
            { tolerance: -1 },
            { tolerance: 256 },
            { tolerance: 1.5 },
        ]) {
            expect(() => replaceColourCommand(session, options("sprite", bad))).toThrow(RangeError);
        }
    });

    it("equals a pixel-by-pixel reference on any cel, colour and tolerance", () => {
        const size = 3;
        fc.assert(
            fc.property(
                imageBytes(size * size),
                fc.integer({ min: 0, max: 0xffffffff }),
                fc.integer({ min: 0, max: 0xffffffff }),
                fc.integer({ min: 0, max: 255 }),
                (bytes, from, to, tolerance) => {
                    const doc = sprite(size, size, [{ pixels: bytes }]);
                    const session = {
                        doc,
                        selection: null,
                        activeLayerId: layerId(0),
                        activeFrameId: FRAME,
                    };
                    const result = replaceColourCommand(session, {
                        from,
                        to,
                        tolerance,
                        scope: "cel",
                    });
                    if ("refused" in result) throw new Error("refused");
                    if (result.command) new History(session).execute(result.command);
                    const norm = (value: number) => ((value & 0xff) === 0 ? 0 : value >>> 0);
                    const source = norm(from);
                    const target = norm(to);
                    const out = celImage(doc, layerId(0), FRAME).data;
                    let changed = 0;
                    for (let at = 0; at < bytes.length; at += 4) {
                        const a = bytes[at + 3];
                        const pixel =
                            a === 0 ? [0, 0, 0, 0] : Array.from(bytes.subarray(at, at + 4));
                        const wanted = [
                            source >>> 24,
                            (source >>> 16) & 0xff,
                            (source >>> 8) & 0xff,
                            source & 0xff,
                        ];
                        const replacement = [
                            target >>> 24,
                            (target >>> 16) & 0xff,
                            (target >>> 8) & 0xff,
                            target & 0xff,
                        ];
                        const matches = pixel.every(
                            (value, index) => Math.abs(value - wanted[index]) <= tolerance,
                        );
                        const differs = pixel.some((value, index) => value !== replacement[index]);
                        const expected =
                            matches && differs
                                ? replacement
                                : Array.from(bytes.subarray(at, at + 4));
                        if (matches && differs) changed++;
                        expect(Array.from(out.subarray(at, at + 4))).toEqual(expected);
                    }
                    expect(result.pixels).toBe(changed);
                },
            ),
            { numRuns: 200 },
        );
    });
});
