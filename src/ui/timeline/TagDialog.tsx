import { RadioGroup } from "radix-ui";
import { useId, useState } from "react";
import { formatHex, parseHex } from "../../core/color";
import { BLACK, labelColourOn, WHITE } from "../../core/color/contrast";
import { MAX_NAME_LENGTH } from "../../core/model";
import { MAX_TAG_REPEAT } from "../../core/tags";
import { TAG_COLOURS, tagProblems } from "../../app/timeline/tagDialogs";
import type { TagDirection, TagRequest, TagValues } from "../../app/timeline/tagDialogs";
import { cssColour } from "../colour/pickerMath";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import "../primitives/field.css";
import "./tags.css";

const DIRECTIONS: readonly { value: TagDirection; label: string }[] = [
    { value: "forward", label: "Forward" },
    { value: "reverse", label: "Reverse" },
    { value: "pingpong", label: "Ping-pong" },
];

/**
 * The Tag dialog (DESIGN §7; SE-023): name, colour (hex field and the preset colours), range
 * (From and To, frame numbers), direction and repeat. An empty name, a colour that is not one
 * and a From after To are named in the message line under the form, and the dialog cannot be
 * confirmed until they are fixed. Nothing changes until it is; the command that opened the
 * dialog applies the values.
 *
 * Tag properties: when more than one tag can be edited (the tags at the active frame), a Tag
 * select comes first, and choosing a tag there shows its values, dropping what was changed for
 * the one before; Delete deletes the tag chosen. So the keyboard reaches a tag that a shorter
 * one covers, which is never the active tag.
 */
export function TagDialog({ request }: { request: TagRequest }) {
    const [tagId, setTagId] = useState(request.chosen);
    const [values, setValues] = useState<TagValues>(request.initial);
    // The colour as typed; the colour is what it parses to.
    const [colourText, setColourText] = useState(() => formatHex(request.initial.color));
    const formId = useId();
    const nameId = useId();
    const colourId = useId();
    const rangeId = useId();
    const repeatHintId = useId();
    const messageId = useId();

    const colour = parseHex(colourText);
    const problems = tagProblems({ ...values, color: colour }, request.frameCount);
    const valid = problems.messages.length === 0;
    const preset = TAG_COLOURS.findIndex((entry) => entry.color === colour);
    const change = (patch: Partial<TagValues>) =>
        setValues((current) => ({ ...current, ...patch }));
    const choose = (id: string) => {
        const choice = request.choices.find((entry) => entry.id === id);
        if (!choice) return;
        setTagId(choice.id);
        setValues(choice.values);
        setColourText(formatHex(choice.values.color));
    };
    const submit = () => {
        if (valid && colour !== null) {
            request.answer({ action: "apply", tagId, values: { ...values, color: colour } });
        }
    };
    const creating = request.mode === "new";
    const label = colour === null ? null : labelColourOn(colour) === "black" ? BLACK : WHITE;
    const options = request.choices.map((choice) => ({ value: choice.id, label: choice.label }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title={creating ? "New tag" : "Tag properties"}
            actions={
                <>
                    {tagId === null ? null : (
                        <Button onClick={() => request.answer({ action: "delete", tagId })}>
                            Delete
                        </Button>
                    )}
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId} disabled={!valid}>
                        {creating ? "Create" : "OK"}
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="tag-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                }}
            >
                {tagId === null || options.length < 2 ? null : (
                    <>
                        <span className="ui-field__label" aria-hidden="true">
                            Tag
                        </span>
                        <Select
                            className="tag-form__choice"
                            label="Tag"
                            hideLabel
                            value={tagId}
                            onChange={choose}
                            options={options}
                        />
                    </>
                )}

                <label className="ui-field__label" htmlFor={nameId}>
                    Name
                </label>
                <input
                    id={nameId}
                    className="tag-form__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_NAME_LENGTH}
                    aria-invalid={problems.name || undefined}
                    aria-describedby={problems.name ? messageId : undefined}
                    value={values.name}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => change({ name: event.target.value })}
                />

                <label className="ui-field__label" htmlFor={colourId}>
                    Colour
                </label>
                <div className="tag-form__row">
                    <span
                        className="tag-form__sample"
                        aria-hidden="true"
                        style={
                            colour === null || label === null
                                ? undefined
                                : { background: cssColour(colour, 1), color: cssColour(label, 1) }
                        }
                    >
                        {values.name.trim() || "Tag"}
                    </span>
                    <input
                        id={colourId}
                        className="tag-form__text tag-form__hex"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={problems.color || undefined}
                        aria-describedby={problems.color ? messageId : undefined}
                        value={colourText}
                        onChange={(event) => setColourText(event.target.value)}
                        // A colour typed in short is shown in full once the field is left.
                        onBlur={() => {
                            if (colour !== null) setColourText(formatHex(colour));
                        }}
                    />
                    <RadioGroup.Root
                        className="tag-form__presets"
                        aria-label="Colour presets"
                        orientation="horizontal"
                        value={preset === -1 ? "" : String(preset)}
                        onValueChange={(index) => {
                            const chosen = TAG_COLOURS[Number(index)];
                            if (chosen) setColourText(formatHex(chosen.color));
                        }}
                    >
                        {TAG_COLOURS.map((entry, index) => (
                            <RadioGroup.Item
                                key={entry.name}
                                className="tag-form__preset"
                                value={String(index)}
                                aria-label={entry.name}
                                style={{ background: cssColour(entry.color, 1) }}
                            />
                        ))}
                    </RadioGroup.Root>
                </div>

                <span className="ui-field__label" id={rangeId}>
                    Frames
                </span>
                <div className="tag-form__row" role="group" aria-labelledby={rangeId}>
                    <NumberField
                        label="From"
                        value={values.from}
                        onChange={(from) => change({ from })}
                        min={1}
                        max={request.frameCount}
                    />
                    <NumberField
                        label="To"
                        value={values.to}
                        onChange={(to) => change({ to })}
                        min={1}
                        max={request.frameCount}
                    />
                </div>

                <span className="ui-field__label">Direction</span>
                <SegmentedControl
                    label="Direction"
                    value={values.direction}
                    onChange={(direction) => change({ direction })}
                    options={DIRECTIONS}
                />

                <span className="ui-field__label" aria-hidden="true">
                    Repeat
                </span>
                <div className="tag-form__row">
                    <NumberField
                        label="Repeat"
                        hideLabel
                        value={values.repeat}
                        onChange={(repeat) => change({ repeat })}
                        min={0}
                        max={MAX_TAG_REPEAT}
                        describedBy={repeatHintId}
                    />
                    <span className="tag-form__hint" id={repeatHintId}>
                        0 repeats without end
                    </span>
                </div>

                <p className="tag-form__message" role="alert" id={messageId}>
                    {problems.messages.join(" ")}
                </p>
            </form>
        </Dialog>
    );
}
