import { useId, useState } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import { NEW_SPRITE_SIZE_PRESETS, newSpriteProblems } from "../../app/sprite/dialogs";
import type { NewSpriteRequest, NewSpriteValues } from "../../app/sprite/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import "../primitives/field.css";
import "./sprite.css";

const PRESET_OPTIONS = NEW_SPRITE_SIZE_PRESETS.map((size) => ({
    value: String(size),
    label: String(size),
}));

interface DiscardDialogProps {
    /** Name of the document whose changes are lost. */
    name: string;
    onCancel(): void;
    onDiscard(): void;
}

/** Asked once before a document with unsaved changes is replaced (DESIGN §7). */
function DiscardDialog({ name, onCancel, onDiscard }: DiscardDialogProps) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title="Discard unsaved changes?"
            actions={
                <>
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button variant="danger" onClick={onDiscard}>
                        Discard
                    </Button>
                </>
            }
        >
            <p>
                “{name}” has unsaved changes. The new sprite takes its place, and the changes are
                lost.
            </p>
        </Dialog>
    );
}

/**
 * New sprite dialog (DESIGN §7): name, width, height and the size presets. The number fields
 * take any number, so that a size outside 1..1024 is shown with its message instead of being
 * silently changed; Create is disabled until every value is accepted.
 */
export function NewSpriteDialog({ request }: { request: NewSpriteRequest }) {
    const [values, setValues] = useState<NewSpriteValues>(request.initial);
    const [confirming, setConfirming] = useState(false);
    const formId = useId();
    const nameId = useId();
    const sizeId = useId();
    const problems = newSpriteProblems(values);
    const valid = problems.message === null;
    const preset =
        values.width === values.height && NEW_SPRITE_SIZE_PRESETS.includes(values.width)
            ? String(values.width)
            : "";

    const change = (patch: Partial<NewSpriteValues>) =>
        setValues((current) => ({ ...current, ...patch }));
    const create = () => {
        if (!valid) return;
        if (request.discards === null) request.answer(values);
        else setConfirming(true);
    };

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="New sprite"
            // One dialog on screen at a time: the question takes the place of this one.
            className={confirming ? "sprite-dialog--covered" : undefined}
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId} disabled={!valid}>
                        Create
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="sprite-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    create();
                }}
            >
                <label className="ui-field__label" htmlFor={nameId}>
                    Name
                </label>
                <input
                    id={nameId}
                    className="sprite-form__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_NAME_LENGTH}
                    value={values.name}
                    onChange={(event) => change({ name: event.target.value })}
                />
                <span className="ui-field__label" id={sizeId}>
                    Size
                </span>
                <div className="sprite-form__row" role="group" aria-labelledby={sizeId}>
                    <NumberField
                        label="Width"
                        value={values.width}
                        onChange={(width) => change({ width })}
                        unit="px"
                    />
                    <NumberField
                        label="Height"
                        value={values.height}
                        onChange={(height) => change({ height })}
                        unit="px"
                    />
                    <SegmentedControl
                        label="Size presets"
                        value={preset}
                        onChange={(size) => change({ width: Number(size), height: Number(size) })}
                        options={PRESET_OPTIONS}
                    />
                </div>
                <p className="sprite-form__message" role="alert">
                    {problems.message}
                </p>
            </form>
            {confirming && request.discards !== null ? (
                <DiscardDialog
                    name={request.discards}
                    onCancel={() => setConfirming(false)}
                    onDiscard={() => request.answer(values)}
                />
            ) : null}
        </Dialog>
    );
}
