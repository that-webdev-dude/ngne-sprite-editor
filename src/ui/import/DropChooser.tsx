import { Popover as RadixPopover } from "radix-ui";
import type { DropChooserRequest } from "../../app/import/importDialog";
import { Button } from "../primitives/Button";
import "../primitives/popover.css";
import "./import.css";

/**
 * The drop chooser (DESIGN §7; SE-044): a popover at the point where one PNG image was dropped,
 * offering "Import as sprite" (the Import PNG dialog), "Add as reference" (a reference layer of
 * the active sprite; disabled while none is open) and "Both" (the dialog, with "Keep source as
 * reference" on). Escape or a click outside closes it without a choice.
 */
export function DropChooser({ request }: { request: DropChooserRequest }) {
    return (
        <RadixPopover.Root
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
        >
            <RadixPopover.Anchor asChild>
                <span
                    className="import-drop__anchor"
                    style={{ left: request.x, top: request.y }}
                    aria-hidden="true"
                />
            </RadixPopover.Anchor>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    className="ui-popover import-drop"
                    aria-label={`Drop ${request.fileName}`}
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    data-import-drop=""
                >
                    <p className="import-drop__name">{request.fileName}</p>
                    <div className="import-drop__actions">
                        <Button onClick={() => request.answer("sprite")}>Import as sprite</Button>
                        <Button
                            disabled={!request.canReference}
                            onClick={() => request.answer("reference")}
                        >
                            Add as reference
                        </Button>
                        <Button onClick={() => request.answer("both")}>Both</Button>
                    </div>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
