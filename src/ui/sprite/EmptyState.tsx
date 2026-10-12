import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import "./sprite.css";

/**
 * What the workspace shows while no document is open (DESIGN §6): plain text buttons, centred,
 * no illustration. Open, Import PNG and the recent files join New sprite in SE-041, SE-044 and
 * SE-047.
 */
export function EmptyState() {
    return (
        <div className="empty-state" data-empty-state="">
            <Button onClick={() => runCommand("file.new")}>New sprite</Button>
        </div>
    );
}
