import { useId, useState } from "react";
import type { FramePngRequest } from "../../app/export/dialogs";
import { framePngName, MIN_FRAME_PNG_SCALE } from "../../core/imageExports";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import "./export.css";

/**
 * Export frame PNG (SPEC §9.6; SE-052): the scale of the active frame's PNG, 1–16× with
 * nearest-neighbour sampling (less for a document too large for 16×), and the file it makes.
 */
export function FramePngDialog({ request }: { request: FramePngRequest }) {
    const [scale, setScale] = useState(request.initialScale);
    const formId = useId();
    const resultId = useId();
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Export frame PNG"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="primary" type="submit" form={formId}>
                        Export
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="frame-png-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    request.answer(scale);
                }}
            >
                <NumberField
                    label="Scale"
                    value={scale}
                    onChange={setScale}
                    unit="×"
                    min={MIN_FRAME_PNG_SCALE}
                    max={request.maxScale}
                    describedBy={resultId}
                />
                <span className="frame-png-form__result" id={resultId} data-frame-png-result="">
                    {framePngName(request.name, request.frameIndex, scale)} ·{" "}
                    {request.width * scale} × {request.height * scale} px
                </span>
            </form>
        </Dialog>
    );
}
