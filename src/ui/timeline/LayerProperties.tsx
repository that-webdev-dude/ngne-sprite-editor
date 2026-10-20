import { Popover as RadixPopover } from "radix-ui";
import { memo, useEffect, useId, useMemo } from "react";
import type { RefObject } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import type { BlendMode } from "../../core/model";
import { TIMELINE_COMMANDS } from "../../app/timeline/timelineCommandIds";
import {
    MAX_REFERENCE_OFFSET,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
} from "../../core/project/format";
import {
    editProperties,
    editReferenceProperties,
    useTimelineState,
} from "../../app/timeline/timelineState";
import type { PropertiesDraft, ReferenceDraft } from "../../app/timeline/timelineState";
import { referenceFit } from "../../app/references/references";
import { useSessions } from "../../app/state/sessions";
import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import { Slider } from "../primitives/Slider";
import { layerHeaderOf } from "./timelineDom";
import { useClosingPopover } from "./useClosingPopover";
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
 * The names of the blend modes (SE-061), in the order of SPEC §5.1 `BlendMode`: Aseprite's
 * names, in the interface's spelling of "colour".
 */
const BLEND_MODE_NAMES: Readonly<Record<BlendMode, string>> = {
    normal: "Normal",
    multiply: "Multiply",
    screen: "Screen",
    overlay: "Overlay",
    darken: "Darken",
    lighten: "Lighten",
    "color-dodge": "Colour Dodge",
    "color-burn": "Colour Burn",
    "hard-light": "Hard Light",
    "soft-light": "Soft Light",
    difference: "Difference",
    exclusion: "Exclusion",
    hue: "Hue",
    saturation: "Saturation",
    color: "Colour",
    luminosity: "Luminosity",
    addition: "Addition",
    subtract: "Subtract",
    divide: "Divide",
};

const BLEND_OPTIONS = (Object.keys(BLEND_MODE_NAMES) as BlendMode[]).map((value) => ({
    value,
    label: BLEND_MODE_NAMES[value],
}));

/**
 * The blend mode of a pixel layer (SE-061), applied with the other fields when the popover
 * closes. Enter on the select opens it or picks a mode; it never closes the popover.
 */
function BlendField({ blend }: { blend: BlendMode }) {
    return (
        <span
            className="timeline-properties__blend"
            onKeyDown={(event) => {
                // Radix lets Enter on an option bubble (through the portal) to the form.
                if (event.key === "Enter") event.preventDefault();
            }}
        >
            <span className="ui-field__label" aria-hidden="true">
                Blend mode
            </span>
            <Select
                label="Blend mode"
                hideLabel
                value={blend}
                onChange={(next) => editProperties({ blend: next })}
                options={BLEND_OPTIONS}
            />
        </span>
    );
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
 * The layer properties popover (DESIGN §7: name, opacity; for a pixel layer the blend mode,
 * SE-061; for a reference layer X, Y, scale and placement, SE-045), beside
 * the row of its layer. What it shows changes no document until it closes — by Enter, Escape
 * or a press outside — and then once, in one undo step. The focus returns to where it was when
 * the popover opened, or to the host's fallback when that is gone (a menu item).
 *
 * The popover is modal (`modal` on its root, `LayerPropertiesHost`): it keeps the focus while
 * a menu that opened it gives the focus back to its trigger, and a press outside closes it
 * without reaching what lies there (a press on the canvas paints nothing). A memo: the host
 * also renders for what is not the popover's (the active document), and rendering the fields
 * again in a history step's microtasks costs the canvas a frame (SE-061).
 */
const LayerProperties = memo(function LayerProperties({
    draft,
    returnToRef,
    contentRef,
}: {
    draft: PropertiesDraft;
    /** Set to where the focus was when the popover opened (`useClosingPopover`). */
    returnToRef: RefObject<Element | null>;
    /** The content element, which `useClosingPopover` makes inert when the popover closes. */
    contentRef: RefObject<HTMLDivElement | null>;
}) {
    const nameId = useId();
    return (
        <RadixPopover.Portal>
            <RadixPopover.Content
                ref={contentRef}
                className="ui-popover timeline-properties"
                aria-label="Layer properties"
                side="right"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                onOpenAutoFocus={() => {
                    returnToRef.current = document.activeElement;
                }}
                onCloseAutoFocus={(event) => {
                    // There is no trigger to go back to; the host moved the focus already, in
                    // the commit that closed the popover (`useClosingPopover`).
                    event.preventDefault();
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
                    {draft.blend !== null ? <BlendField blend={draft.blend} /> : null}
                    {draft.reference ? (
                        <ReferenceFields draft={draft.reference} owner={draft} />
                    ) : null}
                </form>
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
});

/**
 * The layer properties popover's place in the timeline panel: a modal `RadixPopover.Root`
 * whose anchor is the row header of the popover's layer in `grid` (a virtual anchor: wrapping
 * the header in an anchor element would rebuild the row when the popover opens and closes, and
 * lose the focus inside it). It follows the popover's state by itself, so opening and closing
 * it do not render the panel again (SE-061); the focus goes back in the commit that closes it
 * (`useClosingPopover`). A popover whose document stops being the active one is applied.
 */
export const LayerPropertiesHost = memo(function LayerPropertiesHost({
    grid,
    documentId,
    fallback,
}: {
    grid: RefObject<HTMLElement | null>;
    /** The document the panel shows. */
    documentId: string;
    fallback(): void;
}) {
    const properties = useTimelineState((state) => state.properties);
    const liveId = useSessions((state) => state.activeId);
    useEffect(() => {
        if (properties && properties.documentId !== liveId) finishProperties();
    }, [properties, liveId]);
    const { shown, opening, contentRef, returnToRef } = useClosingPopover(
        properties?.documentId === documentId ? properties : null,
        fallback,
    );
    const layerId = shown?.layerId ?? null;
    const anchor = useMemo(
        () => ({
            current: {
                getBoundingClientRect: (): DOMRect => {
                    const header = layerId === null ? null : layerHeaderOf(grid.current, layerId);
                    return (header ?? grid.current ?? document.body).getBoundingClientRect();
                },
            },
        }),
        [grid, layerId],
    );
    return (
        <RadixPopover.Root
            modal
            open={shown !== null}
            onOpenChange={(open) => {
                if (!open) finishProperties();
            }}
        >
            <RadixPopover.Anchor virtualRef={anchor} />
            {shown ? (
                <LayerProperties
                    key={opening}
                    draft={shown}
                    returnToRef={returnToRef}
                    contentRef={contentRef}
                />
            ) : null}
        </RadixPopover.Root>
    );
});
