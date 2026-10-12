import type { Tag } from "../model";

/** A change of a document's frame list, as far as its tags are concerned. */
export interface FrameChange {
    /** Frame IDs in playback order before the change. */
    before: readonly string[];
    /** Frame IDs in playback order after it. */
    after: readonly string[];
    /**
     * The frames the change took out of the order and put back, as a move or a reversal
     * does; they are in both lists. A change that only adds or deletes frames moves none.
     */
    moved?: readonly string[];
}

/**
 * The tags of a document after a change of its frame list: the one rule by which tags follow
 * their frames. Every command that adds, deletes, moves or reverses frames takes its tags
 * from here.
 *
 * A tag covers the frames from its `from` frame to its `to` frame, its members. Each tag is
 * carried over on its own, by the first of these that applies:
 *
 * 1. No member is left, because all were deleted: the tag is removed.
 * 2. Some members were not moved: the tag runs from the first to the last of them in the new
 *    order, so every frame now between them is inside it, also one that was added or dropped
 *    there. Two kinds of frame directly beside that run join it: a moved member, on either
 *    side (a reorder at the edge of a tag keeps the tag whole), and a new frame, after its
 *    last frame (a frame added after the last frame of a tag belongs to it, as in Aseprite).
 *    A moved member that lands anywhere else has left the tag.
 * 3. Every member that is left was moved, because the whole tag was dragged or reversed: the
 *    tag travels with them and runs from the first to the last of them in the new order.
 *
 * So after a deletion the endpoints are the nearest remaining frames inside the old range,
 * and a reorder never removes a tag. The result is in the order of `tags` and holds new
 * objects that differ from the old ones in their endpoints only; `tags` is not changed.
 * Throws `RangeError` for a tag whose endpoints are not a run of `before`.
 */
export function followFrames(tags: readonly Tag[], change: FrameChange): Tag[] {
    const { before, after } = change;
    const moved = new Set(change.moved ?? []);
    const oldIndex = new Map(before.map((id, index) => [id, index]));
    const newIndex = new Map(after.map((id, index) => [id, index]));

    const followed: Tag[] = [];
    for (const tag of tags) {
        const from = oldIndex.get(tag.fromFrameId);
        const to = oldIndex.get(tag.toFrameId);
        if (from === undefined || to === undefined || from > to) {
            throw new RangeError(
                `followFrames: tag "${tag.id}" runs from frame "${tag.fromFrameId}" to ` +
                    `"${tag.toFrameId}", which is not a run of the frames before the change.`,
            );
        }
        const members = new Set(before.slice(from, to + 1).filter((id) => newIndex.has(id)));
        if (members.size === 0) continue;

        const stayed = [...members].filter((id) => !moved.has(id));
        let first = after.length;
        let last = -1;
        for (const id of stayed.length > 0 ? stayed : members) {
            const index = newIndex.get(id) ?? -1;
            first = Math.min(first, index);
            last = Math.max(last, index);
        }
        if (stayed.length > 0) {
            const movedMember = (id: string) => moved.has(id) && members.has(id);
            while (first > 0 && movedMember(after[first - 1])) first--;
            while (
                last < after.length - 1 &&
                (movedMember(after[last + 1]) || !oldIndex.has(after[last + 1]))
            ) {
                last++;
            }
        }
        followed.push({ ...tag, fromFrameId: after[first], toFrameId: after[last] });
    }
    return followed;
}
