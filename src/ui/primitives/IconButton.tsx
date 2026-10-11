import type { ComponentProps } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";
import type { TooltipProps } from "./Tooltip";
import "./button.css";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label"> {
    /** Accessible name and tooltip text; required because the button shows only an icon. */
    label: string;
    /** Key shown in the tooltip. */
    shortcut?: string;
    tooltipSide?: TooltipProps["side"];
}

/** Icon-only button, 24 px (DESIGN §4). The child is the icon. */
export function IconButton({
    label,
    shortcut,
    tooltipSide,
    className,
    type = "button",
    ...rest
}: IconButtonProps) {
    return (
        <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
            <button
                type={type}
                aria-label={label}
                className={cx("ui-icon-button", className)}
                {...rest}
            />
        </Tooltip>
    );
}
