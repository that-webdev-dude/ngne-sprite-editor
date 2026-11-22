import type { StatusField } from "@ngne/editor-ui/shell";
import type { StatusFields } from "./statusFields";

/** The command behind "Fit", which follows the zoom readout (DESIGN §6). */
const FIT_COMMAND = "view.fit";

/**
 * The fields of the status bar (DESIGN §5.7), left to right, from `statusFields`. A field
 * without a value is not rendered: none of the document fields while no document is open, the
 * cursor while the pointer is not over the document, and the selection until one exists. The
 * cursor keeps its place without a reserved width (`cursorField.css`).
 */
export const statusFields: StatusField<StatusFields>[] = [
    { id: "cursor", order: 10, text: (fields) => fields.cursor },
    { id: "size", order: 20, text: (fields) => fields.size },
    { id: "zoom", order: 30, text: (fields) => fields.zoom, action: { commandId: FIT_COMMAND } },
    { id: "frame", order: 40, text: (fields) => fields.frame },
    { id: "duration", order: 50, text: (fields) => fields.duration },
    { id: "selection", order: 60, text: (fields) => fields.selection },
];
