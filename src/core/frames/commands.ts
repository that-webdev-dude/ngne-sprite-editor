import { CelPlan, defaultAllocator, type CelChange } from "../cels/celPlan";
import type { Command, PixelAllocator } from "../history";
import { celAt, frameIndex, randomId } from "../model";
import type { FrameInfo, IdGenerator, SpriteDoc } from "../model";
import { followFrames } from "../tags/follow";
import { sameTags, tagListChange } from "../tags/tagList";
import { FrameDurationError, isFrameDuration, LastFrameError } from "./errors";

const copyFrame = (frame: FrameInfo): FrameInfo => ({ ...frame });
const idOf = (item: { id: string }): string => item.id;

/**
 * Positions of the named frames, lowest first, each once. Throws `RangeError` when no frame
 * is named or the document lacks one of them.
 */
function positionsOf(doc: SpriteDoc, frameIds: readonly string[], caller: string): number[] {
    if (frameIds.length === 0) throw new RangeError(`${caller}: no frame is named.`);
    const positions = new Set<number>();
    for (const id of frameIds) {
        const index = frameIndex(doc, id);
        if (index === -1) throw new RangeError(`${caller}: the document has no frame "${id}".`);
        positions.add(index);
    }
    return [...positions].sort((a, b) => a - b);
}

/** The layers that have one of the cells, bottom to top. */
function layersOf(doc: SpriteDoc, cels: CelChange | null): string[] {
    const layers = new Set(cels?.cells.map((cell) => cell.layerId));
    return doc.layers.filter((layer) => layers.has(layer.id)).map(idOf);
}

/** The error of a command whose document is not the one it was made from any more. */
function changedSince(label: string): Error {
    return new Error(`"${label}": the document changed since the command was made.`);
}

/** "Delete Frame" for one frame, "Delete Frames" for more. */
function counted(label: string, count: number): string {
    return count === 1 ? label : `${label}s`;
}

/** What a command does to the frame list of a document, and what goes with it. */
interface FrameListEdit {
    label: string;
    doc: SpriteDoc;
    /** The frame list the command leaves. */
    frames: readonly FrameInfo[];
    /** The frames it takes out of the order and puts back (`FrameChange.moved`). */
    moved?: readonly string[];
    /** The cels it creates or removes with their frames. */
    cels?: CelChange | null;
    /** The frames and layers whose composite it creates or removes. */
    touched: { frameIds: string[]; layerIds: string[] };
    /**
     * The active frame after `do`, from the one before it. Without it the command leaves the
     * active frame alone, which it can when it deletes no frame.
     */
    activate?: (activeFrameId: string) => string;
}

/**
 * The command of a change of the frame list. The tags follow their frames by the rule of
 * `followFrames`, and a tag that loses all its frames goes with them.
 *
 * The active frame may have been switched since the command was made or undone, which makes
 * no history entry, so `do` works from the active frame it finds and `undo` returns to it.
 *
 * `do` throws, with the session unchanged, when the document no longer is what the command
 * was made from: it has other frames or tags, or its cels differ where the command changes
 * them.
 */
function frameListCommand(edit: FrameListEdit): Command {
    const { doc, cels, activate } = edit;
    const before = doc.frames.map(copyFrame);
    const after = edit.frames.map(copyFrame);
    const tagsBefore = doc.tags.map((tag) => ({ ...tag }));
    const followed = followFrames(tagsBefore, {
        before: before.map(idOf),
        after: after.map(idOf),
        moved: edit.moved,
    });
    const tags = sameTags(tagsBefore, followed) ? null : tagListChange(tagsBefore, followed);
    const asPlanned = (current: SpriteDoc) =>
        current.frames.length === before.length &&
        current.frames.every((frame, index) => frame.id === before[index].id) &&
        sameTags(current.tags, tagsBefore) &&
        (cels?.matches(current) ?? true);
    /** The active frame `do` found. */
    let found: string | null = null;
    return {
        label: edit.label,
        bytes: cels?.bytes ?? 0,
        touched: { ...edit.touched, structure: true },
        do(session) {
            if (!asPlanned(session.doc)) throw changedSince(edit.label);
            // The only step that can fail from here, and it fails before it changes anything.
            cels?.apply(session.doc);
            session.doc.frames = after.map(copyFrame);
            tags?.apply(session.doc);
            if (activate) {
                found = session.activeFrameId;
                session.activeFrameId = activate(found);
            }
        },
        undo(session) {
            if (found !== null) session.activeFrameId = found;
            tags?.revert(session.doc);
            session.doc.frames = before.map(copyFrame);
            cels?.revert(session.doc);
        },
    };
}

/**
 * Adds an empty frame after the frame `afterFrameId`, with that frame's duration, and makes
 * it the active frame. Its ID comes from `newId`. A tag that contains `afterFrameId` contains
 * the new frame as well. Throws `RangeError` when the document has no such frame.
 */
export function addFrameCommand(
    doc: SpriteDoc,
    afterFrameId: string,
    newId: IdGenerator = randomId,
): Command {
    const [at] = positionsOf(doc, [afterFrameId], "addFrameCommand");
    const frame: FrameInfo = { ...doc.frames[at], id: newId() };
    return frameListCommand({
        label: "New Empty Frame",
        doc,
        frames: [...doc.frames.slice(0, at + 1), frame, ...doc.frames.slice(at + 1)],
        touched: { frameIds: [frame.id], layerIds: [] },
        activate: () => frame.id,
    });
}

/**
 * Duplicates frames: the copies, in the order of their originals, go after the last of the
 * named frames, and the first copy becomes the active frame. A copy has the duration of its
 * original and a cel wherever the original has one, with the same opacity and an image of
 * its own with the same pixels. Cels of the named frames that share an image share one copy
 * of it, so links are kept among the copies while no copy is linked to its original. A tag
 * that ends with the last named frame takes the copies in.
 *
 * `newId` gives the IDs of the new frames, then those of the new images. `do` throws
 * `AllocationError` with the session unchanged when an image cannot be allocated. Throws
 * `RangeError` when no frame is named or the document lacks one of them.
 */
export function duplicateFramesCommand(
    doc: SpriteDoc,
    frameIds: readonly string[],
    newId: IdGenerator = randomId,
    allocate: PixelAllocator = defaultAllocator,
): Command {
    const positions = positionsOf(doc, frameIds, "duplicateFramesCommand");
    const sources = positions.map((index) => doc.frames[index]);
    const copies = sources.map((source): FrameInfo => ({ ...source, id: newId() }));
    const plan = new CelPlan(doc, newId, allocate);
    sources.forEach((source, index) => {
        for (const layer of doc.layers) {
            const cel = celAt(doc, layer.id, source.id);
            if (!cel) continue;
            const copy = { imageId: plan.copyOf(cel.imageId), opacity: cel.opacity };
            plan.set(layer.id, copies[index].id, copy);
        }
    });
    const cels = plan.build();
    const end = positions[positions.length - 1] + 1;
    return frameListCommand({
        label: counted("New Frame", copies.length),
        doc,
        frames: [...doc.frames.slice(0, end), ...copies, ...doc.frames.slice(end)],
        cels,
        touched: { frameIds: copies.map(idOf), layerIds: layersOf(doc, cels) },
        activate: () => copies[0].id,
    });
}

/**
 * Deletes frames with their cels. An image none of the remaining cels uses is removed, and
 * undo restores it. A tag keeps the frames it has left, and one that has none left is
 * deleted with them; `exportSettings.frames` is reset to `"all"` when it names such a tag.
 * When the active frame is deleted, the next remaining frame becomes active, or the one
 * before it when none follows.
 *
 * Throws `LastFrameError` when every frame of the document is named, and `RangeError` when
 * none is or the document lacks one of them.
 */
export function deleteFramesCommand(doc: SpriteDoc, frameIds: readonly string[]): Command {
    const positions = positionsOf(doc, frameIds, "deleteFramesCommand");
    if (positions.length === doc.frames.length) throw new LastFrameError();
    const order = doc.frames.map(idOf);
    const deleted = new Set(positions.map((index) => order[index]));
    const plan = new CelPlan(doc);
    for (const frameId of deleted) {
        for (const layer of doc.layers) plan.set(layer.id, frameId, null);
    }
    const cels = plan.build();
    const remaining = (ids: string[]) => ids.find((id) => !deleted.has(id));
    return frameListCommand({
        label: counted("Delete Frame", deleted.size),
        doc,
        frames: doc.frames.filter((frame) => !deleted.has(frame.id)),
        cels,
        touched: { frameIds: [...deleted], layerIds: layersOf(doc, cels) },
        activate(active) {
            if (!deleted.has(active)) return active;
            const at = order.indexOf(active);
            const next = remaining(order.slice(at + 1)) ?? remaining(order.slice(0, at).reverse());
            return next ?? active;
        },
    });
}

/**
 * Moves frames: the named frames are taken out of the order and put back together, in the
 * order they had, before the frame now at `beforeIndex`; `doc.frames.length` puts them at
 * the end. A frame keeps its ID, duration and cels. Tags follow by the rule of `followFrames`:
 * a tag keeps the frames that stay, takes in a frame dropped among them, loses one dragged
 * away, and travels with its frames when all of them move.
 *
 * Returns null when the order would not change. Throws `RangeError` when `beforeIndex` is
 * not an integer in 0..`doc.frames.length`, no frame is named or the document lacks one.
 */
export function moveFramesCommand(
    doc: SpriteDoc,
    frameIds: readonly string[],
    beforeIndex: number,
): Command | null {
    if (!Number.isInteger(beforeIndex) || beforeIndex < 0 || beforeIndex > doc.frames.length) {
        throw new RangeError(
            `moveFramesCommand: ${beforeIndex} is not a position from 0 to ${doc.frames.length}.`,
        );
    }
    const positions = positionsOf(doc, frameIds, "moveFramesCommand");
    const moving = new Set(positions);
    const moved = positions.map((index) => doc.frames[index]);
    const rest = doc.frames.filter((_, index) => !moving.has(index));
    // The frames that stay keep their order, so the gap is counted among them.
    const gap = beforeIndex - positions.filter((index) => index < beforeIndex).length;
    const frames = [...rest.slice(0, gap), ...moved, ...rest.slice(gap)];
    if (frames.every((frame, index) => frame === doc.frames[index])) return null;
    return frameListCommand({
        label: counted("Move Frame", moved.length),
        doc,
        frames,
        moved: moved.map(idOf),
        touched: { frameIds: [], layerIds: [] },
    });
}

/**
 * Reverses frames: the named frames keep the positions they occupy between them and take
 * them in the opposite order, so a range of frames then plays backwards. A frame keeps its
 * ID, duration and cels. Tags follow by the rule of `followFrames`: a tag inside the range
 * travels with its frames, and a tag around the range keeps the frames it has.
 *
 * Returns null when fewer than two frames are named. Throws `RangeError` when none is or
 * the document lacks one of them.
 */
export function reverseFramesCommand(doc: SpriteDoc, frameIds: readonly string[]): Command | null {
    const positions = positionsOf(doc, frameIds, "reverseFramesCommand");
    if (positions.length < 2) return null;
    const frames = [...doc.frames];
    positions.forEach((position, index) => {
        frames[position] = doc.frames[positions[positions.length - 1 - index]];
    });
    return frameListCommand({
        label: "Reverse Frames",
        doc,
        frames,
        moved: positions.map((index) => doc.frames[index].id),
        touched: { frameIds: [], layerIds: [] },
    });
}

/**
 * Sets the duration of one or many frames, as one undo step. Returns null when every named
 * frame has that duration already. Throws `FrameDurationError` for a value that is not an
 * integer in 1..65535, and `RangeError` when no frame is named or the document lacks one of
 * them; the command is then not created. `do` throws, with the session unchanged, when a
 * frame it changes is gone or has another duration than when the command was made.
 */
export function setFrameDurationCommand(
    doc: SpriteDoc,
    frameIds: readonly string[],
    durationMs: number,
): Command | null {
    if (!isFrameDuration(durationMs)) throw new FrameDurationError(durationMs);
    const previous = new Map<string, number>();
    for (const index of positionsOf(doc, frameIds, "setFrameDurationCommand")) {
        const frame = doc.frames[index];
        if (frame.durationMs !== durationMs) previous.set(frame.id, frame.durationMs);
    }
    if (previous.size === 0) return null;
    const withDurations = (frames: readonly FrameInfo[], duration: (frame: FrameInfo) => number) =>
        frames.map((frame) =>
            previous.has(frame.id) ? { ...frame, durationMs: duration(frame) } : frame,
        );
    return {
        label: "Frame Duration",
        // A number per frame.
        bytes: 0,
        // A duration is outside the composite, and the list of frames stays as it is.
        touched: { frameIds: [], layerIds: [], structure: false },
        do(session) {
            const now = new Map(session.doc.frames.map((frame) => [frame.id, frame.durationMs]));
            for (const [id, duration] of previous) {
                if (now.get(id) !== duration) throw changedSince("Frame Duration");
            }
            session.doc.frames = withDurations(session.doc.frames, () => durationMs);
        },
        undo(session) {
            session.doc.frames = withDurations(
                session.doc.frames,
                (frame) => previous.get(frame.id) ?? frame.durationMs,
            );
        },
    };
}
