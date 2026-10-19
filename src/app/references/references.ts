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
    resetReferenceFitCommand,
    setReferenceCommand,
} from "../../core/references";
import type { ReferenceChange, ReferenceRect } from "../../core/references";
import { notices } from "../notices/notices";
import { FloatingApplyError } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import type { OpenDocument } from "../state/sessions";
import { settledDocumentOf } from "../timeline/timelineDocument";
import { referenceImages } from "./referenceImages";

// Reference layers as the app adds and changes them (SPEC §7.6, SE-045). Every change is one
// undo step of the document's history; the source bytes go into the document's store
// (`OpenDocument.referenceSources`, SE-007), from where Save writes them (SE-040, SE-041) and the
// viewport draws them (`app/viewport/viewportController`).
//
// What later tickets call: `addReferenceLayerFromPng` (SE-044: the drop chooser's "Add as
// reference", "keep source as reference" with the cropped region as `rect`) and
// `changeReference` (SE-046: a drag or a corner handle, one step per gesture).

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

/**
 * Adds a reference layer made from the bytes of a PNG file to a document (SPEC §7.6): decoded
 * with the import's PNG path, placed behind the pixel layers at opacity 50%, fitted and centred
 * on the canvas (or in `options.rect`), in one undo step. Resolves with the new layer's ID, or
 * null when nothing was added; the reason has then been shown in an error toast:
 *
 * - The document has four reference layers already ("A sprite can have at most four
 *   reference layers.", checked before and after decoding).
 * - The bytes are not a PNG file, or larger than a project holds (64 MiB, FORMAT.md §1.8).
 * - The document was closed while the file was decoded, or a stroke is in progress.
 *
 * The document is unchanged in every one of these cases. `bytes` are copied.
 */
export async function addReferenceLayerFromPng(
    bytes: Uint8Array,
    options: AddReferenceOptions = {},
): Promise<string | null> {
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
        return fail(`The file is larger than ${MAX_REFERENCE_SOURCE_BYTES / 1024 / 1024} MB.`);
    }
    const source = bytes.slice();
    let image: PixelBuffer;
    try {
        image = await referenceImages.decode(source);
    } catch (error) {
        return fail(reason(error));
    }
    const document = documentOf(before.id) === null ? null : settled(before.id);
    if (!document) return fail("The sprite is busy or was closed.");
    const { session, history } = document;
    if (!canAddReferenceLayer(session.doc)) {
        notices.error(REFERENCE_LIMIT_MESSAGE);
        return null;
    }
    const sourceId = randomId();
    let command: Command;
    try {
        command = addReferenceLayerCommand(session, {
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
    // The bytes first: whoever hears of the step finds them.
    sessionsStore.getState().setReferenceSource(document.id, sourceId, source);
    try {
        history.execute(command);
    } catch (error) {
        sessionsStore.getState().deleteReferenceSource(document.id, sourceId);
        throw error;
    }
    return command.touched.layerIds[0] ?? null;
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

/**
 * Sets position, scale and placement of a reference layer of the active document, those
 * `change` names, in one undo step (SE-046 calls it once per drag). Returns whether a step was
 * recorded: none when nothing changes, the layer is not a reference layer of the active
 * document, or that document is busy with a stroke. Throws `ReferenceLayerError` for a value
 * out of range.
 */
export function changeReference(layerId: string, change: ReferenceChange, label?: string): boolean {
    const active = activeDocument(sessionsStore.getState());
    if (!active || !referenceLayerOf(active, layerId)) return false;
    const document = settled(active.id);
    if (!document || !referenceLayerOf(document, layerId)) return false;
    const command = setReferenceCommand(document.session, layerId, change, label);
    if (!command) return false;
    document.history.execute(command);
    return true;
}

/**
 * Fits a reference layer of the active document to the canvas again, centred, in one undo
 * step. Returns whether a step was recorded: none when it is fitted already, its source is
 * not decoded yet, or the document is busy.
 */
export function resetReferenceFit(layerId: string): boolean {
    const active = activeDocument(sessionsStore.getState());
    const layer = active && referenceLayerOf(active, layerId);
    const size = active && layer ? referenceSourceSize(active, layer) : null;
    if (!active || !size) return false;
    const document = settled(active.id);
    if (!document || !referenceLayerOf(document, layerId)) return false;
    const command = resetReferenceFitCommand(document.session, layerId, size.width, size.height);
    if (!command) return false;
    document.history.execute(command);
    return true;
}
