import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";
import { appInfo, versionLine } from "./appInfo";
import type { AppInfo } from "./appInfo";

// The About dialog (ui/about/about.dialog.tsx): the app's name, version and licence, the
// engine's version, links to the repository and the changelog, and Copy version info, which
// puts `versionLine` on the system clipboard as text.

/** The request of the About dialog. */
export interface AboutRequest {
    kind: "about";
    info: AppInfo;
    /** The line Copy version info copies. */
    versionLine: string;
    /** Copies `versionLine` to the clipboard; false when the clipboard refused or is missing. */
    copy(): Promise<boolean>;
    /** Closes the dialog. */
    answer(values: null): void;
}

function isAboutRequest(request: DialogRequestBase): request is AboutRequest {
    return request.kind === "about";
}

export interface AboutDialogs {
    /** The open request when it is this dialog, otherwise null. */
    readonly store: DialogView<AboutRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Shows the dialog; resolves when it closes, at once when it cannot be shown. */
    show(options: Omit<AboutRequest, "kind" | "answer">): Promise<null>;
}

/** The About dialog over `requests`: by default requests of their own, for a test to host. */
export function createAboutDialogs(
    requests: DialogRequests = createDialogRequests(),
): AboutDialogs {
    return {
        store: dialogView(requests.store, isAboutRequest),
        attachHost: () => requests.attachHost(),
        show: (options) =>
            requests.open<never>((answer): AboutRequest => ({ kind: "about", ...options, answer })),
    };
}

/** The About dialog of the app, shown by the app's one dialog host. */
export const aboutDialogs = createAboutDialogs(commandDialogs);

/** What the command needs of the browser; tests pass their own. */
export interface AboutHost {
    readonly userAgent: string;
    /** Puts `text` on the clipboard; rejects or resolves false when it cannot. */
    writeText(text: string): Promise<unknown>;
    /** Shows the dialog; resolves when it closes. */
    show(options: Omit<AboutRequest, "kind" | "answer">): Promise<unknown>;
}

function browserHost(): AboutHost {
    return {
        userAgent: navigator.userAgent,
        writeText: async (text) => {
            // Missing on a page that is not a secure context.
            if (typeof navigator.clipboard?.writeText !== "function") return false;
            await navigator.clipboard.writeText(text);
            return true;
        },
        show: (options) => aboutDialogs.show(options),
    };
}

/** Shows the About dialog of `info`; resolves once it has closed. */
export async function openAbout(host: AboutHost = browserHost(), info = appInfo): Promise<void> {
    const line = versionLine(info, host.userAgent);
    await host.show({
        info,
        versionLine: line,
        // A refusal (no permission, the page without focus) or a missing API is an answer, not
        // an error: the dialog says the line was not copied.
        copy: async () => {
            try {
                return (await host.writeText(line)) !== false;
            } catch {
                return false;
            }
        },
    });
}
