import {
    clearCelsCommand,
    copyCelsCommand,
    linkCelsCommand,
    moveCelsCommand,
    unlinkCelsCommand,
} from "../../core/cels";
import type { CelOffset, CelSelection } from "../../core/cels";
import { chainedCommand } from "../../core/history";
import type { Command } from "../../core/history";
import { reorderLayerCommand } from "../../core/layers";
import { celAt } from "../../core/model";
import type { DocSession, Layer, SpriteDoc } from "../../core/model";
import type { CelRef, TimelineSelection } from "./selection";

// What the timeline's cel commands and drags act on (SE-026), as pure functions over the
// document. The cel commands of `core/cels` change the cels they are given and do not look at
// `locked` (SE-021 review): the timeline leaves the cels of locked layers out of what it
// clears, moves, copies, links or unlinks, and refuses a drop onto a locked layer.
//
// The cels of a timeline selection need not be a rectangle (Ctrl adds or removes one), while a
// command of `core/cels` takes a rectangle of layers × frames. A selection that is a rectangle
// is one command; another is a command per layer (each layer's cels are a rectangle of one row),
// chained into one undo step.

type SessionCel = Pick<DocSession, "doc" | "activeLayerId" | "activeFrameId">;

/** The pixel layers, bottom to top: the rows of the grid that hold cels. */
function pixelLayerIds(doc: SpriteDoc): string[] {
    return doc.layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id);
}

/**
 * The cels a cel command of the timeline acts on, layer by layer from the bottom, each in frame
 * order: the cels of a cel selection, every pixel layer's cel at the frames of a frame selection,
 * every cel of the pixel layers of a layer selection, or the active cel without a selection.
 * Reference layers have no cels; cels the document no longer has are left out.
 */
export function targetCels(session: SessionCel, selection: TimelineSelection | null): CelRef[] {
    const { doc } = session;
    const layerIds = pixelLayerIds(doc);
    const frameIds = doc.frames.map((frame) => frame.id);
    let chosen: (layerId: string, frameId: string) => boolean;
    if (!selection) {
        chosen = (layerId, frameId) =>
            layerId === session.activeLayerId && frameId === session.activeFrameId;
    } else if (selection.kind === "cels") {
        const keys = new Set(selection.cels.map((cel) => `${cel.layerId}\n${cel.frameId}`));
        chosen = (layerId, frameId) => keys.has(`${layerId}\n${frameId}`);
    } else if (selection.kind === "frames") {
        const frames = new Set(selection.frameIds);
        chosen = (_, frameId) => frames.has(frameId);
    } else {
        const layers = new Set(selection.layerIds);
        chosen = (layerId) => layers.has(layerId);
    }
    return layerIds.flatMap((layerId) =>
        frameIds
            .filter((frameId) => chosen(layerId, frameId))
            .map((frameId) => ({ layerId, frameId })),
    );
}

function layerOf(doc: SpriteDoc, layerId: string): Layer | undefined {
    return doc.layers.find((layer) => layer.id === layerId);
}

/** `cels` without those of locked layers (and of layers the document lacks). */
export function editableCels(doc: SpriteDoc, cels: readonly CelRef[]): CelRef[] {
    return cels.filter((cel) => {
        const layer = layerOf(doc, cel.layerId);
        return layer?.kind === "pixel" && !layer.locked;
    });
}

/** The cels of one layer, in frame order. */
export interface CelRow {
    readonly layerId: string;
    readonly frameIds: readonly string[];
}

/** `cels` by layer, from the bottom pixel layer up, each layer's frames in playback order. */
export function celRows(doc: SpriteDoc, cels: readonly CelRef[]): CelRow[] {
    const byLayer = new Map<string, Set<string>>();
    for (const { layerId, frameId } of cels) {
        const frames = byLayer.get(layerId) ?? new Set<string>();
        frames.add(frameId);
        byLayer.set(layerId, frames);
    }
    return pixelLayerIds(doc).flatMap((layerId) => {
        const frames = byLayer.get(layerId);
        if (!frames) return [];
        return [{ layerId, frameIds: doc.frames.map((f) => f.id).filter((id) => frames.has(id)) }];
    });
}

/** Whether every row holds the same frames: the cels are layers × frames. */
function isRectangle(rows: readonly CelRow[]): boolean {
    const [first, ...others] = rows;
    if (!first) return false;
    const frames = first.frameIds.join("\n");
    return others.every((row) => row.frameIds.join("\n") === frames);
}

type CelCommandFactory = (doc: SpriteDoc, selection: CelSelection) => Command | null;

/**
 * One command over `rows`: the command of their rectangle, or one per row chained into one
 * undo step, in the order of `rows`. Null when it would change nothing.
 */
function rowsCommand(
    label: string,
    session: DocSession,
    rows: readonly CelRow[],
    make: CelCommandFactory,
): Command | null {
    const [first] = rows;
    if (!first) return null;
    if (isRectangle(rows)) {
        return make(session.doc, {
            layerIds: rows.map((row) => row.layerId),
            frameIds: first.frameIds,
        });
    }
    return chainedCommand(
        label,
        session,
        rows.map(
            (row) => (current: DocSession) =>
                make(current.doc, { layerIds: [row.layerId], frameIds: row.frameIds }),
        ),
    );
}

/** Clear: empties the editable cels of `cels`; null when they are empty already. */
export function clearCels(session: DocSession, cels: readonly CelRef[]): Command | null {
    const rows = celRows(session.doc, editableCels(session.doc, cels));
    return rowsCommand("Clear Cels", session, rows, clearCelsCommand);
}

/** Link: links the editable cels of each layer of `cels` (SPEC §7.4); null when none change. */
export function linkCels(session: DocSession, cels: readonly CelRef[]): Command | null {
    const rows = celRows(session.doc, editableCels(session.doc, cels));
    return rowsCommand("Link Cels", session, rows, linkCelsCommand);
}

/** Unlink: gives each linked editable cel of `cels` its own image; null when none is linked. */
export function unlinkCels(session: DocSession, cels: readonly CelRef[]): Command | null {
    const rows = celRows(session.doc, editableCels(session.doc, cels));
    return rowsCommand("Unlink Cels", session, rows, (doc, selection) =>
        unlinkCelsCommand(doc, selection),
    );
}

/**
 * Whether Link would change one of `cels` (SPEC §7.4, `linkCelsCommand`): in some layer, a cel
 * after the first filled one does not share its image and opacity yet.
 */
export function wouldLink(doc: SpriteDoc, cels: readonly CelRef[]): boolean {
    return celRows(doc, cels).some((row) => {
        let base: { imageId: string; opacity: number } | undefined;
        for (const frameId of row.frameIds) {
            const cel = celAt(doc, row.layerId, frameId);
            if (!base) base = cel;
            else if (cel?.imageId !== base.imageId || cel.opacity !== base.opacity) return true;
        }
        return false;
    });
}

/** Whether one of `cels` holds an image. */
export function anyFilled(doc: SpriteDoc, cels: readonly CelRef[]): boolean {
    return cels.some((cel) => celAt(doc, cel.layerId, cel.frameId) !== undefined);
}

/** Whether one of `cels` shares its image with another cel. */
export function anyLinked(doc: SpriteDoc, cels: readonly CelRef[]): boolean {
    const images = new Set<string>();
    for (const cel of cels) {
        const imageId = celAt(doc, cel.layerId, cel.frameId)?.imageId;
        if (imageId !== undefined) images.add(imageId);
    }
    if (images.size === 0) return false;
    const users = new Map<string, number>();
    for (const { imageId } of doc.cels.values()) {
        if (!images.has(imageId)) continue;
        const count = (users.get(imageId) ?? 0) + 1;
        if (count > 1) return true;
        users.set(imageId, count);
    }
    return false;
}

/** Where a cel lies in the grid: its pixel layer from the bottom and its frame. */
interface Position {
    row: number;
    frame: number;
}

function positionOf(doc: SpriteDoc, rows: readonly string[], cel: CelRef): Position | null {
    const row = rows.indexOf(cel.layerId);
    const frame = doc.frames.findIndex((entry) => entry.id === cel.frameId);
    return row === -1 || frame === -1 ? null : { row, frame };
}

/**
 * The offset of a drag of `cels`, brought inside the grid: no cel lands past the bottom or top
 * pixel layer or the first or last frame. `layers` counts pixel layers up the stack.
 */
export function clampCelOffset(
    doc: SpriteDoc,
    cels: readonly CelRef[],
    offset: CelOffset,
): CelOffset {
    const rows = pixelLayerIds(doc);
    const positions = cels.flatMap((cel) => positionOf(doc, rows, cel) ?? []);
    if (positions.length === 0) return { layers: 0, frames: 0 };
    const clamp = (value: number, low: number, high: number) =>
        Math.min(Math.max(value, low), high);
    const minRow = Math.min(...positions.map((at) => at.row));
    const maxRow = Math.max(...positions.map((at) => at.row));
    const minFrame = Math.min(...positions.map((at) => at.frame));
    const maxFrame = Math.max(...positions.map((at) => at.frame));
    // `+ 0` turns a -0 into 0.
    return {
        layers: clamp(offset.layers, -minRow, rows.length - 1 - maxRow) + 0,
        frames: clamp(offset.frames, -minFrame, doc.frames.length - 1 - maxFrame) + 0,
    };
}

/**
 * Whether a drop of `cels` by `offset` would put a cel of an editable layer on a locked layer,
 * which `dropCels` refuses.
 */
export function landsOnLocked(doc: SpriteDoc, cels: readonly CelRef[], offset: CelOffset): boolean {
    const rows = pixelLayerIds(doc);
    return editableCels(doc, cels).some((cel) => {
        const at = positionOf(doc, rows, cel);
        const layerId = at ? rows[at.row + offset.layers] : undefined;
        return layerId !== undefined && layerOf(doc, layerId)?.locked === true;
    });
}

/** A drop of cels: its command, and where each cel it moves or copies lands. */
export interface CelDrop {
    readonly command: Command;
    readonly moved: readonly { readonly from: CelRef; readonly to: CelRef }[];
}

/**
 * The drop of a drag of `cels` by `offset`: a move, or with `copy` a copy (SPEC §7.4). The cels
 * of locked layers stay where they are; a drop that would land a cel on a locked layer, or past
 * the edges of the grid, is refused. Null when it is refused or would change nothing.
 *
 * The selection moves as a whole, as in `moveCelsCommand`. A selection that is no rectangle is
 * moved layer by layer, the layer a row lands on before the row that lands there, so no cel is
 * overwritten before it has moved.
 */
export function dropCels(
    session: DocSession,
    cels: readonly CelRef[],
    offset: CelOffset,
    copy: boolean,
): CelDrop | null {
    const { doc } = session;
    if (offset.layers === 0 && offset.frames === 0) return null;
    const rows = pixelLayerIds(doc);
    const sources = editableCels(doc, cels);
    const moved: { from: CelRef; to: CelRef }[] = [];
    for (const from of sources) {
        const at = positionOf(doc, rows, from);
        if (!at) return null;
        const layerId = rows[at.row + offset.layers];
        const frameId = doc.frames[at.frame + offset.frames]?.id;
        if (layerId === undefined || frameId === undefined) return null;
        if (layerOf(doc, layerId)?.locked) return null;
        moved.push({ from, to: { layerId, frameId } });
    }
    const grouped = celRows(doc, sources);
    // The row a row lands on goes first: from the top when the drag goes up, else from the bottom.
    const ordered = offset.layers > 0 ? [...grouped].reverse() : grouped;
    const command = rowsCommand(
        copy ? "Copy Cels" : "Move Cels",
        session,
        ordered,
        copy
            ? (current, selection) => copyCelsCommand(current, selection, offset)
            : (current, selection) => moveCelsCommand(current, selection, offset),
    );
    return command ? { command, moved } : null;
}

/**
 * The order of the stack after the layers `layerIds` of one kind are dropped `gap` rows below the
 * top of their group in the timeline (0: above its top row). The timeline lists each kind in a
 * group of its own, top first (pixel layers, then the Reference group): the moved layers keep
 * their order and land together; layers of the other kind keep their places in the stack. Only
 * layers of the kind of the first one named move.
 */
export function droppedLayerOrder(
    doc: SpriteDoc,
    layerIds: readonly string[],
    gap: number,
): Layer[] | null {
    const first = doc.layers.find((layer) => layerIds.includes(layer.id));
    if (!first) return null;
    const { kind } = first;
    const moving = new Set(layerIds);
    // Top first, as the group lists them.
    const listed = doc.layers.filter((layer) => layer.kind === kind).reverse();
    const at = Math.min(Math.max(Math.round(gap), 0), listed.length);
    const stays = (layer: Layer) => !moving.has(layer.id);
    const order = [
        ...listed.slice(0, at).filter(stays),
        ...listed.filter((layer) => moving.has(layer.id)),
        ...listed.slice(at).filter(stays),
    ].reverse();
    const layers = [...doc.layers];
    let next = 0;
    doc.layers.forEach((layer, index) => {
        if (layer.kind === kind) layers[index] = order[next++]!;
    });
    return layers;
}

/**
 * Moves the layers `layerIds` as `droppedLayerOrder` says, in one undo step; null when the
 * order stays as it is.
 */
export function dropLayers(
    session: DocSession,
    layerIds: readonly string[],
    gap: number,
): Command | null {
    const { doc } = session;
    const order = droppedLayerOrder(doc, layerIds, gap);
    if (!order || order.every((layer, index) => layer === doc.layers[index])) return null;
    const label = layerIds.length === 1 ? "Move Layer" : "Move Layers";
    // Each layer in turn to its place, from the bottom: the places below it are final then.
    return chainedCommand(
        label,
        session,
        order.map(
            (layer, index) => (current: DocSession) =>
                reorderLayerCommand(current, layer.id, index),
        ),
    );
}
