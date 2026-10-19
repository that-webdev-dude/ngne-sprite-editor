import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { mountPreview } from "../../app/preview/mountPreview";
import {
    ALL_FRAMES,
    PREVIEW_BACKGROUNDS,
    PREVIEW_SPEEDS,
    backgroundColour,
    nextBackground,
    playedAnimation,
    previewState,
} from "../../app/preview/previewState";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { Select } from "../primitives/Select";
import "./preview.css";

const SPEED_OPTIONS = PREVIEW_SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }));

function hex(colour: number): string {
    return `#${colour.toString(16).padStart(6, "0")}`;
}

/**
 * The preview panel (DESIGN §5.5, SE-054): the NGNE game playing the export's atlas, centred
 * and scaled by a whole number of device pixels; under it play/pause, the animation, the speed
 * and the background chip. The game lives while the panel is mounted: the dock mounts a
 * section's body only while it is expanded, so collapsing the panel disposes the game.
 */
export function PreviewPanel() {
    const stage = useRef<HTMLDivElement>(null);
    const host = useRef<HTMLDivElement>(null);
    // Each value on its own: the panel renders again only when one it shows changes (not, for
    // instance, when a pack starts or ends).
    const status = useStore(previewState, (state) => state.status);
    const playing = useStore(previewState, (state) => state.playing);
    const speed = useStore(previewState, (state) => state.speed);
    const background = useStore(previewState, (state) => state.background);
    const animations = useStore(previewState, (state) => state.animations);
    const chosen = useStore(previewState, (state) => state.chosen);
    const diagnostics = useStore(previewState, (state) => state.diagnostics);

    useEffect(() => {
        if (!stage.current || !host.current) return;
        const mounted = mountPreview(stage.current, host.current);
        return () => mounted.dispose();
    }, []);

    const played = playedAnimation({ chosen, animations });
    const animationOptions = [
        ...animations.map((id) => ({ value: id, label: id })),
        { value: ALL_FRAMES, label: "All frames" },
    ];
    const backgroundLabel =
        PREVIEW_BACKGROUNDS.find((entry) => entry.id === background)?.label ?? background;
    const noDocument = status.kind === "none";
    const shown = status.kind === "ready" || status.kind === "packing";

    return (
        <div className="preview-panel">
            <div
                ref={stage}
                className="preview-panel__stage"
                style={{ background: hex(backgroundColour(background)) }}
            >
                <div
                    ref={host}
                    className={shown ? "preview-panel__game" : "preview-panel__game is-hidden"}
                    aria-hidden="true"
                    data-preview-canvas=""
                />
                {status.kind === "too-large" ? (
                    <p className="preview-panel__message" role="status">
                        <strong>Too large to preview</strong>
                        <span>{status.message}</span>
                    </p>
                ) : null}
                {status.kind === "error" ? (
                    <p className="preview-panel__message" role="status">
                        <strong>Cannot preview</strong>
                        <span>{status.message}</span>
                    </p>
                ) : null}
            </div>
            <div className="preview-panel__controls">
                <IconButton
                    label={playing ? "Pause preview" : "Play preview"}
                    disabled={noDocument}
                    onClick={() => previewState.setState({ playing: !playing })}
                >
                    <Icon icon={playing ? Pause : Play} />
                </IconButton>
                <Select
                    label="Preview animation"
                    hideLabel
                    className="preview-panel__animation"
                    value={played}
                    options={animationOptions}
                    disabled={noDocument}
                    onChange={(chosen) => previewState.setState({ chosen })}
                />
                <Select
                    label="Preview speed"
                    hideLabel
                    className="preview-panel__speed"
                    value={String(speed)}
                    options={SPEED_OPTIONS}
                    onChange={(value) => previewState.setState({ speed: Number(value) })}
                />
                <IconButton
                    label={`Preview background: ${backgroundLabel}`}
                    className="preview-panel__background"
                    onClick={() =>
                        previewState.setState({ background: nextBackground(background) })
                    }
                >
                    <span
                        className="preview-panel__swatch"
                        style={{ background: hex(backgroundColour(background)) }}
                    />
                </IconButton>
            </div>
            {diagnostics.length > 0 ? (
                <ul className="preview-panel__diagnostics" aria-label="Preview diagnostics">
                    {diagnostics.map((message, index) => (
                        <li key={index}>{message}</li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
