import { useId, useState } from "react";
import { MAX_NAME_LENGTH } from "../../core/model";
import type { SpritePropertiesRequest, SpritePropertiesValues } from "../../app/sprite/dialogs";
import { isSpriteName, MAX_GRID_OFFSET, MAX_GRID_SIDE, MIN_GRID_SIDE } from "../../core/sprite";
import type { GridGeometry, Pivot } from "../../core/sprite";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { PivotGrid } from "./PivotGrid";
import "../primitives/field.css";
import "./sprite.css";

/**
 * The pivot is normalized (SPEC §5.1): 0..1. Arrow keys step by hundredths; a typed value
 * keeps four decimals, so a pivot on a pixel boundary of a 1024 px sprite can be entered to
 * within about 0.05 px (SE-034).
 */
const PIVOT_RANGE = { min: 0, max: 1, step: 0.01, precision: 4 };
const GRID_SIDE_RANGE = { min: MIN_GRID_SIDE, max: MAX_GRID_SIDE };
const GRID_OFFSET_RANGE = { min: -MAX_GRID_OFFSET, max: MAX_GRID_OFFSET };

/**
 * Sprite properties dialog (SPEC §7.7, DESIGN §7): name, pivot with its 3×3 presets and
 * numeric X/Y, grid size and offset. Nothing changes until OK; the command that opened the
 * dialog applies the values.
 */
export function SpritePropertiesDialog({ request }: { request: SpritePropertiesRequest }) {
    const [values, setValues] = useState<SpritePropertiesValues>(request.initial);
    const formId = useId();
    const nameId = useId();
    const pivotId = useId();
    const gridSizeId = useId();
    const gridOffsetId = useId();
    const valid = isSpriteName(values.name);

    const setPivot = (patch: Partial<Pivot>) =>
        setValues((current) => ({ ...current, pivot: { ...current.pivot, ...patch } }));
    const setGrid = (patch: Partial<GridGeometry>) =>
        setValues((current) => ({ ...current, grid: { ...current.grid, ...patch } }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Sprite properties"
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
                    onChange={(event) =>
                        setValues((current) => ({ ...current, name: event.target.value }))
                    }
                />

                <span className="ui-field__label" id={pivotId}>
                    Pivot
                </span>
                <div className="sprite-form__row" role="group" aria-labelledby={pivotId}>
                    <PivotGrid label="Pivot presets" value={values.pivot} onChange={setPivot} />
                    <NumberField
                        label="X"
                        value={values.pivot.x}
                        onChange={(x) => setPivot({ x })}
                        {...PIVOT_RANGE}
                    />
                    <NumberField
                        label="Y"
                        value={values.pivot.y}
                        onChange={(y) => setPivot({ y })}
                        {...PIVOT_RANGE}
                    />
                </div>

                <span className="ui-field__label" id={gridSizeId}>
                    Grid size
                </span>
                <div className="sprite-form__row" role="group" aria-labelledby={gridSizeId}>
                    <NumberField
                        label="Width"
                        value={values.grid.width}
                        onChange={(width) => setGrid({ width })}
                        unit="px"
                        {...GRID_SIDE_RANGE}
                    />
                    <NumberField
                        label="Height"
                        value={values.grid.height}
                        onChange={(height) => setGrid({ height })}
                        unit="px"
                        {...GRID_SIDE_RANGE}
                    />
                </div>

                <span className="ui-field__label" id={gridOffsetId}>
                    Grid offset
                </span>
                <div className="sprite-form__row" role="group" aria-labelledby={gridOffsetId}>
                    <NumberField
                        label="X"
                        value={values.grid.offsetX}
                        onChange={(offsetX) => setGrid({ offsetX })}
                        unit="px"
                        {...GRID_OFFSET_RANGE}
                    />
                    <NumberField
                        label="Y"
                        value={values.grid.offsetY}
                        onChange={(offsetY) => setGrid({ offsetY })}
                        unit="px"
                        {...GRID_OFFSET_RANGE}
                    />
                </div>

                <p className="sprite-form__message" role="alert">
                    {valid ? null : "Enter a name."}
                </p>
            </form>
        </Dialog>
    );
}
