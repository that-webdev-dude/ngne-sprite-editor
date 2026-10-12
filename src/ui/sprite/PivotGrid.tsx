import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { PIVOT_PRESETS, pivotPresetAt } from "../../core/sprite";
import type { Pivot } from "../../core/sprite";
import { movePivotPreset } from "./pivotGridKeys";
import "./sprite.css";

export interface PivotGridProps {
    /** Accessible name of the group. */
    label: string;
    value: Pivot;
    onChange(pivot: Pivot): void;
}

/**
 * The 3×3 pivot presets (SPEC §7.7) as a radio group laid out like the canvas: the top-left
 * cell is the top-left corner. Arrow keys move the choice by one cell; no cell is checked
 * while the pivot is not one of the nine.
 */
export function PivotGrid({ label, value, onChange }: PivotGridProps) {
    const cells = useRef<(HTMLButtonElement | null)[]>([]);
    const current = pivotPresetAt(value);
    const checked = current ? PIVOT_PRESETS.indexOf(current) : -1;
    // One tab stop for the group: the checked cell, or the first one when none is.
    const tabStop = checked === -1 ? 0 : checked;

    const choose = (index: number) => {
        const preset = PIVOT_PRESETS[index];
        if (preset) onChange({ ...preset.pivot });
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = movePivotPreset(index, event.key);
        if (next === null) return;
        event.preventDefault();
        cells.current[next]?.focus();
        choose(next);
    };

    return (
        <div className="pivot-grid" role="radiogroup" aria-label={label}>
            {PIVOT_PRESETS.map((preset, index) => (
                <button
                    key={preset.id}
                    ref={(element) => {
                        cells.current[index] = element;
                    }}
                    type="button"
                    role="radio"
                    className="pivot-grid__cell"
                    aria-checked={index === checked}
                    aria-label={preset.name}
                    data-preset={preset.id}
                    tabIndex={index === tabStop ? 0 : -1}
                    onClick={() => choose(index)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                />
            ))}
        </div>
    );
}
