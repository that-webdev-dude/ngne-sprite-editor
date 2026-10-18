import { describe, expect, it } from "vitest";
import { CLIPBOARD_FEEDBACK, createEditorClipboard } from "../../src/app/selection/clipboard";
import type { EditorClipboard } from "../../src/app/selection/clipboard";
import { createFloatingState } from "../../src/app/selection/floatingState";
import type { FloatingState } from "../../src/app/selection/floatingState";
import type { SystemClipboard, SystemClipboardRead } from "../../src/app/platform/clipboard";
import { createActiveComposites } from "../../src/app/state/composites";
import { activeDocument, createSessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { celAt, celKey, createDocument, sequentialIds } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { decodePng, encodePng } from "../../src/core/png";
import { createMask, fullMask, selectionOf, setMaskPixel } from "../../src/core/selection";
import { manualFrames } from "./se-014-support";

// SE-032: Cut, Copy, Paste, Delete and Fill (`clipboard.ts`) over a system clipboard of the
// test's own. That clipboard behaves as Chrome's does with `image/png`: what is written is
// decoded and encoded again through premultiplied alpha, so a translucent pixel may come back
// with other colours and a transparent one comes back 0, 0, 0, 0; opaque pixels come back as
// they were. The acceptance of the ticket: the editor's own copy pastes byte for byte; the
// system clipboard round trip keeps opaque pixels; without access the editor's clipboard still
// works and the status bar says so.

const W = 10;
const H = 8;

/** A pattern with opaque, translucent and transparent pixels; the transparent ones have colour. */
function pattern(width = W, height = H): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = (x + y) % 3 === 0 ? 255 : (x + y) % 3 === 1 ? 77 : 0;
            data.set([30 + x * 21, 15 + y * 29, (x * y * 5) & 255, alpha], (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

/** A system clipboard that re-encodes what is written as Chrome's sanitizer does. */
function chromeLikeClipboard(
    access: { read: boolean; write: boolean } = { read: true, write: true },
) {
    const state = { bytes: null as Uint8Array | null, writes: 0, reads: 0 };
    const system: SystemClipboard = {
        async writePng(bytes) {
            if (!access.write) return false;
            state.writes++;
            const image = await decodePng(bytes);
            const data = image.data;
            for (let at = 0; at < data.length; at += 4) {
                const alpha = data[at + 3]!;
                for (let channel = 0; channel < 3; channel++) {
                    const premultiplied = Math.round((data[at + channel]! * alpha) / 255);
                    data[at + channel] =
                        alpha === 0 ? 0 : Math.round((premultiplied * 255) / alpha);
                }
            }
            state.bytes = encodePng(image);
            return true;
        },
        async readPng(): Promise<SystemClipboardRead> {
            state.reads++;
            if (!access.read) return { kind: "unavailable" };
            return state.bytes ? { kind: "image", bytes: state.bytes.slice() } : { kind: "none" };
        },
    };
    return { system, state, access };
}

interface Setup {
    clipboard: EditorClipboard;
    floating: FloatingState;
    feedback: string[];
    errors: string[];
    selected: string[];
    open(image: PixelBuffer | null, prefix: string): OpenDocument;
    active(): OpenDocument;
    frames: ReturnType<typeof manualFrames>;
}

function setUp(system: SystemClipboard, centre = { x: W / 2, y: H / 2 }): Setup {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    const frames = manualFrames();
    const floating = createFloatingState({
        sessions,
        composites,
        viewport: { invalidate() {} },
        nextFrame: frames.request,
        context() {},
    });
    const feedback: string[] = [];
    const errors: string[] = [];
    const selected: string[] = [];
    const active = () => {
        const document = activeDocument(sessions.getState());
        if (!document) throw new Error("no active document");
        return document;
    };
    const clipboard = createEditorClipboard({
        sessions,
        floating,
        system,
        feedback: (message) => void feedback.push(message),
        notices: { error: (message) => void errors.push(message) },
        foreground: () => 0xff8000ff,
        selectMove: () => void selected.push("move"),
        centre: () => centre,
    });
    return {
        clipboard,
        floating,
        feedback,
        errors,
        selected,
        frames,
        active,
        open(image, prefix) {
            const session: DocSession = createDocument(
                { name: prefix, width: W, height: H },
                sequentialIds(prefix),
            );
            if (image) {
                session.doc.images.set(`${prefix}img`, image);
                session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
                    imageId: `${prefix}img`,
                    opacity: 255,
                });
            }
            sessions.getState().open(session);
            return active();
        },
    };
}

/** A selection of an irregular shape: a plus of five pixels around (cx, cy), and (cx + 3, cy). */
function shape(cx: number, cy: number) {
    const mask = createMask(W, H);
    for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [3, 0],
    ] as const) {
        setMaskPixel(mask, cx + dx, cy + dy);
    }
    return selectionOf(mask)!;
}

function image(document: OpenDocument): PixelBuffer | null {
    const { session } = document;
    const cel = celAt(session.doc, session.activeLayerId, session.activeFrameId);
    return cel ? (session.doc.images.get(cel.imageId) ?? null) : null;
}

function rgba(buffer: PixelBuffer, x: number, y: number): number[] {
    const at = (y * buffer.width + x) * 4;
    return Array.from(buffer.data.slice(at, at + 4));
}

describe("copy and paste within the app", () => {
    it("pastes the editor's own copy byte for byte, with its shape, though the system clipboard re-encoded it", async () => {
        const { system, state } = chromeLikeClipboard();
        const test = setUp(system);
        const source = test.open(pattern(), "a-");
        source.session.selection = shape(3, 4);
        await test.clipboard.copy();
        expect(state.writes).toBe(1);
        expect(test.feedback).toEqual([]);

        const target = test.open(null, "b-");
        await test.clipboard.paste();
        expect(state.reads).toBe(1);
        expect(test.selected).toEqual(["move"]);
        const float = test.floating.float!;
        // Its shape: the copied mask, not the PNG's rectangle.
        expect(float.content.mask).toEqual(test.clipboard.content!.mask);
        // To where it was copied from, then applied.
        test.floating.moveTo(2, 3);
        test.floating.apply();
        const pasted = image(target)!;
        const original = pattern();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inShape = source.session.selection!.mask;
                const bit = y * W + x;
                const selected = (inShape.data[bit >> 3]! & (1 << (bit & 7))) !== 0;
                expect(rgba(pasted, x, y), `${x},${y}`).toEqual(
                    selected ? rgba(original, x, y) : [0, 0, 0, 0],
                );
            }
        }
        expect(target.history.undoLabel).toBe("Paste");
        expect(test.errors).toEqual([]);
    });

    it("puts the paste's centre on the pixel at the centre of the viewport, at whole pixels; a larger image than the canvas floats whole", async () => {
        const { system } = chromeLikeClipboard({ read: false, write: false });
        const test = setUp(system, { x: 5.5, y: 3.2 });
        const document = test.open(pattern(), "c-");
        document.session.selection = selectionOf(
            (() => {
                const mask = createMask(W, H);
                for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setMaskPixel(mask, x, y);
                return mask;
            })(),
        );
        await test.clipboard.copy();
        test.active().session.selection = null;
        await test.clipboard.paste();
        expect(test.floating.float?.bounds).toEqual({ x: 4, y: 2, width: 3, height: 3 });
        test.floating.cancel();

        // A system image larger than the canvas.
        const big = chromeLikeClipboard();
        await big.system.writePng(encodePng(pattern(14, 11)));
        const wide = setUp(big.system, { x: 5, y: 4 });
        wide.open(null, "d-");
        await wide.clipboard.paste();
        expect(wide.floating.float?.bounds).toEqual({ x: -2, y: -1, width: 14, height: 11 });
        wide.floating.apply();
        const applied = image(wide.active())!;
        expect(applied.width).toBe(W);
        const source = pattern(14, 11);
        // Clipped to the canvas; an opaque pixel of the source is as it was.
        expect(rgba(source, 2, 1)[3]).toBe(255);
        expect(rgba(applied, 0, 0)).toEqual(rgba(source, 2, 1));
    });
});

describe("the system clipboard", () => {
    it("copied to the system clipboard and pasted back elsewhere, opaque pixels are identical", async () => {
        const shared = chromeLikeClipboard();
        const first = setUp(shared.system);
        const source = first.open(pattern(), "e-");
        source.session.selection = shape(4, 3);
        await first.clipboard.copy();
        const copied = first.clipboard.content!;

        // Another editor (its own clipboard empty) pastes what the system clipboard holds.
        const second = setUp(shared.system);
        const target = second.open(null, "f-");
        await second.clipboard.paste();
        const float = second.floating.float!;
        expect(float.bounds.width).toBe(copied.pixels.width);
        expect(float.bounds.height).toBe(copied.pixels.height);
        // A PNG has no shape: every pixel of the image floats.
        expect(float.content.mask).toEqual(fullMask(copied.pixels.width, copied.pixels.height));
        let opaque = 0;
        for (let y = 0; y < copied.pixels.height; y++) {
            for (let x = 0; x < copied.pixels.width; x++) {
                const expected = rgba(copied.pixels, x, y);
                if (expected[3] !== 255) continue;
                opaque++;
                expect(rgba(float.content.pixels, x, y), `${x},${y}`).toEqual(expected);
            }
        }
        expect(opaque).toBeGreaterThan(1);
        second.floating.apply();
        expect(target.history.undoLabel).toBe("Paste");
    });

    it("pastes an image another program put on the system clipboard, not the editor's own copy", async () => {
        const shared = chromeLikeClipboard();
        const test = setUp(shared.system);
        const document = test.open(pattern(), "g-");
        document.session.selection = shape(4, 3);
        await test.clipboard.copy();
        const other: PixelBuffer = {
            width: 2,
            height: 1,
            data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
        };
        await shared.system.writePng(encodePng(other));
        await test.clipboard.paste();
        expect(Array.from(test.floating.float!.content.pixels.data)).toEqual(
            Array.from(other.data),
        );
    });

    it("reports a PNG that cannot be read, and pastes nothing", async () => {
        const test = setUp({
            writePng: async () => true,
            readPng: async () => ({ kind: "image", bytes: new Uint8Array([1, 2, 3]) }),
        });
        test.open(pattern(), "h-");
        await test.clipboard.paste();
        expect(test.floating.float).toBeNull();
        expect(test.errors).toHaveLength(1);
        expect(test.errors[0]).toMatch(/^Could not paste the image\./);
    });
});

describe("without access to the system clipboard", () => {
    it("copies and pastes with the editor's clipboard, byte for byte, and the status bar explains", async () => {
        const { system, state } = chromeLikeClipboard({ read: false, write: false });
        const test = setUp(system);
        await test.clipboard.paste();
        expect(test.feedback).toEqual([]);
        const document = test.open(pattern(), "i-");
        await test.clipboard.paste();
        expect(test.feedback).toEqual([CLIPBOARD_FEEDBACK.nothingWithoutAccess]);

        document.session.selection = shape(5, 5);
        await test.clipboard.copy();
        expect(state.bytes).toBeNull();
        expect(test.feedback.at(-1)).toBe(CLIPBOARD_FEEDBACK.copiedInEditor);
        await test.clipboard.paste();
        expect(test.feedback.at(-1)).toBe(CLIPBOARD_FEEDBACK.pastedFromEditor);
        const float = test.floating.float!;
        expect(float.content).toEqual(test.clipboard.content);
        expect(float.content).not.toBe(test.clipboard.content);
        expect(float.content.pixels.data).toEqual(
            (() => {
                const copied = new Uint8ClampedArray(float.content.pixels.data.length);
                const { width } = float.content.pixels;
                const bounds = shape(5, 5).bounds;
                for (let y = 0; y < bounds.height; y++) {
                    for (let x = 0; x < width; x++) {
                        const bit = (bounds.y + y) * W + bounds.x + x;
                        if (!(shape(5, 5).mask.data[bit >> 3]! & (1 << (bit & 7)))) continue;
                        copied.set(
                            rgba(pattern(), bounds.x + x, bounds.y + y),
                            (y * width + x) * 4,
                        );
                    }
                }
                return copied;
            })(),
        );
    });

    it("with nothing on either clipboard the status bar says there is nothing to paste", async () => {
        const { system } = chromeLikeClipboard();
        const test = setUp(system);
        test.open(pattern(), "j-");
        await test.clipboard.paste();
        expect(test.feedback).toEqual([CLIPBOARD_FEEDBACK.nothingToPaste]);
        expect(test.floating.float).toBeNull();
    });
});

describe("the edits and their refusals", () => {
    it("Copy while floating copies the floating pixels and leaves them floating; Cut applies them first", async () => {
        const { system } = chromeLikeClipboard();
        const test = setUp(system);
        const document = test.open(pattern(), "k-");
        document.session.selection = shape(3, 3);
        test.floating.lift(document);
        test.floating.moveBy(2, 0);
        await test.clipboard.copy();
        expect(test.floating.floats()).toBe(true);
        expect(test.clipboard.content).toEqual(test.floating.float!.content);
        const steps = document.history.undoCount;
        await test.clipboard.cut();
        expect(test.floating.floats()).toBe(false);
        expect(document.history.undoCount).toBe(steps + 2);
        expect(document.history.undoLabel).toBe("Cut");
        // The cut pixels are those that were moved, now transparent.
        expect(rgba(image(document)!, 5, 3)).toEqual([0, 0, 0, 0]);
    });

    it("refuses to paste, cut, delete or fill on a locked layer, and to copy from a reference layer", async () => {
        const { system } = chromeLikeClipboard();
        const test = setUp(system);
        const document = test.open(pattern(), "l-");
        document.session.selection = shape(3, 3);
        await test.clipboard.copy();
        const layer = document.session.doc.layers[0]!;
        layer.locked = true;
        await test.clipboard.paste();
        await test.clipboard.cut();
        test.clipboard.deleteSelected();
        test.clipboard.fill();
        expect(test.feedback).toEqual(Array(4).fill("Layer is locked"));
        expect(document.history.undoCount).toBe(0);
        expect(test.floating.float).toBeNull();

        document.session.doc.layers.push({
            kind: "reference",
            id: "ref",
            name: "Reference",
            visible: true,
            locked: false,
            opacity: 128,
            sourceId: "src",
            x: 0,
            y: 0,
            scale: 1,
            placement: "behind",
        });
        document.session.activeLayerId = "ref";
        await test.clipboard.copy();
        expect(test.feedback.at(-1)).toBe(CLIPBOARD_FEEDBACK.reference);
    });

    it("Fill writes the foreground into the selected pixels as one step", () => {
        const { system } = chromeLikeClipboard();
        const test = setUp(system);
        const document = test.open(null, "m-");
        document.session.selection = shape(3, 3);
        test.clipboard.fill();
        expect(rgba(image(document)!, 3, 3)).toEqual([0xff, 0x80, 0x00, 0xff]);
        expect(rgba(image(document)!, 6, 3)).toEqual([0xff, 0x80, 0x00, 0xff]);
        expect(rgba(image(document)!, 4, 4)).toEqual([0, 0, 0, 0]);
        expect(document.history.undoLabel).toBe("Fill");
    });
});
