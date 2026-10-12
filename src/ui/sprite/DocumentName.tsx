import { activeDocument, useSessions } from "../../app/state/sessions";
import "./sprite.css";

/**
 * The name of the active document, in the centre of the menu bar (DESIGN §2); nothing while no
 * document is open. SE-041 adds the unsaved marker next to it, SE-047 turns it into the tabs.
 */
export function DocumentName() {
    const name = useSessions((state) => activeDocument(state)?.session.doc.name ?? null);
    if (name === null) return null;
    return (
        <span className="document-name" data-document-name="" title={name}>
            {name}
        </span>
    );
}
