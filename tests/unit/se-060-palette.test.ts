import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { buildPalette } from "../../src/core/import";
import { assertInvariants, createDocument } from "../../src/core/model";
import type { DocSession, Palette, PixelBuffer, SpriteDoc } from "../../src/core/model";
import {
    MAX_PALETTE_COLORS,
    PRESET_PALETTES,
    addColourCommand,
    editColourCommand,
    loadPresetCommand,
    moveColourCommand,
    movedColours,
    paletteFromSprite,
    paletteFromSpriteCommand,
    removeColourCommand,
    setPaletteCommand,
} from "../../src/core/palettes";
import { deserialize, serialize } from "../../src/core/project";
import { FRAME, addFrame, layerId, setCel, sprite } from "./se-010-support";
import type { Rgba } from "./se-010-support";

// SE-060: the palette commands of `core/palettes` — add, remove, move and edit a colour, load a
// preset, the palette from the sprite — each one undo step on the document's palette, none
// recorded when it would change nothing, at most 256 colours; and the palette as a project
// file keeps it.

function session(colors: number[] = [0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff]) {
    const created = createDocument({ name: "palette", width: 4, height: 4 });
    created.doc.palette = { name: "Test", colors: [...colors] };
    return created;
}

function copy(palette: Palette): Palette {
    return { name: palette.name, colors: [...palette.colors] };
}

/** Executes `command` on a history of `target` and checks one undo step and its redo. */
function expectOneStep(target: DocSession, command: Command | null, after: Palette): void {
    expect(command).not.toBeNull();
    if (!command) return;
    const history = new History(target);
    const before = copy(target.doc.palette);
    history.execute(command);
    expect(target.doc.palette).toEqual(after);
    expect(history.undoCount).toBe(1);
    expect(history.undo()).toBe(true);
    expect(target.doc.palette).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(target.doc.palette).toEqual(after);
    assertInvariants(target);
}

describe("setPaletteCommand", () => {
    it("makes no command for the palette the document has", () => {
        const target = session();
        expect(setPaletteCommand(target, copy(target.doc.palette), "Same")).toBeNull();
        const renamed = { ...copy(target.doc.palette), name: "Other" };
        expectOneStep(target, setPaletteCommand(target, renamed, "Rename"), renamed);
    });

    it("touches no frame, no layer and no structure, and keeps its label", () => {
        const target = session();
        const command = setPaletteCommand(target, { name: "x", colors: [1] }, "Label");
        expect(command?.touched).toEqual({ frameIds: [], layerIds: [], structure: false });
        expect(command?.label).toBe("Label");
        expect(command?.bytes).toBeGreaterThan(0);
    });

    it("refuses more than 256 colours and values that are not colours", () => {
        const target = session();
        const full = Array.from({ length: MAX_PALETTE_COLORS }, (_, index) => index);
        expect(MAX_PALETTE_COLORS).toBe(256);
        expect(setPaletteCommand(target, { name: "full", colors: full }, "Full")).not.toBeNull();
        for (const colors of [[...full, 256], [-1], [0.5], [0x1_0000_0000], [Number.NaN]]) {
            expect(() => setPaletteCommand(target, { name: "bad", colors }, "Bad")).toThrow(
                RangeError,
            );
        }
        expect(target.doc.palette.name).toBe("Test");
    });

    it("puts back its own copies, whatever happened to the palette objects meanwhile", () => {
        const target = session();
        const next = { name: "Next", colors: [0x11223344] };
        const history = new History(target);
        const command = setPaletteCommand(target, next, "Set");
        if (!command) throw new Error("no command");
        history.execute(command);
        next.colors.push(5);
        target.doc.palette.colors.push(6);
        history.undo();
        expect(target.doc.palette).toEqual({
            name: "Test",
            colors: [0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff],
        });
        target.doc.palette.colors.pop();
        history.redo();
        expect(target.doc.palette).toEqual({ name: "Next", colors: [0x11223344] });
    });
});

describe("one colour", () => {
    it("add appends a colour the palette lacks, and only while it has fewer than 256", () => {
        const target = session();
        expectOneStep(target, addColourCommand(target, 0x12345680), {
            name: "Test",
            colors: [0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff, 0x12345680],
        });
        // It holds the colour already.
        expect(addColourCommand(target, 0xff0000ff)).toBeNull();
        const full = session(Array.from({ length: 256 }, (_, index) => index));
        expect(addColourCommand(full, 0xffffffff)).toBeNull();
        expect(() => addColourCommand(target, -1)).toThrow(RangeError);
        expect(addColourCommand(target, 0xfefefeff, "Add Current Colour")?.label).toBe(
            "Add Current Colour",
        );
    });

    it("remove takes out the colour at an index; nothing outside the palette", () => {
        const target = session();
        expectOneStep(target, removeColourCommand(target, 1), {
            name: "Test",
            colors: [0x000000ff, 0x00ff00ff, 0x0000ffff],
        });
        for (const index of [-1, 4, 1.5, Number.NaN]) {
            expect(removeColourCommand(target, index), String(index)).toBeNull();
        }
        // The last colour can go: a palette may be empty.
        const single = session([0x102030ff]);
        expectOneStep(single, removeColourCommand(single, 0), { name: "Test", colors: [] });
    });

    it("move puts the colour at the new index and keeps the order of the others", () => {
        expect(movedColours([1, 2, 3, 4, 5], 1, 3)).toEqual([1, 3, 4, 2, 5]);
        expect(movedColours([1, 2, 3, 4, 5], 4, 0)).toEqual([5, 1, 2, 3, 4]);
        const target = session();
        expectOneStep(target, moveColourCommand(target, 0, 3), {
            name: "Test",
            colors: [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0x000000ff],
        });
        // Back from where the step above left it.
        expectOneStep(target, moveColourCommand(target, 2, 1), {
            name: "Test",
            colors: [0xff0000ff, 0x0000ffff, 0x00ff00ff, 0x000000ff],
        });
        for (const [from, to] of [
            [1, 1],
            [-1, 0],
            [0, 4],
            [4, 0],
            [0.5, 1],
        ]) {
            expect(moveColourCommand(target, from, to), `${from} → ${to}`).toBeNull();
        }
        // Two equal colours exchanged change nothing.
        const twins = session([0x112233ff, 0x112233ff, 0x445566ff]);
        expect(moveColourCommand(twins, 0, 1)).toBeNull();
    });

    it("edit replaces the colour at an index; nothing when it is that colour already", () => {
        const target = session();
        expectOneStep(target, editColourCommand(target, 2, 0x80808040), {
            name: "Test",
            colors: [0x000000ff, 0xff0000ff, 0x80808040, 0x0000ffff],
        });
        expect(editColourCommand(target, 1, 0xff0000ff)).toBeNull();
        expect(editColourCommand(target, 4, 0x123456ff)).toBeNull();
        expect(() => editColourCommand(target, 0, 0x1_0000_0000)).toThrow(RangeError);
    });
});

describe("presets", () => {
    it("loading a preset replaces the palette, name and colours, in one undo step", () => {
        for (const preset of PRESET_PALETTES) {
            const target = session();
            const command = loadPresetCommand(target, preset);
            expect(command?.label).toBe(`Load ${preset.name} Palette`);
            expectOneStep(target, command, { name: preset.name, colors: [...preset.colors] });
            // The palette is that preset now.
            expect(loadPresetCommand(target, preset)).toBeNull();
            // The preset's own list is not the document's.
            target.doc.palette.colors.push(1);
            expect(target.doc.palette.colors.length).toBe(preset.colors.length + 1);
        }
    });
});

/** A 4×2 image of the given colours, row-major. */
function pixelsOf(colors: readonly number[]): Rgba[] {
    return colors.map((colour) => [
        colour >>> 24,
        (colour >>> 16) & 0xff,
        (colour >>> 8) & 0xff,
        colour & 0xff,
    ]);
}

function compositesOf(doc: SpriteDoc): PixelBuffer[] {
    return doc.frames.map((frame) => compositeFrame(doc, frame.id));
}

/** A session on a document made by `sprite` (se-010-support). */
function sessionOf(doc: SpriteDoc): DocSession {
    return {
        doc,
        selection: null,
        activeLayerId: doc.layers[0].id,
        activeFrameId: doc.frames[0].id,
    };
}

describe("palette from sprite", () => {
    it("palette from sprite on an image with 5 colours returns exactly those 5", () => {
        const colours = [0x000000ff, 0xffffffff, 0xff0000ff, 0x2040c0ff, 0x80ff20ff];
        // Eight pixels: the five colours, two repeated, one transparent.
        const doc = sprite(4, 2, [
            {
                pixels: pixelsOf([
                    colours[0],
                    colours[1],
                    colours[2],
                    colours[3],
                    colours[4],
                    colours[2],
                    colours[0],
                    0x00000000,
                ]),
            },
        ]);
        const palette = paletteFromSprite(compositesOf(doc));
        expect(palette).toHaveLength(5);
        expect([...palette].sort((a, b) => a - b)).toEqual([...colours].sort((a, b) => a - b));
        // Dark to light (`buildPalette`): black first, white last.
        expect(palette[0]).toBe(0x000000ff);
        expect(palette[4]).toBe(0xffffffff);

        const target = sessionOf(doc);
        expectOneStep(target, paletteFromSpriteCommand(target, compositesOf(doc)), {
            name: doc.name,
            colors: palette,
        });
        expect(paletteFromSpriteCommand(target, compositesOf(doc))).toBeNull();
    });

    it("reads what every frame shows: hidden layers left out, colours by R, G and B", () => {
        const doc = sprite(2, 1, [
            { pixels: pixelsOf([0x112233ff, 0x00000000]) },
            { pixels: pixelsOf([0xaabbccff, 0xaabbccff]), visible: false },
        ]);
        addFrame(doc, "frame-1");
        // A colour that is not opaque counts as its opaque colour.
        setCel(doc, layerId(0), "frame-1", pixelsOf([0x44556680, 0x112233ff]));
        expect(paletteFromSprite(compositesOf(doc))).toEqual([0x112233ff, 0x445566ff]);
        expect(compositesOf(doc)).toHaveLength(2);
        expect(doc.frames.map((frame) => frame.id)).toEqual([FRAME, "frame-1"]);
    });

    it("reduces more than 256 colours to 256 with buildPalette, reading one frame at a time", () => {
        const width = 32;
        const colors = Array.from(
            { length: width * 16 },
            (_, index) => (((index * 2654435761) & 0xffffff00) | 0xff) >>> 0,
        );
        const doc = sprite(width, 16, [{ pixels: pixelsOf(colors) }]);
        expect(new Set(colors).size).toBeGreaterThan(256);
        let read = 0;
        function* lazily(): Generator<PixelBuffer> {
            for (const buffer of compositesOf(doc)) {
                read++;
                yield buffer;
            }
        }
        const palette = paletteFromSprite(lazily());
        expect(read).toBe(1);
        expect(palette).toHaveLength(256);
        expect(palette).toEqual(buildPalette(compositesOf(doc), 256));
    });

    it("gives an empty palette for a sprite with no visible pixel", () => {
        const doc = sprite(2, 2, [{}]);
        const target = sessionOf(doc);
        expectOneStep(target, paletteFromSpriteCommand(target, compositesOf(doc)), {
            name: doc.name,
            colors: [],
        });
    });
});

describe("do and undo", () => {
    type Step =
        | { kind: "add"; colour: number }
        | { kind: "remove"; index: number }
        | { kind: "move"; from: number; to: number }
        | { kind: "edit"; index: number; colour: number }
        | { kind: "preset"; index: number };

    const colour = fc.constantFrom(0x000000ff, 0xff0000ff, 0x12345680, 0xffffffff, 0x00000000);
    const index = fc.integer({ min: -1, max: 40 });
    const step: fc.Arbitrary<Step> = fc.oneof(
        fc.record({ kind: fc.constant("add" as const), colour }),
        fc.record({ kind: fc.constant("remove" as const), index }),
        fc.record({ kind: fc.constant("move" as const), from: index, to: index }),
        fc.record({ kind: fc.constant("edit" as const), index, colour }),
        fc.record({
            kind: fc.constant("preset" as const),
            index: fc.integer({ min: 0, max: PRESET_PALETTES.length - 1 }),
        }),
    );

    function commandOf(target: DocSession, next: Step): Command | null {
        switch (next.kind) {
            case "add":
                return addColourCommand(target, next.colour);
            case "remove":
                return removeColourCommand(target, next.index);
            case "move":
                return moveColourCommand(target, next.from, next.to);
            case "edit":
                return editColourCommand(target, next.index, next.colour);
            case "preset":
                return loadPresetCommand(target, PRESET_PALETTES[next.index]);
        }
    }

    it("every step that changes the palette is one entry; undoing all of them restores it", () => {
        fc.assert(
            fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
                const target = session();
                const history = new History(target);
                const states = [copy(target.doc.palette)];
                for (const next of steps) {
                    const before = copy(target.doc.palette);
                    const command = commandOf(target, next);
                    if (!command) continue;
                    history.execute(command);
                    // A recorded step changed the palette.
                    expect(target.doc.palette).not.toEqual(before);
                    expect(target.doc.palette.colors.length).toBeLessThanOrEqual(256);
                    states.push(copy(target.doc.palette));
                }
                expect(history.undoCount).toBe(states.length - 1);
                for (let at = states.length - 2; at >= 0; at--) {
                    history.undo();
                    expect(target.doc.palette).toEqual(states[at]);
                }
                for (let at = 1; at < states.length; at++) {
                    history.redo();
                    expect(target.doc.palette).toEqual(states[at]);
                }
            }),
        );
    });
});

describe("project file", () => {
    it("keeps the palette the commands made through save and open", async () => {
        const target = session();
        const history = new History(target);
        for (const make of [
            () => loadPresetCommand(target, PRESET_PALETTES[2]),
            () => addColourCommand(target, 0x12345680),
            () => moveColourCommand(target, 0, 5),
            () => editColourCommand(target, 1, 0xabcdef01),
            () => removeColourCommand(target, 2),
        ]) {
            const command = make();
            if (command) history.execute(command);
        }
        expect(history.undoCount).toBe(5);
        const saved = copy(target.doc.palette);
        const read = await deserialize(serialize(target.doc, new Map()));
        expect(read.doc.palette).toEqual(saved);
        expect(read.doc.palette.colors).toContain(0x12345680);
        expect(read.doc.palette.colors).toContain(0xabcdef01);
    });

    it("keeps a palette of 256 colours and an empty one", async () => {
        for (const colors of [Array.from({ length: 256 }, (_, i) => i * 0x01010100 + 0xff), []]) {
            const target = session(colors);
            const read = await deserialize(serialize(target.doc, new Map()));
            expect(read.doc.palette).toEqual({ name: "Test", colors });
        }
    });
});
