import { useMemo, useSyncExternalStore } from "react";
import { TabStrip } from "@ngne/editor-ui/shell";
import { fileWorkflows } from "../../app/file/workflows";
import { sessionsStore } from "../../app/state/sessions";
import { documentTabs, subscribeDocumentTabs } from "../../app/tabs/tabLabel";
import type { TabInfo } from "../../app/tabs/tabLabel";
import { activateDocument, closeDocument, moveDocument } from "../../app/tabs/tabs";

// The document tabs in the centre of the menu bar (DESIGN §2, SE-047): the package's tab strip
// with one tab per open document, the active one selected, each with its label (its file's
// name once it has a file, its sprite name until then; `tabLabel.ts`) and the unsaved marker.
// The strip owns the keys, the drag and the overflow menu; a close asks first when the
// document has unsaved changes (`closeDocument`).

const subscribe = (listener: () => void) =>
    subscribeDocumentTabs(sessionsStore, fileWorkflows, listener);
const snapshot = () => {
    const state = sessionsStore.getState();
    return JSON.stringify([state.activeId, documentTabs(state, fileWorkflows)]);
};

/**
 * The tabs and the active document; renders again only when one of them changes. The files of
 * the documents are not in the session store, so the strip follows the file workflows too: a
 * save names the tab after its file as soon as it is done.
 */
function useTabs(): { tabs: readonly TabInfo[]; activeId: string | null } {
    const key = useSyncExternalStore(subscribe, snapshot);
    return useMemo(() => {
        const [activeId, tabs] = JSON.parse(key) as [string | null, TabInfo[]];
        return { activeId, tabs };
    }, [key]);
}

/**
 * Closes the tab `id`. Closed from the strip with no document left, the focus goes to the
 * empty state's first action, which stands where the viewport target was.
 */
async function close(id: string): Promise<boolean> {
    const fromStrip = document.activeElement?.closest("[data-tab-strip]") != null;
    const closed = await closeDocument(id);
    if (closed && fromStrip && sessionsStore.getState().documents.length === 0) {
        // Once the empty state has replaced the viewport.
        requestAnimationFrame(() =>
            document
                .querySelector<HTMLElement>("[data-empty-state] button")
                ?.focus({ preventScroll: true }),
        );
    }
    return closed;
}

export function DocumentTabs() {
    const { tabs, activeId } = useTabs();
    if (tabs.length === 0) return null;
    return (
        <TabStrip
            items={tabs}
            activeId={activeId}
            label="Documents"
            overflowLabel="All documents"
            activate={(id) => void activateDocument(id)}
            close={close}
            move={moveDocument}
        />
    );
}
