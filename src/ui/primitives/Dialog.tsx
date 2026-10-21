import { Dialog as RadixDialog } from "radix-ui";
import { useRef } from "react";
import type { ReactNode } from "react";
import { surfaceOpener } from "../focus/menuOpener";
import { cx } from "./cx";
import "./dialog.css";

export interface DialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    /** `standard`: up to 560 px wide. `large`: up to 960 px and 86% of the window height. */
    size?: "standard" | "large";
    /** Body; it scrolls when the dialog reaches its maximum height. */
    children: ReactNode;
    /** Buttons, right-aligned; the primary action is a `Button variant="primary"`. */
    actions?: ReactNode;
    className?: string;
}

/**
 * Modal dialog (DESIGN §4): centred, with title, body and right-aligned actions. Radix
 * supplies the role, focus trap and Escape. The dialog is opened by state, not by a Radix
 * trigger, so it returns focus itself to the element that had it when the dialog opened.
 */
export function Dialog({
    open,
    onOpenChange,
    title,
    size = "standard",
    children,
    actions,
    className,
}: DialogProps) {
    const opener = useRef<HTMLElement | null>(null);
    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="ui-dialog__overlay" />
                <RadixDialog.Content
                    className={cx("ui-dialog", `ui-dialog--${size}`, className)}
                    aria-describedby={undefined}
                    onOpenAutoFocus={() => {
                        // Opened by a menu item: the element the menu was opened from.
                        opener.current = surfaceOpener();
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        // The opener may lie outside the part of a panel that is scrolled into
                        // view (the timeline's active cell): giving it the focus moves nothing.
                        if (opener.current?.isConnected) {
                            opener.current.focus({ preventScroll: true });
                        }
                        opener.current = null;
                    }}
                >
                    <RadixDialog.Title className="ui-dialog__title">{title}</RadixDialog.Title>
                    <div className="ui-dialog__body">{children}</div>
                    {actions ? <div className="ui-dialog__actions">{actions}</div> : null}
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
