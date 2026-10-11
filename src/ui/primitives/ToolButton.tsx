import type { ComponentProps } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";
import "./button.css";

export interface ToolButtonProps extends Omit<
    ComponentProps<"button">,
    "aria-label" | "aria-pressed"
> {
    /** Tool name: accessible name and tooltip text. */
    label: string;
    /** Tool key shown in the tooltip, for example "B". */
    shortcut?: string;
    /** The active tool: accent icon on `--bg-active`. */
    active?: boolean;
}

/** Tool rail button, 28 px (DESIGN §4). The child is the icon. */
export function ToolButton({
    label,
    shortcut,
    active = false,
    className,
    type = "button",
    ...rest
}: ToolButtonProps) {
    return (
        <Tooltip label={label} shortcut={shortcut} side="right">
            <button
                type={type}
                aria-label={label}
                aria-pressed={active}
                className={cx("ui-tool-button", className)}
                {...rest}
            />
        </Tooltip>
    );
}
