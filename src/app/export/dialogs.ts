import type { StoreApi } from "zustand/vanilla";
import type { ExportSettings } from "../../core/model";
import type { Pivot } from "../../core/sprite";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The dialogs of the export commands (DESIGN §7; SE-052): Export, the overwrite confirmation
 * and the frame PNG's scale. A command asks and waits for the answer; the dialog host shows
 * the dialog registered for the kind (ui/export/export.dialog.tsx).
 *
 * The Export dialog edits the document's export settings while it is open, and its pivot:
 * its controls call the functions of the request, which the export command made. The
 * settings change through the `ExportSettings` setter (saved, not undoable, SPEC §5.2), the
 * pivot through the undoable command of Sprite properties; the dialog changes nothing itself.
 */

/** Where the bundle goes, as the Export dialog shows it. */
export interface ExportDestination {
    /** "folder": File System Access, into `folder`; "download": a zip download. */
    mode: "folder" | "download";
    /** The name of the document's export folder, or null while none is chosen. */
    folder: string | null;
    /** True while the folder picker is open. */
    choosing: boolean;
}

export interface ExportDialogRequest {
    kind: "export";
    /** The document whose export settings the dialog edits. */
    documentId: string;
    /** The destination, kept up to date while the dialog is open. */
    destination: StoreApi<ExportDestination>;
    /** Changes the document's export settings (no history entry; the document becomes dirty). */
    setSettings(update: (settings: ExportSettings) => void): void;
    /** Sets the document's pivot with the undoable command of Sprite properties. */
    setPivot(pivot: Pivot): void;
    /** Asks for the document's export folder (the folder picker); with File System Access. */
    chooseFolder(): void;
    /** True to export now; null closes the dialog without exporting. */
    answer(values: true | null): void;
}

export interface ExportOverwriteRequest {
    kind: "export-overwrite";
    /** The document being exported. */
    document: string;
    /** The folder's name. */
    folder: string;
    /** The files of the export that the folder holds already. */
    files: readonly string[];
    /** True to replace them; null to export nothing. */
    answer(values: true | null): void;
}

export interface FramePngRequest {
    kind: "export-frame-png";
    /** The document's export name (`exportName`). */
    name: string;
    /** Zero-based index of the frame that is exported: the active one. */
    frameIndex: number;
    /** The size of the document. */
    width: number;
    height: number;
    /** The scale the dialog opens with, and the largest it offers. */
    initialScale: number;
    maxScale: number;
    /** The scale to export at, or null to cancel. */
    answer(values: number | null): void;
}

export type ExportDialogRequestKind =
    ExportDialogRequest | ExportOverwriteRequest | FramePngRequest;

const KINDS: ReadonlySet<string> = new Set<ExportDialogRequestKind["kind"]>([
    "export",
    "export-overwrite",
    "export-frame-png",
]);

function isExportDialogRequest(request: DialogRequestBase): request is ExportDialogRequestKind {
    return KINDS.has(request.kind);
}

export interface ExportDialogs {
    /** The open request when it is one of these dialogs, otherwise null. */
    readonly store: DialogView<ExportDialogRequestKind>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Shows the Export dialog; resolves true when the user exports, null when not. */
    exportBundle(options: Omit<ExportDialogRequest, "kind" | "answer">): Promise<true | null>;
    /** Asks whether to replace the files a folder holds; resolves true to go on. */
    confirmOverwrite(options: Omit<ExportOverwriteRequest, "kind" | "answer">): Promise<boolean>;
    /** Asks for the scale of a frame PNG; resolves with it, or null. */
    framePng(options: Omit<FramePngRequest, "kind" | "answer">): Promise<number | null>;
}

/** The export dialogs over `requests`: by default requests of their own, for a test to host. */
export function createExportDialogs(
    requests: DialogRequests = createDialogRequests(),
): ExportDialogs {
    return {
        store: dialogView(requests.store, isExportDialogRequest),
        attachHost: () => requests.attachHost(),
        exportBundle: (options) =>
            requests.open<true>((answer): ExportDialogRequest => ({
                kind: "export",
                ...options,
                answer,
            })),
        async confirmOverwrite(options) {
            const answer = await requests.open<true>((answer): ExportOverwriteRequest => ({
                kind: "export-overwrite",
                ...options,
                answer,
            }));
            return answer === true;
        },
        framePng: (options) =>
            requests.open<number>((answer): FramePngRequest => ({
                kind: "export-frame-png",
                ...options,
                answer,
            })),
    };
}

/** The export dialogs of the app, shown by the app's one dialog host. */
export const exportDialogs = createExportDialogs(commandDialogs);
