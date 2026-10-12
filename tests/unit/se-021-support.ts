import { expect } from "vitest";
import { History } from "../../src/core/history";
import type { Command, PixelAllocator } from "../../src/core/history";
import { assertInvariants, celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession, Layer, SpriteDoc, Tag } from "../../src/core/model";

// Shared by the SE-021 tests: one document with linked cels, an empty row, a reference layer
// and three tags, and the checks every command goes through.

/** Side of the fixture's canvas; an image has 16 bytes. */
export const SIDE = 2;
export const IMAGE_BYTES = SIDE * SIDE * 4;

/** The layers of the fixture, bottom to top. `REF` is a reference layer. */
export const L1 = "layer-1";
export const REF = "layer-ref";
export const L2 = "layer-2";
export const L3 = "layer-3";

/** The frames of the fixture, in order. */
export const FRAMES = ["f1", "f2", "f3", "f4", "f5"] as const;
const [F1, F2, F3, F4, F5] = FRAMES;

function pixelLayer(id: string): Layer {
    return {
        id,
        name: id,
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    };
}

function referenceLayer(id: string): Layer {
    return {
        id,
        name: id,
        kind: "reference",
        visible: true,
        locked: false,
        opacity: 128,
        sourceId: `source-of-${id}`,
        x: 0,
        y: 0,
        scale: 1,
        placement: "behind",
    };
}

/** An image whose every byte is `fill`, so two images of the fixture never look alike. */
function image(fill: number) {
    return { width: SIDE, height: SIDE, data: new Uint8ClampedArray(IMAGE_BYTES).fill(fill) };
}

function tag(id: string, fromFrameId: string, toFrameId: string, extra: Partial<Tag> = {}): Tag {
    return {
        id,
        name: id,
        color: 0x3366ccff,
        fromFrameId,
        toFrameId,
        direction: "forward",
        repeat: 0,
        ...extra,
    };
}

export interface Fixture {
    session: DocSession;
    doc: SpriteDoc;
    /** Checks the session after every do, undo and redo. */
    history: History;
}

/**
 * A 2×2 document. Cels by image ID, `.` for an empty cell; `a` and `e` are linked, and the
 * cel of layer-2 at f3 has opacity 128:
 *
 *              f1   f2   f3   f4   f5      duration: 100 100 200 100 50
 *     layer-3  .    .    .    .    g
 *     layer-2  d    .    e    e    .
 *     layer-ref     (reference layer)
 *     layer-1  a    a    b    .    c
 *
 * Tags: intro f1–f2, walk f2–f4 (ping-pong), end f5 (reverse, repeat 2). Image `a` is filled
 * with the byte 10, `b` with 20, … `g` with 70. The active frame is f1.
 */
export function fixture(): Fixture {
    const ids = ["doc", L1, F1];
    const session = createDocument({ name: "fixture", width: SIDE, height: SIDE }, () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("fixture: unexpected ID request");
        return id;
    });
    const { doc } = session;
    doc.layers = [pixelLayer(L1), referenceLayer(REF), pixelLayer(L2), pixelLayer(L3)];
    doc.frames = [
        { id: F1, durationMs: 100 },
        { id: F2, durationMs: 100 },
        { id: F3, durationMs: 200 },
        { id: F4, durationMs: 100 },
        { id: F5, durationMs: 50 },
    ];
    ["a", "b", "c", "d", "e", "g"].forEach((id) => {
        doc.images.set(id, image((id.charCodeAt(0) - 96) * 10));
    });
    const cel = (layerId: string, frameId: string, imageId: string, opacity = 255) =>
        doc.cels.set(celKey(layerId, frameId), { imageId, opacity });
    cel(L1, F1, "a");
    cel(L1, F2, "a");
    cel(L1, F3, "b");
    cel(L1, F5, "c");
    cel(L2, F1, "d");
    cel(L2, F3, "e", 128);
    cel(L2, F4, "e");
    cel(L3, F5, "g");
    doc.tags = [
        tag("intro", F1, F2),
        tag("walk", F2, F4, { direction: "pingpong" }),
        tag("end", F5, F5, { direction: "reverse", repeat: 2 }),
    ];
    assertSound(session);
    const history = new History(session);
    history.subscribe(() => assertSound(session));
    return { session, doc, history };
}

/**
 * Throws unless the session satisfies the invariants of SPEC §5.1 and every cel belongs to a
 * pixel layer and a frame of the document: a cel left behind by a deleted frame would keep
 * its image alive, so the invariants alone do not see it.
 */
export function assertSound(session: DocSession): void {
    assertInvariants(session);
    const { doc } = session;
    const cells = new Set<string>();
    for (const layer of doc.layers) {
        if (layer.kind !== "pixel") continue;
        for (const frame of doc.frames) cells.add(celKey(layer.id, frame.id));
    }
    for (const key of doc.cels.keys()) {
        if (!cells.has(key)) throw new Error(`cel ${key} belongs to no pixel layer and frame`);
    }
}

/**
 * A deep copy of the session for "restored exactly" comparisons. The cels and images are
 * listed in the iteration order of their maps, so that the order counts as well.
 */
export function snapshot(session: DocSession) {
    const copy = structuredClone(session);
    return {
        ...copy,
        doc: { ...copy.doc, cels: [...copy.doc.cels], images: [...copy.doc.images] },
    };
}

export type Snapshot = ReturnType<typeof snapshot>;

/** The command of a factory that must have something to change. */
export function some(command: Command | null): Command {
    if (!command) throw new Error("the command has nothing to change");
    return command;
}

/**
 * Do/undo/redo symmetry: executes the command, which must change the session, then undoes
 * and redoes it `rounds` times. Every undo must leave exactly the session found before the
 * command, every redo exactly the session it left; the invariants are checked after each
 * step. The command is left done.
 */
export function expectSymmetric(
    history: History,
    command: Command | null,
    rounds = 3,
): { before: Snapshot; after: Snapshot } {
    const { session } = history;
    const before = snapshot(session);
    history.execute(some(command));
    assertSound(session);
    const after = snapshot(session);
    expect(after).not.toStrictEqual(before);
    for (let round = 0; round < rounds; round++) {
        expect(history.undo()).toBe(true);
        assertSound(session);
        expect(snapshot(session)).toStrictEqual(before);
        expect(history.redo()).toBe(true);
        assertSound(session);
        expect(snapshot(session)).toStrictEqual(after);
    }
    return { before, after };
}

/** IDs of the document's frames, in order. */
export function frameIds(doc: SpriteDoc): string[] {
    return doc.frames.map((frame) => frame.id);
}

/** The cels of a layer as image IDs, frame by frame; `.` is an empty cell. */
export function row(doc: SpriteDoc, layerId: string): string[] {
    return doc.frames.map((frame) => celAt(doc, layerId, frame.id)?.imageId ?? ".");
}

/** The range of every tag, by tag ID, as `[fromFrameId, toFrameId]`. */
export function tagRanges(doc: SpriteDoc): Record<string, [string, string]> {
    return Object.fromEntries(doc.tags.map((tag) => [tag.id, [tag.fromFrameId, tag.toFrameId]]));
}

/** The bytes of a cel's image; throws when the cell is empty. */
export function celBytes(doc: SpriteDoc, layerId: string, frameId: string): number[] {
    const found = doc.images.get(celAt(doc, layerId, frameId)?.imageId ?? "");
    if (!found) throw new Error(`layer "${layerId}" has no cel at frame "${frameId}"`);
    return Array.from(found.data);
}

/** What the platform throws when it cannot allocate a typed array. */
function outOfMemory(): never {
    throw new RangeError("Array buffer allocation failed");
}

/** An allocator that always fails. */
export const failingAllocator: PixelAllocator = outOfMemory;

/** An allocator that works `successes` times and fails from then on. */
export function flakyAllocator(successes: number): PixelAllocator {
    let calls = 0;
    return (byteLength) => {
        if (++calls > successes) outOfMemory();
        return new Uint8ClampedArray(byteLength);
    };
}
