import { describe, expect, it } from "vitest";
import { History, compositeCommand, pixelPatchCommand } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { assertInvariants } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    addFrame,
    addLayer,
    commit,
    copyOf,
    countingBytes,
    execute,
    linkCel,
    newSession,
    paint,
    redo,
    undo,
} from "./se-004-support";

// The helpers `execute`, `undo`, `redo` and `commit` of se-004-support call `assertInvariants`
// after their step. This test adds a subscriber that does the same from inside the history,
// and counts the steps so that none can pass unchecked.

describe("invariants of SPEC §5.1", () => {
    it("assertInvariants holds after every do, undo and redo of every kind of command", () => {
        const session = newSession(4, 3);
        addLayer(session, "layer-b");
        addFrame(session, "frame-b");
        addCel(session, "layer-b", FRAME, "image-b", countingBytes(48));
        linkCel(session, "layer-b", "frame-b", "image-b");
        assertInvariants(session);
        const start = copyOf(session);
        const history = new History(session);
        const checked: string[] = [];
        history.subscribe((change) => {
            assertInvariants(session);
            checked.push(`${change.kind} ${change.label}`);
        });
        const dot = (imageId: string, x: number, y: number): Command =>
            pixelPatchCommand(session.doc, {
                label: "Dot",
                imageId,
                x,
                y,
                pixels: { width: 1, height: 1, data: Uint8ClampedArray.of(9, 8, 7, 255) },
            });

        // A stroke on an empty cel: the cel exists, transparent, from `begin` on.
        const first = history.begin({ layerId: LAYER, frameId: FRAME });
        assertInvariants(session);
        paint(first, 0, 0, [255, 0, 0, 255]);
        commit(history, "Stroke on empty cel");

        // An aborted stroke on another empty cel, which is removed again.
        const aborted = history.begin({ layerId: LAYER, frameId: "frame-b" });
        assertInvariants(session);
        paint(aborted, 1, 1, [0, 255, 0, 255]);
        aborted.abort();
        assertInvariants(session);

        // A stroke on a linked image, a pixel patch command and a composite of two patches.
        paint(history.begin({ layerId: "layer-b", frameId: "frame-b" }), 3, 2, [0, 0, 255, 255]);
        commit(history, "Stroke on linked cel");
        execute(history, dot("image-b", 2, 0));
        execute(
            history,
            compositeCommand("Two dots", [dot(first.imageId, 1, 2), dot("image-b", 0, 1)]),
        );
        const end = copyOf(session);

        while (history.canUndo) undo(history);
        expect(session).toStrictEqual(start);
        while (history.canRedo) redo(history);
        expect(session).toStrictEqual(end);

        const labels = ["Stroke on empty cel", "Stroke on linked cel", "Dot", "Two dots"];
        expect(checked).toEqual([
            ...labels.map((label) => `do ${label}`),
            ...[...labels].reverse().map((label) => `undo ${label}`),
            ...labels.map((label) => `redo ${label}`),
        ]);
    });
});
