import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { History, pixelPatchCommand } from "../../src/core/history";
import { assertInvariants, celAt, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    addFrame,
    addLayer,
    copyOf,
    countingBytes,
    execute,
    linkCel,
    newSession,
    paintRect,
    pixel,
    redo,
    undo,
} from "./se-004-support";

const IMAGE = "image-a";

function buffer(width: number, height: number, bytes: number[]): PixelBuffer {
    return { width, height, data: Uint8ClampedArray.from(bytes) };
}

/** A 4×3 session whose only cel has the bytes 1, 2, 3, … */
function setup(): { session: DocSession; image: PixelBuffer; history: History } {
    const session = newSession(4, 3);
    const image = addCel(session, LAYER, FRAME, IMAGE, countingBytes(48));
    return { session, image, history: new History(session) };
}

describe("pixelPatchCommand", () => {
    it("replaces the rectangle on do, restores it on undo and repeats it on redo", () => {
        const { session, image, history } = setup();
        const original = image.data.slice();
        const pixels = buffer(2, 1, [201, 202, 203, 204, 205, 206, 207, 208]);

        execute(
            history,
            pixelPatchCommand(session.doc, { label: "Fill", imageId: IMAGE, x: 1, y: 2, pixels }),
        );

        const patched = original.slice();
        patched.set(pixels.data, (2 * 4 + 1) * 4);
        expect(image.data).toStrictEqual(patched);
        expect(pixel(image, 1, 2)).toEqual([201, 202, 203, 204]);
        expect(pixel(image, 2, 2)).toEqual([205, 206, 207, 208]);
        expect(history.undoLabel).toBe("Fill");

        undo(history);
        expect(image.data).toStrictEqual(original);
        redo(history);
        expect(image.data).toStrictEqual(patched);
    });

    it("is not applied until the history executes it", () => {
        const { session } = setup();
        const before = copyOf(session);

        pixelPatchCommand(session.doc, {
            label: "Fill",
            imageId: IMAGE,
            x: 0,
            y: 0,
            pixels: buffer(1, 1, [9, 9, 9, 9]),
        });

        expect(session).toStrictEqual(before);
    });

    it("stores before and after sub-buffers of the rectangle, not the image", () => {
        const { session } = setup();
        const pixels = buffer(2, 1, [0, 0, 0, 0, 0, 0, 0, 0]);

        const command = pixelPatchCommand(session.doc, {
            label: "Fill",
            imageId: IMAGE,
            x: 0,
            y: 0,
            pixels,
        });

        // 2×1 pixels before plus 2×1 pixels after; the image is 4×3 = 48 bytes.
        expect(command.bytes).toBe(16);
    });

    it("restores the pixels found when the command was made, whatever is written later", () => {
        const { session, image, history } = setup();
        const first = pixelPatchCommand(session.doc, {
            label: "First",
            imageId: IMAGE,
            x: 0,
            y: 0,
            pixels: buffer(1, 1, [10, 20, 30, 40]),
        });
        execute(history, first);
        execute(
            history,
            pixelPatchCommand(session.doc, {
                label: "Second",
                imageId: IMAGE,
                x: 0,
                y: 0,
                pixels: buffer(2, 1, [50, 60, 70, 80, 90, 100, 110, 120]),
            }),
        );

        undo(history);
        expect(pixel(image, 0, 0)).toEqual([10, 20, 30, 40]);
        expect(pixel(image, 1, 0)).toEqual([5, 6, 7, 8]);
        undo(history);
        expect(pixel(image, 0, 0)).toEqual([1, 2, 3, 4]);
    });

    it("touches every cel that uses the image, in document order", () => {
        const { session } = setup();
        addLayer(session, "layer-b");
        addFrame(session, "frame-b");
        addFrame(session, "frame-c");
        linkCel(session, LAYER, "frame-c", IMAGE);
        linkCel(session, "layer-b", "frame-b", IMAGE);
        addCel(session, "layer-b", FRAME, "image-other");
        assertInvariants(session);

        const linked = pixelPatchCommand(session.doc, {
            label: "Fill",
            imageId: IMAGE,
            x: 0,
            y: 0,
            pixels: buffer(1, 1, [1, 1, 1, 1]),
        });
        const single = pixelPatchCommand(session.doc, {
            label: "Fill",
            imageId: "image-other",
            x: 0,
            y: 0,
            pixels: buffer(1, 1, [1, 1, 1, 1]),
        });

        expect(linked.touched).toEqual({
            frameIds: [FRAME, "frame-b", "frame-c"],
            layerIds: [LAYER, "layer-b"],
            structure: false,
        });
        expect(single.touched).toEqual({
            frameIds: [FRAME],
            layerIds: ["layer-b"],
            structure: false,
        });
    });

    it("rejects an unknown image and a rectangle that leaves the image", () => {
        const { session } = setup();
        const before = copyOf(session);
        const one = buffer(1, 1, [1, 1, 1, 1]);
        const patch = (imageId: string, x: number, y: number, pixels: PixelBuffer) =>
            pixelPatchCommand(session.doc, { label: "Fill", imageId, x, y, pixels });

        expect(() => patch("image-x", 0, 0, one)).toThrow(RangeError);
        expect(() => patch(IMAGE, 4, 0, one)).toThrow(RangeError);
        expect(() => patch(IMAGE, 0, 3, one)).toThrow(RangeError);
        expect(() => patch(IMAGE, -1, 0, one)).toThrow(RangeError);
        expect(() => patch(IMAGE, 0.5, 0, one)).toThrow(RangeError);
        expect(() => patch(IMAGE, 3, 0, buffer(2, 1, [1, 1, 1, 1, 1, 1, 1, 1]))).toThrow(
            RangeError,
        );
        expect(() => patch(IMAGE, 0, 0, buffer(2, 1, [1, 1, 1, 1]))).toThrow(RangeError);
        expect(patch(IMAGE, 3, 2, one).bytes).toBe(8);
        expect(session).toStrictEqual(before);
    });

    it("under a small budget keeps the newest patches undoable and stops at the oldest", () => {
        const { session, image } = setup();
        // Each patch retains 8 bytes; three of them fit.
        const history = new History(session, { budgetBytes: 24 });
        const states = [image.data.slice()];
        for (let step = 1; step <= 5; step++) {
            const pixels = buffer(1, 1, [step, step, step, 255]);
            execute(
                history,
                pixelPatchCommand(session.doc, {
                    label: `Dot ${step}`,
                    imageId: IMAGE,
                    x: step % 4,
                    y: step % 3,
                    pixels,
                }),
            );
            states.push(image.data.slice());
        }

        expect(history.undoCount).toBe(3);
        expect(history.bytes).toBe(24);
        for (let step = 4; step >= 2; step--) {
            undo(history);
            expect(image.data).toStrictEqual(states[step]);
        }
        expect(history.undo()).toBe(false);
        expect(image.data).toStrictEqual(states[2]);
        for (let step = 3; step <= 5; step++) {
            redo(history);
            expect(image.data).toStrictEqual(states[step]);
        }
    });
});

// Random sequences of pixel patches on one cel. A step is made either as a command given to
// `History.execute` or as a transaction that writes the same pixels; a sequence may start
// on an empty cel, where the first step is a transaction that creates the cel.

interface Step {
    via: "command" | "transaction";
    x: number;
    y: number;
    width: number;
    height: number;
    bytes: Uint8Array;
}

interface Sequence {
    width: number;
    height: number;
    /** Bytes of the cel's image at the start; null for an empty cel. */
    initial: Uint8Array | null;
    steps: Step[];
}

function stepsOn(width: number, height: number): fc.Arbitrary<Step> {
    return fc
        .tuple(fc.nat({ max: width - 1 }), fc.nat({ max: height - 1 }))
        .chain(([x, y]) =>
            fc.tuple(
                fc.constant(x),
                fc.constant(y),
                fc.integer({ min: 1, max: width - x }),
                fc.integer({ min: 1, max: height - y }),
            ),
        )
        .chain(([x, y, patchWidth, patchHeight]) => {
            const length = patchWidth * patchHeight * 4;
            return fc.record({
                via: fc.constantFrom("command" as const, "transaction" as const),
                x: fc.constant(x),
                y: fc.constant(y),
                width: fc.constant(patchWidth),
                height: fc.constant(patchHeight),
                bytes: fc.uint8Array({ minLength: length, maxLength: length }),
            });
        });
}

const sequences: fc.Arbitrary<Sequence> = fc
    .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
    .chain(([width, height]) => {
        const length = width * height * 4;
        return fc.record({
            width: fc.constant(width),
            height: fc.constant(height),
            initial: fc.option(fc.uint8Array({ minLength: length, maxLength: length }), {
                nil: null,
            }),
            steps: fc.array(stepsOn(width, height), { minLength: 1, maxLength: 12 }),
        });
    });

/** The bytes of the cel's image, or null while the cel is empty. */
function celBytes(session: DocSession): Uint8ClampedArray | null {
    const cel = celAt(session.doc, LAYER, FRAME);
    if (!cel) return null;
    const image = session.doc.images.get(cel.imageId);
    if (!image) throw new Error("the cel has no image");
    return image.data.slice();
}

function apply(history: History, step: Step, index: number): void {
    const { session } = history;
    const { x, y, width, height } = step;
    const cel = celAt(session.doc, LAYER, FRAME);
    if (cel && step.via === "command") {
        const pixels = { width, height, data: Uint8ClampedArray.from(step.bytes) };
        const patch = { label: `Patch ${index}`, imageId: cel.imageId, x, y, pixels };
        history.execute(pixelPatchCommand(session.doc, patch));
    } else {
        const transaction = history.begin(
            { layerId: LAYER, frameId: FRAME },
            sequentialIds("image-"),
        );
        paintRect(transaction, { x, y, width, height }, Uint8ClampedArray.from(step.bytes));
        expect(transaction.commit(`Patch ${index}`)).not.toBeNull();
    }
    assertInvariants(session);
}

describe("pixel patches, property", () => {
    it(
        "for 500 random sequences, undo all then redo all reproduces every intermediate buffer byte-exactly",
        { timeout: 30_000 },
        () => {
            let runs = 0;
            let patches = 0;
            fc.assert(
                fc.property(sequences, ({ width, height, initial, steps }) => {
                    runs++;
                    patches += steps.length;
                    const session = newSession(width, height);
                    if (initial) {
                        addCel(session, LAYER, FRAME, IMAGE, Uint8ClampedArray.from(initial));
                    }
                    assertInvariants(session);
                    const history = new History(session);

                    const states = [celBytes(session)];
                    steps.forEach((step, index) => {
                        apply(history, step, index);
                        states.push(celBytes(session));
                    });
                    expect(history.undoCount).toBe(steps.length);

                    for (let index = steps.length - 1; index >= 0; index--) {
                        undo(history);
                        expect(celBytes(session)).toStrictEqual(states[index]);
                    }
                    expect(history.undo()).toBe(false);

                    for (let index = 1; index <= steps.length; index++) {
                        redo(history);
                        expect(celBytes(session)).toStrictEqual(states[index]);
                    }
                    expect(history.redo()).toBe(false);
                }),
                { numRuns: 500 },
            );
            expect(runs).toBe(500);
            expect(patches).toBeGreaterThanOrEqual(500);
        },
    );
});
