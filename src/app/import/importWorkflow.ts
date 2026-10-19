import { createStore } from "zustand/vanilla";
import { compareNatural, importIntoDocumentCommand, importedDocument } from "../../core/import";
import type { ImportResult } from "../../core/import";
import { DocumentLimitError, randomId, truncateName } from "../../core/model";
import type { PixelBuffer } from "../../core/model";
import { cropPixels } from "../../core/pixels";
import { PngError, decodePng, encodePng } from "../../core/png";
import { MAX_REFERENCE_SOURCE_BYTES } from "../../core/project/format";
import { addReferenceLayerCommand, fitPlacement } from "../../core/references";
import { normalizeSpriteName } from "../../core/sprite";
import { fileWorkflows } from "../file/workflows";
import { notices } from "../notices/notices";
import { browserClipboard } from "../platform/clipboard";
import { preferences } from "../preferences/preferences";
import type { PickedImage } from "../references/pickImage";
import { referenceImages } from "../references/referenceImages";
import { addReferenceLayerFromPng, referenceLayerCommandFromPng } from "../references/references";
import { FloatingApplyError, applyFloating } from "../selection/floating";
import { activeDocument, sessionsStore } from "../state/sessions";
import { settledDocumentOf } from "../timeline/timelineDocument";
import { importDialogs } from "./importDialog";
import type { DecodedSource, ImportAnswer, ImportSourcesState } from "./importDialog";
import {
    canKeepReference,
    initialForm,
    placeProblem,
    referenceRectOf,
    rememberedOf,
    settingsOf,
} from "./importForm";
import type { ImportForm, RememberedField } from "./importForm";
import { createImportPreview } from "./importPreview";
import type { ImportPreview } from "./importPreview";
import { baseNameOf, isPngName, pickPngFiles } from "./pickImages";

// Import PNG (SPEC §8; SE-044): File → Import PNG, a drop of PNG files, the empty state, and a
// paste while no document is open all come here. The dialog shows the sources and the live
// preview; its answer places the frames: a new document, or one undo step in the active one
// (new frames, or a new layer), with "Keep source as reference" chained into that step. A
// file operation of its own (`fileWorkflows.run`), so nothing else runs meanwhile. Settings are
// remembered for the session: the fields the user changed in the last import made.

/** The fields the last import of this session was made with, where the user changed them. */
let remembered: Partial<Pick<ImportForm, RememberedField>> = {};

/** Forgets what the session remembered (tests). */
export function forgetImportSettings(): void {
    remembered = {};
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** Reads and decodes the files; a file that cannot be read gives a line naming it. */
export async function decodeSources(
    files: readonly PickedImage[],
): Promise<{ sources: DecodedSource[]; errors: string[] }> {
    const sources: DecodedSource[] = [];
    const errors: string[] = [];
    for (const file of files) {
        try {
            const bytes = await file.read();
            const pixels = await decodePng(bytes);
            sources.push({ name: file.name, bytes, pixels });
        } catch (error) {
            const why = error instanceof PngError ? error.message : reason(error);
            errors.push(`“${file.name}” could not be read as a PNG image. ${why}`);
        }
    }
    sources.sort((a, b) => compareNatural(a.name, b.name));
    return { sources, errors };
}

/**
 * The bytes and the pixels of the reference that "Keep source as reference" adds: the file
 * itself for the whole image, a PNG of the cropped region otherwise.
 */
function referenceSourceOf(
    source: DecodedSource,
    crop: ImportForm["crop"],
): { bytes: Uint8Array; pixels: PixelBuffer } {
    if (!crop) return { bytes: source.bytes, pixels: source.pixels };
    const pixels = cropPixels(source.pixels, crop);
    return { bytes: encodePng(pixels), pixels };
}

interface Placement {
    answer: ImportAnswer;
    result: ImportResult;
    sources: readonly DecodedSource[];
    targetId: string | null;
    name: string;
}

/** The frames in a new document, the active one; its reference layer made in it at once. */
function placeInNewDocument({ answer, result, sources, name }: Placement): boolean {
    const { form } = answer;
    const { width, height } = preferences.get("grid");
    const session = importedDocument({
        name,
        frames: result.frames,
        palette: result.palette,
        paletteMode: form.paletteMode,
        grid: { width, height },
    });
    const referenceSources: [string, Uint8Array][] = [];
    const [source] = sources;
    if (form.keepReference && source && canKeepReference(form, sources.length)) {
        const reference = referenceSourceOf(source, form.crop);
        if (reference.bytes.length > MAX_REFERENCE_SOURCE_BYTES) {
            notices.error(
                `Could not add the reference layer. The file is larger than ${
                    MAX_REFERENCE_SOURCE_BYTES / 1024 / 1024
                } MiB.`,
            );
            return false;
        }
        const { pixels } = reference;
        const sourceId = randomId();
        addReferenceLayerCommand(session, {
            sourceId,
            sourceWidth: pixels.width,
            sourceHeight: pixels.height,
            name: baseNameOf(source.name, "Reference"),
            placement: fitPlacement(
                pixels.width,
                pixels.height,
                referenceRectOf(pixels, form, form.fit),
            ),
        }).do(session);
        referenceImages.put(reference.bytes, pixels);
        referenceSources.push([sourceId, reference.bytes]);
    }
    // The active document stops being the active one: its floating selection is applied
    // (SPEC §5.2), as New Sprite does.
    applyFloating();
    sessionsStore.getState().open(session, { referenceSources });
    return true;
}

/** The frames into the open document `targetId`, one undo step with its reference layer. */
async function placeInDocument({ answer, result, sources, targetId }: Placement): Promise<boolean> {
    const { form } = answer;
    const busy = "The sprite is busy or was closed.";
    if (!targetId) return false;
    let first = null;
    const [source] = sources;
    if (form.keepReference && source && canKeepReference(form, sources.length)) {
        const reference = referenceSourceOf(source, form.crop);
        // Applies a floating selection of the document first (SPEC §5.2), and reports why it
        // could not make the layer.
        const step = await referenceLayerCommandFromPng(reference.bytes, {
            documentId: targetId,
            name: baseNameOf(source.name, "Reference"),
            rect: referenceRectOf(reference.pixels, form, form.fit),
        });
        if (!step) return false;
        first = step;
    }
    let document;
    try {
        document = settledDocumentOf(targetId);
    } catch (error) {
        if (error instanceof FloatingApplyError) return false;
        throw error;
    }
    if (!document || (first && document.session !== first.document.session)) {
        notices.error(`Could not import. ${busy}`);
        return false;
    }
    const problem = placeProblem(form, document.session.doc);
    if (problem) {
        notices.error(`Could not import. ${problem}`);
        return false;
    }
    try {
        document.history.execute(
            importIntoDocumentCommand(document.session, result.frames, {
                destination: form.place === "layer" ? "layer" : "frames",
                palette: result.palette,
                paletteMode: form.paletteMode,
                ...(first && { first: first.command }),
            }),
        );
    } catch (error) {
        notices.error(`Could not import. ${reason(error)}`);
        return false;
    }
    return true;
}

export interface ImportOptions {
    /** "Keep source as reference" on at the start (the drop chooser's "Both"). */
    keepReference?: boolean;
    /** The name of a new document; the default is the first file's name without extension. */
    name?: string;
}

/** The dialog for `files`, and the import it answers; a file operation of its own. */
async function runImport(files: readonly PickedImage[], options: ImportOptions): Promise<boolean> {
    const sources = createStore<ImportSourcesState>(() => ({
        sources: [],
        errors: [],
        reading: true,
        generation: 0,
    }));
    let preview: ImportPreview;
    try {
        preview = createImportPreview();
    } catch (error) {
        notices.error(`Could not import. ${reason(error)}`);
        return false;
    }
    /** The reads in order: a later choice of files replaces an earlier one still being read. */
    let reads = 0;
    const read = async (list: readonly PickedImage[]) => {
        const at = ++reads;
        sources.setState({ reading: true });
        const decoded = await decodeSources(list);
        if (at !== reads) return;
        preview.setSources(decoded.sources);
        sources.setState((state) => ({
            ...decoded,
            reading: false,
            generation: state.generation + 1,
        }));
    };
    try {
        void read(files);
        const active = activeDocument(sessionsStore.getState());
        const target = active
            ? {
                  name: active.session.doc.name,
                  width: active.session.doc.width,
                  height: active.session.doc.height,
                  palette: active.session.doc.palette,
              }
            : null;
        const answer = await importDialogs.importPng({
            target,
            initial: initialForm(preferences.get("import"), target, remembered, options),
            sources,
            preview,
            chooseFiles: () => {
                void pickPngFiles().then((picked) => {
                    if (picked) void read(picked);
                });
            },
        });
        if (!answer) return false;
        const { sources: decoded } = sources.getState();
        // Asked once more for the form answered and the sources there are now: an answer the
        // dialog showed may be for an earlier state. The cache makes it quick.
        const { settings, smart } = settingsOf(
            answer.form,
            decoded.length,
            target?.palette ?? null,
        );
        if (decoded.length > 0) preview.request(settings, smart);
        const result = decoded.length > 0 ? await preview.settled() : null;
        if (!result || decoded.length === 0) {
            notices.error(
                `Could not import. ${preview.store.getState().error ?? "There is no image to import."}`,
            );
            return false;
        }
        const placement: Placement = {
            answer,
            result,
            sources: decoded,
            targetId: active?.id ?? null,
            name: normalizeSpriteName(
                truncateName(options.name ?? baseNameOf(decoded[0]!.name, "Sprite")),
            ),
        };
        let placed: boolean;
        try {
            placed =
                answer.form.place === "new"
                    ? placeInNewDocument(placement)
                    : await placeInDocument(placement);
        } catch (error) {
            if (error instanceof FloatingApplyError) return false;
            const why = error instanceof DocumentLimitError ? error.message : reason(error);
            notices.error(`Could not import. ${why}`);
            return false;
        }
        if (placed) {
            remembered = rememberedOf(answer.form, new Set(answer.changed), remembered);
            const count = result.frames.length;
            notices.info(`Imported ${count} ${count === 1 ? "frame" : "frames"}`);
        }
        return placed;
    } finally {
        preview.dispose();
    }
}

/**
 * Opens the Import PNG dialog for `files` and imports what it answers (SPEC §8). Resolves
 * false when nothing was imported: cancelled, refused (reported by toast), or another file
 * operation runs.
 */
export function importImages(
    files: readonly PickedImage[],
    options: ImportOptions = {},
): Promise<boolean> {
    return fileWorkflows.run(() => runImport(files, options));
}

/** File → Import PNG: asks for PNG files, then `importImages`. */
export async function importPng(): Promise<boolean> {
    const files = await pickPngFiles();
    return files ? importImages(files) : false;
}

/** Whether a drop of these files is an import: no project file among them, a PNG file. */
export function isImageDrop(names: readonly string[]): boolean {
    return names.some(isPngName);
}

/**
 * A drop of image files at a point of the window (SPEC §8, DESIGN §7): one image shows the
 * drop chooser there ("Import as sprite", "Add as reference", "Both"); several go to the
 * dialog at once. "Add as reference" adds a reference layer to the active document.
 */
export async function importDropped(
    files: readonly PickedImage[],
    point: { x: number; y: number },
): Promise<boolean> {
    const [only] = files;
    if (!only || files.length > 1) return importImages(files);
    const choice = await importDialogs.chooseDrop({
        x: point.x,
        y: point.y,
        fileName: only.name,
        canReference: activeDocument(sessionsStore.getState()) !== null,
    });
    if (choice === "sprite") return importImages(files);
    if (choice === "both") return importImages(files, { keepReference: true });
    if (choice !== "reference") return false;
    return fileWorkflows.run(async () => {
        let bytes: Uint8Array;
        try {
            bytes = await only.read();
        } catch (error) {
            notices.error(`Could not add the reference layer. ${reason(error)}`);
            return false;
        }
        const added = await addReferenceLayerFromPng(bytes, {
            name: baseNameOf(only.name, "Reference"),
        });
        return added !== null;
    });
}

/** What a paste with no document open says when there is no image to import. */
export const PASTE_FEEDBACK = {
    nothing: "Nothing to paste: the clipboard holds no image",
    unavailable: "Nothing to paste: no access to the system clipboard",
};

/**
 * A paste while no document is open (SPEC §8; with one open, paste is SE-032's): the image on
 * the system clipboard goes to the Import PNG dialog.
 */
export async function importPasted(): Promise<boolean> {
    const read = await browserClipboard().readPng();
    if (read.kind !== "image") {
        notices.info(read.kind === "none" ? PASTE_FEEDBACK.nothing : PASTE_FEEDBACK.unavailable);
        return false;
    }
    const { bytes } = read;
    return importImages([{ name: "Pasted image.png", read: async () => bytes }], {
        name: "Pasted image",
    });
}
