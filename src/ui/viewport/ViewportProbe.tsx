import { useEffect, useRef } from "react";
import { appCommands } from "../../app/commands/appCommands";
import { connectViewPolicy } from "../../app/view/viewPolicy";
import { observeViewportRegion, viewportSize } from "../../app/view/viewportSize";
import "./viewportArea.css";

/**
 * Tells view navigation the size of the viewport region while the shell is on the page,
 * whether a document is open or not (SE-012): an element without content that has the box
 * the viewport element has when it is there. With the size known before a document opens,
 * the document is fitted and centred in the task that opens it (`app/view/viewPolicy`).
 */
export function ViewportProbe() {
    const element = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!element.current) return;
        const stopObserving = observeViewportRegion(element.current);
        // New and opened documents start fitted; the pan limit is kept after a resize and
        // when another document becomes the active one.
        const stopPolicy = connectViewPolicy();
        // The view commands are enabled while the viewport has a size.
        const stopRefresh = viewportSize.subscribe(() => appCommands.refresh());
        return () => {
            stopRefresh();
            stopPolicy();
            stopObserving();
        };
    }, []);

    return <div ref={element} className="viewport-probe" aria-hidden="true" />;
}
