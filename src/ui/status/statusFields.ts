import type { OpenDocument } from "../../app/state/sessions";
import type { StatusState } from "../../app/state/status";
import { frameIndex } from "../../core/model";

/**
 * The texts of the status bar (DESIGN §5.7), left to right, then the message on the right. A
 * field without a value is the empty string and is not rendered.
 */
export interface StatusFields {
    /** Cursor position in document pixels: "14, 9". */
    cursor: string;
    /** Document size: "32 × 32". */
    size: string;
    /** Zoom: "12×". */
    zoom: string;
    /** Active frame and frame count: "Frame 3/8". */
    frame: string;
    /** Duration of the active frame: "100 ms". */
    duration: string;
    /** Size of the selection when one exists: "Selection 11 × 8". */
    selection: string;
    /** Transient tool feedback, or else the hint for the active tool's modifiers. */
    message: string;
    /** Feedback is shown in the warning colour. */
    messageKind: "hint" | "feedback";
}

function formatZoom(scale: number): string {
    return `${Number(scale.toFixed(3))}×`;
}

/** The status bar for the active document (or none) and the transient status values. */
export function statusFields(
    document: OpenDocument | null,
    status: Pick<StatusState, "cursor" | "hint" | "feedback">,
): StatusFields {
    const fields: StatusFields = {
        cursor: "",
        size: "",
        zoom: "",
        frame: "",
        duration: "",
        selection: "",
        message: status.feedback ?? status.hint ?? "",
        messageKind: status.feedback ? "feedback" : "hint",
    };
    if (!document) return fields;

    const { doc, activeFrameId, selection } = document.session;
    const index = frameIndex(doc, activeFrameId);
    if (status.cursor) fields.cursor = `${status.cursor.x}, ${status.cursor.y}`;
    fields.size = `${doc.width} × ${doc.height}`;
    fields.zoom = formatZoom(document.view.scale);
    if (index !== -1) {
        fields.frame = `Frame ${index + 1}/${doc.frames.length}`;
        fields.duration = `${doc.frames[index]?.durationMs ?? 0} ms`;
    }
    if (selection) {
        fields.selection = `Selection ${selection.bounds.width} × ${selection.bounds.height}`;
    }
    return fields;
}
