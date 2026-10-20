import type { StoreApi } from "zustand/vanilla";
import { randomId } from "../../core/model";
import { docFromJson } from "../../core/project";
import { sessionOf } from "../file/workflows";
import type { Notices } from "../notices/notices";
import type { SessionsState } from "../state/sessions";
import type { Autosave } from "./autosave";
import type { RecoveryDialogs, RecoveryEntry } from "./dialogs";
import type { SnapshotRecord, SnapshotStorage } from "./snapshotStorage";

// Crash recovery (SPEC §10, SE-042): on launch, the snapshots autosave left (a reload, a
// crash, a closed window with unsaved changes) are offered in the recovery dialog.
//
// A snapshot names the page that wrote it. Each page holds a Web Lock named after itself for
// as long as it is open, so a snapshot whose page still holds its lock belongs to a page that
// is open in another tab, and is not offered: recovering it there would duplicate a document
// that is still being edited. Without Web Locks every snapshot is offered.
//
// A recovered document opens in a tab of its own with an empty history, and it stays dirty
// until it is saved (its file, if it had one, does not hold the recovered changes); its
// snapshot becomes this page's, and autosave writes only what changes from it.

const LOCK_PREFIX = "ngne-sprite-editor-page:";

/** The lock a page holds while it is open. */
export function ownerLock(owner: string): string {
    return `${LOCK_PREFIX}${owner}`;
}

let thisPage: string | null = null;

/**
 * The owner name of this page: a random id, whose lock (`ownerLock`) the page holds until it
 * is closed. Asked for once per page.
 */
export function pageOwner(): string {
    if (thisPage !== null) return thisPage;
    const owner = randomId();
    thisPage = owner;
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    // Held until the page goes: the callback's promise never settles.
    void locks?.request(ownerLock(owner), () => new Promise<void>(() => {}))?.catch(() => {});
    return owner;
}

/** The owners of the pages open now (their locks are held), or null when that is unknown. */
export async function openOwners(): Promise<Set<string> | null> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return null;
    try {
        const { held = [] } = await locks.query();
        const owners = new Set<string>();
        for (const lock of held) {
            if (lock.name?.startsWith(LOCK_PREFIX)) owners.add(lock.name.slice(LOCK_PREFIX.length));
        }
        return owners;
    } catch {
        return null;
    }
}

/** What went wrong, for a message. */
function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

export interface RecoveryOptions {
    storage: SnapshotStorage;
    sessions: StoreApi<SessionsState>;
    autosave: Pick<Autosave, "adopt">;
    notices: Pick<Notices, "info" | "error">;
    /** This page (`pageOwner`). */
    owner: string;
    /** The owners of the pages open now; the default asks Web Locks (`openOwners`). */
    openOwners?(): Promise<Set<string> | null>;
}

export interface Recovery {
    /** The snapshots to offer, newest first: those of no page open now. */
    offered(): Promise<SnapshotRecord[]>;
    /** Opens the snapshot's document in a tab of its own; false (and a toast) when it cannot. */
    recover(key: string): Promise<boolean>;
    /** Removes the snapshot permanently; false (and a toast) when it cannot. */
    discard(key: string, name: string): Promise<boolean>;
}

export function createRecovery(options: RecoveryOptions): Recovery {
    const { storage, sessions, autosave, notices, owner } = options;
    const owners = options.openOwners ?? openOwners;
    return {
        async offered() {
            const [records, open] = await Promise.all([storage.list(), owners()]);
            return records.filter(
                (record) => record.owner !== owner && !(open?.has(record.owner) ?? false),
            );
        },

        async recover(key) {
            let name = "the document";
            try {
                const snapshot = await storage.read(key);
                if (!snapshot) throw new Error("Its snapshot is no longer stored.");
                name = snapshot.record.name;
                const { record, images, sources } = snapshot;
                // Every check a project file gets (SPEC §10).
                const doc = docFromJson(record.docJson, images, record.version);
                const state = sessions.getState();
                // A document of that id is open already: the recovered one gets an id of its own.
                if (state.documents.some((entry) => entry.id === doc.id)) doc.id = randomId();
                const session = sessionOf(doc);
                const opened = state.open(session, { referenceSources: sources });
                // Dirty until saved: no history position is -1.
                sessions.getState().markSaved(opened.id, {
                    position: -1,
                    exportSettings: JSON.stringify(doc.exportSettings),
                });
                // Dirty now, so autosave keeps the snapshot it takes over.
                autosave.adopt(session, snapshot);
                notices.info(`Recovered ${name}`);
                return true;
            } catch (error) {
                notices.error(`Could not recover “${name}”. ${reason(error)}`);
                return false;
            }
        },

        async discard(key, name) {
            try {
                await storage.remove(key);
                return true;
            } catch (error) {
                notices.error(`Could not discard “${name}”. ${reason(error)}`);
                return false;
            }
        },
    };
}

/** The dialog's entries for `records`. */
export function recoveryEntries(records: readonly SnapshotRecord[]): RecoveryEntry[] {
    return records.map(({ key, name, savedAt, thumbnail }) => ({ key, name, savedAt, thumbnail }));
}

/** The User Timing mark set once the launch check is done; its detail says how many it offered. */
export const RECOVERY_CHECKED_MARK = "ngne-autosave:recovery-checked";

/**
 * The launch check: offers the snapshots of no open page in the recovery dialog. Waits for the
 * dialog host (it attaches after the first render) for up to `hostWaitMs`. `cancelled` stops it
 * (the component that started it went). Resolves with the number of snapshots offered.
 */
export async function offerRecovery(
    recovery: Recovery,
    dialogs: Pick<RecoveryDialogs, "hosted" | "show">,
    cancelled: () => boolean,
    hostWaitMs = 5000,
): Promise<number> {
    let records: SnapshotRecord[] = [];
    try {
        records = await recovery.offered();
    } catch (error) {
        console.warn("Recovery could not read the autosave snapshots:", error);
    }
    for (let waited = 0; !dialogs.hosted && waited < hostWaitMs; waited += 50) {
        if (cancelled()) return 0;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (cancelled()) return 0;
    const byKey = new Map(records.map((record) => [record.key, record]));
    const closed =
        records.length > 0
            ? dialogs.show({
                  entries: recoveryEntries(records),
                  recover: (key) => recovery.recover(key),
                  discard: (key) => recovery.discard(key, byKey.get(key)?.name ?? "the document"),
              })
            : null;
    const offered = closed ? records.length : 0;
    if (typeof performance !== "undefined") {
        performance.mark(RECOVERY_CHECKED_MARK, { detail: { offered } });
    }
    return offered;
}
