import { useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { cx } from "./cx";
import {
    formatNumber,
    parseNumber,
    SCRUB_THRESHOLD_PX,
    scrubNumber,
    stepNumber,
} from "./numberMath";
import type { NumberRange } from "./numberMath";
import "./field.css";

export interface NumberFieldProps extends NumberRange {
    /** Visible label and scrub handle; the accessible name of the field. */
    label: string;
    value: number;
    onChange(value: number): void;
    /** Unit shown muted after the value, for example "px". */
    unit?: string;
    disabled?: boolean;
    /** Keep the label for assistive technology only; the field then has no scrub handle. */
    hideLabel?: boolean;
    className?: string;
    id?: string;
}

interface Scrub {
    pointerId: number;
    x: number;
    value: number;
    moved: boolean;
}

/**
 * Number field (DESIGN §4): drag the label to scrub, arrow keys ±1, Shift ±10, typed values
 * are applied on Enter or blur and dropped on Escape.
 */
export function NumberField({
    label,
    value,
    onChange,
    unit,
    disabled = false,
    hideLabel = false,
    className,
    id,
    min,
    max,
    step,
}: NumberFieldProps) {
    const range: NumberRange = { min, max, step };
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [draft, setDraft] = useState<string | null>(null);
    const scrub = useRef<Scrub | null>(null);
    const suppressClick = useRef(false);
    const text = draft ?? formatNumber(value, range);

    const change = (next: number) => {
        setDraft(null);
        if (next !== value) onChange(next);
    };
    const commit = () => {
        if (draft !== null) change(parseNumber(draft, range) ?? value);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const base = (draft === null ? null : parseNumber(draft, range)) ?? value;
            change(stepNumber(base, event.key === "ArrowUp" ? 1 : -1, range, event.shiftKey));
        } else if (event.key === "Enter") {
            commit();
        } else if (event.key === "Escape") {
            setDraft(null);
        }
    };

    const onPointerDown = (event: PointerEvent<HTMLLabelElement>) => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrub.current = { pointerId: event.pointerId, x: event.clientX, value, moved: false };
        suppressClick.current = false;
    };
    const onPointerMove = (event: PointerEvent<HTMLLabelElement>) => {
        const state = scrub.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const dx = event.clientX - state.x;
        if (!state.moved && Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
        state.moved = true;
        change(scrubNumber(state.value, dx, range, event.shiftKey));
    };
    const onPointerUp = (event: PointerEvent<HTMLLabelElement>) => {
        const state = scrub.current;
        if (!state || state.pointerId !== event.pointerId) return;
        scrub.current = null;
        suppressClick.current = state.moved;
        if (event.type === "pointercancel" && state.moved) change(state.value);
    };
    // A click on the label focuses the field; the click that ends a scrub must not.
    const onClick = (event: MouseEvent<HTMLLabelElement>) => {
        if (suppressClick.current) event.preventDefault();
        suppressClick.current = false;
    };
    // The whole 24 px box is the pointer target, not only the text inside it.
    const focusInput = (event: MouseEvent<HTMLSpanElement>) => {
        const input = event.currentTarget.querySelector("input");
        if (!input || input.disabled || event.target === input) return;
        event.preventDefault();
        input.focus();
    };

    return (
        <span className={cx("ui-field", className)}>
            {hideLabel ? null : (
                <label
                    className="ui-field__label ui-field__label--scrub"
                    htmlFor={inputId}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onClick={onClick}
                >
                    {label}
                </label>
            )}
            <span
                className="ui-number"
                aria-disabled={disabled || undefined}
                onMouseDown={focusInput}
            >
                <input
                    id={inputId}
                    className="ui-number__input"
                    type="text"
                    inputMode="decimal"
                    role="spinbutton"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={hideLabel ? label : undefined}
                    aria-valuenow={value}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuetext={unit ? `${text} ${unit}` : undefined}
                    disabled={disabled}
                    value={text}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={commit}
                />
                {unit ? (
                    <span className="ui-number__unit" aria-hidden="true">
                        {unit}
                    </span>
                ) : null}
            </span>
        </span>
    );
}
