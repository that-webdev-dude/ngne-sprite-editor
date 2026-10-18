import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import type { Command } from "../../src/app/commands/types";
import { commandDialogs } from "../../src/app/dialogs/dialogRequests";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { isFloating } from "../../src/app/selection/floating";
import { floatingState } from "../../src/app/selection/floatingState";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { TAG_COMMANDS as TAGS } from "../../src/app/timeline/tagCommandIds";
import { isTagRequest } from "../../src/app/timeline/tagDialogs";
import { initialTagState, tagStore, withTagArguments } from "../../src/app/timeline/tagState";
import { addFrameCommand } from "../../src/core/frames";
import { celKey, createDocument } from "../../src/core/model";
import type { DocSession, PixelBuffer } from "../../src/core/model";
import { rectMask, selectCommand } from "../../src/core/selection";
import { createTagCommand } from "../../src/core/tags";

// SE-023: the tag commands with a real floating selection (SE-032's `applyFloating`): Tag
// Properties…, Delete Tag and Apply Tag Range apply the float first — one "Move" step, then
// the tag's step — and leave no transaction open.

/** Animation frames that run only when the test says so (the app's float follows them). */
const frames = vi.hoisted(() => ({ next: 1, queue: new Map<number, () => void>() }));

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
        const id = frames.next++;
        frames.queue.set(id, callback);
        return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.queue.delete(id));
});

afterEach(() => {
    floatingState.cancel();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    frames.queue.clear();
    tagStore.setState(initialTagState());
    setKeyContext("floating", false);
    vi.unstubAllGlobals();
});

const W = 8;
const H = 6;

function pattern(seed: number): PixelBuffer {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let index = 0; index < W * H; index++) {
        data.set([seed * 40 + index, index * 3, seed * 7, 255], index * 4);
    }
    return { width: W, height: H, data };
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no active document");
    return document;
}

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

const TAG = "walk";

/**
 * A document of three painted frames with the tag "walk" over frames 1–2, frame 1 active,
 * and a selection of its pixels lifted and moved one pixel: a float that applies as a step.
 */
function floating(): OpenDocument {
    const session: DocSession = createDocument({ name: "float", width: W, height: H });
    const document = sessionsStore.getState().open(session);
    for (let index = 1; index < 3; index++) {
        document.history.execute(addFrameCommand(session.doc, session.activeFrameId));
    }
    session.doc.frames.forEach((frame, index) => {
        const imageId = `image-${index}`;
        session.doc.images.set(imageId, pattern(index + 1));
        session.doc.cels.set(celKey(session.activeLayerId, frame.id), { imageId, opacity: 255 });
    });
    const [first, second] = session.doc.frames;
    session.activeFrameId = first!.id;
    sessionsStore.getState().touch(document.id);
    const tag = createTagCommand(
        session.doc,
        {
            name: TAG,
            color: 0x73bed3ff,
            fromFrameId: first!.id,
            toFrameId: second!.id,
            direction: "forward",
            repeat: 0,
        },
        () => TAG,
    );
    document.history.execute(tag);
    const mask = rectMask(W, H, { x: 1, y: 1, width: 3, height: 2 });
    const select = selectCommand(session, mask, "replace", "Select");
    if (select) document.history.execute(select);
    floatingState.lift(active());
    floatingState.moveBy(1, 0);
    expect(isFloating()).toBe(true);
    expect(document.history.transaction).not.toBeNull();
    return active();
}

/** The float was applied as one "Move" step, then `label` was recorded after it. */
function expectMoveThen(document: OpenDocument, start: number, label: string): void {
    const { history } = document;
    expect(isFloating()).toBe(false);
    expect(history.transaction).toBeNull();
    expect(history.undoCount).toBe(start + 2);
    expect(history.undoLabel).toBe(label);
    history.undo();
    expect(history.undoLabel).toBe("Move");
}

describe("the tag commands apply a floating selection first", () => {
    it("Tag Properties…: a Move step, then Edit Tag", async () => {
        const document = floating();
        const start = document.history.undoCount;
        const detach = commandDialogs.attachHost();
        try {
            expect(command(TAGS.tagProperties).enabled()).toBe(true);
            const done = command(TAGS.tagProperties).run();
            const request = commandDialogs.store.getState().request;
            if (!request || !isTagRequest(request)) throw new Error("no Tag dialog");
            request.answer({
                action: "apply",
                tagId: request.chosen,
                values: { ...request.initial, name: "run" },
            });
            await done;
        } finally {
            detach();
        }
        expect(document.session.doc.tags[0]?.name).toBe("run");
        expectMoveThen(document, start, "Edit Tag");
        expect(document.session.doc.tags[0]?.name).toBe(TAG);
    });

    it("Delete Tag: a Move step, then Delete Tag", () => {
        const document = floating();
        const start = document.history.undoCount;
        expect(command(TAGS.deleteTag).enabled()).toBe(true);
        void command(TAGS.deleteTag).run();
        expect(document.session.doc.tags).toEqual([]);
        expectMoveThen(document, start, "Delete Tag");
        expect(document.session.doc.tags.map((tag) => tag.id)).toEqual([TAG]);
    });

    it("Apply Tag Range: a Move step, then Edit Tag", () => {
        const document = floating();
        const start = document.history.undoCount;
        const { frames: list } = document.session.doc;
        const range = {
            documentId: document.id,
            tagId: TAG,
            fromFrameId: list[0]!.id,
            toFrameId: list[2]!.id,
        };
        withTagArguments({ range }, () => {
            expect(command(TAGS.applyTagRange).enabled()).toBe(true);
            void command(TAGS.applyTagRange).run();
        });
        expect(document.session.doc.tags[0]?.toFrameId).toBe(list[2]!.id);
        expectMoveThen(document, start, "Edit Tag");
        expect(document.session.doc.tags[0]?.toFrameId).toBe(list[1]!.id);
    });
});
