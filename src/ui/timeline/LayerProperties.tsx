import { Popover as RadixPopover } from "radix-ui";
import { useId, useRef } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import { editProperties } from "../../app/timeline/timelineState";
import type { PropertiesDraft } from "../../app/timeline/timelineState";
import { runCommand } from "../commands/runCommand";
import { Slider } from "../primitives/Slider";
import "../primitives/popover.css";

/**
 * Closes the layer properties popover: its values become one undo step (Apply Layer
 * Properties). While its document cannot take them (a stroke), the popover stays open with
 * them; a closed document's are dropped (`timelineLifetime`).
 */
export function finishProperties(): void {
    runCommand(TIMELINE_COMMANDS.applyLayerProperties);
}

/**
 * The layer properties popover (DESIGN §7: name, opacity; the blend mode is SE-061's), beside
 * the row of its layer. What it shows changes no document until it closes — by Enter, Escape
 * or a press outside — and then once, in one undo step. The focus returns to where it was when
 * the popover opened, or to `fallback` when that is gone (a menu item).
 *
 * The popover is modal (`modal` on its root, in the panel): it keeps the focus while a menu that
 * opened it gives the focus back to its trigger, and a press outside closes it without
 * reaching what lies there (a press on the canvas paints nothing).
 */
export function LayerProperties({ draft, fallback }: { draft: PropertiesDraft; fallback(): void }) {
    const nameId = useId();
    /** Where the focus was when the popover opened. */
    const returnTo = useRef<Element | null>(null);
    return (
        <RadixPopover.Portal>
            <RadixPopover.Content
                className="ui-popover timeline-properties"
                aria-label="Layer properties"
                side="right"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                onOpenAutoFocus={() => {
                    returnTo.current = document.activeElement;
                }}
                onCloseAutoFocus={(event) => {
                    // There is no trigger to go back to.
                    event.preventDefault();
                    const target = returnTo.current;
                    if (target instanceof HTMLElement && target.isConnected) {
                        target.focus({ preventScroll: true });
                    } else {
                        fallback();
                    }
                }}
            >
                <form
                    className="timeline-properties__form"
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        finishProperties();
                    }}
                    onKeyDown={(event) => {
                        // Enter in a field applies (a number field has taken its value first).
                        if (event.key === "Enter" && !event.defaultPrevented) {
                            event.preventDefault();
                            finishProperties();
                        }
                    }}
                >
                    <label className="ui-field__label" htmlFor={nameId}>
                        Name
                    </label>
                    <input
                        id={nameId}
                        className="timeline-properties__text"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_NAME_LENGTH}
                        value={draft.name}
                        onChange={(event) => editProperties({ name: event.target.value })}
                    />
                    <Slider
                        className="timeline-properties__slider"
                        label="Opacity"
                        min={0}
                        max={255}
                        value={draft.opacity}
                        onChange={(opacity) => editProperties({ opacity })}
                    />
                </form>
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
}
