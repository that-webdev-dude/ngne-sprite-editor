import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { RAIL, railColumns } from "./layout";
import { RegionBoundary } from "./RegionBoundary";

/**
 * The height the footer takes in one column: its children stacked with the rail's gap. Two
 * columns may lay them out side by side, so the footer's own height then is less; measuring
 * that would let the rail switch back and forth (SE-016).
 */
function footerHeight(footer: HTMLElement | null): number {
    if (!footer) return 0;
    const children = Array.from(footer.children, (child) =>
        child instanceof HTMLElement ? child.offsetHeight : 0,
    );
    if (children.length === 0) return footer.offsetHeight;
    return children.reduce((sum, height) => sum + height, 0) + (children.length - 1) * RAIL.gap;
}

/**
 * Tool rail region. It lays its groups out in one column and switches to two (72 px) when they
 * do not fit its height; it never scrolls and never clips a tool (DESIGN §2). The content is
 * built from `RailGroup` and, at the bottom, an optional `RailFooter`; separators between
 * groups are drawn by the rail.
 */
export function RailFrame({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLElement>(null);
    const [columns, setColumns] = useState<1 | 2>(1);

    useLayoutEffect(() => {
        const rail = ref.current;
        if (!rail) return;
        const measure = () => {
            const groups = Array.from(
                rail.querySelectorAll("[data-rail-group]"),
                (group) => group.childElementCount,
            );
            const footer = rail.querySelector<HTMLElement>("[data-rail-footer]");
            setColumns(railColumns(groups, footerHeight(footer), rail.clientHeight));
        };
        // The resize observer reports once when it starts, before the first paint.
        const resize = new ResizeObserver(measure);
        resize.observe(rail);
        const mutation = new MutationObserver(measure);
        mutation.observe(rail, { childList: true, subtree: true });
        return () => {
            resize.disconnect();
            mutation.disconnect();
        };
    }, []);

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
