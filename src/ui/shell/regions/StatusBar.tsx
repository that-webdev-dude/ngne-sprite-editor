import { useActiveDocument } from "../../../app/state/sessions";
import { useStatus } from "../../../app/state/status";
import { statusFields } from "../../status/statusFields";
import "../../status/status.css";

const FIELDS = ["cursor", "size", "zoom", "frame", "duration", "selection"] as const;

/**
 * Status bar content (DESIGN §5.7), bound to the active document and the transient status
 * values. A field without a value is not rendered: none of the document fields while no
 * document is open, and the cursor, selection and message until a feature supplies them.
 */
export function StatusBar() {
    const document = useActiveDocument();
    const cursor = useStatus((state) => state.cursor);
    const hint = useStatus((state) => state.hint);
    const feedback = useStatus((state) => state.feedback);
    const fields = statusFields(document, { cursor, hint, feedback });
    return (
        <>
            {FIELDS.map((field) =>
                fields[field] ? (
                    <span key={field} className="status-field" data-status={field}>
                        {fields[field]}
                    </span>
                ) : null,
            )}
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
