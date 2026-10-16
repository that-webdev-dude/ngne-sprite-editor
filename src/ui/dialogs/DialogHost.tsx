import { Component, useEffect } from "react";
import type { ReactNode } from "react";
import { commandDialogs, useDialogRequest } from "../../app/dialogs/dialogRequests";
import type { DialogRequestBase } from "../../app/dialogs/dialogRequests";
import { focusMenuOpener } from "../focus/menuOpener";
import { toast } from "../toast/toast";
import { registeredDialogs } from "./registry";

/** Answers a request with null: closes its dialog and tells the command it was cancelled. */
function cancel(request: DialogRequestBase): void {
    (request.answer as (values: null) => void)(null);
}

interface DialogBoundaryProps {
    request: DialogRequestBase;
    name: string;
    children: ReactNode;
}

interface DialogBoundaryState {
    failed: boolean;
}

/**
 * Error boundary of the command dialogs. A dialog that crashes is answered with null, which
 * closes it, and reported by an error toast (DESIGN §4: a toast reports failures); the shell
 * behind it stays usable, and the command can be run again. React reports the caught error
 * to the console.
 */
class DialogBoundary extends Component<DialogBoundaryProps, DialogBoundaryState> {
    override state: DialogBoundaryState = { failed: false };

    static getDerivedStateFromError(): DialogBoundaryState {
        return { failed: true };
    }

    override componentDidCatch(): void {
        cancel(this.props.request);
        toast.error(`${this.props.name} failed to open.`);
    }

    // The answer leaves no request, so the host unmounts this boundary: the next request
    // mounts a new one.
    override render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

/** A number for each request, given when it is first shown: the React key of its dialog. */
const requestKeys = new WeakMap<DialogRequestBase, number>();
let lastRequestKey = 0;

function requestKey(request: DialogRequestBase): number {
    let key = requestKeys.get(request);
    if (key === undefined) {
        key = ++lastRequestKey;
        requestKeys.set(request, key);
    }
    return key;
}

/**
 * Shows the dialog a command has asked for (app/dialogs/dialogRequests.ts), from the dialogs
 * registered by `*.dialog.tsx` modules (ui/dialogs/registry.ts). Mounted once at the root of
 * the app (`UiRoot`), outside every region and inside a boundary of its own, so a failed
 * region does not take the dialogs with it (REVIEW.md B11). While it is mounted it is the
 * host of the requests; without it a request is answered with null at once.
 */
export function DialogHost() {
    const request = useDialogRequest();
    useEffect(() => commandDialogs.attachHost(), []);
    // A request made from a menu item arrives while that menu is still open. The listener runs
    // in the same call, before the dialog exists, so the dialog's opener is the menu's control.
    useEffect(
        () =>
            commandDialogs.store.subscribe((state, previous) => {
                if (state.request && !previous.request) focusMenuOpener();
            }),
        [],
    );
    const dialog = request ? registeredDialogs.get(request.kind) : undefined;
    // A kind no module registers has no dialog to answer it.
    useEffect(() => {
        if (!request || dialog) return;
        console.error(`No dialog is registered for requests of kind "${request.kind}".`);
        cancel(request);
    }, [request, dialog]);
    if (!request || !dialog) return null;
    const { Component: Dialog, name } = dialog;
    // Keyed by request: a request opened before React rendered the null of the one answered
    // before it still mounts a new boundary and dialog, with its own initial values.
    return (
        <DialogBoundary key={requestKey(request)} request={request} name={name}>
            <Dialog request={request} />
        </DialogBoundary>
    );
}
