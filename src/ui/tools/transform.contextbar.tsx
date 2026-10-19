import { useEffect, useRef, useSyncExternalStore } from "react";
import { MAX_TRANSFORM_SIDE } from "../../core/floating";
import type { FreeTransform } from "../../core/floating";
import { FLOATING_COMMANDS } from "../../app/selection/floating.commands";
import { floatingState } from "../../app/selection/floatingState";
import { TRANSFORM_COMMANDS } from "../../app/selection/transform/transform.commands";
import { draftTransform } from "../../app/selection/transform/transformDraft";
import { activeDocument, sessionsStore } from "../../app/state/sessions";
import { runCommand } from "../commands/runCommand";
import { Button } from "../primitives/Button";
import { NumberField } from "../primitives/NumberField";
import type { ContextBarContent } from "./contextBarRegistry";
import "./transformFields.css";

// The transform fields of a floating selection (DESIGN §5.2, SE-033): X, Y, W and H of its
// box in document pixels and its angle in degrees, with Apply and Cancel, in the context bar
// while a selection floats in the active document. A value typed (Enter or leaving the field)
// or stepped is set through Set Transform (`transform.commands.ts`), so it gives exactly what
// the same drag of a handle gives; while a drag lasts the fields follow it.

/** How far from the canvas the box's corner can be typed, in document pixels. */
const POSITION_LIMIT = 16384;

type Key = keyof FreeTransform;

const FIELDS: readonly { key: Key; label: string; unit: string }[] = [
    { key: "x", label: "X", unit: "px" },
    { key: "y", label: "Y", unit: "px" },
    { key: "width", label: "W", unit: "px" },
    { key: "height", label: "H", unit: "px" },
    { key: "angle", label: "Angle", unit: "°" },
];

/** The float's transform while a selection floats in the active document, or null. */
function shownTransform(): FreeTransform | null {
    const { session, transform, selects } = floatingState.shown.getState();
    if (!transform || !selects) return null;
    return activeDocument(sessionsStore.getState())?.session === session ? transform : null;
}

const subscribe = (listener: () => void) => {
    const stopFloat = floatingState.shown.subscribe(listener);
    const stopSessions = sessionsStore.subscribe(listener);
    return () => {
        stopFloat();
        stopSessions();
    };
};

function rangeOf(key: Key): { min: number; max: number } {
    if (key === "angle") return { min: -180, max: 180 };
    if (key === "x" || key === "y") return { min: -POSITION_LIMIT, max: POSITION_LIMIT };
    const source = floatingState.float?.source.pixels;
    return {
        min: 1,
        max: Math.max(MAX_TRANSFORM_SIDE, source?.width ?? 0, source?.height ?? 0),
    };
}

function TransformFields() {
    const transform = useSyncExternalStore(subscribe, () => floatingState.shown.getState());
    const root = useRef<HTMLSpanElement>(null);
    // A press anywhere outside a focused field sets what the field holds before anything else
    // acts on the press: before a press on the canvas applies the float or drags it (as the
    // timeline's fields do, SE-022 review).
    useEffect(() => {
        const onPress = (event: PointerEvent) => {
            const focused = window.document.activeElement;
            if (!(focused instanceof HTMLInputElement) || !root.current?.contains(focused)) return;
            if (event.target instanceof Node && focused.contains(event.target)) return;
            focused.blur();
        };
        window.addEventListener("pointerdown", onPress, true);
        return () => window.removeEventListener("pointerdown", onPress, true);
    }, []);
    const shown = transform.transform;
    if (!shown) return null;
    const set = (key: Key, value: number) => {
        const now = shownTransform();
        if (!now) return;
        draftTransform({ ...now, [key]: value });
        runCommand(TRANSFORM_COMMANDS.set);
    };
    return (
        <span ref={root} className="transform-fields" role="group" aria-label="Transform">
            {FIELDS.map(({ key, label, unit }) => (
                <span key={key} data-transform-field={key}>
                    <NumberField
                        label={label}
                        unit={unit}
                        value={shown[key]}
                        onChange={(value) => set(key, value)}
                        {...rangeOf(key)}
                    />
                </span>
            ))}
            <Button variant="primary" onClick={() => runCommand(FLOATING_COMMANDS.apply)}>
                Apply
            </Button>
            <Button onClick={() => runCommand(FLOATING_COMMANDS.cancel)}>Cancel</Button>
        </span>
    );
}

export const contextBarContent: ContextBarContent = {
    id: "transform",
    order: 10,
    shown: () => shownTransform() !== null,
    subscribe,
    Body: TransformFields,
};
