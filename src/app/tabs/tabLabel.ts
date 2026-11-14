import type { StoreApi } from "zustand/vanilla";
import { PROJECT_FILE_EXTENSION } from "../../core/project";
import { isProjectFileName } from "../file/fileName";
import type { FileWorkflows } from "../file/workflows";
import { isDirty } from "../state/sessions";
import type { SessionsState } from "../state/sessions";

// What a document tab shows (SPEC §10, DESIGN §2; issue #6): once a document has a file (it
// was opened from one or saved to one), the tab is named after that file, without the project
// extension; until then, after its sprite name. The tooltip names both, so the sprite name,
// the export identity (SPEC §9), stays in sight. The overflow menu and the close control use
// the same label as the tab.

/** The label and tooltip of a document's tab. */
export interface TabLabel {
    /** What the tab, its close control and the overflow menu call the document. */
    readonly label: string;
    /** The tab's tooltip: the file's name and the sprite's, or the sprite's alone. */
    readonly tooltip: string;
}

/** What the strip shows of an open document. */
export interface TabInfo extends TabLabel {
    readonly id: string;
    readonly dirty: boolean;
}

/** `fileName` without the project extension; the whole name when that would leave nothing. */
function stem(fileName: string): string {
    if (!isProjectFileName(fileName)) return fileName;
    const cut = fileName.slice(0, -PROJECT_FILE_EXTENSION.length);
    return cut === "" ? fileName : cut;
}

/** The tab of a document whose sprite is `spriteName` and whose file is `fileName`, if any. */
export function tabLabel(spriteName: string, fileName: string | null): TabLabel {
    if (fileName === null) return { label: spriteName, tooltip: spriteName };
    return { label: stem(fileName), tooltip: `${fileName} — sprite: ${spriteName}` };
}

/** The tabs of the open documents, in their order. */
export function documentTabs(
    state: SessionsState,
    files: Pick<FileWorkflows, "fileOf">,
): TabInfo[] {
    return state.documents.map((entry) => ({
        id: entry.id,
        dirty: isDirty(entry),
        ...tabLabel(entry.session.doc.name, files.fileOf(entry.id)?.name ?? null),
    }));
}

/**
 * Calls `listener` when what the tabs show may have changed: the open documents (a rename, the
 * unsaved marker, an id changed by Save As) or the file of one of them, which Open, Save,
 * Save As and Revert set. Returns the function that stops it.
 */
export function subscribeDocumentTabs(
    sessions: StoreApi<SessionsState>,
    files: Pick<FileWorkflows, "subscribe">,
    listener: () => void,
): () => void {
    const stopSessions = sessions.subscribe(listener);
    const stopFiles = files.subscribe(listener);
    return () => {
        stopSessions();
        stopFiles();
    };
}
