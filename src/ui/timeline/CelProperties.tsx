import { Popover as RadixPopover } from "radix-ui";
import { memo, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { celFacts, editCelOpacity, useCelProperties } from "../../app/timeline/celProperties";
import type { CelPropertiesDraft } from "../../app/timeline/celProperties";
import { CEL_PROPERTIES_COMMANDS } from "../../app/timeline/celPropertiesIds";
import { useSessions } from "../../app/state/sessions";
import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import { Slider } from "../primitives/Slider";
import { cellOf } from "./timelineDom";
import { useClosingDraft } from "./useClosingDraft";
import "../primitives/popover.css";

/**
 * Closes the cel properties popover: its opacity becomes one undo step (Apply Cel Properties).
 * While its document cannot take it (a stroke), the popover stays open.
 */
export function finishCelProperties(): void {
    runCommand(CEL_PROPERTIES_COMMANDS.apply);
}

/** What the popover says of the cel's links. */
function linkText(linkedWith: number): string {
    if (linkedWith === 0) return "Not linked";
    return linkedWith === 1 ? "Linked to 1 other cel" : `Linked to ${linkedWith} other cels`;
}

/**
 * The cel properties popover (DESIGN §7, SE-061): the cel's opacity, and its linked state with
 * Unlink, beside the cel's cell. As the layer properties popover, what it shows changes no
 * document until it closes (Enter, Escape or a press outside), then once, in one undo step;
 * Unlink acts at once. On a locked layer its controls are disabled. The focus returns to where
 * it was when it opened, or to `fallback` when that is gone (a menu item). Rendered inside the
 * modal `RadixPopover.Root` of `CelPropertiesHost`; a memo, as `LayerProperties` is.
 */
const CelProperties = memo(function CelProperties({
    draft,
    fallback,
}: {
    draft: CelPropertiesDraft;
    fallback(): void;
}) {
    /** Where the focus was when the popover opened. */
    const returnTo = useRef<Element | null>(null);
    // A primitive, so the popover renders again only when the facts change.
    const key = useSessions((state) => {
        const document = state.documents.find((entry) => entry.id === draft.documentId);
        const facts = document && celFacts(document.session.doc, draft.layerId, draft.frameId);
        return facts ? `${facts.linkedWith} ${facts.locked}` : "";
    });
    const [linked, locked] = key.split(" ");
    const linkedWith = Number(linked ?? 0);
    const readOnly = locked === "true";
    return (
        <RadixPopover.Portal>
            <RadixPopover.Content
                className="ui-popover timeline-properties"
                aria-label="Cel properties"
                side="top"
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
                        finishCelProperties();
                    }}
                    onKeyDown={(event) => {
                        // Enter in a field applies (a number field has taken its value first);
                        // on Unlink it presses the button.
                        if (event.target instanceof HTMLButtonElement) return;
                        if (event.key === "Enter" && !event.defaultPrevented) {
                            event.preventDefault();
                            finishCelProperties();
                        }
                    }}
                >
                    <Slider
                        className="timeline-properties__slider"
                        label="Opacity"
                        min={0}
                        max={255}
                        disabled={readOnly}
                        value={draft.opacity}
                        onChange={editCelOpacity}
                    />
                    <span className="timeline-properties__link" role="status">
                        {readOnly ? `${linkText(linkedWith)}; layer locked` : linkText(linkedWith)}
                    </span>
                    <Button
                        disabled={readOnly || linkedWith === 0}
                        onClick={(event) => {
                            const form = event.currentTarget.form;
                            runCommand(CEL_PROPERTIES_COMMANDS.unlink);
                            // The button is disabled now: the focus stays in the popover, on
                            // the opacity field, so Enter still applies.
                            form?.querySelector<HTMLElement>('input[role="spinbutton"]')?.focus();
                        }}
                    >
                        Unlink
                    </Button>
                </form>
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
});

/**
 * The cel properties popover's place in the timeline panel: a modal `RadixPopover.Root` whose
 * virtual anchor is the cell of the popover's cel in `grid`. It follows the popover's state by
 * itself, so opening and closing the popover do not render the panel again, and it closes
 * after the canvas has had the frames to show what it applied (`useClosingDraft`). A popover
 * whose document stops being the active one is applied.
 */
export const CelPropertiesHost = memo(function CelPropertiesHost({
    grid,
    documentId,
    fallback,
}: {
    grid: RefObject<HTMLElement | null>;
    /** The document the panel shows. */
    documentId: string;
    fallback(): void;
}) {
    const draft = useCelProperties((state) => state.draft);
    const liveId = useSessions((state) => state.activeId);
    useEffect(() => {
        if (draft && draft.documentId !== liveId) finishCelProperties();
    }, [draft, liveId]);
    const shown = useClosingDraft(draft?.documentId === documentId ? draft : null);
    const layerId = shown?.layerId ?? null;
    const frameId = shown?.frameId ?? null;
    const anchor = useMemo(
        () => ({
            current: {
                getBoundingClientRect: (): DOMRect => {
                    const cell =
                        layerId === null || frameId === null
                            ? null
                            : cellOf(grid.current, layerId, frameId);
                    return (cell ?? grid.current ?? document.body).getBoundingClientRect();
                },
            },
        }),
        [grid, layerId, frameId],
    );
    return (
        <RadixPopover.Root
            modal
            open={shown !== null}
            onOpenChange={(open) => {
                if (!open) finishCelProperties();
            }}
        >
            <RadixPopover.Anchor virtualRef={anchor} />
            {shown ? <CelProperties draft={shown} fallback={fallback} /> : null}
        </RadixPopover.Root>
    );
});
