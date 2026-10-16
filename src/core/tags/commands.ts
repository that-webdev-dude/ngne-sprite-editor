import type { Command } from "../history";
import { assertCanAdd, assertNameLength, frameIndex, randomId } from "../model";
import type { DocumentLimits, IdGenerator, SpriteDoc, Tag } from "../model";
import { isTagRepeat, TagRangeError, TagRepeatError } from "./errors";
import { sameTags, tagListChange } from "./tagList";

/** Everything of a tag but its ID: what `createTagCommand` takes and `editTagCommand` changes. */
export type TagProperties = Omit<Tag, "id">;

/**
 * The properties as a document stores them: the known fields only. Throws `TagRangeError`
 * when the range is not a run of the document's frames, `TagRepeatError` for the repeat and
 * `DocumentLimitError` for a name longer than `MAX_NAME_LENGTH` (FORMAT.md §1.2).
 */
function checked(doc: SpriteDoc, properties: TagProperties): TagProperties {
    const { name, color, fromFrameId, toFrameId, direction, repeat } = properties;
    assertNameLength(name);
    const from = frameIndex(doc, fromFrameId);
    const to = frameIndex(doc, toFrameId);
    if (from === -1 || to === -1) {
        throw new TagRangeError(fromFrameId, toFrameId, "unknown-frame");
    }
    if (from > to) throw new TagRangeError(fromFrameId, toFrameId, "from-after-to");
    if (!isTagRepeat(repeat)) throw new TagRepeatError(repeat);
    return { name, color, fromFrameId, toFrameId, direction, repeat };
}

/**
 * The command that replaces the tag list of `doc` with `tags`. Its `do` throws, with the
 * session unchanged, when the document no longer has the tags the command was made from.
 */
function tagCommand(label: string, doc: SpriteDoc, tags: Tag[], structure: boolean): Command {
    const change = tagListChange(doc.tags, tags);
    return {
        label,
        // A few short strings and numbers.
        bytes: 0,
        // Tags are outside the composite; `structure` tells that the list of tags changed.
        touched: { frameIds: [], layerIds: [], structure },
        do(session) {
            if (!change.matches(session.doc)) {
                throw new Error(`"${label}": the document changed since the command was made.`);
            }
            change.apply(session.doc);
        },
        undo: (session) => change.revert(session.doc),
    };
}

/**
 * Adds a tag at the end of the tag list, so it is the one created last (SPEC §7.4). Its ID
 * comes from `newId`. Throws `TagRangeError` when the range is not a run of the document's
 * frames, `TagRepeatError` for a repeat outside 0..255, and `DocumentLimitError` when the
 * document has as many tags as `limits` allows (SPEC §5.1) or the name is too long; the
 * command is then not created.
 */
export function createTagCommand(
    doc: SpriteDoc,
    properties: TagProperties,
    newId: IdGenerator = randomId,
    limits?: Readonly<DocumentLimits>,
): Command {
    const valid = checked(doc, properties);
    assertCanAdd(doc, { tags: 1 }, limits);
    const tag: Tag = { id: newId(), ...valid };
    return tagCommand("New Tag", doc, [...doc.tags, tag], true);
}

/**
 * Changes some properties of a tag (name, colour, range, direction, repeat) and leaves the
 * others, and its place in the tag list, as they are. Returns null when `changes` changes
 * nothing. Throws `TagRangeError`, `TagRepeatError` and, for the name, `DocumentLimitError`
 * as `createTagCommand` does, for the tag as it would be after the change, and `RangeError`
 * when the document has no such tag.
 */
export function editTagCommand(
    doc: SpriteDoc,
    tagId: string,
    changes: Partial<TagProperties>,
): Command | null {
    const tag = doc.tags.find((candidate) => candidate.id === tagId);
    if (!tag) throw new RangeError(`editTagCommand: the document has no tag "${tagId}".`);
    const edited: Tag = {
        id: tag.id,
        ...checked(doc, {
            name: changes.name ?? tag.name,
            color: changes.color ?? tag.color,
            fromFrameId: changes.fromFrameId ?? tag.fromFrameId,
            toFrameId: changes.toFrameId ?? tag.toFrameId,
            direction: changes.direction ?? tag.direction,
            repeat: changes.repeat ?? tag.repeat,
        }),
    };
    const tags = doc.tags.map((candidate) => (candidate === tag ? edited : candidate));
    return sameTags(doc.tags, tags) ? null : tagCommand("Edit Tag", doc, tags, false);
}

/**
 * Deletes a tag. When `exportSettings.frames` names it, that field is reset to `"all"`, and
 * undo restores it (SPEC §5.1). Throws `RangeError` when the document has no such tag.
 */
export function deleteTagCommand(doc: SpriteDoc, tagId: string): Command {
    if (!doc.tags.some((tag) => tag.id === tagId)) {
        throw new RangeError(`deleteTagCommand: the document has no tag "${tagId}".`);
    }
    const tags = doc.tags.filter((tag) => tag.id !== tagId);
    return tagCommand("Delete Tag", doc, tags, true);
}
