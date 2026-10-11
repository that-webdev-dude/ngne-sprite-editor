import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { cx } from "./cx";
import { resizeByDrag, resizeByKey } from "./splitterMath";
import type { SplitterAxis } from "./splitterMath";
import "./splitter.css";

export interface SplitterProps {
    /** Direction of the visible line: `vertical` divides left from right. */
    orientation: SplitterAxis["orientation"];
    /** Accessible name, for example "Resize dock". */
    label: string;
    /** Current size in CSS pixels of the pane this splitter resizes. */
    value: number;
    min: number;
    max: number;
    /** +1 (default): the pane grows as the pointer moves right or down. −1: left or up. */
    growth?: SplitterAxis["growth"];
    onChange(value: number): void;
    /** Double-click or Enter: back to the default size. */
    onReset(): void;
    className?: string;
}

interface Drag {
    pointerId: number;
    origin: number;
    value: number;
}

/**
 * Splitter (DESIGN §4): 8 px hit area around a 1 px line. Drag to resize, double-click to
 * reset; focused, the arrow keys resize, Home/End go to the limits and Enter resets.
 */
export function Splitter({
    orientation,
    label,
    value,
    min,
    max,
    growth = 1,
    onChange,
    onReset,
    className,
}: SplitterProps) {
    const axis: SplitterAxis = { orientation, growth, min, max };
    const drag = useRef<Drag | null>(null);
    const [dragging, setDragging] = useState(false);
    const position = (event: PointerEvent) =>
        orientation === "vertical" ? event.clientX : event.clientY;

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, origin: position(event), value };
        setDragging(true);
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const next = resizeByDrag(state.value, position(event) - state.origin, axis);
        if (next !== value) onChange(next);
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            onReset();
            return;
        }
        const next = resizeByKey(value, event.key, axis, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        if (next !== value) onChange(next);
    };

    return (
        <div
            role="separator"
            tabIndex={0}
            aria-label={label}
            aria-orientation={orientation}
            aria-valuenow={Math.round(value)}
            aria-valuemin={min}
            aria-valuemax={max}
            className={cx("ui-splitter", `ui-splitter--${orientation}`, className)}
            data-dragging={dragging || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onReset}
            onKeyDown={onKeyDown}
        />
    );
}
