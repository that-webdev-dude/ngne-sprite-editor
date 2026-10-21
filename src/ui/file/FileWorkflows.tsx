import { useEffect } from "react";
import { installAutosave } from "../../app/autosave/install";
import { installFileWorkflows } from "../../app/file/install";
import { notices } from "../../app/notices/notices";
import { installLaunchQueue } from "../../app/pwa/launchQueue";
import { toast } from "../toast/toast";

/**
 * The page-wide parts of the file workflows (SE-041): the unload guard while a document is
 * dirty and the drop of a project file on the window (app/file/install.ts), autosave and the
 * recovery offered on launch (SE-042, app/autosave/install.ts), and the toasts that report the
 * results and failures the app announces (app/notices), then the files the installed app is
 * launched with (SE-072, app/pwa/launchQueue.ts), once their toasts can be shown. Renders
 * nothing.
 */
export function FileWorkflows() {
    useEffect(() => installFileWorkflows(), []);
    useEffect(() => installAutosave(), []);
    useEffect(
        () =>
            notices.attachSink((kind, message) => {
                if (kind === "error") toast.error(message);
                else toast.info(message);
            }),
        [],
    );
    useEffect(() => installLaunchQueue(), []);
    return null;
}
