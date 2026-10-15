import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import type { HistoryChange } from "../../src/core/history";
import { celAt } from "../../src/core/model";
import {
    FRAME,
    LAYER,
    addCel,
    commit,
    copyOf,
    countingBytes,
    newSession,
    paint,
    paintRect,
    pixel,
    undo,
} from "./se-004-support";

// SE-015 (review): a stroke that changes nothing records nothing (SPEC §7.1), also when it
// reported pixels that it then gave their first value back (pixel-perfect taking a pixel
// back, a Shift line drawn back over itself). The commit keeps the bounding rectangle of the
// pixels whose bytes differ from `begin` and, when none does, acts as an abort.

const TARGET = { layerId: LAYER, frameId: FRAME };
const RED = [255, 0, 0, 255];

describe("commit of a transaction whose pixels end as they began", () => {
    it("on an existing cel: no entry, no notification, the session as at begin", () => {
        const session = newSession(4, 3);
        const image = addCel(session, LAYER, FRAME, "image-a", countingBytes(48));
        const history = new History(session);
        const atBegin = copyOf(session);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const transaction = history.begin(TARGET);
        const first = pixel(image, 2, 1);
        paint(transaction, 2, 1, RED);
        paint(transaction, 0, 0, RED);
        // Both written back as they were, and reported again.
        paint(transaction, 2, 1, first);
        paint(transaction, 0, 0, [1, 2, 3, 4]);
        expect(transaction.dirty).toEqual({ x: 0, y: 0, width: 3, height: 2 });
        expect(commit(history, "Pencil")).toBeNull();

        expect(transaction.open).toBe(false);
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);
        expect(session).toStrictEqual(atBegin);
    });

    it("on a cel it created: no entry, and the cel is not kept", () => {
        const session = newSession(4, 3);
        const history = new History(session);
        const atBegin = copyOf(session);

        const transaction = history.begin(TARGET);
        expect(transaction.createdCel).toBe(true);
        paint(transaction, 1, 1, RED);
        paint(transaction, 1, 1, [0, 0, 0, 0]);
        expect(commit(history, "Pencil")).toBeNull();

        expect(history.undoCount).toBe(0);
        expect(celAt(session.doc, LAYER, FRAME)).toBeUndefined();
        expect(session).toStrictEqual(atBegin);
    });

    it("records the bounding rectangle of the pixels that differ, not of every reported one", () => {
        const session = newSession(4, 3);
        const image = addCel(session, LAYER, FRAME, "image-a", countingBytes(48));
        const history = new History(session);
        const before = image.data.slice();

        const transaction = history.begin(TARGET);
        // The whole image reported, the same bytes written back but for pixel 3, 2.
        paintRect(transaction, { x: 0, y: 0, width: 4, height: 3 }, before);
        paint(transaction, 3, 2, RED);
        const command = commit(history, "Pencil");

        // Before and after of one pixel.
        expect(command?.bytes).toBe(2 * 4);
        expect(history.undoCount).toBe(1);
        undo(history);
        expect(image.data).toStrictEqual(before);
    });

    it("on a created cel, records from transparent: one changed pixel of four", () => {
        const session = newSession(4, 3);
        const history = new History(session);
        const transaction = history.begin(TARGET);
        paintRect(transaction, { x: 0, y: 0, width: 2, height: 2 }, new Uint8ClampedArray(16));
        paint(transaction, 1, 1, RED);
        const command = commit(history, "Pencil");
        expect(command?.bytes).toBe(4);
        undo(history);
        expect(celAt(session.doc, LAYER, FRAME)).toBeUndefined();
    });
});
