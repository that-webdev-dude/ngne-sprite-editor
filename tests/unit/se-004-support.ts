import { expect } from "vitest";
import type { Command, History, PixelAllocator, Transaction } from "../../src/core/history";
import { assertInvariants, celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer, PixelLayer, Rect } from "../../src/core/model";

// Shared by the SE-004 tests. `execute`, `undo`, `redo` and `commit` call `assertInvariants`
// after the step they perform, so every do, undo and redo made through them is checked.

export const LAYER = "layer-a";
export const FRAME = "frame-a";

/** A session on a new `width` × `height` document with the layer `LAYER` and the frame `FRAME`. */
export function newSession(width: number, height: number): DocSession {
    const ids = ["doc", LAYER, FRAME];
    return createDocument({ name: "fixture", width, height }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("newSession: unexpected ID request");
        return id;
    });
}

export function addLayer(session: DocSession, id: string): void {
    const layer: PixelLayer = {
        id,
        name: id,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    };
    session.doc.layers.push(layer);
}

export function addFrame(session: DocSession, id: string): void {
    session.doc.frames.push({ id, durationMs: 100 });
}

/** Bytes 1, 2, 3, … so that every pixel of a test image differs from every other. */
export function countingBytes(length: number, first = 1): Uint8ClampedArray {
    return Uint8ClampedArray.from({ length }, (_, index) => (first + index) % 256);
}

/** Gives a cel an image of its own, filled with `bytes` (default: transparent). */
export function addCel(
    session: DocSession,
    layerId: string,
    frameId: string,
    imageId: string,
    bytes?: Uint8ClampedArray,
): PixelBuffer {
    const { doc } = session;
    const data = bytes ?? new Uint8ClampedArray(doc.width * doc.height * 4);
    const image = { width: doc.width, height: doc.height, data };
    doc.images.set(imageId, image);
    doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
    return image;
}

/** Makes the cel at (layerId, frameId) a linked cel of an existing image. */
export function linkCel(
    session: DocSession,
    layerId: string,
    frameId: string,
    imageId: string,
): void {
    session.doc.cels.set(celKey(layerId, frameId), { imageId, opacity: 255 });
}

/** A deep copy of the whole session, for "unchanged" and "restored" comparisons. */
export function copyOf(session: DocSession): DocSession {
    return structuredClone(session);
}

export function execute(history: History, command: Command): void {
    history.execute(command);
    assertInvariants(history.session);
}

export function undo(history: History): void {
    expect(history.undo()).toBe(true);
    assertInvariants(history.session);
}

export function redo(history: History): void {
    expect(history.redo()).toBe(true);
    assertInvariants(history.session);
}

/** Commits the history's open transaction. */
export function commit(history: History, label: string): Command | null {
    const transaction = history.transaction;
    if (!transaction) throw new Error("commit: no transaction is open");
    const command = transaction.commit(label);
    assertInvariants(history.session);
    return command;
}

/** Writes `rgba` to one pixel of the transaction's image and reports it. */
export function paint(transaction: Transaction, x: number, y: number, rgba: number[]): void {
    transaction.image.data.set(rgba, (y * transaction.image.width + x) * 4);
    transaction.markDirty({ x, y, width: 1, height: 1 });
}

/** Writes `bytes` over `rect` of the transaction's image and reports the rectangle. */
export function paintRect(transaction: Transaction, rect: Rect, bytes: Uint8ClampedArray): void {
    const { image } = transaction;
    for (let row = 0; row < rect.height; row++) {
        const from = row * rect.width * 4;
        image.data.set(
            bytes.subarray(from, from + rect.width * 4),
            ((rect.y + row) * image.width + rect.x) * 4,
        );
    }
    transaction.markDirty(rect);
}

export function pixel(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return Array.from(image.data.subarray(at, at + 4));
}

/** What the platform throws when it cannot allocate a typed array. */
function outOfMemory(): never {
    throw new RangeError("Array buffer allocation failed");
}

/** An allocator that always fails. */
export const failingAllocator: PixelAllocator = outOfMemory;

/**
 * An allocator that works `successes` times and fails from then on, until `heal()` is
 * called. `calls` counts every request.
 */
export function flakyAllocator(successes: number): {
    allocate: PixelAllocator;
    heal(): void;
    readonly calls: number;
} {
    let calls = 0;
    let healed = false;
    return {
        allocate(byteLength) {
            calls++;
            if (!healed && calls > successes) outOfMemory();
            return new Uint8ClampedArray(byteLength);
        },
        heal() {
            healed = true;
        },
        get calls() {
            return calls;
        },
    };
}
