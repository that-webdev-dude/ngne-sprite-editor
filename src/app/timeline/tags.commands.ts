import type { Command } from "../../core/history";
import { activeTagAt, frameIndex, tagsAtFrame } from "../../core/model";
import type { SpriteDoc, Tag } from "../../core/model";
import { createTagCommand, deleteTagCommand, editTagCommand } from "../../core/tags";
import type { TagProperties } from "../../core/tags";
import type { CommandSpec } from "../commands/types";
import type { OpenDocument } from "../state/sessions";
import { effectiveSelection, targetFrameIds } from "./selection";
import { TAG_COMMANDS as IDS } from "./tagCommandIds";
import { TIMELINE_MENUS } from "./timelineEditIds";
import { NEW_TAG_NAME, newTagColour, tagDialogs, tagRangeLabel } from "./tagDialogs";
import type { TagChoice, TagValues } from "./tagDialogs";
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
// there is none. The dialog of Tag Properties… can choose any other tag at the active frame
// and has a Delete button: the keyboard reaches a tag that a shorter one covers. Apply Tag
// Range, outside the menus, sets the range a drag of a span's end gave. Each change is one
// undo step; a dialog that changes nothing makes none.
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

/** The properties a document stores for what the dialog answered, or null for no range. */
function propertiesOf(doc: SpriteDoc, values: TagValues): TagProperties | null {
    const range = rangeOf(doc, values);
    if (!range) return null;
    const [fromFrameId, toFrameId] = range;
    const { color, direction, repeat } = values;
    return { name: values.name.trim(), color, fromFrameId, toFrameId, direction, repeat };
}

/** A tag's values as the dialog shows them. */
function valuesOf(doc: SpriteDoc, tag: Tag): TagValues {
    return {
        name: tag.name,
        color: tag.color,
        from: frameIndex(doc, tag.fromFrameId) + 1,
        to: frameIndex(doc, tag.toFrameId) + 1,
        direction: tag.direction,
        repeat: tag.repeat,
    };
}

/** New Tag…: the Tag dialog over the selected frames, or the active one; Create adds the tag. */
async function newTag(): Promise<void> {
    const document = availableDocument();
    if (!document) return;
    const { session } = document;
    const { doc } = session;
    const selection = effectiveSelection(timelineStore.getState().selection, document.id, session);
    const indices = targetFrameIds(session, selection).map((id) => frameIndex(doc, id));
    const answer = await tagDialogs.tag({
        mode: "new",
        initial: {
            name: NEW_TAG_NAME,
            color: newTagColour(doc.tags),
            from: Math.min(...indices) + 1,
            to: Math.max(...indices) + 1,
            direction: "forward",
            repeat: 0,
        },
        choices: [],
        chosen: null,
        frameCount: doc.frames.length,
    });
    if (answer?.action !== "apply") return;
    executeOn(document.id, (current) => {
        const properties = propertiesOf(current, answer.values);
        return properties ? createTagCommand(current, properties) : null;
    });
}

/**
 * Tag Properties…: the Tag dialog for the subject tag, with a choice of every tag at the
 * active frame (and the subject when it is not one of them); OK changes what differs in the
 * tag chosen, Delete deletes it.
 */
async function tagProperties(): Promise<void> {
    const found = subject();
    if (!found) return;
    const { document, tag } = found;
    const { doc, activeFrameId } = document.session;
    const atFrame = new Set(tagsAtFrame(doc, frameIndex(doc, activeFrameId)));
    const choices = doc.tags
        .filter((entry) => entry === tag || atFrame.has(entry))
        .map((entry): TagChoice => {
            const values = valuesOf(doc, entry);
            return {
                id: entry.id,
                label: tagRangeLabel(entry.name, values.from, values.to),
                values,
            };
        });
    const answer = await tagDialogs.tag({
        mode: "edit",
        initial: valuesOf(doc, tag),
        choices,
        chosen: tag.id,
        frameCount: doc.frames.length,
    });
    if (!answer) return;
    const { tagId } = answer;
    if (tagId === null) return;
    executeOn(document.id, (current) => {
        if (!current.tags.some((entry) => entry.id === tagId)) return null;
        if (answer.action === "delete") return deleteTagCommand(current, tagId);
        const properties = propertiesOf(current, answer.values);
        return properties ? editTagCommand(current, tagId, properties) : null;
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
        // From the selected frames: in the frame header's menu and the tag bar's (SE-026).
        contextMenus: [
            { menu: TIMELINE_MENUS.frame, order: 300 },
            { menu: TIMELINE_MENUS.tag, order: 100 },
        ],
        enabled: () => availableDocument() !== null,
        run: newTag,
    },
    {
        id: IDS.tagProperties,
        title: "Tag Properties…",
        contextMenus: [{ menu: TIMELINE_MENUS.tag, order: 200 }],
        menuPath: ["Frame"],
        menuOrder: 410,
        enabled: () => subject() !== null,
        run: tagProperties,
    },
    {
        id: IDS.deleteTag,
        title: "Delete Tag",
        contextMenus: [{ menu: TIMELINE_MENUS.tag, order: 210 }],
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
