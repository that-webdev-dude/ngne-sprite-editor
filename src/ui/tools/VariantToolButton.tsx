import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { formatChord } from "../../app/commands/chord";
import type { RailSlot, Tool } from "../../app/tools/types";
import { viewSurface } from "../../app/view/viewNavigation";
import { Icon } from "../primitives/Icon";
import { ToolButton } from "../primitives/ToolButton";
import "../primitives/menu.css";
import "./toolRail.css";

// A rail slot with variants (DESIGN §5.1, SE-031): its button shows the variant selected last,
// with a corner mark, and a click selects that one. Holding the button for `VARIANT_HOLD_MS`,
// a right click or the Menu key (Shift+F10) opens the menu of the slot's variants beside it,
// the shown one checked; a choice there selects it. A press held until the menu opens selects
// nothing by itself, and a release over an item chooses it. Chosen with the pointer, the
// focus goes to the viewport, as after a tool button (SPEC §7.8); from the keyboard it goes
// back to the button. The menu is not modal: a press outside it closes it and acts where it
// lands.
//
// The menu's Radix trigger is a hidden box over the button, which the pointer goes through:
// the button itself opens no surface on a click, so the focus rule of tool buttons holds.

/** How long a press on the button opens the menu of its variants. */
export const VARIANT_HOLD_MS = 300;

export interface VariantToolButtonProps {
    slot: RailSlot;
    /** The variant the button shows (`ToolState.shownInSlot`). */
    shown: Tool;
    /** The active tool is one of the slot's. */
    active: boolean;
    select(id: string): void;
}

export function VariantToolButton({ slot, shown, active, select }: VariantToolButtonProps) {
    const [open, setOpen] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** The press in progress opened the menu: its click selects nothing. */
    const opened = useRef(false);

    const stopHold = () => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    };
    useEffect(() => stopHold, []);

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        opened.current = false;
        stopHold();
        if (event.button !== 0) return;
        timer.current = setTimeout(() => {
            timer.current = null;
            opened.current = true;
            setOpen(true);
        }, VARIANT_HOLD_MS);
    };

    const onClick = (event: MouseEvent<HTMLButtonElement>) => {
        stopHold();
        // The release of the press that opened the menu: it selects nothing. A click from the
        // keyboard (detail 0) always selects.
        if (opened.current && event.detail !== 0) {
            opened.current = false;
            return;
        }
        select(shown.id);
    };

    const onOpenChange = (next: boolean) => {
        if (!next) opened.current = false;
        setOpen(next);
    };

    const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        stopHold();
        setOpen(true);
    };

    // The Menu key and Shift+F10 open it from the keyboard, whether or not the browser follows
    // them with a context menu event (which then finds it open).
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const menuKey =
            event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey);
        if (!menuKey) return;
        event.preventDefault();
        setOpen(true);
    };

    const icon = shown.icon ?? slot.icon;
    return (
        // Not modal: the release of a held press reaches the button, whose click it is (and
        // which selects nothing); a press elsewhere closes the menu and acts there.
        <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
            <ToolButton
                ref={button}
                label={shown.label}
                shortcut={shown.shortcut}
                data-tool={slot.id}
                data-tool-variant={shown.id}
                className="tool-rail__variants"
                active={active}
                onPointerDown={onPointerDown}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onKeyDown={onKeyDown}
            >
                {icon ? <Icon icon={icon} /> : null}
                <span className="tool-rail__corner" aria-hidden="true" />
                <DropdownMenu.Trigger asChild>
                    <span className="tool-rail__anchor" aria-hidden="true" />
                </DropdownMenu.Trigger>
            </ToolButton>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className="ui-menu"
                    side="right"
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    data-tool-variants={slot.id}
                    aria-label={`${slot.label} variants`}
                    onContextMenu={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        const pointer = document.documentElement.dataset.modality !== "keyboard";
                        const target = pointer ? viewSurface() : button.current;
                        target?.focus({ preventScroll: true });
                    }}
                >
                    <DropdownMenu.RadioGroup value={shown.id} onValueChange={select}>
                        {slot.variants.map((variant) => {
                            const glyph = variant.icon ?? slot.icon;
                            return (
                                <DropdownMenu.RadioItem
                                    key={variant.id}
                                    className="ui-menu__item tool-rail__variant"
                                    value={variant.id}
                                    data-variant={variant.id}
                                >
                                    <span className="tool-rail__variant-name">
                                        {glyph ? <Icon icon={glyph} /> : null}
                                        {variant.label}
                                    </span>
                                    {variant.shortcut ? (
                                        <span className="ui-menu__shortcut">
                                            {formatChord(variant.shortcut)}
                                        </span>
                                    ) : null}
                                </DropdownMenu.RadioItem>
                            );
                        })}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
