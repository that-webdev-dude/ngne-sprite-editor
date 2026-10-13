import type { Command, PixelAllocator } from "../history";
import { celAt, frameIndex, layerIndex, randomId } from "../model";
import type { Cel, IdGenerator, SpriteDoc, Touched } from "../model";
import { CelPlan, defaultAllocator, type CellRef } from "./celPlan";
import { CelOpacityError, CelTargetError, isCelOpacity } from "./errors";

/**
 * A rectangular cel selection: every cell of the given layers at the given frames. Neither
 * list needs an order or a gap-free range. Reference layers may be named; they have no
 * cels, so every command passes over them.
 */
export interface CelSelection {
    layerIds: readonly string[];
    frameIds: readonly string[];
}

/** How far a selection is moved or copied, in cells of the timeline grid. */
export interface CelOffset {
    /**
     * Rows up the stack, negative towards the bottom, counted in pixel layers: 1 is the next
     * pixel layer above. Reference layers have no cels, so they are no rows of the grid: they
     * are stepped over wherever they sit in `SpriteDoc.layers`, and no cel lands on one.
     */
    layers: number;
    /** Frames later in playback order, negative for earlier. */
    frames: number;
}

/** A selection as positions in the document: its pixel layers and its frames, lowest first. */
interface Positions {
    layers: number[];
    frames: number[];
}

/** Throws `RangeError` when the selection names a layer or a frame the document lacks. */
function positionsOf(doc: SpriteDoc, selection: CelSelection, caller: string): Positions {
    const layers = new Set<number>();
    for (const id of selection.layerIds) {
        const index = layerIndex(doc, id);
        if (index === -1) throw new RangeError(`${caller}: the document has no layer "${id}".`);
        if (doc.layers[index].kind === "pixel") layers.add(index);
    }
    const frames = new Set<number>();
    for (const id of selection.frameIds) {
        const index = frameIndex(doc, id);
        if (index === -1) throw new RangeError(`${caller}: the document has no frame "${id}".`);
        frames.add(index);
    }
    const ascending = (a: number, b: number) => a - b;
    return { layers: [...layers].sort(ascending), frames: [...frames].sort(ascending) };
}

function cellAt(doc: SpriteDoc, layer: number, frame: number): CellRef {
    return { layerId: doc.layers[layer].id, frameId: doc.frames[frame].id };
}

/** The cells of a selection: layer by layer from the bottom, each in frame order. */
function cellsOf(doc: SpriteDoc, { layers, frames }: Positions): CellRef[] {
    return layers.flatMap((layer) => frames.map((frame) => cellAt(doc, layer, frame)));
}

/** The frames and layers of the changed cells, in document order. */
function touchedBy(doc: SpriteDoc, cells: readonly CellRef[]): Touched {
    const frames = new Set(cells.map((cell) => cell.frameId));
    const layers = new Set(cells.map((cell) => cell.layerId));
    return {
        frameIds: doc.frames.filter((frame) => frames.has(frame.id)).map((frame) => frame.id),
        layerIds: doc.layers.filter((layer) => layers.has(layer.id)).map((layer) => layer.id),
        structure: false,
    };
}

/** "Clear Cel" for one selected cell, "Clear Cels" for more. */
function counted(label: string, { layers, frames }: Positions): string {
    return layers.length * frames.length === 1 ? label : `${label}s`;
}

/**
 * The command of a plan, or null when the plan leaves every cel as it is. Its `do` throws,
 * with the session unchanged, when the document no longer is what the plan was made from.
 */
function celCommand(label: string, doc: SpriteDoc, plan: CelPlan): Command | null {
    const change = plan.build();
    if (!change) return null;
    return {
        label,
        bytes: change.bytes,
        touched: touchedBy(doc, change.cells),
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
 * Empties the selected cells. An image none of the remaining cels uses is removed, and undo
 * restores it. Returns null when every selected cell is empty already.
 */
export function clearCelsCommand(doc: SpriteDoc, selection: CelSelection): Command | null {
    const positions = positionsOf(doc, selection, "clearCelsCommand");
    const plan = new CelPlan(doc);
    for (const { layerId, frameId } of cellsOf(doc, positions)) plan.set(layerId, frameId, null);
    return celCommand(counted("Clear Cel", positions), doc, plan);
}

/**
 * Each selected cell with the cell it lands on when the selection is shifted by `offset`. A
 * layer moves among the pixel layers only, so a reference layer between two of them does not
 * count. Throws `RangeError` for an offset that is not made of integers and `CelTargetError`
 * when a cell would land past the bottom or top pixel layer or the first or last frame.
 */
function shifted(
    doc: SpriteDoc,
    { layers, frames }: Positions,
    offset: CelOffset,
    caller: string,
): { from: CellRef; to: CellRef }[] {
    if (!Number.isInteger(offset.layers) || !Number.isInteger(offset.frames)) {
        throw new RangeError(
            `${caller}: an offset is made of integers, got ${offset.layers} layers and ` +
                `${offset.frames} frames.`,
        );
    }
    const refused = (reason: CelTargetError["reason"]) =>
        new CelTargetError(offset.layers, offset.frames, reason);
    /** Positions of the pixel layers in the stack, bottom to top: the rows of the grid. */
    const rows = doc.layers.flatMap((layer, index) => (layer.kind === "pixel" ? [index] : []));
    const pairs: { from: CellRef; to: CellRef }[] = [];
    for (const layer of layers) {
        const target = rows[rows.indexOf(layer) + offset.layers];
        if (target === undefined) throw refused("outside-layers");
        for (const frame of frames) {
            if (!doc.frames[frame + offset.frames]) throw refused("outside-frames");
            pairs.push({
                from: cellAt(doc, layer, frame),
                to: cellAt(doc, target, frame + offset.frames),
            });
        }
    }
    return pairs;
}

/**
 * Moves the selected cells by `offset`. The selection moves as a whole: each cell it lands
 * on gets what the selected cell held, an empty cell included, and the cells it leaves
 * become empty. A moved cel keeps its image and opacity, so its links stay. Images no cel
 * uses afterwards are removed, and undo restores them.
 *
 * Returns null when nothing would change. Throws `CelTargetError` when a selected cell would
 * land past the first or last frame or past the bottom or top pixel layer (`CelOffset` counts
 * pixel layers, so no cel lands on a reference layer), and `RangeError` for an offset that is
 * not made of integers or a selection that names a layer or frame the document lacks.
 */
export function moveCelsCommand(
    doc: SpriteDoc,
    selection: CelSelection,
    offset: CelOffset,
): Command | null {
    const positions = positionsOf(doc, selection, "moveCelsCommand");
    const pairs = shifted(doc, positions, offset, "moveCelsCommand");
    const plan = new CelPlan(doc);
    // Left first: a cell that is left and landed on ends with what landed there.
    for (const { from } of pairs) plan.set(from.layerId, from.frameId, null);
    for (const { from, to } of pairs) {
        plan.set(to.layerId, to.frameId, celAt(doc, from.layerId, from.frameId) ?? null);
    }
    return celCommand(counted("Move Cel", positions), doc, plan);
}

/**
 * Copies the selected cells to the cells `offset` away, which get what the selected cells
 * hold, an empty cell included. A copy has an image of its own with the same pixels, and the
 * opacity of its original; selected cels that share an image share one copy of it, so links
 * are kept among the copies while no copy is linked to its original. Images no cel uses
 * afterwards are removed, and undo restores them.
 *
 * The IDs of the new images come from `newId`. Returns null when nothing would change, which
 * includes an offset of zero. Throws as `moveCelsCommand` does; `do` throws `AllocationError`
 * with the session unchanged when an image cannot be allocated.
 */
export function copyCelsCommand(
    doc: SpriteDoc,
    selection: CelSelection,
    offset: CelOffset,
    newId: IdGenerator = randomId,
    allocate: PixelAllocator = defaultAllocator,
): Command | null {
    const positions = positionsOf(doc, selection, "copyCelsCommand");
    const pairs = shifted(doc, positions, offset, "copyCelsCommand");
    if (offset.layers === 0 && offset.frames === 0) return null;
    const plan = new CelPlan(doc, newId, allocate);
    for (const { from, to } of pairs) {
        const cel = celAt(doc, from.layerId, from.frameId);
        const copy = cel ? { imageId: plan.copyOf(cel.imageId), opacity: cel.opacity } : null;
        plan.set(to.layerId, to.frameId, copy);
    }
    return celCommand(counted("Copy Cel", positions), doc, plan);
}

/**
 * Links the selected cells of each layer, as Aseprite does: the layer's first selected cel
 * that is not empty is the one linked to, and every selected cell after it gets its image
 * and its opacity, so they share one image and editing one edits all (SPEC §7.4). Selected
 * cells before it are empty and stay empty, as does a layer whose selected cells are all
 * empty. Images no cel uses afterwards are removed, and undo restores them. Returns null
 * when nothing would change.
 */
export function linkCelsCommand(doc: SpriteDoc, selection: CelSelection): Command | null {
    const positions = positionsOf(doc, selection, "linkCelsCommand");
    const plan = new CelPlan(doc);
    for (const layer of positions.layers) {
        let base: Cel | undefined;
        for (const frame of positions.frames) {
            const { layerId, frameId } = cellAt(doc, layer, frame);
            if (base) plan.set(layerId, frameId, base);
            else base = celAt(doc, layerId, frameId);
        }
    }
    return celCommand("Link Cels", doc, plan);
}

/**
 * Unlinks the selected cels: each one that shares its image with another cel gets a copy of
 * the image for itself, with the same pixels (SPEC §7.4). When every cel of an image is
 * selected, the last of them (layers from the bottom, then frames in order) keeps the image.
 *
 * The IDs of the new images come from `newId`. Returns null when no selected cel is linked.
 * `do` throws `AllocationError` with the session unchanged when an image cannot be allocated.
 */
export function unlinkCelsCommand(
    doc: SpriteDoc,
    selection: CelSelection,
    newId: IdGenerator = randomId,
    allocate: PixelAllocator = defaultAllocator,
): Command | null {
    const positions = positionsOf(doc, selection, "unlinkCelsCommand");
    const users = new Map<string, number>();
    for (const { imageId } of doc.cels.values()) users.set(imageId, (users.get(imageId) ?? 0) + 1);
    const plan = new CelPlan(doc, newId, allocate);
    for (const { layerId, frameId } of cellsOf(doc, positions)) {
        const cel = celAt(doc, layerId, frameId);
        const sharing = cel ? (users.get(cel.imageId) ?? 0) : 0;
        if (!cel || sharing < 2) continue;
        users.set(cel.imageId, sharing - 1);
        plan.set(layerId, frameId, {
            imageId: plan.ownCopyOf(cel.imageId),
            opacity: cel.opacity,
        });
    }
    return celCommand(counted("Unlink Cel", positions), doc, plan);
}

/**
 * Sets the opacity of the selected cels; empty cells stay empty. Opacity belongs to the cel,
 * not to its image, so a cel linked to a selected one keeps its own. Returns null when
 * nothing would change. Throws `CelOpacityError` for a value that is not an integer in
 * 0..255; the command is then not created.
 */
export function setCelOpacityCommand(
    doc: SpriteDoc,
    selection: CelSelection,
    opacity: number,
): Command | null {
    if (!isCelOpacity(opacity)) throw new CelOpacityError(opacity);
    const positions = positionsOf(doc, selection, "setCelOpacityCommand");
    const plan = new CelPlan(doc);
    for (const { layerId, frameId } of cellsOf(doc, positions)) {
        const cel = celAt(doc, layerId, frameId);
        if (cel) plan.set(layerId, frameId, { imageId: cel.imageId, opacity });
    }
    return celCommand("Cel Opacity", doc, plan);
}
