import { useShallow } from "zustand/react/shallow";
import { activeDocument, useSessions } from "../../../app/state/sessions";
import { useStatus } from "../../../app/state/status";
import { runCommand } from "../../commands/runCommand";
import { useCommandValue } from "../../commands/useCommands";
import { statusFields } from "../../status/statusFields";
import "../../status/status.css";

const FIELDS = ["cursor", "size", "zoom", "frame", "duration", "selection"] as const;

/** The command behind "Fit", which follows the zoom readout (DESIGN §6). */
const FIT_COMMAND = "view.fit";

/**
 * Status bar content (DESIGN §5.7), bound to the active document and the transient status
 * values. A field without a value is not rendered: none of the document fields while no
 * document is open, the cursor while the pointer is not over the document, and the selection
 * and the message until a feature supplies them. "Fit" sits beside the zoom readout
 * (DESIGN §6); it is a control, not a field, so it carries no `data-status`.
 */
export function StatusBar() {
    const cursor = useStatus((state) => state.cursor);
    const hint = useStatus((state) => state.hint);
    const feedback = useStatus((state) => state.feedback);
    // The texts, compared field by field: a change to the document that alters none of them
    // (most edits) does not render the bar again.
    const fields = useSessions(
        useShallow((state) => statusFields(activeDocument(state), { cursor, hint, feedback })),
    );
    const fitTitle = useCommandValue((registry) => registry.get(FIT_COMMAND)?.title() ?? null);
    const fitEnabled = useCommandValue((registry) => registry.get(FIT_COMMAND)?.enabled() ?? false);
    return (
        <>
            {FIELDS.flatMap((field) => {
                if (!fields[field]) return [];
                const shown = [
                    <span key={field} className="status-field" data-status={field}>
                        {fields[field]}
                    </span>,
                ];
                if (field === "zoom" && fitTitle !== null) {
                    shown.push(
                        <button
                            key={FIT_COMMAND}
                            type="button"
                            className="status-action"
                            data-status-action="fit"
                            disabled={!fitEnabled}
                            onClick={() => runCommand(FIT_COMMAND)}
                        >
                            {fitTitle}
                        </button>,
                    );
                }
                return shown;
            })}
            {fields.message ? (
                <span
                    className="status-message"
                    data-status="message"
                    data-kind={fields.messageKind}
                >
                    {fields.message}
                </span>
            ) : null}
        </>
    );
}
