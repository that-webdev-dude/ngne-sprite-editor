import { useId, useState } from "react";
import type { ReplaceColourRequest } from "../../app/palette/replaceColour";
import { formatHex, parseHex } from "../../core/color";
import { MAX_REPLACE_TOLERANCE } from "../../core/palettes";
import type { ReplaceScope } from "../../core/palettes";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { cssColour } from "./pickerMath";
import "../primitives/field.css";
import "./replaceColour.css";

const SCOPES: readonly { value: ReplaceScope; label: string }[] = [
    { value: "selection", label: "Selection" },
    { value: "cel", label: "Cel" },
    { value: "frame", label: "Frame" },
    { value: "sprite", label: "Sprite" },
];

/** A colour as hex text, with a sample of it over the checkerboard. */
function HexColourField({
    label,
    text,
    onChange,
    messageId,
}: {
    label: string;
    text: string;
    onChange(text: string): void;
    messageId: string;
}) {
    const id = useId();
    const colour = parseHex(text);
    return (
        <>
            <label className="ui-field__label" htmlFor={id}>
                {label}
            </label>
            <span className="replace-form__row">
                <span className="replace-form__sample" aria-hidden="true">
                    <span
                        className="replace-form__fill"
                        style={colour === null ? undefined : { background: cssColour(colour) }}
                    />
                </span>
                <input
                    id={id}
                    className="replace-form__hex"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={colour === null || undefined}
                    aria-describedby={colour === null ? messageId : undefined}
                    value={text}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => onChange(event.target.value)}
                    // A colour typed in short is shown in full once the field is left.
                    onBlur={() => {
                        if (colour !== null) onChange(formatHex(colour));
                    }}
                />
            </span>
        </>
    );
}

/**
 * Replace colour (DESIGN §7; SE-066): From, To (hex, 3, 4, 6 or 8 digits, as the colour
 * panel's field), Tolerance (0–255, the largest difference of any channel) and Scope
 * (Selection, offered only with a selection; Cel; Frame; Sprite). Nothing changes until
 * Replace; the command that opened the dialog makes the change, one undo step.
 */
export function ReplaceColourDialog({ request }: { request: ReplaceColourRequest }) {
    const { initial, hasSelection } = request;
    const [fromText, setFromText] = useState(() => formatHex(initial.from));
    const [toText, setToText] = useState(() => formatHex(initial.to));
    const [tolerance, setTolerance] = useState(initial.tolerance);
    const [scope, setScope] = useState<ReplaceScope>(initial.scope);
    const formId = useId();
    const messageId = useId();
    const from = parseHex(fromText);
    const to = parseHex(toText);
    const valid = from !== null && to !== null;
    const options = SCOPES.map((option) => ({
        ...option,
        disabled: option.value === "selection" && !hasSelection,
    }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Replace colour"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId} disabled={!valid}>
                        Replace
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="replace-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    if (from !== null && to !== null) {
                        request.answer({ from, to, tolerance, scope });
                    }
                }}
            >
                <HexColourField
                    label="From"
                    text={fromText}
                    onChange={setFromText}
                    messageId={messageId}
                />
                <HexColourField
                    label="To"
                    text={toText}
                    onChange={setToText}
                    messageId={messageId}
                />
                <span className="ui-field__label" aria-hidden="true">
                    Tolerance
                </span>
                <NumberField
                    label="Tolerance"
                    hideLabel
                    value={tolerance}
                    onChange={setTolerance}
                    min={0}
                    max={MAX_REPLACE_TOLERANCE}
                />
                <span className="ui-field__label" aria-hidden="true">
                    Scope
                </span>
                <SegmentedControl
                    label="Scope"
                    value={scope}
                    onChange={setScope}
                    options={options}
                />
                <p className="replace-form__message" id={messageId} role="alert">
                    {valid ? null : "Enter colours as hex: #RRGGBB or #RRGGBBAA."}
                </p>
            </form>
        </Dialog>
    );
}
