import { describe, expect, it } from "vitest";
import { AllocationError } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import {
    DOCUMENT_LIMITS,
    DocumentLimitError,
    DocumentSizeError,
    assertInvariants,
    celKey,
    createDocument,
} from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { flipPixels, rotatePixels } from "../../src/core/pixels";
import { rectMask, selectionOf } from "../../src/core/selection";
import type { SpriteOperationOptions } from "../../src/core/sprite";
import {
    PIVOT_PRESETS,
    canvasSizeCommand,
    contentBounds,
    cropToSelectionCommand,
    flipCanvasCommand,
    rotateCanvasCommand,
    spriteSizeCommand,
    trimCommand,
} from "../../src/core/sprite";
import {
    FRAMES,
    IMAGE_A,
    IMAGE_B,
    IMAGE_C,
    L1,
    L2,
    SIDE,
    expectSymmetric,
    fixture,
    historyOf,
    imageWith,
    made,
    patterned,
    pixelAt,
    reference,
    snapshot,
} from "./se-034-support";

// SE-034: the sprite operations of SPEC §7.7 over every image of a document.

type Make = (session: DocSession, options?: SpriteOperationOptions) => Command | null;

/**
 * Every operation, made for the fixture: each changes it. The third entry is the fixture's
 * pivot (0.25, 1) afterwards: over the same content, normalized to the new canvas.
 */
const OPERATIONS: [string, Make, { x: number; y: number }][] = [
    [
        "canvas size",
        (session, options) =>
            canvasSizeCommand(session, { width: 48, height: 40, anchor: { x: 1, y: 0 } }, options),
        // Pixel (8, 32) moves by (16, 0): (24 / 48, 32 / 40).
        { x: 0.5, y: 0.8 },
    ],
    [
        "sprite size, nearest",
        (session, options) =>
            spriteSizeCommand(session, { width: 64, height: 16, method: "nearest" }, options),
        { x: 0.25, y: 1 },
    ],
    [
        "sprite size, area",
        (session, options) =>
            spriteSizeCommand(session, { width: 16, height: 16, method: "area" }, options),
        { x: 0.25, y: 1 },
    ],
    [
        "crop to selection",
        (session, options) => cropToSelectionCommand(session, options),
        // Pixel (8, 32) in the crop (2, 3, 10, 12): (6 / 10, 29 / 12 clamped to 1).
        { x: 0.6, y: 1 },
    ],
    [
        "trim",
        (session, options) => trimCommand(session, options),
        // Pixel (8, 32) in the trim (4, 2, 24, 28): (4 / 24, 30 / 28 clamped to 1).
        { x: 4 / 24, y: 1 },
    ],
    [
        "rotate canvas 90°",
        (session, options) => rotateCanvasCommand(session, 90, options),
        { x: 0, y: 0.25 },
    ],
    [
        "rotate canvas 180°",
        (session, options) => rotateCanvasCommand(session, 180, options),
        { x: 0.75, y: 0 },
    ],
    [
        "rotate canvas 90° CCW",
        (session, options) => rotateCanvasCommand(session, 270, options),
        { x: 1, y: 0.75 },
    ],
    [
        "flip canvas horizontal",
        (session, options) => flipCanvasCommand(session, "horizontal", options),
        { x: 0.75, y: 1 },
    ],
    [
        "flip canvas vertical",
        (session, options) => flipCanvasCommand(session, "vertical", options),
        { x: 0.25, y: 0 },
    ],
];

/** A snapshot without its selection. */
function withoutSelection(state: ReturnType<typeof snapshot>) {
    return { ...state, selection: undefined };
}

describe("each sprite operation", () => {
    it.each(OPERATIONS)(
        "%s: do and undo are symmetric on layers, frames, linked cels, the selection and the pivot",
        (_, make, pivot) => {
            const session = fixture();
            const before = snapshot(session);
            const after = expectSymmetric(session, made(make(session)));

            // Cleared by the command, restored by undo (expectSymmetric compares the selection).
            expect(before.selection).not.toBeNull();
            expect(after.selection).toBeNull();
            // Links preserved: the cels name the same images, so frames 1 and 2 of L1 share one.
            expect(after.doc.cels).toEqual(before.doc.cels);
            expect(after.doc.images.map(([id]) => id)).toEqual([IMAGE_A, IMAGE_B, IMAGE_C]);
            // Every image has the document's size afterwards ("cel-image-size" also holds).
            for (const [, width, height] of after.doc.images) {
                expect([width, height]).toEqual([after.doc.width, after.doc.height]);
            }
            // The pivot stays over the same content and normalized; undo restored it exactly
            // (expectSymmetric). The rest of the document is left alone.
            expect(before.doc.pivot).toEqual({ x: 0.25, y: 1 });
            expect(after.doc.pivot).toEqual(pivot);
            expect(after.doc.frames).toEqual(before.doc.frames);
            expect(after.doc.tags).toEqual(before.doc.tags);
            expect([after.activeLayerId, after.activeFrameId]).toEqual([L2, FRAMES[1]]);
        },
    );

    it.each(OPERATIONS)(
        "%s: one history entry, touching every frame and layer, structure",
        (_, make) => {
            const session = fixture();
            const command = made(make(session));
            expect(command.touched).toEqual({
                frameIds: [...FRAMES],
                layerIds: session.doc.layers.map((layer) => layer.id),
                structure: true,
            });
            const history = historyOf(session);
            history.execute(command);
            expect(history.undoCount).toBe(1);
            expect(history.undoLabel).toBe(command.label);
            // While done it keeps the old images: three of 32 × 32.
            expect(history.bytes).toBe(3 * SIDE * SIDE * 4);
        },
    );

    it.each(OPERATIONS)("%s: a failed allocation leaves the session as it was", (_, make) => {
        const session = fixture();
        const before = snapshot(session);
        let calls = 0;
        // Fails at the second of the three images.
        const allocate = (bytes: number) => {
            if (++calls === 2) throw new RangeError("out of memory");
            return new Uint8ClampedArray(bytes);
        };
        const history = historyOf(session);
        expect(() => history.execute(made(make(session, { allocate })))).toThrow(AllocationError);
        expect(snapshot(session)).toEqual(before);
        expect(history.undoCount).toBe(0);
    });

    it("the invariant 'every image has the document's dimensions' holds after a chain of them and their undo", () => {
        const session = fixture();
        const history = historyOf(session);
        const start = snapshot(session);
        for (const [, make] of OPERATIONS) {
            // Crop needs a selection; the others cleared it.
            if (!session.selection) {
                history.execute(selectionStep(session));
            }
            const command = make(session);
            if (command) history.execute(command);
            assertInvariants(session);
        }
        while (history.undo()) assertInvariants(session);
        expect(snapshot(session)).toEqual(start);
    });
});

/** A selection of a corner of the canvas, as a command. */
function selectionStep(session: DocSession): Command {
    const { width, height } = session.doc;
    const next = selectionOf(rectMask(width, height, { x: 0, y: 0, width: 2, height: 2 }));
    let previous = session.selection;
    return {
        label: "Select",
        bytes: 0,
        touched: { frameIds: [], layerIds: [], structure: false },
        do(target) {
            previous = target.selection;
            target.selection = next;
        },
        undo(target) {
            target.selection = previous;
        },
    };
}

describe("canvas size", () => {
    it("32→48 anchored centre places old content at offset (8, 8) in every cel; a reference layer's x, y increase by 8", () => {
        const session = fixture();
        const old = new Map(
            [...session.doc.images].map(([id, image]) => [id, Array.from(image.data)] as const),
        );
        historyOf(session).execute(
            made(canvasSizeCommand(session, { width: 48, height: 48, anchor: { x: 0.5, y: 0.5 } })),
        );
        const { doc } = session;
        expect([doc.width, doc.height]).toEqual([48, 48]);
        for (const [id, image] of doc.images) {
            const before = old.get(id) ?? [];
            for (let y = 0; y < 48; y++) {
                for (let x = 0; x < 48; x++) {
                    const inside = x >= 8 && x < 40 && y >= 8 && y < 40;
                    const at = ((y - 8) * SIDE + (x - 8)) * 4;
                    const expected = inside ? before.slice(at, at + 4) : [0, 0, 0, 0];
                    expect(pixelAt(image, x, y), `${id} (${x}, ${y})`).toEqual(expected);
                }
            }
        }
        expect(reference(doc)).toMatchObject({ x: 3.5 + 8, y: -2 + 8, scale: 0.5 });
    });

    it.each(PIVOT_PRESETS.map((preset) => [preset.name, preset.pivot] as const))(
        "anchor %s: 5×3 → 16×9 puts old (0, 0) at (trunc(ax·11), trunc(ay·6)), moves a reference layer by as much, and shrinking back gives the original",
        (_, anchor) => {
            const session = createDocument({ name: "a", width: 5, height: 3 });
            session.doc.images.set("i", patterned(5, 3, 1));
            session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
                imageId: "i",
                opacity: 255,
            });
            session.doc.layers.push({
                id: "ref",
                name: "Ref",
                kind: "reference",
                visible: true,
                locked: false,
                opacity: 128,
                sourceId: "s",
                x: 0.5,
                y: -1,
                scale: 2,
                placement: "behind",
            });
            const dx = Math.trunc(anchor.x * 11);
            const dy = Math.trunc(anchor.y * 6);
            const history = historyOf(session);
            history.execute(made(canvasSizeCommand(session, { width: 16, height: 9, anchor })));
            const image = session.doc.images.get("i");
            if (!image) throw new Error("no image");
            // Pixel (x, y) of the old canvas carries (x, y, 1, 255).
            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 5; x++) {
                    expect(pixelAt(image, x + dx, y + dy)).toEqual([x, y, 1, 255]);
                }
            }
            expect(reference(session.doc, "ref")).toMatchObject({
                x: 0.5 + dx,
                y: -1 + dy,
                scale: 2,
            });
            // Back to 5 × 3 with the same anchor gives the original.
            history.execute(made(canvasSizeCommand(session, { width: 5, height: 3, anchor })));
            expect(Array.from(session.doc.images.get("i")?.data ?? [])).toEqual(
                Array.from(patterned(5, 3, 1).data),
            );
            expect(reference(session.doc, "ref")).toMatchObject({ x: 0.5, y: -1, scale: 2 });
        },
    );

    it("an odd difference: growing by one pixel and shrinking back gives the original", () => {
        const session = createDocument({ name: "a", width: 4, height: 3 });
        session.doc.images.set("i", patterned(4, 3, 7));
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "i",
            opacity: 255,
        });
        const centre = { x: 0.5, y: 0.5 };
        const history = historyOf(session);
        history.execute(made(canvasSizeCommand(session, { width: 5, height: 4, anchor: centre })));
        history.execute(made(canvasSizeCommand(session, { width: 4, height: 3, anchor: centre })));
        expect(Array.from(session.doc.images.get("i")?.data ?? [])).toEqual(
            Array.from(patterned(4, 3, 7).data),
        );
    });

    it("the same size is no command; a size outside 1..1024 or an anchor outside 0..1 is refused", () => {
        const session = fixture();
        const before = snapshot(session);
        const centre = { x: 0.5, y: 0.5 };
        expect(
            canvasSizeCommand(session, { width: SIDE, height: SIDE, anchor: centre }),
        ).toBeNull();
        for (const [width, height] of [
            [0, 32],
            [32, 1025],
            [12.5, 32],
            [Number.NaN, 32],
        ]) {
            expect(() => canvasSizeCommand(session, { width, height, anchor: centre })).toThrow(
                DocumentSizeError,
            );
        }
        expect(() =>
            canvasSizeCommand(session, { width: 40, height: 40, anchor: { x: 2, y: 0 } }),
        ).toThrow(RangeError);
        expect(snapshot(session)).toEqual(before);
    });
});

describe("sprite size", () => {
    it("32→64 doubles a reference layer's x, y and scale", () => {
        const session = fixture();
        historyOf(session).execute(
            made(spriteSizeCommand(session, { width: 64, height: 64, method: "nearest" })),
        );
        expect([session.doc.width, session.doc.height]).toEqual([64, 64]);
        expect(reference(session.doc)).toMatchObject({ x: 7, y: -4, scale: 1 });
    });

    it("nearest doubles each pixel; area average weights colours by alpha", () => {
        const session = createDocument({ name: "a", width: 2, height: 2 });
        const image = patterned(2, 2, 9);
        session.doc.images.set("i", image);
        session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
            imageId: "i",
            opacity: 255,
        });
        const history = historyOf(session);
        history.execute(
            made(spriteSizeCommand(session, { width: 4, height: 4, method: "nearest" })),
        );
        const big = session.doc.images.get("i");
        if (!big) throw new Error("no image");
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                expect(pixelAt(big, x, y)).toEqual([x >> 1, y >> 1, 9, 255]);
            }
        }
        history.undo();

        // Area: a half-transparent red pixel beside a transparent one gives red at half the
        // alpha, not a darker red.
        const area = createDocument({ name: "b", width: 2, height: 1 });
        area.doc.images.set("j", {
            width: 2,
            height: 1,
            data: new Uint8ClampedArray([200, 0, 0, 128, 0, 0, 0, 0]),
        });
        area.doc.cels.set(celKey(area.activeLayerId, area.activeFrameId), {
            imageId: "j",
            opacity: 255,
        });
        historyOf(area).execute(
            made(spriteSizeCommand(area, { width: 1, height: 1, method: "area" })),
        );
        expect(Array.from(area.doc.images.get("j")?.data ?? [])).toEqual([200, 0, 0, 64]);
    });

    it("scales a reference layer by the factor of each axis, and its scale by their geometric mean", () => {
        const session = fixture();
        // 32 × 32 → 64 × 32: factors 2 and 1, geometric mean √2.
        historyOf(session).execute(
            made(spriteSizeCommand(session, { width: 64, height: 32, method: "nearest" })),
        );
        const layer = reference(session.doc);
        expect([layer.x, layer.y]).toEqual([3.5 * 2, -2]);
        expect(layer.scale).toBeCloseTo(0.5 * Math.SQRT2, 12);
    });

    it("the same size is no command; a size outside 1..1024 is refused", () => {
        const session = fixture();
        expect(
            spriteSizeCommand(session, { width: SIDE, height: SIDE, method: "area" }),
        ).toBeNull();
        expect(() =>
            spriteSizeCommand(session, { width: 2048, height: 32, method: "nearest" }),
        ).toThrow(DocumentSizeError);
    });
});

describe("crop to selection and trim", () => {
    it("crop keeps the selection's bounding rectangle and moves references with the content", () => {
        const session = fixture();
        const a = session.doc.images.get(IMAGE_A);
        if (!a) throw new Error("no image");
        const expected = pixelAt(a, 4, 6);
        historyOf(session).execute(made(cropToSelectionCommand(session)));
        expect([session.doc.width, session.doc.height]).toEqual([10, 12]);
        // (4, 6) of the old canvas is (2, 3) of the new.
        expect(pixelAt(session.doc.images.get(IMAGE_A) ?? a, 2, 3)).toEqual(expected);
        expect(reference(session.doc)).toMatchObject({ x: 1.5, y: -5, scale: 0.5 });
    });

    it("crop needs a selection, and one of the whole canvas changes nothing", () => {
        const session = fixture();
        session.selection = null;
        expect(cropToSelectionCommand(session)).toBeNull();
        session.selection = selectionOf(
            rectMask(SIDE, SIDE, { x: 0, y: 0, width: SIDE, height: SIDE }),
        );
        expect(cropToSelectionCommand(session)).toBeNull();
    });

    it("trim on a document whose content differs per frame trims to the union of all frames", () => {
        const session = fixture();
        // A: x 4..11, y 6..9 (frames 1, 2); B: x 20..27, y 2..5 (frame 3); C: x 10..13, y 20..29.
        expect(contentBounds(session.doc)).toEqual({ x: 4, y: 2, width: 24, height: 28 });
        historyOf(session).execute(made(trimCommand(session)));
        expect([session.doc.width, session.doc.height]).toEqual([24, 28]);
        // Each frame keeps its own content, moved by (-4, -2).
        const at = (id: string, x: number, y: number) =>
            pixelAt(session.doc.images.get(id) ?? patterned(1, 1, 0), x, y);
        expect(at(IMAGE_A, 0, 4)).toEqual([255, 0, 0, 255]);
        expect(at(IMAGE_B, 16, 0)).toEqual([0, 255, 0, 255]);
        expect(at(IMAGE_C, 6, 18)).toEqual([0, 0, 255, 255]);
        expect(at(IMAGE_C, 9, 27)).toEqual([0, 0, 255, 255]);
        expect(reference(session.doc)).toMatchObject({ x: -0.5, y: -4, scale: 0.5 });
        // Nothing left to trim.
        expect(trimCommand(session)).toBeNull();
    });

    it("trim of a document without content, or whose content reaches every edge, is no command", () => {
        const empty = createDocument({ name: "a", width: 8, height: 8 });
        expect(trimCommand(empty)).toBeNull();
        const full = createDocument({ name: "b", width: 8, height: 8 });
        full.doc.images.set("i", imageWith(8, 8, { x: 0, y: 0, width: 8, height: 8 }, [1, 2, 3]));
        full.doc.cels.set(celKey(full.activeLayerId, full.activeFrameId), {
            imageId: "i",
            opacity: 255,
        });
        expect(trimCommand(full)).toBeNull();
    });
});

describe("rotate and flip canvas", () => {
    it("rotate and flip are exact permutations of every image and leave reference layers untouched", () => {
        const cases: [
            Make,
            (image: ReturnType<typeof patterned>) => ReturnType<typeof patterned>,
        ][] = [
            [(s) => rotateCanvasCommand(s, 90), (image) => rotatePixels(image, 90)],
            [(s) => rotateCanvasCommand(s, 180), (image) => rotatePixels(image, 180)],
            [(s) => rotateCanvasCommand(s, 270), (image) => rotatePixels(image, 270)],
            [(s) => flipCanvasCommand(s, "horizontal"), (image) => flipPixels(image, "horizontal")],
            [(s) => flipCanvasCommand(s, "vertical"), (image) => flipPixels(image, "vertical")],
        ];
        for (const [make, expected] of cases) {
            const session = createDocument({ name: "a", width: 5, height: 3 });
            session.doc.images.set("i", patterned(5, 3, 3));
            session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
                imageId: "i",
                opacity: 255,
            });
            session.doc.layers.push({
                id: "ref",
                name: "Ref",
                kind: "reference",
                visible: true,
                locked: false,
                opacity: 128,
                sourceId: "s",
                x: 1.25,
                y: 2,
                scale: 3,
                placement: "front",
            });
            historyOf(session).execute(made(make(session)));
            const want = expected(patterned(5, 3, 3));
            expect([session.doc.width, session.doc.height]).toEqual([want.width, want.height]);
            expect(Array.from(session.doc.images.get("i")?.data ?? [])).toEqual(
                Array.from(want.data),
            );
            expect(reference(session.doc, "ref")).toMatchObject({ x: 1.25, y: 2, scale: 3 });
        }
    });

    it("four quarter turns give the original document", () => {
        const session = fixture();
        const start = snapshot(session);
        const history = historyOf(session);
        for (let turn = 0; turn < 4; turn++)
            history.execute(made(rotateCanvasCommand(session, 90)));
        expect(snapshot(session)).toEqual({ ...start, selection: null });
    });

    it("refuses an angle or an axis it does not know", () => {
        const session = fixture();
        expect(() => rotateCanvasCommand(session, 45 as 90)).toThrow(RangeError);
        expect(() => flipCanvasCommand(session, "diagonal" as "vertical")).toThrow(RangeError);
    });
});

describe("history budget and memory guard", () => {
    it("a sprite-wide command larger than the history budget is retained and undoable", () => {
        const session = fixture();
        const before = snapshot(session);
        // The budget is smaller than the three old images the command keeps.
        const history = historyOf(session, { budgetBytes: 1024 });
        history.execute(made(selectionStep(session)));
        const command = made(spriteSizeCommand(session, { width: 64, height: 64, method: "area" }));
        history.execute(command);
        expect(command.bytes).toBeGreaterThan(history.budgetBytes);
        // The newest entry stays; the older one was dropped to make room.
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Sprite Size");
        expect(history.undo()).toBe(true);
        assertInvariants(session);
        expect(session.selection).not.toBeNull();
        expect(withoutSelection(snapshot(session))).toEqual(withoutSelection(before));
    });

    it("refuses a size whose images would pass the pixel memory limit, with the session unchanged", () => {
        const session = fixture();
        const before = snapshot(session);
        // Three images: 3 × 64 × 64 × 4 = 49 152 bytes.
        const limits = { ...DOCUMENT_LIMITS, pixelBytes: 3 * 64 * 64 * 4 - 1 };
        const thrown = (() => {
            try {
                canvasSizeCommand(
                    session,
                    { width: 64, height: 64, anchor: { x: 0, y: 0 } },
                    { limits },
                );
            } catch (error) {
                return error;
            }
            return null;
        })();
        expect(thrown).toBeInstanceOf(DocumentLimitError);
        expect(thrown).toMatchObject({ limit: "pixelBytes", requested: 3 * 64 * 64 * 4 });
        expect(() =>
            spriteSizeCommand(session, { width: 64, height: 64, method: "nearest" }, { limits }),
        ).toThrow(DocumentLimitError);
        // Exactly at the limit is allowed; shrinking is never refused.
        const at = { ...DOCUMENT_LIMITS, pixelBytes: 3 * 64 * 64 * 4 };
        expect(
            spriteSizeCommand(
                session,
                { width: 64, height: 64, method: "nearest" },
                { limits: at },
            ),
        ).not.toBeNull();
        const tiny = { ...DOCUMENT_LIMITS, pixelBytes: 1 };
        expect(trimCommand(session, { limits: tiny })).not.toBeNull();
        expect(snapshot(session)).toEqual(before);
    });

    it.each([
        [256, true],
        [257, false],
    ])(
        "the real limit: a 1024 × 1024 canvas with %i images (1 GiB is 256) is allowed: %s",
        (count, allowed) => {
            const session = createDocument({ name: "a", width: 1, height: 1 });
            for (let index = 0; index < count; index++) {
                const imageId = `i${index}`;
                const frameId = index === 0 ? session.activeFrameId : `f${index}`;
                if (index > 0) session.doc.frames.push({ id: frameId, durationMs: 100 });
                session.doc.images.set(imageId, patterned(1, 1, 0));
                session.doc.cels.set(celKey(session.activeLayerId, frameId), {
                    imageId,
                    opacity: 255,
                });
            }
            assertInvariants(session);
            const make = () =>
                canvasSizeCommand(session, { width: 1024, height: 1024, anchor: { x: 0, y: 0 } });
            if (allowed) {
                // Made, not done: doing it would allocate the gigabyte.
                expect(make()).not.toBeNull();
            } else {
                expect(make).toThrow(DocumentLimitError);
            }
        },
    );
});

/** A `width` × `height` document with one cel showing `image`, and the given pivot. */
function documentOf(
    image: ReturnType<typeof patterned>,
    pivot: { x: number; y: number },
): DocSession {
    const session = createDocument({ name: "a", width: image.width, height: image.height });
    session.doc.images.set("i", image);
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "i",
        opacity: 255,
    });
    session.doc.pivot = pivot;
    return session;
}

describe("the pivot stays over the same content and normalized", () => {
    it("canvas size moves it with the content: 32→48 centred puts pixel (8, 32) at (16, 40)", () => {
        const session = fixture();
        const before = session.doc.pivot;
        const history = historyOf(session);
        history.execute(
            made(canvasSizeCommand(session, { width: 48, height: 48, anchor: { x: 0.5, y: 0.5 } })),
        );
        expect(session.doc.pivot).toEqual({ x: 16 / 48, y: 40 / 48 });
        history.undo();
        // Undo puts back the very value.
        expect(session.doc.pivot).toBe(before);
    });

    it("a pivot left outside the new canvas is clamped to its edge, and undo restores it exactly", () => {
        for (const [anchor, expected] of [
            // 32→16 at the top left: pixel (8, 32) is at (8, 32): x 0.5, y 2 → 1.
            [
                { x: 0, y: 0 },
                { x: 0.5, y: 1 },
            ],
            // At the bottom right the canvas moves by (-16, -16): (-8, 16): x → 0, y 1.
            [
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ],
        ] as const) {
            const session = fixture();
            const history = historyOf(session);
            history.execute(made(canvasSizeCommand(session, { width: 16, height: 16, anchor })));
            expect(session.doc.pivot).toEqual(expected);
            history.undo();
            expect(session.doc.pivot).toEqual({ x: 0.25, y: 1 });
        }
    });

    it("crop and trim move it with the content; sprite size leaves it as it is", () => {
        const session = documentOf(
            imageWith(10, 10, { x: 2, y: 4, width: 4, height: 4 }, [1, 1, 1]),
            { x: 0.3, y: 0.5 },
        );
        const history = historyOf(session);
        // Content (2, 4, 4, 4); pixel (3, 5) → (1, 1) of 4 × 4.
        history.execute(made(trimCommand(session)));
        expect(session.doc.pivot).toEqual({ x: (3 - 2) / 4, y: (5 - 4) / 4 });
        history.execute(made(spriteSizeCommand(session, { width: 12, height: 8, method: "area" })));
        expect(session.doc.pivot).toEqual({ x: 0.25, y: 0.25 });
        history.undo();
        history.undo();
        expect(session.doc.pivot).toEqual({ x: 0.3, y: 0.5 });
    });

    it("flip mirrors it and rotate turns it with the canvas", () => {
        const cases: [Make, { x: number; y: number }][] = [
            [(s) => flipCanvasCommand(s, "horizontal"), { x: 0.75, y: 1 }],
            [(s) => flipCanvasCommand(s, "vertical"), { x: 0.25, y: 0 }],
            // 90° cw: (x, y) → (1 − y, x); 180°: (1 − x, 1 − y); 270°: (y, 1 − x).
            [(s) => rotateCanvasCommand(s, 90), { x: 0, y: 0.25 }],
            [(s) => rotateCanvasCommand(s, 180), { x: 0.75, y: 0 }],
            [(s) => rotateCanvasCommand(s, 270), { x: 1, y: 0.75 }],
        ];
        for (const [make, expected] of cases) {
            const session = documentOf(patterned(5, 3, 2), { x: 0.25, y: 1 });
            const history = historyOf(session);
            history.execute(made(make(session)));
            expect(session.doc.pivot).toEqual(expected);
            history.undo();
            expect(session.doc.pivot).toEqual({ x: 0.25, y: 1 });
        }
    });
});

describe("a flip or rotation that changes nothing is no command", () => {
    // A centred square: its own mirror image and its own quarter turn.
    const square = () => imageWith(4, 4, { x: 1, y: 1, width: 2, height: 2 }, [5, 6, 7]);
    // A centred bar on a 6 × 4 canvas: its own mirror images and its own half turn.
    const bar = () => imageWith(6, 4, { x: 1, y: 1, width: 4, height: 2 }, [5, 6, 7]);
    const centre = { x: 0.5, y: 0.5 };

    it("flip: every image its own mirror image and the pivot on the axis", () => {
        expect(flipCanvasCommand(documentOf(bar(), centre), "horizontal")).toBeNull();
        expect(flipCanvasCommand(documentOf(bar(), centre), "vertical")).toBeNull();
        expect(flipCanvasCommand(documentOf(bar(), { x: 0.5, y: 1 }), "horizontal")).toBeNull();
        // The pivot would move, so the flip is made.
        expect(
            flipCanvasCommand(documentOf(bar(), { x: 0.25, y: 0.5 }), "horizontal"),
        ).not.toBeNull();
        expect(flipCanvasCommand(documentOf(bar(), { x: 0.5, y: 1 }), "vertical")).not.toBeNull();
        // An image that is not symmetric.
        expect(
            flipCanvasCommand(documentOf(patterned(6, 4, 1), centre), "horizontal"),
        ).not.toBeNull();
        // No image at all: only the pivot counts.
        expect(
            flipCanvasCommand(createDocument({ name: "e", width: 3, height: 3 }), "vertical"),
        ).toBeNull();
    });

    it("rotate: a square canvas for a quarter turn, any canvas for a half turn, and a pivot at the centre", () => {
        expect(rotateCanvasCommand(documentOf(square(), centre), 90)).toBeNull();
        expect(rotateCanvasCommand(documentOf(square(), centre), 270)).toBeNull();
        expect(rotateCanvasCommand(documentOf(square(), centre), 180)).toBeNull();
        expect(rotateCanvasCommand(documentOf(bar(), centre), 180)).toBeNull();
        // 1 × 1 at 180°.
        expect(rotateCanvasCommand(documentOf(patterned(1, 1, 4), centre), 180)).toBeNull();
        // The canvas changes shape: always a command.
        expect(rotateCanvasCommand(documentOf(bar(), centre), 90)).not.toBeNull();
        // The pivot would move.
        expect(rotateCanvasCommand(documentOf(square(), { x: 0.5, y: 0 }), 90)).not.toBeNull();
        expect(
            rotateCanvasCommand(documentOf(patterned(1, 1, 4), { x: 0, y: 0 }), 180),
        ).not.toBeNull();
        // The image is not its own quarter turn.
        expect(rotateCanvasCommand(documentOf(patterned(4, 4, 1), centre), 90)).not.toBeNull();
    });
});

describe("linked cels", () => {
    it("an image shared by two cels is changed once and stays shared", () => {
        const session = fixture();
        historyOf(session).execute(made(flipCanvasCommand(session, "horizontal")));
        const one = session.doc.cels.get(celKey(L1, FRAMES[0]));
        const two = session.doc.cels.get(celKey(L1, FRAMES[1]));
        expect(one?.imageId).toBe(IMAGE_A);
        expect(two?.imageId).toBe(IMAGE_A);
        // Flipped once: A's rectangle x 4..11 is now x 20..27.
        const a = session.doc.images.get(IMAGE_A);
        if (!a) throw new Error("no image");
        expect(pixelAt(a, 20, 6)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(a, 4, 6)).toEqual([0, 0, 0, 0]);
        expect(session.doc.images.get(IMAGE_B)).toBeDefined();
    });
});
