import type { PixelBuffer } from "../../core/pixels";
import { SegmentedControl } from "../primitives/SegmentedControl";
import type { SegmentedOption } from "../primitives/SegmentedControl";
import { PixelCanvas } from "./PixelCanvas";

/** The frames the pane draws at most; the summary line counts them all. */
export const MAX_SHOWN_FRAMES = 64;

export type ResultZoom = "1" | "2" | "4" | "8";

const ZOOMS: readonly SegmentedOption<ResultZoom>[] = [
    { value: "1", label: "1×" },
    { value: "2", label: "2×" },
    { value: "4", label: "4×" },
    { value: "8", label: "8×" },
];

/** The zoom the pane opens with for frames of this size: the largest that shows 128 px or less. */
export function defaultZoom(width: number, height: number): ResultZoom {
    const side = Math.max(width, height);
    for (const zoom of ["8", "4", "2"] as const) {
        if (side * Number(zoom) <= 128) return zoom;
    }
    return "1";
}

/**
 * The result pane of Import PNG (DESIGN §7): every frame at the target size over the
 * checkerboard, at a zoom of 1× to 8×; the import's error in its place when it fails.
 */
export function ResultPane({
    frames,
    error,
    computing,
    zoom,
    onZoom,
}: {
    frames: readonly PixelBuffer[] | null;
    error: string | null;
    computing: boolean;
    zoom: ResultZoom;
    onZoom(zoom: ResultZoom): void;
}) {
    const scale = Number(zoom);
    return (
        <div className="import-result" data-import-result="" aria-busy={computing}>
            <div className="import-result__bar">
                <span className="ui-field__label" aria-hidden="true">
                    Zoom
                </span>
                <SegmentedControl label="Zoom" value={zoom} onChange={onZoom} options={ZOOMS} />
            </div>
            {error !== null ? (
                <p className="import-dialog__error" role="alert" data-import-error="">
                    {error}
                </p>
            ) : (
                <div className="import-result__frames" data-import-frames="">
                    {(frames ?? []).slice(0, MAX_SHOWN_FRAMES).map((frame, index) => (
                        <PixelCanvas
                            // The frames of one answer keep their order.
                            key={index}
                            pixels={frame}
                            className="import-result__frame"
                            style={{ width: frame.width * scale, height: frame.height * scale }}
                            data-import-frame={index}
                        />
                    ))}
                    {frames && frames.length > MAX_SHOWN_FRAMES ? (
                        <span className="import-result__more">
                            and {frames.length - MAX_SHOWN_FRAMES} more
                        </span>
                    ) : null}
                </div>
            )}
        </div>
    );
}
