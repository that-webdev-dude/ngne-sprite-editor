import { useEffect } from "react";
import { installFileWorkflows } from "../../app/file/install";
import { notices } from "../../app/notices/notices";
import { toast } from "../toast/toast";

/**
 * The page-wide parts of the file workflows (SE-041): the unload guard while a document is
 * dirty and the drop of a project file on the window (app/file/install.ts), and the toasts
 * that report the results and failures the app announces (app/notices). Renders nothing.
 */
export function FileWorkflows() {
    useEffect(() => installFileWorkflows(), []);
    useEffect(
        () =>
            notices.attachSink((kind, message) => {
                if (kind === "error") toast.error(message);
                else toast.info(message);
            }),
        [],
    );
    return null;
}
