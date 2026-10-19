import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The dialog of Export GIF… (SPEC §9.6, DESIGN §7; SE-063): which frames (every frame or one
 * tag) and the scale. The export command asks and waits for the answer; the dialog host shows
 * the dialog registered for the kind (ui/export/gif.dialog.tsx). The dialog changes nothing
 * of the document.
 */

/** One entry of the Frames select. */
export interface GifChoice {
    /** "all", or `tag:<id>`. */
    value: string;
    /** "All frames", or the tag's name with its frame range: "Walk (1–3)". */
    label: string;
    /** The frames of one pass of the GIF. */
    frameCount: number;
    /** How many times the pass plays; 0 without end. */
    plays: number;
}

export interface GifAnswer {
    /** The `value` of the chosen `GifChoice`. */
    choice: string;
    scale: number;
}

export interface GifRequest {
    kind: "export-gif";
    /** The size of the document. */
    width: number;
    height: number;
    /** Every frame first, then each tag in the document's order. */
    choices: readonly GifChoice[];
    /** The choice and the scale the dialog opens with. */
    initialChoice: string;
    initialScale: number;
    minScale: number;
    maxScale: number;
    /** The file name the export gives the GIF of this choice and scale. */
    fileName(choice: string, scale: number): string;
    /** The choice and scale to export, or null to cancel. */
    answer(values: GifAnswer | null): void;
}

function isGifRequest(request: DialogRequestBase): request is GifRequest {
    return request.kind === "export-gif";
}

export interface GifDialogs {
    /** The open request when it is this dialog, otherwise null. */
    readonly store: DialogView<GifRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Asks for the frames and scale of a GIF; resolves with them, or null. */
    gif(options: Omit<GifRequest, "kind" | "answer">): Promise<GifAnswer | null>;
}

/** The GIF dialog over `requests`: by default requests of their own, for a test to host. */
export function createGifDialogs(requests: DialogRequests = createDialogRequests()): GifDialogs {
    return {
        store: dialogView(requests.store, isGifRequest),
        attachHost: () => requests.attachHost(),
        gif: (options) =>
            requests.open<GifAnswer>((answer): GifRequest => ({
                kind: "export-gif",
                ...options,
                answer,
            })),
    };
}

/** The GIF dialog of the app, shown by the app's one dialog host. */
export const gifDialogs = createGifDialogs(commandDialogs);
