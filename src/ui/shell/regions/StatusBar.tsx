import { useActiveDocument } from "../../../app/state/sessions";
import { useStatus } from "../../../app/state/status";
import { runCommand } from "../../commands/runCommand";
import { useCommands } from "../../commands/useCommands";
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
    const document = useActiveDocument();
    const cursor = useStatus((state) => state.cursor);
    const hint = useStatus((state) => state.hint);
    const feedback = useStatus((state) => state.feedback);
    const fit = useCommands().find((command) => command.id === FIT_COMMAND);
    const fields = statusFields(document, { cursor, hint, feedback });
    return (
        <>
            {FIELDS.flatMap((field) => {
                if (!fields[field]) return [];
                const shown = [
                    <span key={field} className="status-field" data-status={field}>
                        {fields[field]}
                    </span>,
                ];
                if (field === "zoom" && fit) {
                    shown.push(
                        <button
                            key={FIT_COMMAND}
                            type="button"
                            className="status-action"
                            data-status-action="fit"
                            disabled={!fit.enabled()}
                            onClick={() => runCommand(FIT_COMMAND)}
                        >
                            {fit.title()}
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
