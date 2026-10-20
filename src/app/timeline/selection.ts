import type { DocSession, SpriteDoc } from "../../core/model";

// The selection of the timeline (DESIGN §5.6, SE-022): cels, frames (the header) or layers
// (the rows), made by clicks — a click selects one, Shift selects the range from the anchor,
// Ctrl (or Cmd) adds or removes one. Pure functions over the document; the panel keeps the
// selection in `timelineState`.
//
// A selection belongs to the cel that was active when it was made (`at`): it holds while that
// cel stays the active one. A click makes the clicked cel active and the selection together;
// anything else that moves the active cel — the arrow keys, a new frame or layer, undo — ends
// the selection, as moving the active cel ends a range in Aseprite.

/** One cel of the grid. */
export interface CelRef {
    readonly layerId: string;
    readonly frameId: string;
}

interface SelectionBase {
    readonly documentId: string;
    /** The active cel when the selection was made. */
    readonly at: CelRef;
}

export type TimelineSelection =
    | (SelectionBase & {
          readonly kind: "cels";
          readonly cels: readonly CelRef[];
          /** Where Shift ranges start. */
          readonly anchor: CelRef;
      })
    | (SelectionBase & {
          readonly kind: "frames";
          readonly frameIds: readonly string[];
          readonly anchor: string;
      })
    | (SelectionBase & {
          readonly kind: "layers";
          readonly layerIds: readonly string[];
          readonly anchor: string;
      });

/** What a click in the grid is on. */
export type ClickTarget =
    | { readonly kind: "cels"; readonly cel: CelRef }
    | { readonly kind: "frames"; readonly frameId: string }
    | { readonly kind: "layers"; readonly layerId: string };

export interface ClickModifiers {
    /** Shift: the range from the anchor. */
    readonly shift: boolean;
    /** Ctrl or Cmd: add or remove one. */
    readonly toggle: boolean;
}

/** The rows and columns of the grid: pixel layers bottom to top, frames in playback order. */
export interface GridOrder {
    readonly layerIds: readonly string[];
    readonly frameIds: readonly string[];
}

/**
 * The rows and columns of the timeline grid's cels. Reference layers have no cels: their rows,
 * in a group of their own under the pixel layers (SE-045), are not part of a cel or a layer
 * range.
 */
export function gridOrder(doc: SpriteDoc): GridOrder {
    return {
        layerIds: doc.layers.filter((layer) => layer.kind === "pixel").map((layer) => layer.id),
        frameIds: doc.frames.map((frame) => frame.id),
    };
}

/**
 * Every row of the timeline from the bottom up (SE-045): the reference layers, bottom to top,
 * under the pixel layers, bottom to top, as the panel lists them top first. What ↑ and ↓ walk.
 */
export function rowOrder(doc: SpriteDoc): string[] {
    const ids = (kind: string) =>
        doc.layers.filter((layer) => layer.kind === kind).map((layer) => layer.id);
    return [...ids("reference"), ...ids("pixel")];
}

const sameCel = (a: CelRef, b: CelRef) => a.layerId === b.layerId && a.frameId === b.frameId;

/** The items of `order` from `from` to `to`, both included; null when either is not there. */
function between(order: readonly string[], from: string, to: string): string[] | null {
    const start = order.indexOf(from);
    const end = order.indexOf(to);
    if (start === -1 || end === -1) return null;
    return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** Adds `extra` to `items` without repeating one. */
function union<Item>(
    items: readonly Item[],
    extra: readonly Item[],
    same: (a: Item, b: Item) => boolean,
) {
    return [...items, ...extra.filter((item) => !items.some((kept) => same(kept, item)))];
}

/** `items` without `item`, or with it added when it was not there. */
function toggled<Item>(items: readonly Item[], item: Item, same: (a: Item, b: Item) => boolean) {
    return items.some((kept) => same(kept, item))
        ? items.filter((kept) => !same(kept, item))
        : [...items, item];
}

const sameId = (a: string, b: string) => a === b;

/**
 * The selection after a click on `target`. `current` is the selection in effect before the
 * click (`effectiveSelection`), `at` the cel the click makes active. Shift and Ctrl extend a
 * selection of the same kind only; on another kind they act as a plain click.
 */
export function clickSelection(
    current: TimelineSelection | null,
    target: ClickTarget,
    modifiers: ClickModifiers,
    order: GridOrder,
    documentId: string,
    at: CelRef,
): TimelineSelection {
    const base = { documentId, at };
    const extend = current !== null && current.kind === target.kind;
    switch (target.kind) {
        case "cels": {
            const { cel } = target;
            const previous = extend && current.kind === "cels" ? current : null;
            if (previous && modifiers.shift) {
                const layers = between(order.layerIds, previous.anchor.layerId, cel.layerId);
                const frames = between(order.frameIds, previous.anchor.frameId, cel.frameId);
                if (layers && frames) {
                    const range = layers.flatMap((layerId) =>
                        frames.map((frameId) => ({ layerId, frameId })),
                    );
                    const cels = modifiers.toggle ? union(previous.cels, range, sameCel) : range;
                    return { ...base, kind: "cels", cels, anchor: previous.anchor };
                }
            } else if (previous && modifiers.toggle) {
                const cels = toggled(previous.cels, cel, sameCel);
                return { ...base, kind: "cels", cels, anchor: cel };
            }
            return { ...base, kind: "cels", cels: [cel], anchor: cel };
        }
        case "frames": {
            const { frameId } = target;
            const previous = extend && current.kind === "frames" ? current : null;
            if (previous && modifiers.shift) {
                const range = between(order.frameIds, previous.anchor, frameId);
                if (range) {
                    const frameIds = modifiers.toggle
                        ? union(previous.frameIds, range, sameId)
                        : range;
                    return { ...base, kind: "frames", frameIds, anchor: previous.anchor };
                }
            } else if (previous && modifiers.toggle) {
                const frameIds = toggled(previous.frameIds, frameId, sameId);
                return { ...base, kind: "frames", frameIds, anchor: frameId };
            }
            return { ...base, kind: "frames", frameIds: [frameId], anchor: frameId };
        }
        case "layers": {
            const { layerId } = target;
            const previous = extend && current.kind === "layers" ? current : null;
            if (previous && modifiers.shift) {
                const range = between(order.layerIds, previous.anchor, layerId);
                if (range) {
                    const layerIds = modifiers.toggle
                        ? union(previous.layerIds, range, sameId)
                        : range;
                    return { ...base, kind: "layers", layerIds, anchor: previous.anchor };
                }
            } else if (previous && modifiers.toggle) {
                const layerIds = toggled(previous.layerIds, layerId, sameId);
                return { ...base, kind: "layers", layerIds, anchor: layerId };
            }
            return { ...base, kind: "layers", layerIds: [layerId], anchor: layerId };
        }
    }
}

/**
 * The selection while it holds: made in this document, with the cel that was active then
 * still active. Null otherwise.
 */
export function effectiveSelection(
    selection: TimelineSelection | null,
    documentId: string,
    session: Pick<DocSession, "activeLayerId" | "activeFrameId">,
): TimelineSelection | null {
    if (!selection || selection.documentId !== documentId) return null;
    const { at } = selection;
    return at.layerId === session.activeLayerId && at.frameId === session.activeFrameId
        ? selection
        : null;
}

/**
 * The selected frames in playback order: the frames of a frame selection, or the frames a
 * cel selection has a cel in. Frames the document no longer has are left out.
 */
export function selectedFrameIds(
    doc: { readonly frames: readonly { readonly id: string }[] },
    selection: TimelineSelection | null,
): string[] {
    if (!selection || selection.kind === "layers") return [];
    const chosen = new Set(
        selection.kind === "frames" ? selection.frameIds : selection.cels.map((cel) => cel.frameId),
    );
    return doc.frames.filter((frame) => chosen.has(frame.id)).map((frame) => frame.id);
}

/**
 * The layers of a layer selection, pixel and reference layers alike (SE-045 review A), bottom
 * to top; none for another kind.
 */
export function selectedLayerIds(doc: SpriteDoc, selection: TimelineSelection | null): string[] {
    if (!selection || selection.kind !== "layers") return [];
    const chosen = new Set(selection.layerIds);
    return doc.layers.filter((layer) => chosen.has(layer.id)).map((layer) => layer.id);
}

/**
 * The keys of a selection's items, made once per selection object (SE-026 review J): the
 * grid asks for each cell it renders.
 */
const selectedKeys = new WeakMap<TimelineSelection, ReadonlySet<string>>();

const celKeyOf = (layerId: string, frameId: string) => `${layerId}\n${frameId}`;

function keysOf(selection: TimelineSelection): ReadonlySet<string> {
    let keys = selectedKeys.get(selection);
    if (!keys) {
        keys = new Set(
            selection.kind === "cels"
                ? selection.cels.map((cel) => celKeyOf(cel.layerId, cel.frameId))
                : selection.kind === "frames"
                  ? selection.frameIds
                  : selection.layerIds,
        );
        selectedKeys.set(selection, keys);
    }
    return keys;
}

/** Whether the cell of `layerId` at `frameId` is in the selection, by any kind. */
export function isCelSelected(
    selection: TimelineSelection | null,
    layerId: string,
    frameId: string,
): boolean {
    if (!selection) return false;
    const keys = keysOf(selection);
    switch (selection.kind) {
        case "cels":
            return keys.has(celKeyOf(layerId, frameId));
        case "frames":
            return keys.has(frameId);
        case "layers":
            return keys.has(layerId);
    }
}

/**
 * The frames a frame command acts on (duration, delete): the selected frames, or the active
 * frame when none is selected.
 */
export function targetFrameIds(
    session: {
        readonly doc: { readonly frames: readonly { readonly id: string }[] };
        readonly activeFrameId: string;
    },
    selection: TimelineSelection | null,
): string[] {
    const selected = selectedFrameIds(session.doc, selection);
    return selected.length > 0 ? selected : [session.activeFrameId];
}

/** The layers Delete Layer removes: the selected layers, or the active layer. */
export function targetLayerIds(session: DocSession, selection: TimelineSelection | null): string[] {
    const selected = selectedLayerIds(session.doc, selection);
    return selected.length > 0 ? selected : [session.activeLayerId];
}
