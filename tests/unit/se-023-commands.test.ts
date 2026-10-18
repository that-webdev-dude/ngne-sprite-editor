import { afterEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import type { Command } from "../../src/app/commands/types";
import { commandDialogs } from "../../src/app/dialogs/dialogRequests";
import { setKeyContext } from "../../src/app/keymap/contextState";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { TAG_COMMANDS as TAGS } from "../../src/app/timeline/tagCommandIds";
import {
    isTagRequest,
    NEW_TAG_NAME,
    newTagColour,
    TAG_COLOURS,
    tagProblems,
} from "../../src/app/timeline/tagDialogs";
import type { TagRequest, TagValues } from "../../src/app/timeline/tagDialogs";
import { initialTagState, tagStore, withTagArguments } from "../../src/app/timeline/tagState";
import { clickTimeline } from "../../src/app/timeline/timelineClicks";
import { TIMELINE_COMMANDS as IDS } from "../../src/app/timeline/timelineCommandIds";
import { activateCel } from "../../src/app/timeline/timelineDocument";
import { initialTimelineState, timelineStore } from "../../src/app/timeline/timelineState";
import { createDocument } from "../../src/core/model";
import { createTagCommand } from "../../src/core/tags";

// SE-023: the tag commands in the app's registry — New Tag… over the selected frames, Tag
// Properties… and Delete Tag on the span's tag or the active tag, Apply Tag Range for a drag —
// what each does to the active document and its history, and the checks of the Tag dialog.

/**
 * Calls of `applyFloating` (SE-032's hook). With `commit`, the hook does what SE-032's will:
 * it commits the transaction that holds the floating pixels, as one step ("Move").
 */
const floating = vi.hoisted(() => ({ calls: 0, commit: false }));
vi.mock("../../src/app/selection/floating", async () => {
    const sessions = await import("../../src/app/state/sessions");
    return {
        applyFloating: () => {
            floating.calls++;
            const document = sessions.activeDocument(sessions.sessionsStore.getState());
            const transaction = document?.history.transaction;
            if (!floating.commit || !transaction) return;
            transaction.image.data[3] = transaction.image.data[3] === 255 ? 0 : 255;
            transaction.markDirty({ x: 0, y: 0, width: 1, height: 1 });
            transaction.commit("Move");
        },
        isFloating: () => false,
    };
});

afterEach(() => {
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    timelineStore.setState(initialTimelineState());
    tagStore.setState(initialTagState());
    setKeyContext("floating", false);
    floating.calls = 0;
    floating.commit = false;
});

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** Runs a command as the registry's callers do: only while enabled. Returns whether it ran. */
function run(id: string): boolean {
    const found = command(id);
    if (!found.enabled()) return false;
    void found.run();
    return true;
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no document is open");
    return document;
}

/** A document with one layer and `frames` frames, the first one active. */
function openWith(frames: number): OpenDocument {
    sessionsStore.getState().open(createDocument({ name: "t", width: 4, height: 4 }));
    for (let index = 1; index < frames; index++) run(IDS.newEmptyFrame);
    activateCel({ frameId: frameAt(0) });
    return active();
}

const frameAt = (index: number) => active().session.doc.frames[index]?.id ?? "";
const tags = () => active().session.doc.tags;

/** Adds a tag over frames `from`..`to` (indices) to the active document; returns its id. */
function addTag(name: string, from: number, to: number): string {
    const { session, history } = active();
    const id = `tag-${name}`;
    const properties = {
        name,
        color: 0x73bed3ff,
        fromFrameId: frameAt(from),
        toFrameId: frameAt(to),
        direction: "forward" as const,
        repeat: 0,
    };
    history.execute(createTagCommand(session.doc, properties, () => id));
    return id;
}

/** A tag of the active document by name, with its range as frame indices. */
function tagNamed(name: string) {
    const tag = tags().find((entry) => entry.name === name);
    if (!tag) return undefined;
    const index = (id: string) => active().session.doc.frames.findIndex((frame) => frame.id === id);
    return { ...tag, from: index(tag.fromFrameId), to: index(tag.toFrameId) };
}

/**
 * Runs a command that opens the Tag dialog, with a dialog host attached, and answers the
 * request with what `respond` returns. Returns the request the dialog was shown.
 */
async function throughDialog(
    id: string,
    respond: (request: TagRequest) => TagValues | null,
): Promise<TagRequest> {
    const detach = commandDialogs.attachHost();
    try {
        const found = command(id);
        expect(found.enabled(), id).toBe(true);
        const done = found.run();
        const request = commandDialogs.store.getState().request;
        if (!request || !isTagRequest(request)) throw new Error(`${id} opened no Tag dialog`);
        request.answer(respond(request));
        await done;
        return request;
    } finally {
        detach();
    }
}

/** Selects frames by index in the timeline's header: a click, then Shift or Ctrl clicks. */
function selectFrames(first: number, ...more: [number, "shift" | "toggle"][]): void {
    clickTimeline({ kind: "frames", frameId: frameAt(first) }, { shift: false, toggle: false });
    for (const [index, how] of more) {
        clickTimeline(
            { kind: "frames", frameId: frameAt(index) },
            { shift: how === "shift", toggle: how === "toggle" },
        );
    }
}

describe("the tag commands in the registry", () => {
    it("New Tag… takes the Frame menu item planned for it; Tag Properties… and Delete Tag follow it in its group", () => {
        const plan = plannedCommands.find((entry) => entry.id === TAGS.newTag);
        expect(plan).toMatchObject({ menuPath: ["Frame"], title: "New Tag…" });
        expect(command(TAGS.newTag)).toMatchObject({
            planned: false,
            menuPath: plan?.menuPath,
            menuOrder: plan?.menuOrder,
        });
        const group = Math.floor((plan?.menuOrder ?? 0) / 100);
        let previous = plan?.menuOrder ?? 0;
        for (const id of [TAGS.tagProperties, TAGS.deleteTag]) {
            const { menuPath, menuOrder } = command(id);
            expect(menuPath, id).toEqual(["Frame"]);
            expect(Math.floor(menuOrder / 100), id).toBe(group);
            expect(menuOrder, id).toBeGreaterThan(previous);
            previous = menuOrder;
        }
        expect(command(TAGS.tagProperties).title()).toBe("Tag Properties…");
        expect(command(TAGS.deleteTag).title()).toBe("Delete Tag");
        // Apply Tag Range is outside the menus: the tag bar runs it.
        expect(command(TAGS.applyTagRange).menuPath).toBeNull();
        // No key of SPEC §7.8 is a tag command's.
        for (const id of Object.values(TAGS)) expect(command(id).shortcuts, id).toEqual([]);
    });

    it("are disabled without a document, and during a stroke", () => {
        for (const id of Object.values(TAGS)) expect(command(id).enabled(), id).toBe(false);
        openWith(3);
        addTag("walk", 0, 2);
        expect(command(TAGS.newTag).enabled()).toBe(true);
        expect(command(TAGS.tagProperties).enabled()).toBe(true);
        expect(command(TAGS.deleteTag).enabled()).toBe(true);
        const { session, history } = active();
        const stroke = history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        for (const id of [TAGS.newTag, TAGS.tagProperties, TAGS.deleteTag]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        stroke.abort();
        expect(command(TAGS.newTag).enabled()).toBe(true);
    });
});

describe("New Tag…", () => {
    it("opens the Tag dialog over the selected frames; Create adds the tag in one undo step", async () => {
        openWith(6);
        selectFrames(1, [4, "shift"]);
        const before = active().history.undoCount;
        const request = await throughDialog(TAGS.newTag, (shown) => shown.initial);
        expect(request).toMatchObject({
            mode: "new",
            frameCount: 6,
            initial: {
                name: NEW_TAG_NAME,
                color: TAG_COLOURS[0]?.color,
                from: 2,
                to: 5,
                direction: "forward",
                repeat: 0,
            },
        });
        expect(tags()).toHaveLength(1);
        expect(tagNamed("Tag")).toMatchObject({
            from: 1,
            to: 4,
            color: TAG_COLOURS[0]?.color,
            direction: "forward",
            repeat: 0,
        });
        const { history } = active();
        expect(history.undoCount).toBe(before + 1);
        expect(history.undoLabel).toBe("New Tag");
        history.undo();
        expect(tags()).toEqual([]);
    });

    it("takes the frames from the first selected to the last, or the active frame when none is selected", async () => {
        openWith(6);
        const start = active().history.undoCount;
        // Frames 2 and 5, Ctrl-toggled: the range runs over the gap.
        selectFrames(1, [4, "toggle"]);
        let request = await throughDialog(TAGS.newTag, () => null);
        expect(request.initial).toMatchObject({ from: 2, to: 5 });
        // Cels of frames 3 and 4.
        clickTimeline(
            { kind: "cels", cel: { layerId: active().session.activeLayerId, frameId: frameAt(2) } },
            { shift: false, toggle: false },
        );
        clickTimeline(
            { kind: "cels", cel: { layerId: active().session.activeLayerId, frameId: frameAt(3) } },
            { shift: true, toggle: false },
        );
        request = await throughDialog(TAGS.newTag, () => null);
        expect(request.initial).toMatchObject({ from: 3, to: 4 });
        // No selection: the active frame.
        activateCel({ frameId: frameAt(5) });
        request = await throughDialog(TAGS.newTag, () => null);
        expect(request.initial).toMatchObject({ from: 6, to: 6 });
        // Cancelled each time: no tag, no step.
        expect(tags()).toEqual([]);
        expect(active().history.undoCount).toBe(start);
    });

    it("creates what the dialog answers: name without surrounding space, colour, range, direction and repeat", async () => {
        openWith(4);
        await throughDialog(TAGS.newTag, (shown) => ({
            ...shown.initial,
            name: "  jump  ",
            color: 0x112233ff,
            from: 2,
            to: 4,
            direction: "pingpong",
            repeat: 3,
        }));
        expect(tagNamed("jump")).toMatchObject({
            color: 0x112233ff,
            from: 1,
            to: 3,
            direction: "pingpong",
            repeat: 3,
        });
    });

    it("proposes the first preset colour no tag has", async () => {
        openWith(2);
        const colours: number[] = [];
        for (let count = 0; count < 3; count++) {
            const request = await throughDialog(TAGS.newTag, (shown) => shown.initial);
            colours.push(request.initial.color);
        }
        expect(colours).toEqual(TAG_COLOURS.slice(0, 3).map((preset) => preset.color));
        expect(newTagColour([{ color: TAG_COLOURS[1]!.color }])).toBe(TAG_COLOURS[0]?.color);
        // Every preset taken: the presets again, by the number of tags.
        const all = TAG_COLOURS.map(({ color }) => ({ color }));
        expect(newTagColour(all)).toBe(TAG_COLOURS[0]?.color);
        expect(newTagColour([...all, { color: 1 }])).toBe(TAG_COLOURS[1]?.color);
    });

    it("applies a floating selection before the tag is added", async () => {
        openWith(2);
        const { session, history } = active();
        const start = history.undoCount;
        history.begin({ layerId: session.activeLayerId, frameId: session.activeFrameId });
        setKeyContext("floating", true);
        floating.commit = true;
        await throughDialog(TAGS.newTag, (shown) => shown.initial);
        expect(floating.calls).toBeGreaterThan(0);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(start + 2);
        expect(history.undoLabel).toBe("New Tag");
        history.undo();
        expect(history.undoLabel).toBe("Move");
    });
});

describe("Tag Properties…", () => {
    it("edits the active tag at the active frame: the shortest one there", async () => {
        openWith(8);
        addTag("outer", 0, 7);
        addTag("inner", 2, 3);
        activateCel({ frameId: frameAt(2) });
        const request = await throughDialog(TAGS.tagProperties, (shown) => ({
            ...shown.initial,
            name: "step",
        }));
        expect(request).toMatchObject({
            mode: "edit",
            frameCount: 8,
            initial: { name: "inner", from: 3, to: 4, direction: "forward", repeat: 0 },
        });
        expect(tags().map((tag) => tag.name)).toEqual(["outer", "step"]);
        expect(active().history.undoLabel).toBe("Edit Tag");
        // At a frame of the outer tag only.
        activateCel({ frameId: frameAt(6) });
        const outer = await throughDialog(TAGS.tagProperties, () => null);
        expect(outer.initial.name).toBe("outer");
        // Outside every tag: disabled.
        const document = active();
        document.session.doc.tags = document.session.doc.tags.filter((tag) => tag.name !== "outer");
        sessionsStore.getState().touch(document.id);
        expect(command(TAGS.tagProperties).enabled()).toBe(false);
        expect(command(TAGS.deleteTag).enabled()).toBe(false);
    });

    it("edits the tag of the span that ran it, whatever the active frame", async () => {
        openWith(8);
        const outer = addTag("outer", 0, 7);
        addTag("inner", 2, 3);
        activateCel({ frameId: frameAt(2) });
        const detach = commandDialogs.attachHost();
        let done: void | Promise<void> = undefined;
        withTagArguments({ target: outer }, () => {
            expect(command(TAGS.tagProperties).enabled()).toBe(true);
            done = command(TAGS.tagProperties).run();
        });
        // The target is read before the dialog opens, and taken out right after.
        expect(tagStore.getState().target).toBeNull();
        const request = commandDialogs.store.getState().request;
        if (!request || !isTagRequest(request)) throw new Error("no Tag dialog");
        expect(request.initial.name).toBe("outer");
        request.answer({ ...request.initial, direction: "reverse", from: 2, to: 8 });
        await done;
        detach();
        expect(tagNamed("outer")).toMatchObject({ direction: "reverse", from: 1, to: 7 });
        expect(tagNamed("inner")).toMatchObject({ direction: "forward", from: 2, to: 3 });
    });

    it("makes one undo step of what changed, and none when nothing did", async () => {
        openWith(5);
        addTag("walk", 1, 3);
        activateCel({ frameId: frameAt(2) });
        const { history } = active();
        const start = history.undoCount;
        await throughDialog(TAGS.tagProperties, (shown) => shown.initial);
        expect(history.undoCount).toBe(start);
        await throughDialog(TAGS.tagProperties, (shown) => ({ ...shown.initial, name: " walk " }));
        expect(history.undoCount).toBe(start);
        await throughDialog(TAGS.tagProperties, () => null);
        expect(history.undoCount).toBe(start);

        await throughDialog(TAGS.tagProperties, (shown) => ({
            ...shown.initial,
            name: "run",
            direction: "pingpong",
            repeat: 2,
            color: 0x000000ff,
            to: 5,
        }));
        expect(history.undoCount).toBe(start + 1);
        expect(tagNamed("run")).toMatchObject({
            direction: "pingpong",
            repeat: 2,
            color: 0x000000ff,
            from: 1,
            to: 4,
        });
        history.undo();
        expect(tagNamed("walk")).toMatchObject({
            direction: "forward",
            repeat: 0,
            color: 0x73bed3ff,
            from: 1,
            to: 3,
        });
    });
});

describe("Delete Tag", () => {
    it("deletes the active tag at the active frame, or the span's, in one undo step", () => {
        openWith(6);
        const outer = addTag("outer", 0, 5);
        addTag("inner", 1, 2);
        activateCel({ frameId: frameAt(1) });
        const { history } = active();
        const start = history.undoCount;
        expect(run(TAGS.deleteTag)).toBe(true);
        expect(tags().map((tag) => tag.name)).toEqual(["outer"]);
        expect(history.undoCount).toBe(start + 1);
        expect(history.undoLabel).toBe("Delete Tag");
        history.undo();
        expect(tags().map((tag) => tag.name)).toEqual(["outer", "inner"]);
        // From the outer tag's span, with the inner one active.
        withTagArguments({ target: outer }, () => void run(TAGS.deleteTag));
        expect(tags().map((tag) => tag.name)).toEqual(["inner"]);
        expect(tagStore.getState().target).toBeNull();
        // A span of a tag that is gone: nothing.
        withTagArguments({ target: outer }, () => {
            expect(run(TAGS.deleteTag)).toBe(false);
        });
        expect(tags().map((tag) => tag.name)).toEqual(["inner"]);
    });

    it("resets the export's frames when they named the tag, and undo restores them", () => {
        openWith(3);
        const walk = addTag("walk", 0, 2);
        const document = active();
        sessionsStore
            .getState()
            .updateExportSettings(
                document.id,
                (settings) => void (settings.frames = { tagId: walk }),
            );
        run(TAGS.deleteTag);
        expect(document.session.doc.exportSettings.frames).toBe("all");
        document.history.undo();
        expect(document.session.doc.exportSettings.frames).toEqual({ tagId: walk });
    });
});

describe("Apply Tag Range", () => {
    /** Runs Apply Tag Range for `tagId` with the frames at `from` and `to`. */
    function applyRange(tagId: string, from: number, to: number, documentId = active().id) {
        let ran = false;
        const range = { documentId, tagId, fromFrameId: frameAt(from), toFrameId: frameAt(to) };
        withTagArguments({ range }, () => {
            ran = run(TAGS.applyTagRange);
        });
        return ran;
    }

    it("sets the range a drag gave in one undo step, and nothing without one", () => {
        openWith(6);
        const walk = addTag("walk", 1, 2);
        const { history } = active();
        const start = history.undoCount;
        expect(command(TAGS.applyTagRange).enabled()).toBe(false);
        expect(applyRange(walk, 1, 5)).toBe(true);
        expect(tagNamed("walk")).toMatchObject({ from: 1, to: 5 });
        expect(history.undoCount).toBe(start + 1);
        expect(history.undoLabel).toBe("Edit Tag");
        expect(tagStore.getState().range).toBeNull();
        history.undo();
        expect(tagNamed("walk")).toMatchObject({ from: 1, to: 2 });
        // The same range: no step.
        applyRange(walk, 1, 2);
        expect(history.undoCount).toBe(start);
    });

    it("changes nothing for a range that is not one, a tag that is gone or another document", () => {
        openWith(6);
        const walk = addTag("walk", 1, 2);
        const { history, id } = active();
        const start = history.undoCount;
        applyRange(walk, 4, 3);
        applyRange("gone", 0, 5);
        withTagArguments(
            { range: { documentId: id, tagId: walk, fromFrameId: "nope", toFrameId: frameAt(2) } },
            () => void run(TAGS.applyTagRange),
        );
        expect(applyRange(walk, 0, 5, "another")).toBe(false);
        expect(history.undoCount).toBe(start);
        expect(tagNamed("walk")).toMatchObject({ from: 1, to: 2 });
    });
});

describe("the checks of the Tag dialog", () => {
    const valid = {
        name: "walk",
        color: 0x73bed3ff,
        from: 2,
        to: 5,
        direction: "forward" as const,
        repeat: 0,
    };

    it("accepts a name, a colour, frames in order and a repeat 0..255", () => {
        expect(tagProblems(valid, 8)).toEqual({
            name: false,
            color: false,
            range: false,
            repeat: false,
            messages: [],
        });
        expect(tagProblems({ ...valid, from: 5, to: 5, repeat: 255 }, 8).messages).toEqual([]);
    });

    it("rejects an empty name and a From after To, each with its message", () => {
        expect(tagProblems({ ...valid, name: "" }, 8)).toMatchObject({
            name: true,
            messages: ["Enter a name."],
        });
        expect(tagProblems({ ...valid, name: "   " }, 8).name).toBe(true);
        expect(tagProblems({ ...valid, from: 6, to: 5 }, 8)).toMatchObject({
            range: true,
            messages: ["From must not be after To."],
        });
        expect(tagProblems({ ...valid, name: "", from: 6, to: 5 }, 8).messages).toEqual([
            "Enter a name.",
            "From must not be after To.",
        ]);
    });

    it("rejects a colour that is not one, frames outside the document and a repeat outside 0..255", () => {
        expect(tagProblems({ ...valid, color: null }, 8)).toMatchObject({
            color: true,
            messages: ["Enter a colour as #RRGGBB."],
        });
        expect(tagProblems({ ...valid, to: 9 }, 8)).toMatchObject({
            range: true,
            messages: ["Frames run from 1 to 8."],
        });
        expect(tagProblems({ ...valid, from: 0 }, 8).range).toBe(true);
        expect(tagProblems({ ...valid, from: 1.5 }, 8).range).toBe(true);
        expect(tagProblems({ ...valid, repeat: 256 }, 8)).toMatchObject({
            repeat: true,
            messages: ["Repeat must be from 0 to 255."],
        });
        expect(tagProblems({ ...valid, repeat: -1 }, 8).repeat).toBe(true);
        expect(tagProblems({ ...valid, name: "x".repeat(256) }, 8).name).toBe(true);
    });
});
