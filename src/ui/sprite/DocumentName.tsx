import { activeDocument, isDirty, useSessions } from "../../app/state/sessions";
import "./sprite.css";

/**
 * The name of the active document, in the centre of the menu bar (DESIGN §2), with the unsaved
 * marker after it while the document is dirty (SE-041, SPEC §5.2); nothing while no document
 * is open. SE-047 turns it into the tabs.
 */
export function DocumentName() {
    const name = useSessions((state) => activeDocument(state)?.session.doc.name ?? null);
    const dirty = useSessions((state) => {
        const document = activeDocument(state);
        return document !== null && isDirty(document);
    });
    if (name === null) return null;
    return (
        <span className="document-name">
            <span className="document-name__text" data-document-name="" title={name}>
                {name}
            </span>
            {dirty ? (
                <span
                    className="document-name__unsaved"
                    data-unsaved-marker=""
                    title="Unsaved changes"
                >
                    <span aria-hidden="true">*</span>
                    <span className="ui-visually-hidden">Unsaved changes</span>
                </span>
            ) : null}
        </span>
    );
}
