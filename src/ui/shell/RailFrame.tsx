import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { railGroups } from "../../app/tools/registry";
import { toolRegistry } from "../../app/tools/toolRegistry";
import { RAIL, railColumns } from "./layout";
import { RegionBoundary } from "./RegionBoundary";

/** The number of buttons in each group of the rail, as the tool registry plans them. */
function plannedGroups(): readonly number[] {
    return railGroups(toolRegistry.railSlots()).map((group) => group.length);
}

/**
 * Tool rail region. It lays its groups out in one column and switches to two (72 px) when they
 * do not fit its height; it never scrolls and never clips a tool (DESIGN §2). The content is
 * built from `RailGroup` and, at the bottom, an optional `RailFooter`; separators between
 * groups are drawn by the rail.
 *
 * The column count follows the planned content, not what is rendered (SE-016): the groups of
 * the tool registry's rail slots and the footer of the colour chips (`RAIL.footer`). A rail
 * whose content failed to render keeps the healthy layout, and the footer, which two columns
 * lay out side by side, cannot make the rail switch back and forth.
 */
export function RailFrame({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLElement>(null);
    const [height, setHeight] = useState<number | null>(null);
    // Renders again when the registry's slots change.
    useSyncExternalStore(toolRegistry.subscribe, toolRegistry.version);

    useLayoutEffect(() => {
        const rail = ref.current;
        if (!rail) return;
        // The resize observer reports once when it starts, before the first paint.
        const resize = new ResizeObserver(() => setHeight(rail.clientHeight));
        resize.observe(rail);
        return () => resize.disconnect();
    }, []);

    const columns = height === null ? 1 : railColumns(plannedGroups(), RAIL.footer, height);

    return (
        <nav
            ref={ref}
            className="shell-rail"
            data-region="tool-rail"
            data-columns={columns}
            aria-label="Tools"
        >
            <RegionBoundary name="Tool rail" compact>
                {children}
            </RegionBoundary>
        </nav>
    );
}

/** One group of tool buttons; its direct children are the buttons. */
export function RailGroup({ children }: { children: ReactNode }) {
    return (
        <div className="shell-rail__group" data-rail-group="">
            {children}
        </div>
    );
}

/**
 * Content pinned to the bottom of the rail (the colour chips of DESIGN §5.1). Its children
 * stack in one column and stand side by side in two.
 */
export function RailFooter({ children }: { children: ReactNode }) {
    return (
        <div className="shell-rail__footer" data-rail-footer="">
            {children}
        </div>
    );
}
