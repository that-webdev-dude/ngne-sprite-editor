import { useSessions } from "../../../app/state/sessions";
import { EmptyState } from "../../sprite/EmptyState";
import { ViewportArea } from "../../viewport/ViewportArea";
import { ViewportProbe } from "../../viewport/ViewportProbe";

/**
 * Viewport content: the viewport element with the NGNE canvas of the active document, or the
 * empty state while no document is open (DESIGN §6). The probe beside them measures the
 * region for view navigation, document or not.
 */
export function Viewport() {
    const open = useSessions((state) => state.activeId !== null);
    return (
        <>
            <ViewportProbe />
            {open ? <ViewportArea /> : <EmptyState />}
        </>
    );
}
