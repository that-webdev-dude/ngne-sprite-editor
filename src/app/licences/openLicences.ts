import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

// The open-source licences of the app: `licences.txt` beside `index.html`, which the build
// writes (scripts/licences.ts, vite.config.ts) and the development server answers. The command
// fetches the file and shows its text in a dialog of the app (ui/licences/licences.dialog.tsx).
//
// The text is fetched from the page, so the service worker answers from its cache and the
// dialog shows it offline in the installed app. It is shown in a dialog, not in a new tab: a
// tab the page opens stays in the editor's process and holds about 3 MB of its heap until the
// user closes it (the SE-070 soak failed on two such tabs). When the file cannot be read, the
// dialog says so and names its address.

/** The file of the build, relative to the app's base. */
export const LICENCES_PATH = "licences.txt";

/** The request of the licences dialog. */
export interface LicencesRequest {
    kind: "licences";
    /** The text of the licences file, or null when it could not be read. */
    text: string | null;
    /** The file's address, which the dialog names when the text could not be read. */
    address: string;
    /** Closes the dialog. */
    answer(values: null): void;
}

function isLicencesRequest(request: DialogRequestBase): request is LicencesRequest {
    return request.kind === "licences";
}

export interface LicencesDialogs {
    /** The open request when it is this dialog, otherwise null. */
    readonly store: DialogView<LicencesRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Shows the dialog; resolves when it closes, at once when it cannot be shown. */
    show(options: Pick<LicencesRequest, "text" | "address">): Promise<null>;
}

/** The licences dialog over `requests`: by default requests of their own, for a test to host. */
export function createLicencesDialogs(
    requests: DialogRequests = createDialogRequests(),
): LicencesDialogs {
    return {
        store: dialogView(requests.store, isLicencesRequest),
        attachHost: () => requests.attachHost(),
        show: (options) =>
            requests.open<never>((answer): LicencesRequest => ({
                kind: "licences",
                ...options,
                answer,
            })),
    };
}

/** The licences dialog of the app, shown by the app's one dialog host. */
export const licencesDialogs = createLicencesDialogs(commandDialogs);

/** What the command needs of the browser; tests pass their own. */
export interface LicencesHost {
    /** The app's base URL, against which `LICENCES_PATH` is resolved. */
    readonly baseUrl: string;
    /** The text at `url`, or null when it cannot be read. */
    fetchText(url: string): Promise<string | null>;
    /** Shows the text, or that the file at `address` could not be read; resolves when closed. */
    show(text: string | null, address: string): Promise<unknown>;
}

function browserHost(): LicencesHost {
    return {
        baseUrl: document.baseURI,
        fetchText: async (url) => {
            try {
                const response = await fetch(url);
                return response.ok ? await response.text() : null;
            } catch {
                return null;
            }
        },
        show: (text, address) => licencesDialogs.show({ text, address }),
    };
}

/** Fetches the licences file and shows it; resolves once the dialog has closed. */
export async function openLicences(host: LicencesHost = browserHost()): Promise<void> {
    const address = new URL(LICENCES_PATH, host.baseUrl).href;
    const text = await host.fetchText(address);
    await host.show(text, address);
}
