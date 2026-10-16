import { describe, expect, it } from "vitest";
import { watchPixelMemory } from "../../src/app/state/pixelMemory";
import { createSessionsStore } from "../../src/app/state/sessions";
import { duplicateFramesCommand } from "../../src/core/frames";
import { celKey, createDocument, PIXEL_MEMORY_WARNING_BYTES } from "../../src/core/model";
import { pixelMemoryMessage } from "../../src/ui/sprite/PixelMemoryWarning";

// SE-034: the app warns once when a document's pixel memory passes 512 MB (SPEC §5.1). The
// threshold is lowered by the watch's `thresholdBytes` option: an 8 × 8 image is 256 bytes.

const IMAGE = 8 * 8 * 4;

/** An 8 × 8 document with one cel, open in a store of its own. */
function setup(name = "big") {
    const sessions = createSessionsStore();
    const session = createDocument({ name, width: 8, height: 8 });
    session.doc.images.set("i", { width: 8, height: 8, data: new Uint8ClampedArray(IMAGE) });
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "i",
        opacity: 255,
    });
    const document = sessions.getState().open(session);
    return { sessions, document };
}

describe("the pixel memory warning", () => {
    it("warns once when a document passes the threshold, not at it, and not again", () => {
        const { sessions, document } = setup();
        const warnings: [string, number][] = [];
        const stop = watchPixelMemory({
            sessions,
            thresholdBytes: 2 * IMAGE,
            warn: (warned, bytes) => warnings.push([warned.id, bytes]),
        });
        const duplicate = () =>
            document.history.execute(
                duplicateFramesCommand(document.session.doc, [document.session.activeFrameId]),
            );
        expect(warnings).toEqual([]);
        duplicate(); // 2 images: at the threshold, not past it.
        expect(warnings).toEqual([]);
        duplicate(); // 3 images: past it.
        expect(warnings).toEqual([[document.id, 3 * IMAGE]]);
        duplicate();
        document.history.undo();
        document.history.undo();
        document.history.undo();
        duplicate();
        duplicate();
        sessions.getState().touch(document.id);
        expect(warnings).toHaveLength(1);
        stop();
    });

    it("warns about each document of its own, and about one that is past it when the watch starts", () => {
        const { sessions, document } = setup("first");
        const other = createDocument({ name: "second", width: 8, height: 8 });
        const warnings: string[] = [];
        const stop = watchPixelMemory({
            sessions,
            thresholdBytes: 0,
            warn: (warned) => warnings.push(warned.session.doc.name),
        });
        expect(warnings).toEqual(["first"]);
        sessions.getState().open(other);
        expect(warnings).toEqual(["first"]);
        // The second document has no image yet: 0 bytes is not past 0. Once it has one, it is
        // warned about on its own.
        const second = sessions.getState().documents[1];
        second.session.doc.images.set("j", {
            width: 8,
            height: 8,
            data: new Uint8ClampedArray(IMAGE),
        });
        second.session.doc.cels.set(
            celKey(second.session.activeLayerId, second.session.activeFrameId),
            { imageId: "j", opacity: 255 },
        );
        sessions.getState().touch(second.id);
        expect(warnings).toEqual(["first", "second"]);
        stop();
        sessions.getState().touch(document.id);
        expect(warnings).toEqual(["first", "second"]);
    });

    it("uses 512 MB unless told otherwise, and says what the 1 GB limit refuses", () => {
        expect(PIXEL_MEMORY_WARNING_BYTES).toBe(512 * 1024 * 1024);
        const { sessions } = setup();
        const warnings: number[] = [];
        const stop = watchPixelMemory({ sessions, warn: (_, bytes) => warnings.push(bytes) });
        expect(warnings).toEqual([]);
        stop();
        expect(pixelMemoryMessage("hero", 513 * 1024 * 1024)).toBe(
            "“hero” uses 513 MB of pixel memory. Operations that would pass 1024 MB are refused.",
        );
    });
});
