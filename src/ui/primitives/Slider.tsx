import { Slider as RadixSlider } from "radix-ui";
import { cx } from "./cx";
import { NumberField } from "./NumberField";
import "./slider.css";

export interface SliderProps {
    /** Visible label; the accessible name of the thumb and of the number field. */
    label: string;
    value: number;
    onChange(value: number): void;
    min?: number;
    max?: number;
    step?: number;
    /** Unit shown in the number field. */
    unit?: string;
    disabled?: boolean;
    className?: string;
}

/**
 * Slider (DESIGN §4): 2 px track, 10 px thumb in a 24 px hit area, with the value in an
 * adjacent number field.
 */
export function Slider({
    label,
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    unit,
    disabled = false,
    className,
}: SliderProps) {
    return (
        <span className={cx("ui-slider", className)}>
            <span className="ui-field__label" aria-hidden="true">
                {label}
            </span>
            <RadixSlider.Root
                className="ui-slider__root"
                value={[value]}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onValueChange={([next]) => {
                    if (next !== undefined && next !== value) onChange(next);
                }}
            >
                <RadixSlider.Track className="ui-slider__track">
                    <RadixSlider.Range className="ui-slider__range" />
                </RadixSlider.Track>
                <RadixSlider.Thumb className="ui-slider__thumb" aria-label={label} />
            </RadixSlider.Root>
            <NumberField
                label={label}
                hideLabel
                value={value}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                unit={unit}
                disabled={disabled}
            />
        </span>
    );
}
