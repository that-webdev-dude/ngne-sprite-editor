import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactNode } from "react";
import "./tooltip.css";

/** DESIGN §4: tooltips open after 400 ms. */
export const TOOLTIP_DELAY_MS = 400;

/** Required once above every `Tooltip`; `UiRoot` provides it. */
export function TooltipProvider({ children }: { children: ReactNode }) {
    return (
        <RadixTooltip.Provider delayDuration={TOOLTIP_DELAY_MS} skipDelayDuration={0}>
            {children}
        </RadixTooltip.Provider>
    );
}

export interface TooltipProps {
    /** Control name. */
    label: string;
    /** Key shown after the name, for example "B" or "Shift+U". */
    shortcut?: string;
    side?: "top" | "right" | "bottom" | "left";
    /** One element that accepts a ref and event props. */
    children: ReactNode;
}

export function Tooltip({ label, shortcut, side = "bottom", children }: TooltipProps) {
    return (
        <RadixTooltip.Root>
            <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    className="ui-tooltip"
                    side={side}
                    sideOffset={6}
                    collisionPadding={4}
                >
                    {label}
                    {shortcut ? <span className="ui-tooltip__key">{shortcut}</span> : null}
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );
}
