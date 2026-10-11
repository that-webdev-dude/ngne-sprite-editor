import { describe, expect, it } from "vitest";
import { History, TransactionError, pixelPatchCommand } from "../../src/core/history";
import type { HistoryChange } from "../../src/core/history";
import { assertInvariants, celAt, sequentialIds } from "../../src/core/model";
import type { BitMask, DocSession, PixelBuffer, ReferenceLayer } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    addFrame,
    addLayer,
    commit,
    copyOf,
    countingBytes,
    linkCel,
    newSession,
    paint,
    paintRect,
    pixel,
    redo,
    undo,
} from "./se-004-support";

const TARGET = { layerId: LAYER, frameId: FRAME };
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const HALF_BLUE = [0, 0, 255, 128];

/** A mask of a `width` × `height` document with the bits of the listed pixels set. */
function mask(width: number, height: number, pixels: Array<[number, number]>): BitMask {
    const data = new Uint8Array(Math.ceil((width * height) / 8));
    for (const [x, y] of pixels) {
        const bit = y * width + x;
        data[bit >> 3] |= 1 << (bit & 7);
    }
    return { width, height, data };
}

/** A 4×3 session with an empty cel at the target. */
function emptySetup(): { session: DocSession; history: History } {
    const session = newSession(4, 3);
    return { session, history: new History(session) };
}

/** A 4×3 session whose target cel has the bytes 1, 2, 3, … */
function filledSetup(): { session: DocSession; image: PixelBuffer; history: History } {
    const session = newSession(4, 3);
    const image = addCel(session, LAYER, FRAME, "image-a", countingBytes(48));
    return { session, image, history: new History(session) };
}

function imageOfTarget(session: DocSession): PixelBuffer {
    const cel = celAt(session.doc, LAYER, FRAME);
    const image = cel && session.doc.images.get(cel.imageId);
    if (!image) throw new Error("the target cel is empty");
    return image;
}

describe("transaction on an empty cel", () => {
    it("a stroke on an empty cel creates the cel; undo removes it; redo restores identical pixels", () => {
        const { session, history } = emptySetup();
        const { doc } = session;

        const transaction = history.begin(TARGET, sequentialIds("image-"));

        expect(transaction.createdCel).toBe(true);
        expect(transaction.imageId).toBe("image-1");
        expect(celAt(doc, LAYER, FRAME)).toEqual({ imageId: "image-1", opacity: 255 });
        expect(doc.images.get("image-1")).toBe(transaction.image);
        expect(transaction.image.width).toBe(4);
        expect(transaction.image.height).toBe(3);
        expect(transaction.image.data).toStrictEqual(new Uint8ClampedArray(48));
        assertInvariants(session);

        paint(transaction, 1, 0, RED);
        paint(transaction, 2, 1, GREEN);
        paint(transaction, 3, 2, HALF_BLUE);
        const command = commit(history, "Pencil");

        expect(command?.label).toBe("Pencil");
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Pencil");
        const painted = imageOfTarget(session).data.slice();
        expect(pixel(imageOfTarget(session), 1, 0)).toEqual(RED);
        expect(pixel(imageOfTarget(session), 2, 1)).toEqual(GREEN);
        expect(pixel(imageOfTarget(session), 3, 2)).toEqual(HALF_BLUE);

        for (let round = 0; round < 2; round++) {
            undo(history);
            expect(celAt(doc, LAYER, FRAME)).toBeUndefined();
            expect(doc.cels.size).toBe(0);
            expect(doc.images.size).toBe(0);

            redo(history);
            expect(celAt(doc, LAYER, FRAME)).toEqual({ imageId: "image-1", opacity: 255 });
            const restored = imageOfTarget(session);
            expect(restored.width).toBe(4);
            expect(restored.height).toBe(3);
            expect(restored.data).toStrictEqual(painted);
        }
    });

    it("its history entry includes the creation of the cel and retains the dirty rectangle only", () => {
        const { session, history } = emptySetup();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const transaction = history.begin(TARGET);
        paint(transaction, 1, 1, RED);
        paint(transaction, 2, 2, GREEN);
        const command = commit(history, "Pencil");

        // One entry for both the cel and its pixels; 2×2 pixels of the 4×3 image.
        expect(history.undoCount).toBe(1);
        expect(command?.bytes).toBe(16);
        expect(history.bytes).toBe(16);
        expect(changes).toEqual([
            {
                kind: "do",
                label: "Pencil",
                touched: { frameIds: [FRAME], layerIds: [LAYER], structure: false },
            },
        ]);
        expect(session.doc.cels.size).toBe(1);
    });

    it("a second stroke on the created cel undoes separately", () => {
        const { session, history } = emptySetup();
        paint(history.begin(TARGET), 0, 0, RED);
        commit(history, "First");
        const transaction = history.begin(TARGET);
        expect(transaction.createdCel).toBe(false);
        paint(transaction, 0, 0, GREEN);
        paint(transaction, 1, 0, GREEN);
        commit(history, "Second");

        undo(history);
        expect(pixel(imageOfTarget(session), 0, 0)).toEqual(RED);
        expect(pixel(imageOfTarget(session), 1, 0)).toEqual([0, 0, 0, 0]);
        undo(history);
        expect(session.doc.cels.size).toBe(0);
        redo(history);
        redo(history);
        expect(pixel(imageOfTarget(session), 0, 0)).toEqual(GREEN);
        expect(pixel(imageOfTarget(session), 1, 0)).toEqual(GREEN);
    });
});

describe("transaction on an existing cel", () => {
    it("writes into the cel's own image and commits one entry that undo and redo reverse exactly", () => {
        const { session, image, history } = filledSetup();
        const original = image.data.slice();

        const transaction = history.begin(TARGET);
        expect(transaction.createdCel).toBe(false);
        expect(transaction.imageId).toBe("image-a");
        expect(transaction.image).toBe(image);
        expect(transaction.dirty).toBeNull();
        paint(transaction, 0, 0, RED);
        paint(transaction, 3, 1, GREEN);
        expect(transaction.dirty).toEqual({ x: 0, y: 0, width: 4, height: 2 });
        const command = commit(history, "Pencil");

        expect(transaction.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(1);
        // Before and after for the 4×2 dirty rectangle of the 4×3 image.
        expect(command?.bytes).toBe(2 * 4 * 2 * 4);
        const painted = image.data.slice();
        expect(pixel(image, 0, 0)).toEqual(RED);
        expect(pixel(image, 3, 1)).toEqual(GREEN);

        undo(history);
        expect(image.data).toStrictEqual(original);
        expect(session.doc.images.get("image-a")).toBe(image);
        redo(history);
        expect(image.data).toStrictEqual(painted);
    });

    it("applies the patch to every cel that links the image and reports each as touched", () => {
        const { session, image, history } = filledSetup();
        addLayer(session, "layer-b");
        addFrame(session, "frame-b");
        linkCel(session, LAYER, "frame-b", "image-a");
        linkCel(session, "layer-b", "frame-b", "image-a");
        assertInvariants(session);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const linked = () => {
            const cel = celAt(session.doc, "layer-b", "frame-b");
            const shared = cel && session.doc.images.get(cel.imageId);
            if (!shared) throw new Error("the linked cel is empty");
            return shared;
        };

        paint(history.begin(TARGET), 2, 2, RED);
        commit(history, "Pencil");

        expect(linked()).toBe(image);
        expect(pixel(linked(), 2, 2)).toEqual(RED);
        const touched = {
            frameIds: [FRAME, "frame-b"],
            layerIds: [LAYER, "layer-b"],
            structure: false,
        };
        expect(changes).toEqual([{ kind: "do", label: "Pencil", touched }]);

        undo(history);
        expect(pixel(linked(), 2, 2)).toEqual([41, 42, 43, 44]);
        redo(history);
        expect(pixel(linked(), 2, 2)).toEqual(RED);
        expect(changes.map((change) => change.kind)).toEqual(["do", "undo", "redo"]);
        expect(changes.every((change) => change.touched.frameIds.includes("frame-b"))).toBe(true);
    });

    it("a committed stroke clears redo", () => {
        const { session, history } = filledSetup();
        paint(history.begin(TARGET), 0, 0, RED);
        commit(history, "First");
        undo(history);
        expect(history.redoCount).toBe(1);

        paint(history.begin(TARGET), 1, 1, GREEN);
        commit(history, "Second");

        expect(history.redoCount).toBe(0);
        expect(history.redo()).toBe(false);
        expect(pixel(imageOfTarget(session), 0, 0)).toEqual([1, 2, 3, 4]);
        expect(pixel(imageOfTarget(session), 1, 1)).toEqual(GREEN);
    });

    it("clips reported rectangles to the canvas and rejects fractional ones", () => {
        const { history } = filledSetup();
        const transaction = history.begin(TARGET);

        transaction.markDirty({ x: -5, y: -5, width: 3, height: 3 });
        transaction.markDirty({ x: 4, y: 0, width: 2, height: 2 });
        transaction.markDirty({ x: 1, y: 1, width: 0, height: 5 });
        expect(transaction.dirty).toBeNull();

        transaction.markDirty({ x: 2, y: -1, width: 10, height: 2 });
        expect(transaction.dirty).toEqual({ x: 2, y: 0, width: 2, height: 1 });
        transaction.markDirty({ x: -1, y: 2, width: 2, height: 9 });
        expect(transaction.dirty).toEqual({ x: 0, y: 0, width: 4, height: 3 });

        expect(() => transaction.markDirty({ x: 0.5, y: 0, width: 1, height: 1 })).toThrow(
            RangeError,
        );
        transaction.abort();
    });
});

describe("abort", () => {
    it("aborting a transaction leaves the session deep-equal to its state at begin", () => {
        const { session, image, history } = filledSetup();
        session.selection = {
            mask: mask(4, 3, [[1, 1]]),
            bounds: { x: 1, y: 1, width: 1, height: 1 },
        };
        const atBegin = copyOf(session);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const transaction = history.begin(TARGET);
        paint(transaction, 0, 0, RED);
        paintRect(transaction, { x: 1, y: 1, width: 3, height: 2 }, countingBytes(24, 100));
        // A write that was never reported is restored as well.
        transaction.image.data.fill(7, 44, 48);
        expect(session).not.toStrictEqual(atBegin);
        transaction.abort();

        expect(session).toStrictEqual(atBegin);
        expect(session.doc.images.get("image-a")).toBe(image);
        assertInvariants(session);
        expect(transaction.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(0);
        expect(history.canUndo).toBe(false);
        expect(changes).toEqual([]);
    });

    it("aborting a transaction that created the cel removes the cel and its image", () => {
        const { session, history } = emptySetup();
        const atBegin = copyOf(session);

        const transaction = history.begin(TARGET);
        paint(transaction, 2, 2, RED);
        expect(session.doc.cels.size).toBe(1);
        transaction.abort();

        expect(session).toStrictEqual(atBegin);
        expect(session.doc.cels.size).toBe(0);
        expect(session.doc.images.size).toBe(0);
        assertInvariants(session);
        expect(history.undoCount).toBe(0);
    });

    it("aborting with a clip mask and earlier history restores the state at begin", () => {
        const { session, history } = filledSetup();
        paint(history.begin(TARGET), 3, 2, GREEN);
        commit(history, "Earlier");
        const atBegin = copyOf(session);
        const position = history.position;

        const transaction = history.begin({ ...TARGET, clip: mask(4, 3, [[0, 0]]) });
        paint(transaction, 0, 0, RED);
        paint(transaction, 1, 0, RED);
        transaction.abort();

        expect(session).toStrictEqual(atBegin);
        expect(history.position).toBe(position);
        expect(history.undoCount).toBe(1);
        undo(history);
        expect(pixel(imageOfTarget(session), 3, 2)).toEqual([45, 46, 47, 48]);
    });
});

describe("commit without a reported change", () => {
    it("adds no history entry and restores the pixels", () => {
        const { session, history } = filledSetup();
        const atBegin = copyOf(session);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const transaction = history.begin(TARGET);
        transaction.image.data.fill(9, 0, 4);
        expect(commit(history, "Pencil")).toBeNull();

        expect(session).toStrictEqual(atBegin);
        expect(transaction.open).toBe(false);
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);
    });

    it("removes the cel it created and keeps redo", () => {
        const { session, history } = emptySetup();
        paint(history.begin(TARGET), 0, 0, RED);
        commit(history, "First");
        undo(history);
        const atBegin = copyOf(session);

        history.begin(TARGET);
        expect(commit(history, "Second")).toBeNull();

        expect(session).toStrictEqual(atBegin);
        expect(session.doc.cels.size).toBe(0);
        expect(history.redoCount).toBe(1);
        redo(history);
        expect(pixel(imageOfTarget(session), 0, 0)).toEqual(RED);
    });
});

describe("clip mask", () => {
    // Pixels (1, 0), (2, 0), (1, 1) and (2, 1) are inside the mask.
    const inside: Array<[number, number]> = [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
    ];

    it("a stroke crossing the mask edge changes pixels only inside the mask", () => {
        const { session, image, history } = filledSetup();
        const original = image.data.slice();

        const transaction = history.begin({ ...TARGET, clip: mask(4, 3, inside) });
        // A horizontal line over the whole first row, then a vertical one over column 1.
        paintRect(transaction, { x: 0, y: 0, width: 4, height: 1 }, new Uint8ClampedArray(16));
        // Outside pixels are back already, before the commit: the live image is clipped.
        expect(pixel(image, 0, 0)).toEqual([1, 2, 3, 4]);
        expect(pixel(image, 3, 0)).toEqual([13, 14, 15, 16]);
        paintRect(
            transaction,
            { x: 1, y: 0, width: 1, height: 3 },
            Uint8ClampedArray.from([...RED, ...RED, ...RED]),
        );
        commit(history, "Pencil");

        const expected = original.slice();
        expected.set(RED, 1 * 4);
        expected.set([0, 0, 0, 0], 2 * 4);
        expected.set(RED, (4 + 1) * 4);
        expect(image.data).toStrictEqual(expected);
        assertInvariants(session);

        undo(history);
        expect(image.data).toStrictEqual(original);
        redo(history);
        expect(image.data).toStrictEqual(expected);
    });

    it("narrows the dirty rectangle to the pixels inside the mask", () => {
        const { history } = filledSetup();

        const transaction = history.begin({ ...TARGET, clip: mask(4, 3, inside) });
        paintRect(transaction, { x: 0, y: 0, width: 4, height: 3 }, new Uint8ClampedArray(48));
        expect(transaction.dirty).toEqual({ x: 1, y: 0, width: 2, height: 2 });
        const command = commit(history, "Fill");

        expect(command?.bytes).toBe(2 * 2 * 2 * 4);
    });

    it("on an empty cel, pixels outside the mask stay transparent", () => {
        const { session, history } = emptySetup();

        const transaction = history.begin({ ...TARGET, clip: mask(4, 3, inside) });
        paintRect(
            transaction,
            { x: 0, y: 0, width: 4, height: 3 },
            new Uint8ClampedArray(48).fill(200),
        );
        commit(history, "Fill");

        const image = imageOfTarget(session);
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 4; x++) {
                const selected = inside.some(([sx, sy]) => sx === x && sy === y);
                expect(pixel(image, x, y)).toEqual(selected ? [200, 200, 200, 200] : [0, 0, 0, 0]);
            }
        }
        const painted = image.data.slice();
        undo(history);
        expect(session.doc.cels.size).toBe(0);
        redo(history);
        expect(imageOfTarget(session).data).toStrictEqual(painted);
    });

    it("a stroke entirely outside the mask adds no entry and creates no cel", () => {
        const { session, history } = emptySetup();
        const atBegin = copyOf(session);

        const transaction = history.begin({ ...TARGET, clip: mask(4, 3, inside) });
        paint(transaction, 0, 2, RED);
        paint(transaction, 3, 2, RED);
        expect(transaction.dirty).toBeNull();
        expect(commit(history, "Pencil")).toBeNull();

        expect(session).toStrictEqual(atBegin);
        expect(history.undoCount).toBe(0);
    });

    it("takes the session's selection mask as it is", () => {
        const { session, image, history } = filledSetup();
        session.selection = {
            mask: mask(4, 3, [[3, 2]]),
            bounds: { x: 3, y: 2, width: 1, height: 1 },
        };

        const transaction = history.begin({ ...TARGET, clip: session.selection.mask });
        paintRect(transaction, { x: 2, y: 1, width: 2, height: 2 }, new Uint8ClampedArray(16));
        commit(history, "Eraser");

        expect(pixel(image, 3, 2)).toEqual([0, 0, 0, 0]);
        expect(pixel(image, 2, 2)).toEqual([41, 42, 43, 44]);
        expect(pixel(image, 2, 1)).toEqual([25, 26, 27, 28]);
        expect(pixel(image, 3, 1)).toEqual([29, 30, 31, 32]);
    });
});

describe("transaction guards", () => {
    it("begin rejects a target that is not a cel of a pixel layer, and a mask of another size", () => {
        const { session, history } = emptySetup();
        const reference: ReferenceLayer = {
            id: "ref-1",
            name: "Reference",
            kind: "reference",
            visible: true,
            locked: false,
            opacity: 128,
            sourceId: "source-1",
            x: 0,
            y: 0,
            scale: 1,
            placement: "behind",
        };
        session.doc.layers.push(reference);
        const before = copyOf(session);

        expect(() => history.begin({ layerId: "layer-x", frameId: FRAME })).toThrow(
            TransactionError,
        );
        expect(() => history.begin({ layerId: "ref-1", frameId: FRAME })).toThrow(TransactionError);
        expect(() => history.begin({ layerId: LAYER, frameId: "frame-x" })).toThrow(
            TransactionError,
        );
        expect(() => history.begin({ ...TARGET, clip: mask(3, 4, []) })).toThrow(TransactionError);
        expect(() =>
            history.begin({ ...TARGET, clip: { width: 4, height: 3, data: new Uint8Array(1) } }),
        ).toThrow(TransactionError);

        expect(session).toStrictEqual(before);
        expect(history.transaction).toBeNull();
        history.begin(TARGET).abort();
    });

    it("while a transaction is open the history rejects begin, execute, undo and redo", () => {
        const { session, image, history } = filledSetup();
        paint(history.begin(TARGET), 0, 0, RED);
        commit(history, "First");
        paint(history.begin(TARGET), 1, 0, RED);
        commit(history, "Second");
        undo(history);
        const patch = pixelPatchCommand(session.doc, {
            label: "Fill",
            imageId: "image-a",
            x: 0,
            y: 0,
            pixels: { width: 1, height: 1, data: Uint8ClampedArray.from(GREEN) },
        });

        const transaction = history.begin(TARGET);
        expect(history.transaction).toBe(transaction);
        const during = image.data.slice();

        expect(() => history.begin(TARGET)).toThrow(TransactionError);
        expect(() => history.execute(patch)).toThrow(TransactionError);
        expect(() => history.undo()).toThrow(TransactionError);
        expect(() => history.redo()).toThrow(TransactionError);
        expect(image.data).toStrictEqual(during);
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(1);
        expect(transaction.open).toBe(true);

        transaction.abort();
        redo(history);
        expect(pixel(image, 1, 0)).toEqual(RED);
    });

    it("a closed transaction rejects markDirty, commit and abort", () => {
        const { history } = filledSetup();
        const committed = history.begin(TARGET);
        paint(committed, 0, 0, RED);
        commit(history, "Pencil");
        const aborted = history.begin(TARGET);
        aborted.abort();

        for (const transaction of [committed, aborted]) {
            expect(transaction.open).toBe(false);
            expect(() => transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 })).toThrow(
                TransactionError,
            );
            expect(() => transaction.commit("Again")).toThrow(TransactionError);
            expect(() => transaction.abort()).toThrow(TransactionError);
        }
        expect(history.undoCount).toBe(1);
        expect(history.transaction).toBeNull();
    });
});
