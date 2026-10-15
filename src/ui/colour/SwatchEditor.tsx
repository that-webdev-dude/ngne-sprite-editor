import { Popover } from "radix-ui";
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { APPLY_EDIT } from "../../app/palette/paletteCommandIds";
import { dropSwatchEdit, paletteStore, usePaletteState } from "../../app/palette/paletteState";
import { useSessions } from "../../app/state/sessions";
import { runCommand } from "../commands/runCommand";
import { ColourPicker } from "./ColourPicker";
import { PALETTE_GRID_ATTRIBUTE, swatchElement } from "./paletteUi";
import "../primitives/popover.css";

// The swatch editor (DESIGN §5.4, SE-060): the colour picker of DESIGN §5.3 in a popover
// (DESIGN §4) beside the swatch that Edit Colour… opened it on. The picker edits a draft; the
// swatch shows it while the popover is open, and the palette takes it in one undo step when
// the popover closes — by Escape, a press outside, or the focus leaving it. A press outside
// ends the edit before it does anything else, so a stroke it begins on the canvas comes after
// the edit; what was typed in a field and not applied yet is applied first, as leaving the
// field would. Escape drops such typing, as it does in the fields. The edit is applied as well
// when its document stops being the active one, and when the editor leaves the page, so no
// edit outlives its popover. It is applied through the registry (Apply Colour Edit); an edit
// that command cannot take (its document closed) is dropped.

/** Takes what the focused field of `container` holds by taking the focus from it. */
function applyTyping(container: HTMLElement | null): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && container?.contains(active)) active.blur();
}

/** Ends the open swatch edit through the registry. */
function applyEdit(): void {
    if (!paletteStore.getState().edit) return;
    if (!runCommand(APPLY_EDIT)) dropSwatchEdit();
}

export function SwatchEditor({ fallback }: { fallback: RefObject<HTMLElement | null> }) {
    const edit = usePaletteState((state) => state.edit);
    const activeId = useSessions((state) => state.activeId);
    const content = useRef<HTMLDivElement>(null);
    const index = edit?.index ?? -1;
    /** The swatch of the last edit, which gets the focus back after the popover closed. */
    const edited = useRef(-1);

    useEffect(() => {
        if (index < 0) return;
        edited.current = index;
        const onPress = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && content.current?.contains(target)) return;
            applyTyping(content.current);
            applyEdit();
        };
        window.addEventListener("pointerdown", onPress, true);
        return () => window.removeEventListener("pointerdown", onPress, true);
    }, [index]);

    // Another document became the active one: the edit goes to its own document.
    useEffect(() => {
        if (edit && edit.documentId !== activeId) applyEdit();
    }, [edit, activeId]);

    // The editor leaves the page (no document is open, the region was rebuilt): the edit ends
    // with it rather than coming back in the next editor.
    useEffect(() => () => applyEdit(), []);

    // Left of the grid, level with the swatch, so it hides no swatch; beside the header's
    // button when the swatch is not on the page (the command ran from the command palette
    // with the section collapsed).
    const anchor = useMemo(
        () => ({
            current: {
                getBoundingClientRect: (): DOMRect => {
                    const swatch = swatchElement(index);
                    const grid = swatch?.closest(`[${PALETTE_GRID_ATTRIBUTE}]`);
                    if (!swatch || !grid) {
                        return (fallback.current ?? document.body).getBoundingClientRect();
                    }
                    const row = swatch.getBoundingClientRect();
                    const box = grid.getBoundingClientRect();
                    return new DOMRect(box.left, row.top, box.width, row.height);
                },
            },
        }),
        [index, fallback],
    );

    return (
        <Popover.Root
            open={edit !== null}
            onOpenChange={(open) => {
                if (!open) applyEdit();
            }}
        >
            <Popover.Anchor virtualRef={anchor} />
            <Popover.Portal>
                <Popover.Content
                    ref={content}
                    className="ui-popover swatch-editor"
                    aria-label="Edit colour"
                    data-swatch-editor=""
                    side="left"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    onContextMenu={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => {
                        // There is no trigger to go back to. A press outside put the focus
                        // where it pressed; otherwise the swatch has it again.
                        event.preventDefault();
                        const active = document.activeElement;
                        if (active && active !== document.body) return;
                        const swatch = swatchElement(edited.current);
                        (swatch ?? fallback.current)?.focus({ preventScroll: true });
                    }}
                >
                    {edit ? <ColourPicker store={edit.draft} single /> : null}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
