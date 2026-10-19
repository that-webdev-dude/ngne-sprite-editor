import type { StoreApi } from "zustand/vanilla";
import type { PixelBuffer } from "../../core/pixels";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";
import type { ImportForm, ImportTarget } from "./importForm";
import type { ImportPreview, PreviewResult } from "./importPreview";

/**
 * The surfaces of Import PNG (DESIGN §7; SE-044): the large dialog, and the chooser that a drop
 * of one image shows at the drop point. The import workflow asks and waits for the answer; the
 * dialog host shows what `ui/import/import.dialog.tsx` registers for the kinds. Neither
 * changes a document.
 */

/** A decoded source image: its file's name and bytes, and its pixels (straight RGBA8). */
export interface DecodedSource {
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly pixels: PixelBuffer;
}

/** The source images of the dialog, which "Choose files…" replaces. */
export interface ImportSourcesState {
    /** In natural order of their names (SPEC §8). */
    sources: readonly DecodedSource[];
    /** A line for each file that could not be read, naming it. */
    errors: readonly string[];
    /** True while files are being read. */
    reading: boolean;
    /** Counts the times the sources were replaced: the dialog starts its crop and grid anew. */
    generation: number;
}

export interface ImportAnswer {
    form: ImportForm;
    /** The fields the user changed, for the session to remember. */
    changed: readonly (keyof ImportForm)[];
    /** How many frames were placed. */
    frames: number;
}

export interface ImportRequest {
    kind: "import-png";
    /** The document the frames may go into, or null when none is open. */
    target: (ImportTarget & { name: string }) | null;
    /** What the form opens with. */
    initial: ImportForm;
    sources: StoreApi<ImportSourcesState>;
    /** The live preview: the dialog asks it at every change. */
    preview: ImportPreview;
    /** Asks for other files; they replace the sources when the user chooses any. */
    chooseFiles(): void;
    /**
     * Places the import of `result`, the settled answer for the form: resolves null once the
     * frames are placed (the dialog then answers and closes), otherwise with why they could not
     * be, which the dialog shows while it stays open (SE-044 review B).
     */
    place(answer: ImportAnswer, result: PreviewResult): Promise<string | null>;
    /** The form to import with, or null to cancel. */
    answer(values: ImportAnswer | null): void;
}

/** What the drop chooser offers for one dropped image. */
export type DropChoice = "sprite" | "reference" | "both";

export interface DropChooserRequest {
    kind: "import-drop";
    /** The drop point, in CSS pixels of the window. */
    x: number;
    y: number;
    fileName: string;
    /** Whether a document is open: a reference layer goes into it. */
    canReference: boolean;
    answer(values: DropChoice | null): void;
}

type ImportRequests = ImportRequest | DropChooserRequest;

function isImportRequest(request: DialogRequestBase): request is ImportRequests {
    return request.kind === "import-png" || request.kind === "import-drop";
}

export interface ImportDialogs {
    /** The open request when it is one of these, otherwise null. */
    readonly store: DialogView<ImportRequests>;
    attachHost(): () => void;
    importPng(options: Omit<ImportRequest, "kind" | "answer">): Promise<ImportAnswer | null>;
    chooseDrop(options: Omit<DropChooserRequest, "kind" | "answer">): Promise<DropChoice | null>;
}

export function createImportDialogs(
    requests: DialogRequests = createDialogRequests(),
): ImportDialogs {
    return {
        store: dialogView(requests.store, isImportRequest),
        attachHost: () => requests.attachHost(),
        importPng: (options) =>
            requests.open<ImportAnswer>((answer): ImportRequest => ({
                kind: "import-png",
                ...options,
                answer,
            })),
        chooseDrop: (options) =>
            requests.open<DropChoice>((answer): DropChooserRequest => ({
                kind: "import-drop",
                ...options,
                answer,
            })),
    };
}

/** The import surfaces of the app, shown by the app's one dialog host. */
export const importDialogs = createImportDialogs(commandDialogs);
