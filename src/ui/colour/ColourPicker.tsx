import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { editorStore, useEditor } from "../../app/state/editor";
import type { ColourSlot } from "../../app/state/editor";
import { formatHex, hsvToRgb, packRgba, parseHex, unpackRgba } from "../../core/color";
import type { Hsv } from "../../core/color";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { cancelNextContextMenu } from "./cancelContextMenu";
import {
    changeHsv,
    keyAlpha,
    keyHue,
    keySaturationValue,
    pickAlpha,
    pickHue,
    pickSaturationValue,
} from "./pickerEdits";
import type { Box, EditorStore } from "./pickerEdits";
import { cssColour } from "./pickerMath";
import "./colourPicker.css";

// The colour panel (DESIGN §5.3): a saturation/value field, a hue strip and an alpha strip,
// a hex field, and H S V or R G B fields chosen with a segmented control. It edits the
// foreground. Held down in the field or a strip, the right button edits the background
// instead: the panel shows the background from the press to the release. Every control
// works from the keyboard (arrow keys on the field and the strips). Keys act on the colour
// the panel shows, so during a right-button drag they edit the background as well. What each
// control does to the colour is in `pickerEdits.ts`.

const store: EditorStore = editorStore;
const editor = () => editorStore.getState();

/** Whether a key comes with a modifier that leaves it to the shortcuts. */
function chorded(event: KeyboardEvent): boolean {
    return event.ctrlKey || event.altKey || event.metaKey;
}

/** The inner box of an element in client pixels: inside its border. */
function innerBox(element: Element): Box {
    const rect = element.getBoundingClientRect();
    return {
        left: rect.left + element.clientLeft,
        top: rect.top + element.clientTop,
        width: element.clientWidth,
        height: element.clientHeight,
    };
}

type Pick = (slot: ColourSlot, x: number, y: number, element: HTMLElement) => void;

/**
 * The pointer of the field and the strips: a left press edits the foreground and a right
 * press the background, through the drag that follows (DESIGN §5.3). `editing` is told which
 * colour the panel shows. The context menu of a right press is cancelled.
 */
function useColourDrag(pick: Pick, editing: (slot: ColourSlot) => void) {
    const drag = useRef<{ pointerId: number; slot: ColourSlot } | null>(null);
    const end = (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        editing("foreground");
    };
    return {
        onPointerDown(event: PointerEvent<HTMLElement>) {
            if (drag.current || (event.button !== 0 && event.button !== 2)) return;
            const slot: ColourSlot = event.button === 2 ? "background" : "foreground";
            if (slot === "background") cancelNextContextMenu();
            // No text selection from the drag. The control takes the focus itself, so a
            // field being typed in commits first; after the release, the focus rule of SPEC
            // §7.8 hands it to the viewport.
            event.preventDefault();
            const element = event.currentTarget;
            element.focus({ preventScroll: true });
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // The pointer is gone already; its release or cancel ends the drag.
            }
            drag.current = { pointerId: event.pointerId, slot };
            editing(slot);
            pick(slot, event.clientX, event.clientY, element);
        },
        onPointerMove(event: PointerEvent<HTMLElement>) {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            // Its button released while another stays down: the drag ends.
            if ((event.buttons & (current.slot === "foreground" ? 1 : 2)) === 0) {
                end(event);
                return;
            }
            pick(current.slot, event.clientX, event.clientY, event.currentTarget);
        },
        onPointerUp: end,
        onPointerCancel: end,
        onLostPointerCapture: end,
        onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    };
}

interface ControlProps {
    /** The colour the panel shows, which the keys edit. */
    slot: ColourSlot;
    hsv: Hsv;
    editing(slot: ColourSlot): void;
}

/** The saturation/value square: saturation from left to right, value from bottom to top. */
function SaturationValueField({ slot, hsv, editing }: ControlProps) {
    const drag = useColourDrag(
        (target, x, y, element) => pickSaturationValue(store, target, innerBox(element), x, y),
        editing,
    );
    const pure = hsvToRgb(hsv.h, 1, 1);
    const saturation = Math.round(hsv.s * 100);
    const value = Math.round(hsv.v * 100);
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label="Saturation and value"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={saturation}
            aria-valuetext={`Saturation ${saturation}%, value ${value}%`}
            className="colour-sv"
            data-colour-control="sv"
            style={{
                background: `linear-gradient(to top, rgb(0 0 0), rgb(0 0 0 / 0)), linear-gradient(to right, rgb(255 255 255), rgb(${pure.r} ${pure.g} ${pure.b}))`,
            }}
            onKeyDown={(event) => {
                if (chorded(event)) return;
                if (keySaturationValue(store, slot, event.key, event.shiftKey)) {
                    event.preventDefault();
                }
            }}
            {...drag}
        >
            <span
                className="colour-sv__handle"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
        </div>
    );
}

interface StripProps {
    kind: "hue" | "alpha";
    label: string;
    /** The colour the panel shows, which the keys edit. */
    slot: ColourSlot;
    value: number;
    max: number;
    valueText: string;
    /** Background of the track. */
    fill: string;
    /** Sets the colour `target` from client `x` over the track's box. */
    pick(editor: EditorStore, target: ColourSlot, box: Box, x: number): void;
    /** Applies a key to the colour `target`; returns whether the strip took it. */
    step(editor: EditorStore, target: ColourSlot, key: string, shift: boolean): boolean;
    editing(slot: ColourSlot): void;
}

/** A 10 px strip in a 24 px hit area (DESIGN §5.3). */
function ColourStrip({
    kind,
    label,
    slot,
    value,
    max,
    valueText,
    fill,
    pick,
    step,
    editing,
}: StripProps) {
    const drag = useColourDrag(
        (target, x, _y, element) =>
            pick(store, target, innerBox(element.firstElementChild ?? element), x),
        editing,
    );
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.round(value)}
            aria-valuetext={valueText}
            className={`colour-strip colour-strip--${kind}`}
            data-colour-control={kind}
            onKeyDown={(event) => {
                if (chorded(event)) return;
                if (step(store, slot, event.key, event.shiftKey)) event.preventDefault();
            }}
            {...drag}
        >
            <span className="colour-strip__track">
                <span className="colour-strip__fill" style={{ background: fill }} />
                <span className="colour-strip__thumb" style={{ left: `${(value / max) * 100}%` }} />
            </span>
        </div>
    );
}

const HUES = [0, 60, 120, 180, 240, 300, 360].map((hue) => {
    const { r, g, b } = hsvToRgb(hue, 1, 1);
    return `rgb(${r} ${g} ${b})`;
});

/**
 * The colour as hex text; what is typed applies on Enter or when the field is left. No length
 * limit: pasted text with white space around the digits is taken (`parseHex` trims it).
 */
function HexField({ colour, onChange }: { colour: number; onChange(colour: number): void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const parsed = parseHex(draft);
        setDraft(null);
        if (parsed !== null && parsed !== colour) onChange(parsed);
    };
    return (
        <input
            className="colour-panel__hex"
            type="text"
            aria-label="Hex"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? formatHex(colour)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                else if (event.key === "Escape") setDraft(null);
            }}
        />
    );
}

type FieldMode = "hsv" | "rgb";
const FIELD_MODES = [
    { value: "hsv", label: "HSV" },
    { value: "rgb", label: "RGB" },
] as const;

/** The colour panel of the dock. */
export function ColourPicker() {
    const [slot, setSlot] = useState<ColourSlot>("foreground");
    const [mode, setMode] = useState<FieldMode>("hsv");
    const colour = useEditor((state) => state[slot]);
    const hsv = useEditor((state) =>
        slot === "foreground" ? state.foregroundHsv : state.backgroundHsv,
    );
    const rgba = unpackRgba(colour);
    const setChannel = (channel: "r" | "g" | "b", value: number) => {
        const current = unpackRgba(editor()[slot]);
        current[channel] = value;
        editor().setColour(slot, packRgba(current.r, current.g, current.b, current.a));
    };
    return (
        <div className="colour-panel" data-colour-panel="" data-editing={slot}>
            <SaturationValueField slot={slot} hsv={hsv} editing={setSlot} />
            <ColourStrip
                kind="hue"
                label="Hue"
                slot={slot}
                value={hsv.h}
                max={360}
                valueText={`${Math.round(hsv.h)}°`}
                fill={`linear-gradient(to right, ${HUES.join(", ")})`}
                pick={pickHue}
                step={keyHue}
                editing={setSlot}
            />
            <ColourStrip
                kind="alpha"
                label="Alpha"
                slot={slot}
                value={rgba.a}
                max={255}
                valueText={`${rgba.a} of 255`}
                fill={`linear-gradient(to right, ${cssColour(colour, 0)}, ${cssColour(colour, 1)})`}
                pick={pickAlpha}
                step={keyAlpha}
                editing={setSlot}
            />
            <div className="colour-panel__row">
                <SegmentedControl
                    label="Colour fields"
                    value={mode}
                    onChange={setMode}
                    options={FIELD_MODES}
                />
                <HexField colour={colour} onChange={(next) => editor().setColour(slot, next)} />
            </div>
            <div className="colour-panel__row colour-panel__fields">
                {mode === "hsv" ? (
                    <>
                        <NumberField
                            label="H"
                            unit="°"
                            min={0}
                            max={360}
                            value={Math.round(hsv.h)}
                            onChange={(h) => changeHsv(store, slot, { h })}
                        />
                        <NumberField
                            label="S"
                            unit="%"
                            min={0}
                            max={100}
                            value={Math.round(hsv.s * 100)}
                            onChange={(s) => changeHsv(store, slot, { s: s / 100 })}
                        />
                        <NumberField
                            label="V"
                            unit="%"
                            min={0}
                            max={100}
                            value={Math.round(hsv.v * 100)}
                            onChange={(v) => changeHsv(store, slot, { v: v / 100 })}
                        />
                    </>
                ) : (
                    <>
                        {(["r", "g", "b"] as const).map((channel) => (
                            <NumberField
                                key={channel}
                                label={channel.toUpperCase()}
                                min={0}
                                max={255}
                                value={rgba[channel]}
                                onChange={(value) => setChannel(channel, value)}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
