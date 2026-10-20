import type { StoreApi } from "zustand/vanilla";
import { randomId } from "../../core/model";
import { ProjectError, docFromJson } from "../../core/project";
import { sessionOf } from "../file/workflows";
import type { Notices } from "../notices/notices";
import { namedSources } from "../references/referenceSources";
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
// Two pages may offer the same snapshot (a browser restoring its tabs after a crash opens two
// editors). Recover and Discard check again, in the transaction that takes or removes the
// snapshot, that its owner is still the one the dialog listed and that no open page holds it;
// otherwise the other page has it: a toast says so and the row goes (SE-042 review B).
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

/** The toast when another page has the snapshot. */
export function elsewhereMessage(name: string): string {
    return `“${name}” is open in another tab.`;
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
    /**
     * Opens an offered snapshot's document in a tab of its own. Resolves true when its row
     * goes: recovered, or had by another page meanwhile (a toast says so); false when it cannot
     * be opened (a toast says why).
     */
    recover(key: string): Promise<boolean>;
    /**
     * Removes an offered snapshot permanently. Resolves true when its row goes: removed, gone
     * already, or had by another page (a toast says so); false when removing failed.
     */
    discard(key: string): Promise<boolean>;
}

export function createRecovery(options: RecoveryOptions): Recovery {
    const { storage, sessions, autosave, notices, owner } = options;
    const owners = options.openOwners ?? openOwners;
    /** The offered snapshots as this page saw them: who owned each. */
    const seen = new Map<string, SnapshotRecord>();
    /** Whether another open page holds the snapshot `record` (its owner is open). */
    const heldElsewhere = async (record: SnapshotRecord) =>
        record.owner !== owner && ((await owners())?.has(record.owner) ?? false);

    return {
        async offered() {
            const [records, open] = await Promise.all([storage.list(), owners()]);
            const offered = records.filter(
                (record) => record.owner !== owner && !(open?.has(record.owner) ?? false),
            );
            for (const record of offered) seen.set(record.key, record);
            return offered;
        },

        async recover(key) {
            const listed = seen.get(key);
            const name = listed?.name ?? "the document";
            try {
                if (!listed) throw new Error("It was not offered.");
                if (await heldElsewhere(listed)) {
                    notices.error(elsewhereMessage(name));
                    return true;
                }
                const taken = await storage.take(key, listed.owner, owner);
                if (taken === "taken") {
                    notices.error(elsewhereMessage(name));
                    return true;
                }
                if (taken === "gone") {
                    notices.error(`Could not recover “${name}”. Its snapshot is no longer stored.`);
                    return true;
                }
                // This page's from now on, opened or not: Discard asks for this owner.
                seen.set(key, taken.record);
                const { record, images, sources } = taken;
                // Every check a project file gets (SPEC §10), the reference sources included.
                const doc = docFromJson(record.docJson, images, record.version);
                const referenceSources = new Map<string, Uint8Array>();
                for (const sourceId of namedSources(doc)) {
                    const bytes = sources.get(sourceId);
                    if (!bytes) {
                        throw new ProjectError(
                            "missing-reference",
                            `A reference layer names the source “${sourceId}”, and the snapshot ` +
                                "does not hold it.",
                        );
                    }
                    referenceSources.set(sourceId, bytes);
                }
                const state = sessions.getState();
                // A document of that id is open already: the recovered one gets an id of its own.
                if (state.documents.some((entry) => entry.id === doc.id)) doc.id = randomId();
                const session = sessionOf(doc);
                const opened = state.open(session, { referenceSources });
                // Dirty until saved: no history position is -1.
                sessions.getState().markSaved(opened.id, {
                    position: -1,
                    exportSettings: JSON.stringify(doc.exportSettings),
                });
                // Dirty now, so autosave keeps the snapshot it takes over.
                autosave.adopt(session, taken);
                seen.delete(key);
                notices.info(`Recovered ${name}`);
                return true;
            } catch (error) {
                notices.error(`Could not recover “${name}”. ${reason(error)}`);
                return false;
            }
        },

        async discard(key) {
            const listed = seen.get(key);
            const name = listed?.name ?? "the document";
            try {
                if (!listed) return true;
                if (await heldElsewhere(listed)) {
                    notices.error(elsewhereMessage(name));
                    return true;
                }
                const result = await storage.discard(key, listed.owner);
                if (result === "taken") notices.error(elsewhereMessage(name));
                seen.delete(key);
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

/**
 * The User Timing mark set once the launch check is done; its detail says how many snapshots
 * it offered. It stays in the page's timeline: the E2E specs read it.
 */
export const RECOVERY_CHECKED_MARK = "ngne-autosave:recovery-checked";

/**
 * The launch check: offers the snapshots of no open page in the recovery dialog. Waits for the
 * dialog host (it attaches after the first render) for up to `hostWaitMs`; while another dialog
 * is open, waits for it to close. `cancelled` stops it (the component that started it went).
 * Resolves with the number of snapshots offered.
 */
export async function offerRecovery(
    recovery: Recovery,
    dialogs: Pick<RecoveryDialogs, "hosted" | "show" | "free">,
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
    let offered = 0;
    while (records.length > 0 && dialogs.hosted) {
        if (cancelled()) return 0;
        const closed = dialogs.show({
            entries: recoveryEntries(records),
            recover: (key) => recovery.recover(key),
            discard: (key) => recovery.discard(key),
        });
        if (closed) {
            offered = records.length;
            break;
        }
        // Another dialog is open: offered once it closes.
        await dialogs.free();
    }
    if (cancelled()) return 0;
    if (typeof performance !== "undefined") {
        performance.mark(RECOVERY_CHECKED_MARK, { detail: { offered } });
    }
    return offered;
}
