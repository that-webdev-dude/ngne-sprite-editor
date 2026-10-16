import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Requests for the dialogs of commands (DESIGN §7). A command asks for a dialog and waits for
 * the answer; the dialog host of the interface (ui/dialogs/DialogHost.tsx) shows the dialog
 * registered for the request's kind and answers it. The document is changed by the command,
 * never by the dialog (SPEC §5).
 *
 * - One dialog at a time: a request made while another is open is answered with null.
 * - A request made while no host is attached is answered with null at once, so a command
 *   never waits for a dialog nobody shows. When the last host detaches, the open request is
 *   answered with null.
 */

/** What every request has: the kind of dialog it asks for, and its answer. */
export interface DialogRequestBase {
    /** The dialog the host shows for it, by the kind the dialog registers. */
    readonly kind: string;
    /** Answers the request: values, or null to cancel. Closes the dialog. */
    answer(values: never): void;
}

export interface DialogState<Request> {
    /** The dialog that is open, or null. */
    request: Request | null;
}

/**
 * What a feature reads of a request store: the open request when it is one of the feature's
 * kinds, otherwise null.
 */
export interface DialogView<Request extends DialogRequestBase> {
    getState(): DialogState<Request>;
    subscribe(
        listener: (state: DialogState<Request>, previous: DialogState<Request>) => void,
    ): () => void;
}

/** The view of `store` that shows the requests `is` accepts (a guard by kind). */
export function dialogView<Request extends DialogRequestBase>(
    store: StoreApi<DialogState<DialogRequestBase>>,
    is: (request: DialogRequestBase) => request is Request,
): DialogView<Request> {
    const narrow = ({ request }: DialogState<DialogRequestBase>): DialogState<Request> => ({
        request: request && is(request) ? request : null,
    });
    return {
        getState: () => narrow(store.getState()),
        subscribe: (listener) =>
            store.subscribe((state, previous) => listener(narrow(state), narrow(previous))),
    };
}

export interface DialogRequests<Request extends DialogRequestBase = DialogRequestBase> {
    readonly store: StoreApi<DialogState<Request>>;
    /**
     * Opens the request `build` makes from its answer function; resolves with the answer.
     * Resolves with null at once while another request is open or no host is attached.
     */
    open<Values>(
        build: (answer: (values: Values | null) => void) => Request,
    ): Promise<Values | null>;
    /**
     * Called by a host when it starts showing requests. Returns the function that detaches it;
     * when no host is left, the open request is answered with null.
     */
    attachHost(): () => void;
    /** True while at least one host is attached. */
    readonly hosted: boolean;
}

export function createDialogRequests<
    Request extends DialogRequestBase = DialogRequestBase,
>(): DialogRequests<Request> {
    const store = createStore<DialogState<Request>>(() => ({ request: null }));
    let hosts = 0;
    /** The answer function of the open request: what a detaching host answers it with. */
    let cancel: (() => void) | null = null;

    return {
        store,
        get hosted() {
            return hosts > 0;
        },
        open<Values>(build: (answer: (values: Values | null) => void) => Request) {
            if (hosts === 0 || store.getState().request) return Promise.resolve(null);
            return new Promise<Values | null>((resolve) => {
                const request = build((values) => {
                    // Answered already: a second answer changes nothing.
                    if (store.getState().request !== request) return;
                    cancel = null;
                    store.setState({ request: null });
                    resolve(values);
                });
                cancel = () => (request.answer as (values: null) => void)(null);
                store.setState({ request });
            });
        },
        attachHost() {
            hosts++;
            let attached = true;
            return () => {
                if (!attached) return;
                attached = false;
                hosts--;
                if (hosts === 0) cancel?.();
            };
        },
    };
}

/**
 * The dialog requests of the app. Features ask through their own typed functions over it
 * (`spriteDialogs` of app/sprite/dialogs.ts); the one dialog host shows them all.
 */
export const commandDialogs = createDialogRequests();

/** The open request of the app, or null; the component renders again when it changes. */
export function useDialogRequest(): DialogRequestBase | null {
    return useStore(commandDialogs.store, (state) => state.request);
}
