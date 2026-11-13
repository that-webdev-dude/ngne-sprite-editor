import type { LicencesRequest } from "../../app/licences/openLicences";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "./licences.css";

/**
 * Open Source Licences (View menu): the text of `licences.txt`, as the build writes it, in a
 * large dialog whose body scrolls. When the file could not be read, the dialog says so and
 * links its address.
 */
export function LicencesDialog({ request }: { request: LicencesRequest }) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Open Source Licences"
            size="large"
            actions={
                <Button variant="primary" onClick={() => request.answer(null)}>
                    Close
                </Button>
            }
        >
            {request.text === null ? (
                <p className="licences__missing">
                    The licences file could not be loaded. It is at{" "}
                    <a href={request.address} target="_blank" rel="noopener noreferrer">
                        {request.address}
                    </a>
                    .
                </p>
            ) : (
                // Focusable, so the keyboard can scroll the text.
                <pre
                    className="licences__text"
                    tabIndex={0}
                    role="region"
                    aria-label="Licence text"
                >
                    {request.text}
                </pre>
            )}
        </Dialog>
    );
}
