import { useStore } from "zustand";
import { openRecentId } from "../../app/file/recent.commands";
import { recentFiles } from "../../app/file/recentFiles";
import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import "./sprite.css";

/**
 * What the workspace shows while no document is open (DESIGN §6): plain text buttons, centred,
 * no illustration. New sprite (SE-008), Open (SE-041) and, below them, the recent files
 * (SE-047), newest first, each opening its file through its File → Open Recent command;
 * nothing of the list shows while it is empty. Import PNG joins them in SE-044.
 */
export function EmptyState() {
    const entries = useStore(recentFiles.store, (state) => state.entries);
    return (
        <div className="empty-state" data-empty-state="">
            <Button onClick={() => runCommand("file.new")}>New sprite</Button>
            <Button onClick={() => runCommand("file.open")}>Open</Button>
            {entries.length > 0 ? (
                <>
                    <p className="empty-state__recent-title" id="empty-state-recent">
                        Recent files
                    </p>
                    <ul className="empty-state__recent" aria-labelledby="empty-state-recent">
                        {entries.map((entry) => (
                            <li key={entry.key}>
                                <Button
                                    data-recent-file={entry.name}
                                    title={entry.name}
                                    onClick={() => runCommand(openRecentId(entry))}
                                >
                                    <span className="empty-state__recent-name">{entry.name}</span>
                                </Button>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </div>
    );
}
