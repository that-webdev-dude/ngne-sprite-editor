import type { SpriteDoc, Tag } from "../model";

// Shared by the commands that change a document's tag list: the tag commands, and the frame
// commands whose tags follow their frames. Not part of the public API of `core/tags`.

function sameTag(a: Tag, b: Tag): boolean {
    const keys = Object.keys(a) as (keyof Tag)[];
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** True when both lists hold equal tags in the same order. */
export function sameTags(a: readonly Tag[], b: readonly Tag[]): boolean {
    return a.length === b.length && a.every((tag, index) => sameTag(tag, b[index]));
}

/** A replacement of a document's tag list that can be taken back. */
export interface TagListChange {
    /** Whether the document has the tag list the change starts from. */
    matches(doc: SpriteDoc): boolean;
    /** Puts the new list in place. */
    apply(doc: SpriteDoc): void;
    /** Puts the old list back. */
    revert(doc: SpriteDoc): void;
}

/**
 * The change of a document's tag list from `before` to `after`. Each step installs copies, so
 * neither list is shared with the document.
 *
 * `exportSettings.frames` is set outside the history (SPEC §5.2), so whenever a list is put
 * in place it may name any tag. When it names one the list lacks, it is reset to `"all"`
 * (SPEC §5.1); the opposite step sets it back, unless it was given another value in between.
 */
export function tagListChange(before: readonly Tag[], after: readonly Tag[]): TagListChange {
    const copy = (tag: Tag): Tag => ({ ...tag });
    const lists = { before: before.map(copy), after: after.map(copy) };
    /** ID of the tag whose export reference the last step reset. */
    let reset: string | null = null;

    const put = (doc: SpriteDoc, tags: readonly Tag[]) => {
        const restore = reset;
        reset = null;
        doc.tags = tags.map(copy);
        const has = (id: string) => tags.some((tag) => tag.id === id);
        const exported = doc.exportSettings.frames;
        if (exported !== "all") {
            if (!has(exported.tagId)) {
                reset = exported.tagId;
                doc.exportSettings.frames = "all";
            }
        } else if (restore !== null && has(restore)) {
            doc.exportSettings.frames = { tagId: restore };
        }
    };

    return {
        matches: (doc) => sameTags(doc.tags, lists.before),
        apply: (doc) => put(doc, lists.after),
        revert: (doc) => put(doc, lists.before),
    };
}
