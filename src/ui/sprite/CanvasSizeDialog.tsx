import { useId, useState } from "react";
import { sizeProblems } from "../../app/sprite/dialogs";
import type { CanvasSizeRequest, CanvasSizeValues } from "../../app/sprite/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { PivotGrid } from "./PivotGrid";
import "../primitives/field.css";
import "./sprite.css";

/**
 * Canvas size dialog (SPEC §7.7, DESIGN §7): width, height and the 3×3 anchor grid, which
 * places the old canvas in the new one. The number fields take any number, so that a size
 * outside 1..1024 is shown with its message; OK is disabled until both sides are accepted.
 * Nothing changes until OK; the command that opened the dialog resizes the canvas.
 */
export function CanvasSizeDialog({ request }: { request: CanvasSizeRequest }) {
    const [values, setValues] = useState<CanvasSizeValues>(request.initial);
    const formId = useId();
    const sizeId = useId();
    const problems = sizeProblems(values);
    const valid = problems.message === null;
    const change = (patch: Partial<CanvasSizeValues>) =>
        setValues((current) => ({ ...current, ...patch }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Canvas size"
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
                </div>

                <span className="ui-field__label" aria-hidden="true">
                    Anchor
                </span>
                <div className="sprite-form__row">
                    <PivotGrid
                        label="Anchor"
                        value={values.anchor}
                        onChange={(anchor) => change({ anchor })}
                    />
                </div>

                <p className="sprite-form__message" role="alert">
                    {problems.message}
                </p>
            </form>
        </Dialog>
    );
}
