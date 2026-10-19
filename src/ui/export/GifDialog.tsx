import { useId, useState } from "react";
import type { GifRequest } from "../../app/export/gifDialog";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { Select } from "../primitives/Select";
import "./gif.css";

/** "loops forever", "plays once", "plays 3 times". */
function playsText(plays: number): string {
    if (plays === 0) return "loops forever";
    return plays === 1 ? "plays once" : `plays ${plays} times`;
}

/**
 * Export GIF (SPEC §9.6, DESIGN §7; SE-063): the frames (every frame, or one tag) and the
 * scale, 1–8× with nearest-neighbour sampling, and the result line naming the file, its size,
 * its frames and how it plays.
 */
export function GifDialog({ request }: { request: GifRequest }) {
    const [choice, setChoice] = useState(request.initialChoice);
    const [scale, setScale] = useState(request.initialScale);
    const formId = useId();
    const resultId = useId();
    const chosen = request.choices.find((entry) => entry.value === choice) ?? request.choices[0]!;
    const frames = chosen.frameCount === 1 ? "1 frame" : `${chosen.frameCount} frames`;
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Export GIF"
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
                className="gif-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    request.answer({ choice: chosen.value, scale });
                }}
            >
                <Select
                    label="Frames"
                    value={chosen.value}
                    onChange={setChoice}
                    options={request.choices.map(({ value, label }) => ({ value, label }))}
                />
                <NumberField
                    label="Scale"
                    value={scale}
                    onChange={setScale}
                    unit="×"
                    min={request.minScale}
                    max={request.maxScale}
                    describedBy={resultId}
                />
                <span className="gif-form__result" id={resultId} data-gif-result="">
                    {request.fileName(chosen.value, scale)} · {request.width * scale} ×{" "}
                    {request.height * scale} px · {frames} · {playsText(chosen.plays)}
                </span>
            </form>
        </Dialog>
    );
}
