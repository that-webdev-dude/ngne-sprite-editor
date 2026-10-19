import { useSyncExternalStore } from "react";
import type { ToolOptionSpec, ToolOptionValue } from "../../../app/tools/types";
import { shownContextBarContent, subscribeContextBarContent } from "../../tools/contextBarRegistry";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives/Select";
import { Toggle } from "../../primitives/Toggle";
import { useToolState } from "../../tools/useToolState";
import "../../tools/contextBar.css";

interface OptionControlProps {
    option: ToolOptionSpec;
    value: ToolOptionValue;
    onChange(value: ToolOptionValue): void;
}

/** One option of the active tool, as the control its kind calls for (DESIGN §4, §5.2). */
function OptionControl({ option, value, onChange }: OptionControlProps) {
    const data = { "data-tool-option": option.key };
    switch (option.kind) {
        case "number":
            return (
                <span {...data}>
                    <NumberField
                        label={option.label}
                        value={Number(value)}
                        onChange={onChange}
                        min={option.min}
                        max={option.max}
                        step={option.step}
                        unit={option.unit}
                    />
                </span>
            );
        case "toggle":
            return (
                <Toggle
                    {...data}
                    label={option.label}
                    pressed={value === true}
                    onPressedChange={onChange}
                    showLabel
                />
            );
        case "choice": {
            const choice = String(value);
            if (option.display === "select") {
                return (
                    <span {...data}>
                        <Select
                            label={option.label}
                            value={choice}
                            onChange={onChange}
                            options={option.choices}
                        />
                    </span>
                );
            }
            return (
                <span className="ui-field" {...data}>
                    {/* The group is named by its aria-label; this is the visible label. */}
                    <span className="ui-field__label" aria-hidden="true">
                        {option.label}
                    </span>
                    <SegmentedControl
                        label={option.label}
                        value={choice}
                        onChange={onChange}
                        options={option.choices}
                    />
                </span>
            );
        }
    }
}

/**
 * Context bar content (DESIGN §5.2): the active tool's name and its options, in the order the
 * tool lists them, rendered from its option schema (SE-014). Empty while no registered tool is
 * active. While registered content is shown (`contextBarRegistry.ts`; SE-033: the transform
 * fields of a floating selection), it takes the options' place.
 */
export function ContextBar() {
    const tools = useToolState();
    const content = useSyncExternalStore(subscribeContextBarContent, shownContextBarContent);
    const tool = tools.active();
    if (!tool) return null;
    const values = tools.options(tool);
    return (
        <>
            <span className="context-tool" data-context-tool={tool.id}>
                {tool.label}
            </span>
            {content ? (
                <span className="context-content" data-context-content={content.id}>
                    <content.Body />
                </span>
            ) : null}
            {content
                ? null
                : tool.options.map((option) => (
                      <OptionControl
                          key={`${tool.id}:${option.key}`}
                          option={option}
                          value={values[option.key] ?? option.default}
                          onChange={(value) => tools.setOption(tool, option.key, value)}
                      />
                  ))}
        </>
    );
}
