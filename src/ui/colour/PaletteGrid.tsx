import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { editorStore, useEditor } from "../../app/state/editor";
import type { ColourSlot } from "../../app/state/editor";
import { activeDocument, useSessions } from "../../app/state/sessions";
import { formatHex } from "../../core/color";
import { cancelNextContextMenu } from "./cancelContextMenu";
import { cssColour } from "./pickerMath";
import "./paletteGrid.css";

// The palette section (DESIGN §5.4) until SE-060 lands: a read-only grid of the active
// document's palette. A left press on a swatch sets the foreground to its colour, a right
// press the background; the swatch of the foreground colour is marked. From the keyboard the
// grid is one tab stop: arrow keys, Home and End move through it, Enter takes the colour into
// the foreground and Shift+Enter into the background (DESIGN §8). It is an ARIA grid, not a
// listbox: a listbox takes typed letters for typeahead, and the keymap would then keep the
// `canvas` letter and digit keys (X, B, 1…) from a focused swatch (SPEC §7.8). The keys the
// grid uses it takes itself, so the keymap leaves them alone.

/** A swatch is 16 px; the grid has a 1 px border. */
const SWATCH = 16;
const BORDER = 1;

/** The palette of the active document as text, so the grid renders only when it changes. */
function paletteText(name: string, colors: readonly number[]): string {
    return JSON.stringify({ name, colors });
}

/** The swatch indices of each row of a grid of `count` swatches, `columns` to a row. */
function rowsOf(count: number, columns: number): number[][] {
    const rows: number[][] = [];
    for (let start = 0; start < count; start += columns) {
        rows.push(Array.from({ length: Math.min(columns, count - start) }, (_, at) => start + at));
    }
    return rows;
}

function pick(slot: ColourSlot, colour: number): void {
    const editor = editorStore.getState();
    if (editor[slot] !== colour) editor.setColour(slot, colour);
}

export function PaletteGrid() {
    const text = useSessions((state) => {
        const palette = activeDocument(state)?.session.doc.palette;
        return palette ? paletteText(palette.name, palette.colors) : null;
    });
    const palette = useMemo(
        () => (text === null ? null : (JSON.parse(text) as { name: string; colors: number[] })),
        [text],
    );
    const foreground = useEditor((state) => state.foreground);
    const container = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [focused, setFocused] = useState(0);

    useLayoutEffect(() => {
        const element = container.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const colors = palette?.colors ?? [];
    const columns = Math.max(
        1,
        Math.min(colors.length, Math.floor((width - 2 * BORDER) / SWATCH) || 1),
    );
    const selected = colors.indexOf(foreground);
    // The tab stop: the swatch last focused, within the palette.
    const stop = Math.min(focused, Math.max(0, colors.length - 1));

    const focusSwatch = (index: number) => {
        setFocused(index);
        container.current
            ?.querySelector<HTMLElement>(`[data-swatch="${index}"]`)
            ?.focus({ preventScroll: false });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const last = colors.length - 1;
        let next: number;
        switch (event.key) {
            case "ArrowRight":
                next = Math.min(last, index + 1);
                break;
            case "ArrowLeft":
                next = Math.max(0, index - 1);
                break;
            case "ArrowDown":
                next = index + columns <= last ? index + columns : index;
                break;
            case "ArrowUp":
                next = index - columns >= 0 ? index - columns : index;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = last;
                break;
            case "Enter": {
                event.preventDefault();
                const colour = colors[index];
                if (colour !== undefined) {
                    pick(event.shiftKey ? "background" : "foreground", colour);
                }
                return;
            }
            default:
                return;
        }
        event.preventDefault();
        focusSwatch(next);
    };

    const onPointerDown = (event: PointerEvent<HTMLElement>, index: number) => {
        const colour = colors[index];
        if (colour === undefined || (event.button !== 0 && event.button !== 2)) return;
        if (event.button === 2) cancelNextContextMenu();
        setFocused(index);
        pick(event.button === 2 ? "background" : "foreground", colour);
    };

    const swatch = (index: number) => {
        const colour = colors[index] ?? 0;
        return (
            <div
                key={index}
                role="gridcell"
                aria-selected={index === selected}
                aria-label={formatHex(colour)}
                title={formatHex(colour)}
                tabIndex={index === stop ? 0 : -1}
                className="palette-grid__swatch"
                data-swatch={index}
                data-colour={formatHex(colour, true)}
                onPointerDown={(event) => onPointerDown(event, index)}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={(event) => onKeyDown(event, index)}
            >
                <span className="palette-grid__fill" style={{ background: cssColour(colour) }} />
            </div>
        );
    };

    return (
        <div ref={container} className="palette-panel" data-palette-panel="">
            {palette && colors.length > 0 ? (
                <div role="grid" aria-label={`Palette ${palette.name}`} className="palette-grid">
                    {rowsOf(colors.length, columns).map((row) => (
                        <div key={row[0]} role="row" className="palette-grid__row">
                            {row.map(swatch)}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
