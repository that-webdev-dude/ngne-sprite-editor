import { RadioGroup } from "radix-ui";
import { cx } from "./cx";
import "./segmented.css";

export interface SegmentedOption<Value extends string> {
    value: Value;
    label: string;
    disabled?: boolean;
}

export interface SegmentedControlProps<Value extends string> {
    /** Accessible name of the group. */
    label: string;
    value: Value;
    /** Accepts a state setter directly; the value type is inferred from `value` and `options`. */
    onChange(value: NoInfer<Value>): void;
    options: readonly SegmentedOption<Value>[];
    disabled?: boolean;
    className?: string;
}

/** Segmented control: one choice of a few, as a radio group (arrow keys move the choice). */
export function SegmentedControl<Value extends string>({
    label,
    value,
    onChange,
    options,
    disabled = false,
    className,
}: SegmentedControlProps<Value>) {
    return (
        <RadioGroup.Root
            className={cx("ui-segmented", className)}
            aria-label={label}
            orientation="horizontal"
            value={value}
            onValueChange={(next) => onChange(next as Value)}
            disabled={disabled}
        >
            {options.map((option) => (
                <RadioGroup.Item
                    key={option.value}
                    className="ui-segmented__item"
                    value={option.value}
                    disabled={option.disabled}
                >
                    {option.label}
                </RadioGroup.Item>
            ))}
        </RadioGroup.Root>
    );
}
