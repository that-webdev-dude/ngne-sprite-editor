import { Popover as RadixPopover } from "radix-ui";
import { useId, useRef } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import {
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
} from "../../core/project/format";
import { editProperties, editReferenceProperties } from "../../app/timeline/timelineState";
import type { PropertiesDraft, ReferenceDraft } from "../../app/timeline/timelineState";
import { referenceFit } from "../../app/references/references";
import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
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

/** Scale is shown in percent: document pixels per 100 source pixels. */
const PERCENT = 100;

/**
 * The fields of a reference layer (DESIGN §7, SE-045): X and Y of its top-left corner in
 * document pixels, its scale in percent, its placement, and Reset to Fit, which puts the
 * fitted values in the fields. Like the name and opacity, they apply when the popover closes.
 */
function ReferenceFields({ draft, owner }: { draft: ReferenceDraft; owner: PropertiesDraft }) {
    const offset = { min: -MAX_REFERENCE_OFFSET, max: MAX_REFERENCE_OFFSET, step: 1, precision: 2 };
    // A locked reference keeps its geometry (SPEC §7.6): the fields are read-only.
    const disabled = draft.locked;
    return (
        <div className="timeline-properties__reference">
            <NumberField
                label="X"
                unit="px"
                {...offset}
                disabled={disabled}
                value={draft.x}
                onChange={(x) => editReferenceProperties({ x })}
            />
            <NumberField
                label="Y"
                unit="px"
                {...offset}
                disabled={disabled}
                value={draft.y}
                onChange={(y) => editReferenceProperties({ y })}
            />
            <NumberField
                label="Scale"
                unit="%"
                min={MIN_REFERENCE_SCALE * PERCENT}
                max={MAX_REFERENCE_SCALE * PERCENT}
                step={1}
                precision={4}
                disabled={disabled}
                value={draft.scale * PERCENT}
                onChange={(percent) => editReferenceProperties({ scale: percent / PERCENT })}
            />
            <SegmentedControl
                className="timeline-properties__placement"
                label="Placement"
                disabled={disabled}
                value={draft.placement}
                onChange={(placement) => editReferenceProperties({ placement })}
                options={[
                    { value: "behind", label: "Behind" },
                    { value: "front", label: "In front" },
                ]}
            />
            <Button
                className="timeline-properties__fit"
                disabled={disabled}
                // Computed at the click, the source decoded first when it is not yet: a hidden
                // reference's is not (SE-045 review J).
                onClick={async () => {
                    const fit = await referenceFit(owner.documentId, owner.layerId);
                    if (fit) editReferenceProperties(fit, owner.layerId);
                }}
            >
                Reset to Fit
            </Button>
        </div>
    );
}

/**
 * The layer properties popover (DESIGN §7: name, opacity; for a reference layer X, Y, scale and
 * placement, SE-045; the blend mode is SE-061's), beside
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
                    {draft.reference ? (
                        <ReferenceFields draft={draft.reference} owner={draft} />
                    ) : null}
                </form>
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
}
