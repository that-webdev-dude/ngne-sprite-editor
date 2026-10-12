import { assertInvariants, createDocument } from "../../core/model";
import type { CreateDocumentOptions } from "../../core/model";
import { appCommands } from "../commands/appCommands";
import type { CommandRegistry } from "../commands/registry";
import { keyContextStore } from "../keymap/contextState";
import { preferences } from "../preferences/preferences";
import type { PreferenceStore } from "../preferences/preferences";
import { editorStore } from "../state/editor";
import { sessionsStore } from "../state/sessions";
import { statusStore } from "../state/status";

/**
 * What end-to-end tests reach in the page: the stores and the registry themselves, and a way
 * to open a session without the interface. `App.tsx` installs it in development builds only;
 * the production bundle has no such global.
 */
export interface EditorTestHooks {
    readonly sessions: typeof sessionsStore;
    readonly editor: typeof editorStore;
    readonly status: typeof statusStore;
    readonly keyContexts: typeof keyContextStore;
    readonly preferences: PreferenceStore;
    readonly commands: CommandRegistry;
    /** Creates a document and opens it as the active session; returns the document's id. */
    openSession(options: CreateDocumentOptions): string;
    /** Throws when an open document violates an invariant of SPEC §5.1. */
    assertInvariants(): void;
}

declare global {
    interface Window {
        __ngneTest?: EditorTestHooks;
    }
}

/** Puts the hooks on `target.__ngneTest` and returns them. */
export function installTestHooks(target: Window = window): EditorTestHooks {
    const hooks: EditorTestHooks = {
        sessions: sessionsStore,
        editor: editorStore,
        status: statusStore,
        keyContexts: keyContextStore,
        preferences,
        commands: appCommands,
        openSession: (options) => sessionsStore.getState().open(createDocument(options)).id,
        assertInvariants() {
            for (const { session } of sessionsStore.getState().documents) {
                assertInvariants(session);
            }
        },
    };
    target.__ngneTest = hooks;
    return hooks;
}
