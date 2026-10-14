import type { ToolOptions } from "../state/editor";
import type { ToolOptionSpec, ToolOptionValue } from "./types";

// The values of a tool's options (SE-014). The editor store keeps what the user set, by tool
// id and option key (`EditorState.toolOptions`); everything else is the option's default. A
// stored value the option cannot take (another type, out of range, a choice that no longer
// exists) reads as the nearest value it can take, or as the default. Pure: no store.

/** The value `option` takes for `stored`, which may be anything. */
export function optionValue(option: ToolOptionSpec, stored: unknown): ToolOptionValue {
    switch (option.kind) {
        case "number": {
            if (typeof stored !== "number" || !Number.isFinite(stored)) return option.default;
            return Math.min(option.max, Math.max(option.min, stored));
        }
        case "toggle":
            return typeof stored === "boolean" ? stored : option.default;
        case "choice":
            return option.choices.some((choice) => choice.value === stored)
                ? (stored as string)
                : option.default;
    }
}

/** Every option of a tool with its value, by key. */
export function optionValues(
    options: readonly ToolOptionSpec[],
    stored: ToolOptions | undefined,
): Record<string, ToolOptionValue> {
    const values: Record<string, ToolOptionValue> = {};
    for (const option of options) values[option.key] = optionValue(option, stored?.[option.key]);
    return values;
}
