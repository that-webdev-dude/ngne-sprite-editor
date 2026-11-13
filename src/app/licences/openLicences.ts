// The open-source licences of the app: `licences.txt` beside `index.html`, which the build
// writes (scripts/licences.ts, vite.config.ts) and the development server answers. The file
// opens in a new tab as plain text.
//
// The tab is opened at once, while the click or key that ran the command still counts as the
// user's (a browser blocks a window opened later), then shows the file. The text is fetched
// from the page, so the service worker answers from its cache and the file opens offline in
// the installed app; it is shown from a blob URL, since a new tab's own request for the file
// is a navigation, which the worker leaves to the network. When the fetch fails, the tab goes
// to the file's address instead.

/** The file of the build, relative to the app's base. */
export const LICENCES_PATH = "licences.txt";

/** A window the command can send to an address. */
export interface LicencesTab {
    location: { href: string };
    opener: unknown;
}

/** What the command needs of the browser; tests pass their own. */
export interface LicencesHost {
    /** The app's base URL, against which `LICENCES_PATH` is resolved. */
    readonly baseUrl: string;
    /** Opens an empty tab; null when the browser refuses. */
    openTab(): LicencesTab | null;
    /** The text at `url`, or null when it cannot be read. */
    fetchText(url: string): Promise<string | null>;
    /** A URL of `text` as a plain-text file. */
    textUrl(text: string): string;
    /** Releases a URL of `textUrl` once the tab has had time to load it. */
    releaseLater(url: string): void;
}

/** How long a blob URL stays valid after the tab was sent to it. */
const RELEASE_AFTER_MS = 60_000;

function browserHost(): LicencesHost {
    return {
        baseUrl: document.baseURI,
        openTab: () => window.open("", "_blank"),
        fetchText: async (url) => {
            try {
                const response = await fetch(url);
                return response.ok ? await response.text() : null;
            } catch {
                return null;
            }
        },
        textUrl: (text) =>
            URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })),
        releaseLater: (url) => {
            setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
        },
    };
}

/**
 * Opens the licences file in a new tab. Resolves to false when the browser refused the tab,
 * true otherwise.
 */
export async function openLicences(host: LicencesHost = browserHost()): Promise<boolean> {
    const address = new URL(LICENCES_PATH, host.baseUrl).href;
    const tab = host.openTab();
    if (!tab) return false;
    // The file needs no access to the editor's window.
    tab.opener = null;
    const text = await host.fetchText(address);
    if (text === null) {
        tab.location.href = address;
        return true;
    }
    const url = host.textUrl(text);
    tab.location.href = url;
    host.releaseLater(url);
    return true;
}
