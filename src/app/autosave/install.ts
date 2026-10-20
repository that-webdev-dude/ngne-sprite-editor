import { notices } from "../notices/notices";
import { preferences } from "../preferences/preferences";
import { isFloating } from "../selection/floating";
import { activeComposites } from "../state/composites";
import { sessionsStore } from "../state/sessions";
import { createAutosave } from "./autosave";
import { recoveryDialogs } from "./dialogs";
import { createRecovery, offerRecovery, pageOwner } from "./recovery";
import { indexedDbSnapshots } from "./snapshotStorage";
import type { SnapshotStorage } from "./snapshotStorage";

let storage: SnapshotStorage | null | undefined;

/** The app's snapshot storage, opened once per page; null without IndexedDB. */
function appSnapshots(): SnapshotStorage | null {
    if (storage === undefined) storage = indexedDbSnapshots();
    return storage;
}

/**
 * Autosave and crash recovery of the app (SPEC §10, SE-042): starts autosave over the app's
 * documents and, on launch, offers the snapshots left by an earlier page in the recovery
 * dialog. Returns the function that stops both (the component that installed it went).
 */
export function installAutosave(): () => void {
    const snapshots = appSnapshots();
    const owner = pageOwner();
    const autosave = createAutosave({
        sessions: sessionsStore,
        storage: snapshots,
        preferences,
        notices,
        composites: activeComposites,
        isFloating: () => isFloating(),
        owner,
    });
    let stopped = false;
    if (snapshots) {
        const recovery = createRecovery({
            storage: snapshots,
            sessions: sessionsStore,
            autosave,
            notices,
            owner,
        });
        void offerRecovery(recovery, recoveryDialogs, () => stopped);
    }
    return () => {
        stopped = true;
        autosave.stop();
    };
}
