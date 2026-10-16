import { expect } from "vitest";
import { History } from "../../src/core/history";
import type { Command, HistoryOptions } from "../../src/core/history";
import { assertInvariants, celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer, ReferenceLayer, SpriteDoc } from "../../src/core/model";
import { rectMask, selectionOf } from "../../src/core/selection";

// Shared by the SE-034 tests: a document of several layers and frames with linked cels, a
// reference layer, a tag and an active selection, and a deep picture of a session.

export const SIDE = 32;
export const L1 = "layer-1";
export const REF = "layer-ref";
export const L2 = "layer-2";
export const FRAMES = ["frame-1", "frame-2", "frame-3"] as const;
export const IMAGE_A = "image-a";
export const IMAGE_B = "image-b";
export const IMAGE_C = "image-c";

/** A `width` × `height` image with an opaque rectangle of colour `rgb` inside it. */
export function imageWith(
    width: number,
    height: number,
    rect: { x: number; y: number; width: number; height: number },
    rgb: readonly [number, number, number],
): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const at = (y * width + x) * 4;
            data.set([rgb[0], rgb[1], rgb[2], 255], at);
        }
    }
    return { width, height, data };
}

/** A `width` × `height` image whose every pixel is distinct: (x, y, seed, 255). */
export function patterned(width: number, height: number, seed: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set([x, y, seed, 255], (y * width + x) * 4);
    }
    return { width, height, data };
}

/** RGBA of one pixel. */
export function pixelAt(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return Array.from(image.data.subarray(at, at + 4));
}

/**
 * 32 × 32, layers L1 (pixel), REF (reference), L2 (pixel), three frames. L1 has image A at
 * frames 1 and 2 (linked) and image B at frame 3; L2 has image C at frame 2. The content
 * differs per frame: A covers (4..11, 6..9), B (20..27, 2..5), C (10..13, 20..29). A tag spans
 * frames 2–3 and the selection is the rectangle (2, 3, 10, 12).
 */
export function fixture(): DocSession {
    const session = createDocument({ name: "fixture", width: SIDE, height: SIDE });
    const { doc } = session;
    const first = doc.layers[0];
    doc.layers = [
        { ...first, id: L1, name: "One" },
        {
            id: REF,
            name: "Ref",
            kind: "reference",
            visible: true,
            locked: false,
            opacity: 128,
            sourceId: "source-1",
            x: 3.5,
            y: -2,
            scale: 0.5,
            placement: "behind",
        },
        { ...first, id: L2, name: "Two" },
    ];
    doc.frames = FRAMES.map((id) => ({ id, durationMs: 100 }));
    doc.images.set(
        IMAGE_A,
        imageWith(SIDE, SIDE, { x: 4, y: 6, width: 8, height: 4 }, [255, 0, 0]),
    );
    doc.images.set(
        IMAGE_B,
        imageWith(SIDE, SIDE, { x: 20, y: 2, width: 8, height: 4 }, [0, 255, 0]),
    );
    doc.images.set(
        IMAGE_C,
        imageWith(SIDE, SIDE, { x: 10, y: 20, width: 4, height: 10 }, [0, 0, 255]),
    );
    doc.cels.set(celKey(L1, FRAMES[0]), { imageId: IMAGE_A, opacity: 255 });
    doc.cels.set(celKey(L1, FRAMES[1]), { imageId: IMAGE_A, opacity: 200 });
    doc.cels.set(celKey(L1, FRAMES[2]), { imageId: IMAGE_B, opacity: 255 });
    doc.cels.set(celKey(L2, FRAMES[1]), { imageId: IMAGE_C, opacity: 255 });
    doc.tags = [
        {
            id: "tag-1",
            name: "Walk",
            color: 0xff0000ff,
            fromFrameId: FRAMES[1],
            toFrameId: FRAMES[2],
            direction: "forward",
            repeat: 0,
        },
    ];
    doc.pivot = { x: 0.25, y: 1 };
    session.activeLayerId = L2;
    session.activeFrameId = FRAMES[1];
    session.selection = selectionOf(rectMask(SIDE, SIDE, { x: 2, y: 3, width: 10, height: 12 }));
    assertInvariants(session);
    return session;
}

export function reference(doc: SpriteDoc, id = REF): ReferenceLayer {
    const layer = doc.layers.find((candidate) => candidate.id === id);
    if (layer?.kind !== "reference") throw new Error(`no reference layer ${id}`);
    return layer;
}

/** Everything of a session, as plain data in the order of its maps. */
export function snapshot(session: DocSession) {
    const { doc, selection } = session;
    return {
        doc: {
            ...doc,
            layers: doc.layers.map((layer) => ({ ...layer })),
            frames: doc.frames.map((frame) => ({ ...frame })),
            cels: [...doc.cels].map(([key, cel]) => [key, { ...cel }]),
            images: [...doc.images].map(([id, image]) => [
                id,
                image.width,
                image.height,
                Array.from(image.data),
            ]),
            tags: doc.tags.map((tag) => ({ ...tag })),
            palette: { ...doc.palette, colors: [...doc.palette.colors] },
            pivot: { ...doc.pivot },
            settings: structuredClone(doc.settings),
            exportSettings: structuredClone(doc.exportSettings),
        },
        selection: selection && {
            bounds: { ...selection.bounds },
            mask: [selection.mask.width, selection.mask.height, Array.from(selection.mask.data)],
        },
        activeLayerId: session.activeLayerId,
        activeFrameId: session.activeFrameId,
    };
}

/** The command, which the test expects to exist. */
export function made(command: Command | null): Command {
    if (!command) throw new Error("expected a command");
    return command;
}

export function historyOf(session: DocSession, options?: HistoryOptions): History {
    return new History(session, options);
}

/**
 * Executes `command` on a history of `session`, then checks the invariants, undoes it (the
 * session is as before, down to the order of its maps), redoes it (as after the first do)
 * and undoes it again. Returns the snapshot after the first do.
 */
export function expectSymmetric(session: DocSession, command: Command) {
    const history = historyOf(session);
    const before = snapshot(session);
    history.execute(command);
    assertInvariants(session);
    const after = snapshot(session);
    expect(history.undo()).toBe(true);
    assertInvariants(session);
    expect(snapshot(session)).toEqual(before);
    expect(history.redo()).toBe(true);
    assertInvariants(session);
    expect(snapshot(session)).toEqual(after);
    expect(history.undo()).toBe(true);
    expect(snapshot(session)).toEqual(before);
    return after;
}
