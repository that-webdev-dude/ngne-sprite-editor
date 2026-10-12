import { useSessions } from "../../../app/state/sessions";
import { EmptyState } from "../../sprite/EmptyState";

/**
 * Viewport content: the empty state while no document is open (DESIGN §6). The NGNE canvas of
 * the open document is added by SE-011.
 */
export function Viewport() {
    const open = useSessions((state) => state.activeId !== null);
    return open ? null : <EmptyState />;
}
