// The system clipboard as the editor uses it (SPEC §7.2, SE-032): PNG images only, through the
// asynchronous Clipboard API (`navigator.clipboard`, `ClipboardItem` of type `image/png`).
// Chrome asks for no permission to write from a key press, and asks for `clipboard-read` to
// read; a refusal, a page without the focus or a browser without the API makes the call fail,
// which is reported as "unavailable" and never thrown, so the editor's own clipboard carries
// on alone (`app/selection/clipboard.ts`).

/** What a read of the system clipboard found. */
export type SystemClipboardRead =
    /** A PNG image: its file bytes, as the browser hands them over. */
    | { kind: "image"; bytes: Uint8Array }
    /** The clipboard holds no image (text, or nothing). */
    | { kind: "none" }
    /** The clipboard could not be read: no permission, no focus, or no API. */
    | { kind: "unavailable" };

export interface SystemClipboard {
    /** Puts a PNG file on the clipboard. Resolves to false when that was not possible. */
    writePng(bytes: Uint8Array): Promise<boolean>;
    /** Reads the first PNG image of the clipboard. */
    readPng(): Promise<SystemClipboardRead>;
}

const PNG = "image/png";

/** The clipboard of the page's browser. */
export function browserClipboard(): SystemClipboard {
    const api = () =>
        typeof navigator !== "undefined" && typeof ClipboardItem !== "undefined"
            ? navigator.clipboard
            : undefined;
    return {
        async writePng(bytes) {
            const clipboard = api();
            if (!clipboard?.write) return false;
            try {
                const blob = new Blob([new Uint8Array(bytes)], { type: PNG });
                await clipboard.write([new ClipboardItem({ [PNG]: blob })]);
                return true;
            } catch {
                return false;
            }
        },
        async readPng() {
            const clipboard = api();
            if (!clipboard?.read) return { kind: "unavailable" };
            let items: ClipboardItems;
            try {
                items = await clipboard.read();
            } catch {
                return { kind: "unavailable" };
            }
            for (const item of items) {
                if (!item.types.includes(PNG)) continue;
                try {
                    const blob = await item.getType(PNG);
                    return { kind: "image", bytes: new Uint8Array(await blob.arrayBuffer()) };
                } catch {
                    return { kind: "unavailable" };
                }
            }
            return { kind: "none" };
        },
    };
}
