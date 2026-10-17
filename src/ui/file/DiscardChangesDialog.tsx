import type { DiscardChangesRequest } from "../../app/file/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";

/** What happens to the document, said after "“name” has unsaved changes." */
function consequence({ action, file }: DiscardChangesRequest): string {
    switch (action) {
        case "close":
            return "Closing it loses them.";
        case "open":
            return `“${file ?? ""}” takes its place, and the changes are lost.`;
        case "revert":
            return `Revert reads “${file ?? ""}” again, and the changes are lost.`;
    }
}

/**
 * Asked once before unsaved changes are lost to Close, Open or Revert (DESIGN §7: what undo
 * cannot reverse is confirmed once). Cancel, Escape and a click outside keep the document.
 */
export function DiscardChangesDialog({ request }: { request: DiscardChangesRequest }) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Discard unsaved changes?"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => request.answer(true)}>
                        Discard
                    </Button>
                </>
            }
        >
            <p>
                “{request.document}” has unsaved changes. {consequence(request)}
            </p>
        </Dialog>
    );
}
