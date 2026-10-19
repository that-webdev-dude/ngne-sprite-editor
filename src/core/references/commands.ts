import type { Command } from "../history";
import { normalizeLayerName } from "../layers";
import { assertCanAdd, MAX_REFERENCE_LAYERS, randomId, truncateName } from "../model";
import type { DocSession, DocumentLimits, IdGenerator, ReferenceLayer, SpriteDoc } from "../model";
import { MAX_REFERENCE_OFFSET, MAX_REFERENCE_SCALE, MIN_REFERENCE_SCALE } from "../project/format";
import { fitToCanvas } from "./fit";
import type { ReferencePlacement } from "./fit";

// The commands of reference layers (SPEC §7.6, SE-045): add one from a decoded image, and set
// its position, scale and placement. Name, visibility, lock, opacity and delete are the layer
// commands of `core/layers`, which take reference layers as they take pixel layers.
//
// A reference layer is not part of the composite (SPEC §5.3): its property commands name the
// layer in `touched` and no frame, so no composite is given up. Adding one changes the list of
// layers, so it reports `structure: true` (SPEC §5.2), as every command that adds a layer does.

/**
 * What was wrong:
 * - `limit`: the document has `MAX_REFERENCE_LAYERS` reference layers already.
 * - `layer-not-found`: the document has no layer with the given ID.
 * - `not-a-reference-layer`: the layer is a pixel layer.
 * - `value`: a position, scale or source size is outside its range, or a placement is not
 *   "behind" or "front".
 */
export type ReferenceLayerErrorCode =
    "limit" | "layer-not-found" | "not-a-reference-layer" | "value";

/** Thrown while a command is made: nothing reaches the history, the session is unchanged. */
export class ReferenceLayerError extends Error {
    override readonly name = "ReferenceLayerError";
    readonly code: ReferenceLayerErrorCode;

    constructor(code: ReferenceLayerErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** The reference layers of a document, bottom to top. */
export function referenceLayers(doc: Pick<SpriteDoc, "layers">): ReferenceLayer[] {
    return doc.layers.filter((layer): layer is ReferenceLayer => layer.kind === "reference");
}

/** Whether the document can take another reference layer (SPEC §5.1: at most four). */
export function canAddReferenceLayer(doc: Pick<SpriteDoc, "layers">): boolean {
    return referenceLayers(doc).length < MAX_REFERENCE_LAYERS;
}

/** The reference layer with this ID. Throws `layer-not-found` and `not-a-reference-layer`. */
export function findReferenceLayer(doc: SpriteDoc, layerId: string): ReferenceLayer {
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
        throw new ReferenceLayerError("layer-not-found", `The document has no layer "${layerId}".`);
    }
    if (layer.kind !== "reference") {
        throw new ReferenceLayerError(
            "not-a-reference-layer",
            `"${layer.name}" is a pixel layer, not a reference layer.`,
        );
    }
    return layer;
}

/** The part of a reference layer its property commands set. */
export interface ReferenceChange {
    x?: number;
    y?: number;
    scale?: number;
    placement?: ReferenceLayer["placement"];
}

/**
 * Throws the `value` error unless every field of `change` is in the range a project file
 * holds (FORMAT.md §1.8): `x` and `y` within ±`MAX_REFERENCE_OFFSET`, `scale` from
 * `MIN_REFERENCE_SCALE` to `MAX_REFERENCE_SCALE`, placement "behind" or "front".
 */
export function assertReferenceChange(change: ReferenceChange): void {
    for (const axis of ["x", "y"] as const) {
        const value = change[axis];
        if (value === undefined) continue;
        if (!Number.isFinite(value) || Math.abs(value) > MAX_REFERENCE_OFFSET) {
            throw new ReferenceLayerError(
                "value",
                `A reference layer's ${axis} must be a number from ${-MAX_REFERENCE_OFFSET} to ` +
                    `${MAX_REFERENCE_OFFSET}, not ${value}.`,
            );
        }
    }
    const { scale, placement } = change;
    if (
        scale !== undefined &&
        !(Number.isFinite(scale) && scale >= MIN_REFERENCE_SCALE && scale <= MAX_REFERENCE_SCALE)
    ) {
        throw new ReferenceLayerError(
            "value",
            `A reference layer's scale must be a number from ${MIN_REFERENCE_SCALE} to ` +
                `${MAX_REFERENCE_SCALE}, not ${scale}.`,
        );
    }
    if (placement !== undefined && placement !== "behind" && placement !== "front") {
        throw new ReferenceLayerError(
            "value",
            `A reference layer is placed "behind" or "front", not "${String(placement)}".`,
        );
    }
}

/** Options of `addReferenceLayerCommand`. */
export interface AddReferenceLayerOptions {
    /** The ID of the source bytes, kept beside the document (SE-007 store). */
    sourceId: string;
    /** Size of the decoded source image in pixels. */
    sourceWidth: number;
    sourceHeight: number;
    /** Name of the layer; the default is "Reference". Cut to `MAX_NAME_LENGTH`. */
    name?: string;
    /** Position and scale; the default fits the image to the canvas and centres it. */
    placement?: ReferencePlacement;
    /** Makes the layer's ID; the default is `randomId`. */
    newId?: IdGenerator;
    /** The limits the command checks (SPEC §5.1); the default is `DOCUMENT_LIMITS`. */
    limits?: Readonly<DocumentLimits>;
}

/** The label of the step that adds a reference layer. */
export const ADD_REFERENCE_LABEL = "New Reference Layer";

/**
 * Adds a reference layer (SPEC §7.6): visible, unlocked, opacity 128 (50%), placed behind
 * the pixel layers, fitted and centred on the canvas unless `options.placement` says
 * otherwise. It goes directly above the topmost reference layer in the stack, or to the
 * bottom of the stack when there is none, so the reference group keeps its order; its place
 * among the pixel layers does not change how it is drawn (FORMAT.md §1.3). The active layer
 * stays active: drawing goes on on the pixel layer while the reference shows behind it.
 *
 * Throws `ReferenceLayerError` (`limit` at four reference layers, `value` for a source size
 * that is not a positive integer or a placement out of range) and `DocumentLimitError` when
 * the document has as many layers as `options.limits` allows.
 */
export function addReferenceLayerCommand(
    session: DocSession,
    options: AddReferenceLayerOptions,
): Command {
    const { doc } = session;
    const { sourceId, sourceWidth, sourceHeight, newId = randomId } = options;
    if (!canAddReferenceLayer(doc)) {
        throw new ReferenceLayerError(
            "limit",
            `A sprite can have at most ${MAX_REFERENCE_LAYERS} reference layers.`,
        );
    }
    for (const side of [sourceWidth, sourceHeight]) {
        if (!Number.isInteger(side) || side < 1) {
            throw new ReferenceLayerError("value", `A source side of ${side} px is not allowed.`);
        }
    }
    const placement = options.placement ?? fitToCanvas(doc, sourceWidth, sourceHeight);
    assertReferenceChange(placement);
    assertCanAdd(doc, { layers: 1 }, options.limits);
    const name = normalizeLayerName(truncateName(options.name?.trim() || "Reference"));
    const id = newId();
    let index = 0;
    doc.layers.forEach((layer, at) => {
        if (layer.kind === "reference") index = at + 1;
    });
    /** The active layer `do` found: undo returns to it when the new layer became active. */
    let activeBefore = session.activeLayerId;
    return {
        label: ADD_REFERENCE_LABEL,
        // The layer object only; the source bytes live beside the document.
        bytes: 0,
        touched: { frameIds: [], layerIds: [id], structure: true },
        do(target) {
            const current = target.doc;
            activeBefore = target.activeLayerId;
            const layer: ReferenceLayer = {
                id,
                name,
                kind: "reference",
                visible: true,
                locked: false,
                opacity: 128,
                sourceId,
                x: placement.x,
                y: placement.y,
                scale: placement.scale,
                placement: "behind",
            };
            current.layers.splice(index, 0, layer);
        },
        undo(target) {
            const current = target.doc;
            const at = current.layers.findIndex((layer) => layer.id === id);
            if (at !== -1) current.layers.splice(at, 1);
            // The new layer was made active since: the active layer `do` found is again.
            if (target.activeLayerId === id) target.activeLayerId = activeBefore;
        },
    };
}

/** The label of a change, by the fields it sets. */
function changeLabel(change: ReferenceChange): string {
    const keys = Object.keys(change);
    if (keys.length === 1 && change.placement !== undefined) {
        return change.placement === "front" ? "Reference to Front" : "Reference Behind";
    }
    if (keys.every((key) => key === "x" || key === "y")) return "Move Reference";
    if (keys.length === 1 && change.scale !== undefined) return "Scale Reference";
    return "Reference Properties";
}

/**
 * Sets position, scale and placement of a reference layer, those `change` names, in one step.
 * `x`, `y` are the top-left corner in document pixels and stay where they are when only the
 * scale changes. Returns null when the layer has those values already (no step). Throws
 * `ReferenceLayerError`: `layer-not-found`, `not-a-reference-layer`, `value`. `label` names
 * the step; the default follows the fields that change.
 */
export function setReferenceCommand(
    session: DocSession,
    layerId: string,
    change: ReferenceChange,
    label?: string,
): Command | null {
    const layer = findReferenceLayer(session.doc, layerId);
    assertReferenceChange(change);
    const next: ReferenceChange = {};
    for (const key of ["x", "y", "scale", "placement"] as const) {
        const value = change[key];
        if (value !== undefined && value !== layer[key]) Object.assign(next, { [key]: value });
    }
    if (Object.keys(next).length === 0) return null;
    let previous: ReferenceChange = {};
    return {
        label: label ?? changeLabel(next),
        bytes: 0,
        // Not part of any composite (SPEC §5.3): no frame changes.
        touched: { frameIds: [], layerIds: [layerId], structure: false },
        do({ doc }) {
            const found = findReferenceLayer(doc, layerId);
            previous = {};
            for (const key of Object.keys(next) as (keyof ReferenceChange)[]) {
                Object.assign(previous, { [key]: found[key] });
            }
            Object.assign(found, next);
        },
        undo({ doc }) {
            Object.assign(findReferenceLayer(doc, layerId), previous);
        },
    };
}

/** The label of Reset to Fit. */
export const RESET_REFERENCE_FIT_LABEL = "Reset Reference to Fit";

/**
 * Fits a reference layer to the canvas again and centres it (the placement a new one gets);
 * its placement behind or in front stays. Returns null when it is fitted already. Throws as
 * `setReferenceCommand` does.
 */
export function resetReferenceFitCommand(
    session: DocSession,
    layerId: string,
    sourceWidth: number,
    sourceHeight: number,
): Command | null {
    const fitted = fitToCanvas(session.doc, sourceWidth, sourceHeight);
    return setReferenceCommand(session, layerId, fitted, RESET_REFERENCE_FIT_LABEL);
}
