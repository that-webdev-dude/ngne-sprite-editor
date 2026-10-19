import { createStore } from "zustand/vanilla";
import {
    MAX_IMPORT_FRAMES,
    compareNatural,
    importIntoDocumentCommand,
    importedDocument,
} from "../../core/import";
import type { ImportResult } from "../../core/import";
import {
    DocumentLimitError,
    MAX_DOCUMENT_PIXEL_BYTES,
    randomId,
    truncateName,
} from "../../core/model";
import type { PixelBuffer } from "../../core/model";
import { cropPixels } from "../../core/pixels";
import { PngError, decodePng, encodePng } from "../../core/png";
import { MAX_REFERENCE_SOURCE_BYTES } from "../../core/project/format";
import { addReferenceLayerCommand, fitPlacement, referenceLayers } from "../../core/references";
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
    initialForm,
    placeProblem,
    referenceProblem,
    referenceRectOf,
    rememberedOf,
} from "./importForm";
import type { ImportForm, ImportTarget, RememberedField } from "./importForm";
import { createImportPreview } from "./importPreview";
import type { ImportPreview, PreviewResult } from "./importPreview";
import { baseNameOf, isPngName, pickPngFiles } from "./pickImages";

// Import PNG (SPEC §8; SE-044): File → Import PNG, a drop of PNG files, the empty state, and a
// paste while no document is open all come here. The dialog shows the sources and the live
// preview; its Import places the frames while the dialog stays open, which closes once they
// are placed and shows why when they cannot be: a new document, or one undo step in the active
// one (new frames, or a new layer), with "Keep source as reference" chained into that step. A
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

/** How many files one import reads, and how many bytes of pixels their images may hold. */
export interface SourceLimits {
    /** Most files; more are refused before any is read. The default is 1024 (SPEC §8). */
    files: number;
    /**
     * Most bytes of decoded pixels for all files together; the files that would pass it are
     * left out. The default is the 1 GiB of SPEC §5.1.
     */
    pixelBytes: number;
}

export const SOURCE_LIMITS: Readonly<SourceLimits> = Object.freeze({
    files: MAX_IMPORT_FRAMES,
    pixelBytes: MAX_DOCUMENT_PIXEL_BYTES,
});

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Width and height from a PNG file's header, read before the image is decoded; null if none. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
    if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
        return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Reads and decodes the files in natural order of their names; a file that cannot be read
 * gives a line naming it. More files than `limits.files` are refused before any is read. Once
 * the decoded images would hold more than `limits.pixelBytes`, decoding stops: that file and
 * those after it are left out, each named in a line (sizes are read from the PNG header,
 * before the pixels are made).
 */
export async function decodeSources(
    files: readonly PickedImage[],
    limits: Readonly<SourceLimits> = SOURCE_LIMITS,
): Promise<{ sources: DecodedSource[]; errors: string[] }> {
    if (files.length > limits.files) {
        return {
            sources: [],
            errors: [
                `${files.length} files were chosen; an import reads at most ${limits.files} files.`,
            ],
        };
    }
    const ordered = [...files].sort((a, b) => compareNatural(a.name, b.name));
    const sources: DecodedSource[] = [];
    const errors: string[] = [];
    let total = 0;
    let full = false;
    const gib = limits.pixelBytes / 1024 ** 3;
    const budget = Number.isInteger(gib) ? `${gib} GiB` : `${limits.pixelBytes} bytes`;
    for (const file of ordered) {
        if (!full) {
            try {
                const bytes = await file.read();
                const size = pngSize(bytes);
                if (size && total + size.width * size.height * 4 > limits.pixelBytes) {
                    full = true;
                } else {
                    const pixels = await decodePng(bytes);
                    total += pixels.data.byteLength;
                    sources.push({ name: file.name, bytes, pixels });
                    continue;
                }
            } catch (error) {
                const why = error instanceof PngError ? error.message : reason(error);
                errors.push(`“${file.name}” could not be read as a PNG image. ${why}`);
                continue;
            }
        }
        errors.push(
            `“${file.name}” was left out: the images would hold more than ${budget} of pixels.`,
        );
    }
    return { sources, errors };
}

/**
 * The bytes and the pixels of the reference that "Keep source as reference" adds: the file
 * itself for the whole image, a PNG of the cropped region otherwise. A reference larger than a
 * project holds (`limit`, 64 MiB, FORMAT.md §1.8) gives the reason instead.
 */
export function referenceSourceFor(
    source: DecodedSource,
    crop: ImportForm["crop"],
    limit = MAX_REFERENCE_SOURCE_BYTES,
): { bytes: Uint8Array; pixels: PixelBuffer } | { problem: string } {
    let reference: { bytes: Uint8Array; pixels: PixelBuffer };
    if (crop) {
        const pixels = cropPixels(source.pixels, crop);
        reference = { bytes: encodePng(pixels), pixels };
    } else {
        reference = { bytes: source.bytes, pixels: source.pixels };
    }
    if (reference.bytes.length > limit) {
        const mib = limit / 1024 / 1024;
        const size = Number.isInteger(mib) ? `${mib} MiB` : `${limit} bytes`;
        return {
            problem: `The source is too large to keep as a reference: a reference holds at most ${size}.`,
        };
    }
    return reference;
}

/** What placing needs: the answer, its result, the sources and where they go. */
interface Placement {
    form: ImportForm;
    result: ImportResult;
    sources: readonly DecodedSource[];
    /** The reference to keep, already checked; null for none. */
    reference: { bytes: Uint8Array; pixels: PixelBuffer } | null;
    targetId: string | null;
    name: string;
}

/**
 * The frames in a new document, the active one; its reference layer made in it at once.
 * Returns null, or why it could not.
 */
function placeInNewDocument({ form, result, sources, reference, name }: Placement): string | null {
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
    if (reference && source) {
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
    return null;
}

/**
 * The frames into the open document `targetId`, one undo step with its reference layer.
 * Returns null, or why it could not.
 */
async function placeInDocument({
    form,
    result,
    sources,
    reference,
    targetId,
}: Placement): Promise<string | null> {
    const busy = "The sprite is busy or was closed.";
    if (!targetId) return busy;
    let first = null;
    const [source] = sources;
    if (reference && source) {
        // Applies a floating selection of the document first (SPEC §5.2); a failure there is
        // reported by its toast as well.
        const step = await referenceLayerCommandFromPng(reference.bytes, {
            documentId: targetId,
            name: baseNameOf(source.name, "Reference"),
            rect: referenceRectOf(reference.pixels, form, form.fit),
        });
        if (!step) return "The reference layer could not be added.";
        first = step;
    }
    const document = settledDocumentOf(targetId);
    if (!document || (first && document.session !== first.document.session)) return busy;
    const problem = placeProblem(form, document.session.doc);
    if (problem) return problem;
    document.history.execute(
        importIntoDocumentCommand(document.session, result.frames, {
            destination: form.place === "layer" ? "layer" : "frames",
            palette: result.palette,
            paletteMode: form.paletteMode,
            ...(first && { first: first.command }),
        }),
    );
    return null;
}

export interface ImportOptions {
    /** "Keep source as reference" on at the start (the drop chooser's "Both"). */
    keepReference?: boolean;
    /** The name of a new document; the default is the first file's name without extension. */
    name?: string;
}

/** The dialog for `files`, and the import it places; a file operation of its own. */
async function runImportDialog(
    files: readonly PickedImage[],
    options: ImportOptions,
): Promise<boolean> {
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
    const active = activeDocument(sessionsStore.getState());
    const target: (ImportTarget & { name: string }) | null = active
        ? {
              name: active.session.doc.name,
              width: active.session.doc.width,
              height: active.session.doc.height,
              palette: active.session.doc.palette,
              references: referenceLayers(active.session.doc).length,
          }
        : null;
    /** Places what the dialog settled; null once placed, otherwise why not. */
    const place = async (answer: ImportAnswer, result: PreviewResult): Promise<string | null> => {
        const { form } = answer;
        const { sources: decoded } = sources.getState();
        const [first] = decoded;
        if (!first) return "There is no image to import.";
        let reference: Placement["reference"] = null;
        if (form.keepReference && referenceProblem(form, decoded.length, target) === null) {
            const made = referenceSourceFor(first, form.crop);
            if ("problem" in made) return made.problem;
            reference = made;
        }
        // The answer has settled: the worker and what it holds go before the frames are
        // placed (a later change of a setting starts another).
        preview.suspend();
        const placement: Placement = {
            form,
            result,
            sources: decoded,
            reference,
            targetId: active?.id ?? null,
            name: normalizeSpriteName(
                truncateName(options.name ?? baseNameOf(first.name, "Sprite")),
            ),
        };
        try {
            return form.place === "new"
                ? placeInNewDocument(placement)
                : await placeInDocument(placement);
        } catch (error) {
            if (error instanceof FloatingApplyError) {
                return "The floating selection could not be applied.";
            }
            return error instanceof DocumentLimitError ? error.message : reason(error);
        }
    };
    try {
        void read(files);
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
            place,
        });
        if (!answer) return false;
        remembered = rememberedOf(answer.form, new Set(answer.changed), remembered);
        const count = answer.frames;
        notices.info(`Imported ${count} ${count === 1 ? "frame" : "frames"}`);
        return true;
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
    return fileWorkflows.run(() => runImportDialog(files, options));
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
