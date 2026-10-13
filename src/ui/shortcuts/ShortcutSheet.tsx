import { shortcutGroups } from "../../app/shortcuts/shortcutSheet";
import type { ShortcutGroup } from "../../app/shortcuts/shortcutSheet";
import { surfaces } from "../../app/surfaces/surfaces";
import { Chord } from "../commands/Chord";
import { useCommands } from "../commands/useCommands";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "./shortcuts.css";

const close = () => surfaces.close("shortcut-sheet");

/** One menu: its name as a heading, then its commands with their keys. */
function Group({ group }: { group: ShortcutGroup }) {
    return (
        <section className="shortcut-sheet__group" data-shortcut-group={group.title}>
            <h3 className="shortcut-sheet__heading">{group.title}</h3>
            <dl className="shortcut-sheet__rows">
                {group.rows.map((row) => (
                    <div
                        key={row.command.id}
                        className="shortcut-sheet__row"
                        data-command={row.command.id}
                    >
                        <dt className="shortcut-sheet__title">{row.title}</dt>
                        <dd className="shortcut-sheet__keys">
                            {row.chords.map((chord) => (
                                <Chord key={chord} chord={chord} />
                            ))}
                            {row.hold ? <span className="shortcut-sheet__hold">hold</span> : null}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

/**
 * Shortcut sheet (DESIGN §7): every shortcut of the command registry, grouped by menu. It is
 * generated from the registry (app/shortcuts/shortcutSheet.ts), so it lists a binding as soon
 * as its command is registered. The list is one tab stop, so the keyboard scrolls it.
 */
export function ShortcutSheet() {
    const groups = shortcutGroups(useCommands());
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) close();
            }}
            title="Keyboard shortcuts"
            className="shortcut-dialog"
            actions={
                <Button variant="primary" onClick={close}>
                    Close
                </Button>
            }
        >
            <div
                className="shortcut-sheet"
                role="group"
                aria-label="Shortcuts by menu"
                tabIndex={0}
            >
                <div className="shortcut-sheet__columns">
                    {groups.map((group) => (
                        <Group key={group.title} group={group} />
                    ))}
                </div>
            </div>
        </Dialog>
    );
}
