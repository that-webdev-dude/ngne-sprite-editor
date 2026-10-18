import type { StoreApi } from "zustand/vanilla";
import { clearSelected, contentOfImage, copySelected, fillSelected } from "../../core/floating";
import type { FloatingContent } from "../../core/floating";
import type { PixelBuffer } from "../../core/model";
import { decodePng, encodePng } from "../../core/png";
import type { Notices } from "../notices/notices";
import type { SystemClipboard } from "../platform/clipboard";
import { activeDocument } from "../state/sessions";
import type { OpenDocument, SessionsState } from "../state/sessions";
import type { Point } from "../view/coordinates";
import type { Feedback } from "./feedback";
import type { FloatingState } from "./floatingState";
import { floatRefusal } from "./move/floatTarget";

// Cut, Copy, Paste, Delete and Fill (SPEC §7.2, §7.8; SE-032).
//
// - The editor's own clipboard always holds what was copied or cut last: the selected pixels
//   of the active cel (the selection's bounding rectangle, unselected pixels transparent) and
//   the selection's shape, or the floating pixels while a selection floats. The system
//   clipboard gets the same pixels as an `image/png` file (SE-005's encoder) when the browser
//   allows it.
// - Paste reads the system clipboard when the browser allows it. An image there that is the
//   editor's own copy (the same size, the same alpha everywhere and the same colour wherever
//   it is opaque: the browser may re-encode the PNG) is pasted from the editor's clipboard,
//   with its shape; another image is pasted whole. When the system clipboard cannot be read
//   the editor's clipboard is pasted, and the status bar says why.
// - Paste makes a floating selection on the active cel, its centre on the pixel at the centre
//   of the viewport, at whole pixels; an image larger than the canvas floats whole and is
//   clipped when it is applied. It selects the Move tool, which holds the float.
// - Cut, Delete and Fill apply a floating selection first and then act on the selection,
//   each one undo step; Copy copies the floating pixels as they are and leaves them floating.
//   Fill writes the foreground colour. Cut and Copy need a selection or a float; Delete and
//   Fill a selection. They write on the layers paint may go to (SPEC §7.1); Copy reads any
//   pixel layer.

/** The status-bar feedback of the clipboard (DESIGN §5.7). */
export const CLIPBOARD_FEEDBACK = {
    copiedInEditor: "No access to the system clipboard: copied in the editor only",
    pastedFromEditor: "No access to the system clipboard: pasted from the editor's clipboard",
    nothingToPaste: "Nothing to paste",
    nothingWithoutAccess: "Nothing to paste: no access to the system clipboard",
    reference: "Reference layers cannot be copied",
} as const;

export interface ClipboardSources {
    sessions: StoreApi<SessionsState>;
    floating: FloatingState;
    system: SystemClipboard;
    feedback: Feedback;
    notices: Pick<Notices, "error">;
    /** The foreground colour, 0xRRGGBBAA (Fill). */
    foreground(): number;
    /** Selects the Move tool, which holds a floating selection. */
    selectMove(): void;
    /** The document position at the centre of the viewport showing `document`. */
    centre(document: OpenDocument): Point;
}

export interface EditorClipboard {
    /** The editor's own clipboard: what was copied or cut last; null before. */
    readonly content: FloatingContent | null;
    /** Copy and Cut can run: pixels float, or the history is idle and there is a selection. */
    canCopy(): boolean;
    /** Paste can run: a document is open and its history is idle or holds a float. */
    canPaste(): boolean;
    /** Delete and Fill can run: as `canCopy`, the selection the float would leave included. */
    canEdit(): boolean;
    copy(): Promise<void>;
    cut(): Promise<void>;
    paste(): Promise<void>;
    deleteSelected(): void;
    fill(): void;
}

function cloneContent(content: FloatingContent): FloatingContent {
    const { pixels, mask } = content;
    return {
        pixels: { width: pixels.width, height: pixels.height, data: pixels.data.slice() },
        mask: { width: mask.width, height: mask.height, data: mask.data.slice() },
    };
}

/**
 * Whether `image`, read from the system clipboard, is the editor's `own` copy: the same size,
 * the same alpha at every pixel and the same colour at every opaque one.
 */
function isOwnCopy(own: PixelBuffer, image: PixelBuffer): boolean {
    if (own.width !== image.width || own.height !== image.height) return false;
    const a = own.data;
    const b = image.data;
    if (a.length !== b.length) return false;
    for (let at = 0; at < a.length; at += 4) {
        if (a[at + 3] !== b[at + 3]) return false;
        if (a[at + 3] !== 255) continue;
        if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) return false;
    }
    return true;
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

export function createEditorClipboard(sources: ClipboardSources): EditorClipboard {
    const { sessions, floating } = sources;
    let content: FloatingContent | null = null;

    const active = () => activeDocument(sessions.getState());
    /** The active document while its history is idle. */
    const idle = (): OpenDocument | null => {
        const document = active();
        return document && !document.history.transaction ? document : null;
    };
    /** The active document after its float was applied, while its history is idle. */
    const settled = (): OpenDocument | null => {
        if (floating.floats()) floating.apply();
        return idle();
    };
    const targetOf = ({ session }: OpenDocument) => ({
        layerId: session.activeLayerId,
        frameId: session.activeFrameId,
    });
    const canPaste = (): boolean => {
        const document = active();
        return document !== null && (!document.history.transaction || floating.floats());
    };
    const selectionOrFloat = (): boolean => {
        if (floating.floats()) return true;
        return (idle()?.session.selection ?? null) !== null;
    };

    /** Puts `copied` on the system clipboard; says so when it cannot. */
    const toSystem = async (copied: FloatingContent) => {
        const written = await sources.system.writePng(encodePng(copied.pixels));
        if (!written) sources.feedback(CLIPBOARD_FEEDBACK.copiedInEditor);
    };

    /** The content to paste and what the status bar should say; null content: nothing. */
    const contentToPaste = async (): Promise<{
        pasted: FloatingContent | null;
        note: string | null;
    } | null> => {
        const read = await sources.system.readPng();
        if (read.kind === "image") {
            let image: PixelBuffer;
            try {
                image = await decodePng(read.bytes);
            } catch (error) {
                sources.notices.error(`Could not paste the image. ${reason(error)}`);
                return null;
            }
            const own = content && isOwnCopy(content.pixels, image) ? content : null;
            return { pasted: own ?? contentOfImage(image), note: null };
        }
        if (read.kind === "none") {
            return { pasted: content, note: content ? null : CLIPBOARD_FEEDBACK.nothingToPaste };
        }
        return {
            pasted: content,
            note: content
                ? CLIPBOARD_FEEDBACK.pastedFromEditor
                : CLIPBOARD_FEEDBACK.nothingWithoutAccess,
        };
    };

    return {
        get content() {
            return content;
        },
        canCopy: selectionOrFloat,
        canPaste,
        canEdit: selectionOrFloat,

        async copy() {
            const document = active();
            if (!document) return;
            let copied: FloatingContent;
            const float = floating.floats(document) ? floating.float : null;
            if (float) {
                copied = cloneContent(float.content);
            } else {
                const { session, history } = document;
                if (history.transaction || !session.selection) return;
                const layer = session.doc.layers.find(
                    (entry) => entry.id === session.activeLayerId,
                );
                if (layer?.kind !== "pixel") {
                    sources.feedback(CLIPBOARD_FEEDBACK.reference);
                    return;
                }
                copied = copySelected(session, targetOf(document), session.selection);
            }
            content = copied;
            await toSystem(copied);
        },

        async cut() {
            const document = settled();
            const selection = document?.session.selection ?? null;
            if (!document || !selection) return;
            const refused = floatRefusal(document);
            if (refused) {
                sources.feedback(refused);
                return;
            }
            const target = targetOf(document);
            const copied = copySelected(document.session, target, selection);
            clearSelected(document.history, target, selection, "Cut");
            content = copied;
            await toSystem(copied);
        },

        async paste() {
            const before = active();
            if (!before || !canPaste()) return;
            const refusedBefore = floatRefusal(before);
            if (refusedBefore) {
                sources.feedback(refusedBefore);
                return;
            }
            const found = await contentToPaste();
            if (!found) return;
            const { pasted, note } = found;
            if (!pasted) {
                if (note) sources.feedback(note);
                return;
            }
            // Taken as the document is now: the same one, and idle once its float is applied.
            if (active()?.session !== before.session) return;
            const document = settled();
            if (!document) return;
            const refused = floatRefusal(document);
            if (refused) {
                sources.feedback(refused);
                return;
            }
            sources.selectMove();
            const centre = sources.centre(document);
            const { width, height } = pasted.pixels;
            // The image's centre on the pixel nearest the viewport's centre (`+ 0`: never -0).
            const x = Math.floor(centre.x - width / 2 + 0.5) + 0;
            const y = Math.floor(centre.y - height / 2 + 0.5) + 0;
            floating.paste(document, cloneContent(pasted), x, y);
            if (note) sources.feedback(note);
        },

        deleteSelected() {
            const document = settled();
            const selection = document?.session.selection ?? null;
            if (!document || !selection) return;
            const refused = floatRefusal(document);
            if (refused) {
                sources.feedback(refused);
                return;
            }
            clearSelected(document.history, targetOf(document), selection, "Delete");
        },

        fill() {
            const document = settled();
            const selection = document?.session.selection ?? null;
            if (!document || !selection) return;
            const refused = floatRefusal(document);
            if (refused) {
                sources.feedback(refused);
                return;
            }
            fillSelected(
                document.history,
                targetOf(document),
                selection,
                sources.foreground(),
                "Fill",
            );
        },
    };
}
