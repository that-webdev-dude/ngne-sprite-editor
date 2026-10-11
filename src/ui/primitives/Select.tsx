import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";
import { useId } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import "./field.css";
import "./menu.css";

export interface SelectOption<Value extends string> {
    value: Value;
    label: string;
    disabled?: boolean;
}

export interface SelectProps<Value extends string> {
    /** Visible label; the accessible name of the trigger. */
    label: string;
    value: Value;
    /** Accepts a state setter directly; the value type is inferred from `value` and `options`. */
    onChange(value: NoInfer<Value>): void;
    options: readonly SelectOption<Value>[];
    disabled?: boolean;
    /** Keep the label for assistive technology only. */
    hideLabel?: boolean;
    className?: string;
}

/** Select (DESIGN §4): Radix Select with the metrics of the number field. */
export function Select<Value extends string>({
    label,
    value,
    onChange,
    options,
    disabled = false,
    hideLabel = false,
    className,
}: SelectProps<Value>) {
    const triggerId = useId();
    return (
        <span className={cx("ui-field", className)}>
            {hideLabel ? null : (
                <label className="ui-field__label" htmlFor={triggerId}>
                    {label}
                </label>
            )}
            <RadixSelect.Root
                value={value}
                onValueChange={(next) => onChange(next as Value)}
                disabled={disabled}
            >
                <RadixSelect.Trigger
                    id={triggerId}
                    className="ui-select"
                    aria-label={hideLabel ? label : undefined}
                >
                    <RadixSelect.Value />
                    <RadixSelect.Icon className="ui-select__icon">
                        <Icon icon={ChevronDown} />
                    </RadixSelect.Icon>
                </RadixSelect.Trigger>
                <RadixSelect.Portal>
                    <RadixSelect.Content
                        className="ui-menu ui-menu--select"
                        position="popper"
                        sideOffset={4}
                        collisionPadding={8}
                    >
                        <RadixSelect.Viewport>
                            {options.map((option) => (
                                <RadixSelect.Item
                                    key={option.value}
                                    className="ui-menu__item"
                                    value={option.value}
                                    disabled={option.disabled}
                                >
                                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                                    <RadixSelect.ItemIndicator className="ui-menu__indicator">
                                        <Icon icon={Check} />
                                    </RadixSelect.ItemIndicator>
                                </RadixSelect.Item>
                            ))}
                        </RadixSelect.Viewport>
                    </RadixSelect.Content>
                </RadixSelect.Portal>
            </RadixSelect.Root>
        </span>
    );
}
