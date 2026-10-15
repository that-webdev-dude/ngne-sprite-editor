import type { StoreApi } from "zustand/vanilla";
import type { ColourSlot, EditorState } from "../../app/state/editor";
import type { Hsv } from "../../core/color";
import { alphaAfterKey, fractionAlong, hueAfterKey, svAfterKey } from "./pickerMath";

// What the controls of the colour panel (DESIGN §5.3) do to a colour of the editor store, for
// a pointer position or a key: `ColourPicker.tsx` calls these with the app's store, the unit
// tests with stores of their own. Free of the DOM and of React.
//
// The panel edits HSV as the store keeps it (`EditorState.foregroundHsv`), so a drag to the
// bottom or the left edge of the field, where the colour turns black or grey, keeps the hue
// and brings it back when the drag returns. Every edit names the colour it changes: the one
// the panel shows, which is the background while the right button is held.

export type EditorStore = Pick<StoreApi<EditorState>, "getState">;

/** A control's box in client pixels, inside its border. */
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The HSV the store keeps for a colour. */
export function storedHsv(editor: EditorStore, slot: ColourSlot): Hsv {
    const state = editor.getState();
    return slot === "foreground" ? state.foregroundHsv : state.backgroundHsv;
}

/** Changes part of a colour's HSV, and its alpha, keeping the rest as stored. */
export function changeHsv(
    editor: EditorStore,
    slot: ColourSlot,
    change: Partial<Hsv>,
    alpha = editor.getState()[slot] & 0xff,
): void {
    editor.getState().setColourHsv(slot, { ...storedHsv(editor, slot), ...change }, alpha);
}

/**
 * The saturation/value field at client position `x, y`: saturation from left to right, value
 * from bottom to top, clamped to the field; the hue as stored.
 */
export function pickSaturationValue(
    editor: EditorStore,
    slot: ColourSlot,
    box: Box,
    x: number,
    y: number,
): void {
    changeHsv(editor, slot, {
        s: fractionAlong(x, box.left, box.width),
        v: 1 - fractionAlong(y, box.top, box.height),
    });
}

/** The hue strip at client `x`: 0° at its left end, 360° at its right end. */
export function pickHue(editor: EditorStore, slot: ColourSlot, box: Box, x: number): void {
    changeHsv(editor, slot, { h: fractionAlong(x, box.left, box.width) * 360 });
}

/** The alpha strip at client `x`: 0 at its left end, 255 at its right end. */
export function pickAlpha(editor: EditorStore, slot: ColourSlot, box: Box, x: number): void {
    changeHsv(editor, slot, {}, Math.round(fractionAlong(x, box.left, box.width) * 255));
}

/** A key on the saturation/value field; returns whether the field took it. */
export function keySaturationValue(
    editor: EditorStore,
    slot: ColourSlot,
    key: string,
    shift: boolean,
): boolean {
    const next = svAfterKey(storedHsv(editor, slot), key, shift);
    if (!next) return false;
    changeHsv(editor, slot, next);
    return true;
}

/** A key on the hue strip; returns whether the strip took it. */
export function keyHue(
    editor: EditorStore,
    slot: ColourSlot,
    key: string,
    shift: boolean,
): boolean {
    const next = hueAfterKey(storedHsv(editor, slot).h, key, shift);
    if (next === null) return false;
    changeHsv(editor, slot, { h: next });
    return true;
}

/** A key on the alpha strip; returns whether the strip took it. */
export function keyAlpha(
    editor: EditorStore,
    slot: ColourSlot,
    key: string,
    shift: boolean,
): boolean {
    const next = alphaAfterKey(editor.getState()[slot] & 0xff, key, shift);
    if (next === null) return false;
    changeHsv(editor, slot, {}, next);
    return true;
}
