import { Popover as RadixPopover } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cx";
import "./popover.css";

export interface PopoverProps {
    /** One element that accepts a ref and event props; it opens the popover. */
    trigger: ReactNode;
    /** Accessible name of the popover. */
    label: string;
    children: ReactNode;
    /** Controlled state; leave both out for an uncontrolled popover. */
    open?: boolean;
    onOpenChange?(open: boolean): void;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    className?: string;
}

/** Popover (DESIGN §4): non-modal surface that closes on Escape and on an outside click. */
export function Popover({
    trigger,
    label,
    children,
    open,
    onOpenChange,
    side = "bottom",
    align = "start",
    className,
}: PopoverProps) {
    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    className={cx("ui-popover", className)}
                    aria-label={label}
                    side={side}
                    align={align}
                    sideOffset={6}
                    collisionPadding={8}
                >
                    {children}
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
