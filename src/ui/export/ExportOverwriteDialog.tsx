import type { ExportOverwriteRequest } from "../../app/export/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "./export.css";

/**
 * Asked once per folder before a document's export replaces files there (DESIGN §7:
 * overwriting files in an export folder is confirmed once). It names the files the folder
 * holds, which may be another document's that has the same export name. Cancel, Escape and a
 * click outside write nothing.
 */
export function ExportOverwriteDialog({ request }: { request: ExportOverwriteRequest }) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Replace files?"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => request.answer(true)}>
                        Replace
                    </Button>
                </>
            }
        >
            <p>
                The folder “{request.folder}” already holds{" "}
                {request.files.length === 1 ? "this file" : `these ${request.files.length} files`}.
                Exporting “{request.document}” replaces {request.files.length === 1 ? "it" : "them"}
                :
            </p>
            <ul className="export-overwrite__files" data-overwrite-files="">
                {request.files.map((name) => (
                    <li key={name}>{name}</li>
                ))}
            </ul>
        </Dialog>
    );
}
