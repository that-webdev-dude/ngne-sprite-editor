import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import "./sprite.css";

/**
 * What the workspace shows while no document is open (DESIGN §6): plain text buttons, centred,
 * no illustration. New sprite (SE-008) and Open (SE-041); Import PNG and the recent files join
 * them in SE-044 and SE-047.
 */
export function EmptyState() {
    return (
        <div className="empty-state" data-empty-state="">
            <Button onClick={() => runCommand("file.new")}>New sprite</Button>
            <Button onClick={() => runCommand("file.open")}>Open</Button>
        </div>
    );
}
