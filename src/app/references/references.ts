import type { Command } from "../../core/history";
import { DocumentLimitError, MAX_REFERENCE_LAYERS, randomId } from "../../core/model";
import type { PixelBuffer, ReferenceLayer } from "../../core/model";
import { PngError } from "../../core/png";
import { MAX_REFERENCE_SOURCE_BYTES } from "../../core/project/format";
import {
    addReferenceLayerCommand,
    canAddReferenceLayer,
    fitPlacement,
    ReferenceLayerError,
    fitToCanvas,
    RESET_REFERENCE_FIT_LABEL,
    setReferenceCommand,
} from "../../core/references";
import type { ReferenceChange, ReferencePlacement, ReferenceRect } from "../../core/references";
import { notices } from "../notices/notices";
import { FloatingApplyError } from "../selection/floating";
import { PAINT_REFUSED } from "../tools/paintTarget";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { settledDocumentOf } from "../timeline/timelineDocument";
import { referenceImages } from "./referenceImages";
import { withReferenceSources } from "./referenceSources";

// Reference layers as the app adds and changes them (SPEC §7.6, SE-045). Every change is one
// undo step of the document's history; the source bytes go into the document's store
// (`OpenDocument.referenceSources`, SE-007), from where Save writes them (SE-040, SE-041) and the
// viewport draws them (`app/viewport/viewportController`).
//
// What later tickets call: `addReferenceLayerFromPng` and `referenceLayerCommandFromPng`
// (SE-044: the drop chooser's "Add as reference", "keep source as reference" with the cropped
// region as `rect`, chained with the import in one step) and `changeReference` (SE-046: a drag
// or a corner handle, one step per gesture; a locked layer refuses).

/** The toast of a fifth reference layer. */
export const REFERENCE_LIMIT_MESSAGE = `A sprite can have at most ${
    ["no", "one", "two", "three", "four"][MAX_REFERENCE_LAYERS] ?? MAX_REFERENCE_LAYERS
} reference layers.`;

/** Options of `addReferenceLayerFromPng`. */
export interface AddReferenceOptions {
    /** The document to add to; the default is the active one. */
    documentId?: string;
    /** Name of the layer; the default is "Reference". */
    name?: string;
    /**
     * Where the image goes, in document pixels: fitted inside this rectangle and centred
     * there (SE-044 passes the cropped region of an import). The default is the canvas.
     */
    rect?: ReferenceRect;
}

function documentOf(documentId: string | undefined): OpenDocument | null {
    const state = sessionsStore.getState();
    if (documentId === undefined) return activeDocument(state);
    return state.documents.find((entry) => entry.id === documentId) ?? null;
}

/**
 * The document `documentId` when it can take a command now: a floating selection of the
 * active document applied first (SPEC §5.2), no stroke open. Null otherwise, or when it
 * could not be applied (that was reported).
 */
function settled(documentId: string): OpenDocument | null {
    try {
        return settledDocumentOf(documentId);
    } catch (error) {
        if (error instanceof FloatingApplyError) return null;
        throw error;
    }
}

/** Why a reference could not be added, as the toast says it. */
function reason(error: unknown): string {
    if (
        error instanceof PngError ||
        error instanceof ReferenceLayerError ||
        error instanceof DocumentLimitError
    ) {
        return error.message;
    }
    return "Something went wrong.";
}

/** A reference layer's step made from a PNG file, not yet executed (`referenceLayerCommandFromPng`). */
export interface ReferenceLayerStep {
    /** The document the step is for; execute it in that document's history. */
    document: OpenDocument;
    /**
     * The step: it adds the layer and puts the source bytes into the document's store, and its
     * undo takes both away (SE-045 review C). Made for the document as it is now: execute it
     * before the document changes again, alone or in a `compositeCommand` (SE-044 chains it
     * with its import, one undo step for both).
     */
    command: Command;
    /** The ID the new layer gets. */
    layerId: string;
}

/**
 * The step that adds a reference layer made from the bytes of a PNG file to a document (SPEC
 * §7.6), without executing it: decoded with the import's PNG path, placed behind the pixel
 * layers at opacity 50%, fitted and centred on the canvas (or in `options.rect`). Resolves null
 * when no step can be made; the reason has then been shown in an error toast:
 *
 * - The document has four reference layers already ("A sprite can have at most four
 *   reference layers.", checked before and after decoding).
 * - The bytes are not a PNG file, or larger than a project holds (64 MiB, FORMAT.md §1.8).
 * - The document was closed, opened again or reverted while the file was decoded, or a
 *   stroke is in progress ("The sprite is busy or was closed.").
 *
 * A floating selection of the document is applied first (SPEC §5.2). `bytes` are copied.
 */
export async function referenceLayerCommandFromPng(
    bytes: Uint8Array,
    options: AddReferenceOptions = {},
): Promise<ReferenceLayerStep | null> {
    const fail = (why: string): null => {
        notices.error(`Could not add the reference layer. ${why}`);
        return null;
    };
    const before = documentOf(options.documentId);
    if (!before) return null;
    if (!canAddReferenceLayer(before.session.doc)) {
        notices.error(REFERENCE_LIMIT_MESSAGE);
        return null;
    }
    if (bytes.length > MAX_REFERENCE_SOURCE_BYTES) {
        return fail(`The file is larger than ${MAX_REFERENCE_SOURCE_BYTES / 1024 / 1024} MiB.`);
    }
    const source = bytes.slice();
    let image: PixelBuffer;
    try {
        image = await referenceImages.decode(source);
    } catch (error) {
        return fail(reason(error));
    }
    // The same session: a document opened again or reverted keeps its id, not its session.
    const busy = "The sprite is busy or was closed.";
    if (documentOf(before.id)?.session !== before.session) return fail(busy);
    const document = settled(before.id);
    if (!document || document.session !== before.session) return fail(busy);
    const { session } = document;
    if (!canAddReferenceLayer(session.doc)) {
        notices.error(REFERENCE_LIMIT_MESSAGE);
        return null;
    }
    const sourceId = randomId();
    let added: Command;
    try {
        added = addReferenceLayerCommand(session, {
            sourceId,
            sourceWidth: image.width,
            sourceHeight: image.height,
            ...(options.name !== undefined && { name: options.name }),
            ...(options.rect && {
                placement: fitPlacement(image.width, image.height, options.rect),
            }),
        });
    } catch (error) {
        return fail(reason(error));
    }
    referenceImages.put(source, image);
    const command = withReferenceSources(added, {
        sessions: sessionsStore,
        documentId: document.id,
        owned: new Map([[sourceId, source]]),
    });
    return { document, command, layerId: added.touched.layerIds[0]! };
}

/**
 * Adds a reference layer made from the bytes of a PNG file to a document in one undo step
 * (`referenceLayerCommandFromPng`, executed at once). Resolves with the new layer's ID, or
 * null when nothing was added; the reason has then been shown in an error toast, and the
 * document is unchanged.
 */
export async function addReferenceLayerFromPng(
    bytes: Uint8Array,
    options: AddReferenceOptions = {},
): Promise<string | null> {
    const step = await referenceLayerCommandFromPng(bytes, options);
    if (!step) return null;
    step.document.history.execute(step.command);
    return step.layerId;
}

/** The reference layer `layerId` of a document, if it is one. */
export function referenceLayerOf(
    document: OpenDocument,
    layerId: string,
): ReferenceLayer | undefined {
    const layer = document.session.doc.layers.find((candidate) => candidate.id === layerId);
    return layer?.kind === "reference" ? layer : undefined;
}

/** The decoded size of a reference layer's source, or null while it is not decoded. */
export function referenceSourceSize(
    document: OpenDocument,
    layer: ReferenceLayer,
): { width: number; height: number } | null {
    const bytes = document.referenceSources.get(layer.sourceId);
    const image = bytes ? referenceImages.get(bytes) : null;
    return image ? { width: image.width, height: image.height } : null;
}

/** Why a reference layer's geometry cannot change: the paint tools' reason for a locked layer. */
export const REFERENCE_LOCKED = PAINT_REFUSED.locked;

/**
 * What a change of a reference layer's position, scale or placement came to: `changed` when a
 * step was recorded; `refused` with the reason when the layer is locked (SPEC §7.6: a lock
 * keeps the geometry, as it keeps pixels from the paint tools).
 */
export interface ReferenceChangeResult {
    changed: boolean;
    refused?: string;
}

const UNCHANGED: ReferenceChangeResult = { changed: false };

/**
 * Sets position, scale and placement of a reference layer of the active document, those
 * `change` names, in one undo step (SE-046 calls it once per drag). No step is recorded when
 * nothing changes, the layer is not a reference layer of the active document, or that document
 * is busy with a stroke; a locked layer is refused with `REFERENCE_LOCKED`. Throws
 * `ReferenceLayerError` for a value out of range.
 */
export function changeReference(
    layerId: string,
    change: ReferenceChange,
    label?: string,
): ReferenceChangeResult {
    const active = activeDocument(sessionsStore.getState());
    const layer = active && referenceLayerOf(active, layerId);
    if (!active || !layer) return UNCHANGED;
    if (layer.locked) return { changed: false, refused: REFERENCE_LOCKED };
    const document = settled(active.id);
    if (!document || !referenceLayerOf(document, layerId)) return UNCHANGED;
    const command = setReferenceCommand(document.session, layerId, change, label);
    if (!command) return UNCHANGED;
    document.history.execute(command);
    return { changed: true };
}

/**
 * The placement that fits a reference layer's source to the canvas of its document, centred:
 * the source is decoded first when it is not yet (a hidden layer's, say). Null when the
 * document or the layer is gone meanwhile, or the source cannot be decoded.
 */
export async function referenceFit(
    documentId: string,
    layerId: string,
): Promise<ReferencePlacement | null> {
    const document = documentOf(documentId);
    const layer = document && referenceLayerOf(document, layerId);
    const bytes = layer && document.referenceSources.get(layer.sourceId);
    if (!document || !bytes) return null;
    let image: PixelBuffer;
    try {
        image = await referenceImages.decode(bytes);
    } catch {
        return null;
    }
    const now = documentOf(documentId);
    if (now?.session !== document.session) return null;
    return fitToCanvas(now.session.doc, image.width, image.height);
}

/**
 * Fits a reference layer of the active document to the canvas again, centred, in one undo
 * step; its source is decoded first when it is not yet. Refused for a locked layer, like
 * `changeReference`; no step when it is fitted already or the document is busy or changed.
 */
export async function resetReferenceFit(layerId: string): Promise<ReferenceChangeResult> {
    const active = activeDocument(sessionsStore.getState());
    const layer = active && referenceLayerOf(active, layerId);
    if (!active || !layer) return UNCHANGED;
    if (layer.locked) return { changed: false, refused: REFERENCE_LOCKED };
    const fitted = await referenceFit(active.id, layerId);
    if (!fitted || activeDocument(sessionsStore.getState())?.session !== active.session) {
        return UNCHANGED;
    }
    return changeReference(layerId, fitted, RESET_REFERENCE_FIT_LABEL);
}
