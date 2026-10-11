import type { ComponentProps, MouseEvent } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";
import "./button.css";

export interface ToggleProps extends Omit<ComponentProps<"button">, "aria-label" | "aria-pressed"> {
    /** Accessible name; also the tooltip, or the visible text with `showLabel`. */
    label: string;
    pressed: boolean;
    onPressedChange(pressed: boolean): void;
    /** Key shown in the tooltip. */
    shortcut?: string;
    /** Show the label as text next to the icon (context bar mode toggles). */
    showLabel?: boolean;
}

/** On/off control: an icon button with `aria-pressed`, not a switch (DESIGN §4). */
export function Toggle({
    label,
    pressed,
    onPressedChange,
    shortcut,
    showLabel = false,
    className,
    type = "button",
    onClick,
    children,
    ...rest
}: ToggleProps) {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) onPressedChange(!pressed);
    };
    const button = (
        <button
            type={type}
            aria-label={showLabel ? undefined : label}
            aria-pressed={pressed}
            className={cx("ui-icon-button", "ui-toggle", showLabel && "ui-toggle--text", className)}
            onClick={handleClick}
            {...rest}
        >
            {children}
            {showLabel ? label : null}
        </button>
    );
    if (showLabel && !shortcut) return button;
    return (
        <Tooltip label={label} shortcut={shortcut}>
            {button}
        </Tooltip>
    );
}
