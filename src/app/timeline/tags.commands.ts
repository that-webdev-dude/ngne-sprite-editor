import type { Command } from "../../core/history";
import { activeTagAt, frameIndex } from "../../core/model";
import type { SpriteDoc, Tag } from "../../core/model";
import { createTagCommand, deleteTagCommand, editTagCommand } from "../../core/tags";
import type { CommandSpec } from "../commands/types";
import type { OpenDocument } from "../state/sessions";
import { effectiveSelection, targetFrameIds } from "./selection";
import { TAG_COMMANDS as IDS } from "./tagCommandIds";
import { NEW_TAG_NAME, newTagColour, tagDialogs } from "./tagDialogs";
import type { TagValues } from "./tagDialogs";
import { tagStore } from "./tagState";
import { availableDocument, settledDocumentOf } from "./timelineDocument";
import { timelineStore } from "./timelineState";

// Tag commands of the timeline (SPEC §7.4; SE-023), over the tag commands of `core/tags`.
//
// New Tag… takes the Frame menu item planned for it: it opens the Tag dialog over the frames
// selected in the timeline, from the first to the last, or over the active frame when none is
// selected, and creates the tag when the dialog is confirmed. Tag Properties… and Delete Tag
// follow it in the menu. They act on the tag whose span ran them (a double-click, `tagStore`),
// otherwise on the active tag at the active frame (`activeTagAt`), and are disabled while
// there is none. Apply Tag Range, outside the menus, sets the range a drag of a span's end
// gave. Each change is one undo step; a dialog that changes nothing makes none.
//
// A command applies a floating selection before it changes the document and does nothing
// during a stroke (`timelineDocument.ts`). The tag bar takes the ids from `tagCommandIds.ts`.

/** The tag a command acts on: the span's that ran it, or the active tag at the active frame. */
function subjectTag(document: OpenDocument): Tag | null {
    const { doc, activeFrameId } = document.session;
    const { target } = tagStore.getState();
    if (target !== null) return doc.tags.find((tag) => tag.id === target) ?? null;
    return activeTagAt(doc, frameIndex(doc, activeFrameId)) ?? null;
}

function subject(): { document: OpenDocument; tag: Tag } | null {
    const document = availableDocument();
    const tag = document ? subjectTag(document) : null;
    return document && tag ? { document, tag } : null;
}

/**
 * Executes a command made from the open document `documentId` once it can take one (a
 * floating selection applied first). Returns whether a step was recorded.
 */
function executeOn(documentId: string, make: (doc: SpriteDoc) => Command | null): boolean {
    const document = settledDocumentOf(documentId);
    if (!document) return false;
    const command = make(document.session.doc);
    if (!command) return false;
    document.history.execute(command);
    return true;
}

/** The ids of the frames the dialog's numbers name, or null when one is not a frame. */
function rangeOf(doc: SpriteDoc, values: TagValues): [string, string] | null {
    const from = doc.frames[values.from - 1];
    const to = doc.frames[values.to - 1];
    return from && to && values.from <= values.to ? [from.id, to.id] : null;
}

/** New Tag…: the Tag dialog over the selected frames, or the active one; Create adds the tag. */
async function newTag(): Promise<void> {
    const document = availableDocument();
    if (!document) return;
    const { session } = document;
    const { doc } = session;
    const selection = effectiveSelection(timelineStore.getState().selection, document.id, session);
    const indices = targetFrameIds(session, selection).map((id) => frameIndex(doc, id));
    const values = await tagDialogs.tag({
        mode: "new",
        initial: {
            name: NEW_TAG_NAME,
            color: newTagColour(doc.tags),
            from: Math.min(...indices) + 1,
            to: Math.max(...indices) + 1,
            direction: "forward",
            repeat: 0,
        },
        frameCount: doc.frames.length,
    });
    if (!values) return;
    executeOn(document.id, (current) => {
        const range = rangeOf(current, values);
        if (!range) return null;
        const [fromFrameId, toFrameId] = range;
        const { color, direction, repeat } = values;
        const name = values.name.trim();
        return createTagCommand(current, {
            name,
            color,
            fromFrameId,
            toFrameId,
            direction,
            repeat,
        });
    });
}

/** Tag Properties…: the Tag dialog with the tag's values; OK changes what differs. */
async function tagProperties(): Promise<void> {
    const found = subject();
    if (!found) return;
    const { document, tag } = found;
    const { doc } = document.session;
    const values = await tagDialogs.tag({
        mode: "edit",
        initial: {
            name: tag.name,
            color: tag.color,
            from: frameIndex(doc, tag.fromFrameId) + 1,
            to: frameIndex(doc, tag.toFrameId) + 1,
            direction: tag.direction,
            repeat: tag.repeat,
        },
        frameCount: doc.frames.length,
    });
    if (!values) return;
    executeOn(document.id, (current) => {
        const range = rangeOf(current, values);
        if (!range || !current.tags.some((entry) => entry.id === tag.id)) return null;
        const [fromFrameId, toFrameId] = range;
        const { color, direction, repeat } = values;
        const name = values.name.trim();
        return editTagCommand(current, tag.id, {
            name,
            color,
            fromFrameId,
            toFrameId,
            direction,
            repeat,
        });
    });
}

function deleteTag(): void {
    const found = subject();
    if (!found) return;
    executeOn(found.document.id, (doc) =>
        doc.tags.some((tag) => tag.id === found.tag.id)
            ? deleteTagCommand(doc, found.tag.id)
            : null,
    );
}

/** Apply Tag Range: the range a drag gave, when the tag and both frames are still there. */
function applyTagRange(): void {
    const { range } = tagStore.getState();
    if (!range) return;
    const { tagId, fromFrameId, toFrameId } = range;
    executeOn(range.documentId, (doc) => {
        const from = frameIndex(doc, fromFrameId);
        const to = frameIndex(doc, toFrameId);
        if (from === -1 || to === -1 || from > to) return null;
        if (!doc.tags.some((tag) => tag.id === tagId)) return null;
        return editTagCommand(doc, tagId, { fromFrameId, toFrameId });
    });
}

export const commands: CommandSpec[] = [
    {
        id: IDS.newTag,
        title: "New Tag…",
        enabled: () => availableDocument() !== null,
        run: newTag,
    },
    {
        id: IDS.tagProperties,
        title: "Tag Properties…",
        menuPath: ["Frame"],
        menuOrder: 410,
        enabled: () => subject() !== null,
        run: tagProperties,
    },
    {
        id: IDS.deleteTag,
        title: "Delete Tag",
        menuPath: ["Frame"],
        menuOrder: 420,
        enabled: () => subject() !== null,
        run: deleteTag,
    },
    {
        id: IDS.applyTagRange,
        title: "Apply Tag Range",
        enabled: () => {
            const { range } = tagStore.getState();
            return range !== null && availableDocument()?.id === range.documentId;
        },
        run: applyTagRange,
    },
];
