import { Link2, Link2Off } from "lucide-react";
import { useId, useState } from "react";
import { sizeProblems } from "../../app/sprite/dialogs";
import type { SpriteSizeRequest, SpriteSizeValues } from "../../app/sprite/dialogs";
import type { SpriteSizeMethod } from "../../core/sprite";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { Icon } from "../primitives/Icon";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Toggle } from "../primitives/Toggle";
import "../primitives/field.css";
import "./sprite.css";

const METHOD_OPTIONS: readonly { value: SpriteSizeMethod; label: string }[] = [
    { value: "nearest", label: "Nearest" },
    { value: "area", label: "Area average" },
];

/**
 * The other side for `side` when the aspect ratio `from` / `to` is kept: rounded, and at least
 * 1. Null while `side` is not a whole number of pixels, which leaves the other side alone.
 */
function keptSide(side: number, from: number, to: number): number | null {
    return Number.isInteger(side) && side >= 1 ? Math.max(1, Math.round((side * to) / from)) : null;
}

/**
 * Sprite size dialog (SPEC §7.7, DESIGN §7): width, height, the aspect lock and the
 * resampling (nearest or area average). With the lock on, which it is to begin with, a change
 * of one side sets the other in the ratio of the sprite's size. OK is disabled until both
 * sides are in 1..1024. Nothing changes until OK; the command that opened the dialog
 * resamples the sprite.
 */
export function SpriteSizeDialog({ request }: { request: SpriteSizeRequest }) {
    const [values, setValues] = useState<SpriteSizeValues>(request.initial);
    const [locked, setLocked] = useState(true);
    const formId = useId();
    const sizeId = useId();
    const problems = sizeProblems(values);
    const valid = problems.message === null;
    const { width: originalWidth, height: originalHeight } = request.initial;

    const setWidth = (width: number) =>
        setValues((current) => ({
            ...current,
            width,
            height: (locked && keptSide(width, originalWidth, originalHeight)) || current.height,
        }));
    const setHeight = (height: number) =>
        setValues((current) => ({
            ...current,
            height,
            width: (locked && keptSide(height, originalHeight, originalWidth)) || current.width,
        }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Sprite size"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId} disabled={!valid}>
                        OK
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
                    if (valid) request.answer(values);
                }}
            >
                <span className="ui-field__label" id={sizeId}>
                    Size
                </span>
                <div className="sprite-form__row" role="group" aria-labelledby={sizeId}>
                    <NumberField label="Width" value={values.width} onChange={setWidth} unit="px" />
                    <Toggle label="Keep aspect ratio" pressed={locked} onPressedChange={setLocked}>
                        <Icon icon={locked ? Link2 : Link2Off} />
                    </Toggle>
                    <NumberField
                        label="Height"
                        value={values.height}
                        onChange={setHeight}
                        unit="px"
                    />
                </div>

                <span className="ui-field__label" aria-hidden="true">
                    Resampling
                </span>
                <div className="sprite-form__row">
                    <SegmentedControl
                        label="Resampling"
                        value={values.method}
                        onChange={(method) => setValues((current) => ({ ...current, method }))}
                        options={METHOD_OPTIONS}
                    />
                </div>

                <p className="sprite-form__message" role="alert">
                    {problems.message}
                </p>
            </form>
        </Dialog>
    );
}
