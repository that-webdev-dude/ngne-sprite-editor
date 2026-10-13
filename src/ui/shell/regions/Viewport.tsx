import { useSessions } from "../../../app/state/sessions";
import { EmptyState } from "../../sprite/EmptyState";
import { ViewportCanvas } from "../../viewport/ViewportCanvas";

/**
 * Viewport content: the NGNE canvas of the active document, or the empty state while no
 * document is open (DESIGN §6).
 */
export function Viewport() {
    const open = useSessions((state) => state.activeId !== null);
    return open ? <ViewportCanvas /> : <EmptyState />;
}
