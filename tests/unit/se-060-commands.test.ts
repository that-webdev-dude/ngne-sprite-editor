import { afterEach, describe, expect, it } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { invokeCommand } from "../../src/app/commands/invoke";
import { buildContextMenu, menuCommands } from "../../src/app/commands/menuModel";
import { finishSwatchEdit } from "../../src/app/palette/palette.commands";
import {
    ADD_COLOUR,
    APPLY_EDIT,
    EDIT_COLOUR,
    MOVE_COLOUR,
    PALETTE_FROM_SPRITE,
    PALETTE_MENU,
    PRESET_MENU,
    REMOVE_COLOUR,
    presetCommandId,
    presetOfCommand,
} from "../../src/app/palette/paletteCommandIds";
import {
    currentSwatch,
    paletteStore,
    setCurrentSwatch,
    setMoveTarget,
} from "../../src/app/palette/paletteState";
import { activeComposites } from "../../src/app/state/composites";
import { DEFAULT_FOREGROUND, editorStore } from "../../src/app/state/editor";
import { sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { celKey, createDocument } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { PRESET_PALETTES } from "../../src/core/palettes";

// SE-060: the palette commands of the app registry (DESIGN §5.4) on the app's own stores: each
// changes the active document's palette in one undo step and records nothing when it would
// change nothing; Remove, Edit and Move act on the current swatch; the overflow and preset
// menus are generated from the commands that list them.

const command = (id: string) => {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
};

/** Runs a command as a menu or a button does: not at all while it is disabled. */
function run(id: string): boolean {
    return invokeCommand(command(id), (error) => {
        throw error;
    });
}

const COLOURS = [0x000000ff, 0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffffffff];

function open(colors: number[] = COLOURS): OpenDocument {
    const session = createDocument({ name: "sheet", width: 4, height: 2 });
    session.doc.palette = { name: "Test", colors: [...colors] };
    return sessionsStore.getState().open(session);
}

afterEach(() => {
    finishSwatchEdit();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    paletteStore.setState({ current: 0, target: null, edit: null });
    editorStore.getState().resetColours();
});

describe("registration", () => {
    it("registers the commands from app/palette, without keys", () => {
        const ids = [
            ADD_COLOUR,
            REMOVE_COLOUR,
            EDIT_COLOUR,
            APPLY_EDIT,
            MOVE_COLOUR,
            PALETTE_FROM_SPRITE,
        ];
        const presets = PRESET_PALETTES.map(presetCommandId);
        for (const id of [...ids, ...presets]) {
            const found = command(id);
            expect(found.planned, id).toBe(false);
            expect(found.source, id).toMatch(/palette\/palette\.commands\.ts$/);
            expect(found.shortcuts, id).toEqual([]);
            expect(found.menuPath, id).toBeNull();
        }
        expect(command(ADD_COLOUR).title()).toBe("Add Current Colour");
        expect(command(REMOVE_COLOUR).title()).toBe("Remove Colour");
        expect(command(EDIT_COLOUR).title()).toBe("Edit Colour…");
        expect(command(APPLY_EDIT).title()).toBe("Apply Colour Edit");
        expect(command(PALETTE_FROM_SPRITE).title()).toBe("Palette from Sprite");
    });

    it("tells open menus when the palette state changes, as for the app's other stores", () => {
        open();
        const before = appCommands.version();
        setCurrentSwatch(3);
        expect(appCommands.version()).toBeGreaterThan(before);
        const after = appCommands.version();
        setMoveTarget(1);
        expect(appCommands.version()).toBeGreaterThan(after);
    });

    it("puts remove, edit and the palette from the sprite in the overflow menu, in DESIGN's order", () => {
        const items = menuCommands(buildContextMenu(appCommands.list(), PALETTE_MENU)).map(
            (entry) => entry.id,
        );
        const own = items.filter((id) =>
            [REMOVE_COLOUR, EDIT_COLOUR, PALETTE_FROM_SPRITE].includes(id),
        );
        expect(own).toEqual([REMOVE_COLOUR, EDIT_COLOUR, PALETTE_FROM_SPRITE]);
        // Remove and edit form a group; the palette from the sprite starts another.
        const nodes = buildContextMenu(appCommands.list(), PALETTE_MENU);
        const kinds = nodes.map((node) => (node.kind === "command" ? node.command.id : "|"));
        expect(kinds.indexOf("|", kinds.indexOf(EDIT_COLOUR))).toBeLessThan(
            kinds.indexOf(PALETTE_FROM_SPRITE),
        );
    });

    it("lists every preset of core/palettes in the preset menu, in their order", () => {
        const items = menuCommands(buildContextMenu(appCommands.list(), PRESET_MENU));
        // SE-060's items only: a later ticket may add others to the menu.
        const presets = items.flatMap((entry) => presetOfCommand(entry.id) ?? []);
        expect(presets.map((preset) => preset.id)).toEqual(
            PRESET_PALETTES.map((preset) => preset.id),
        );
        for (const preset of PRESET_PALETTES) {
            expect(command(presetCommandId(preset)).title()).toBe(`Load ${preset.name} Palette`);
        }
        expect(presetOfCommand(ADD_COLOUR)).toBeUndefined();
    });
});

describe("enabled", () => {
    it("is false for every palette command without a document", () => {
        for (const entry of appCommands.list()) {
            if (!entry.source.match(/palette\/palette\.commands\.ts$/)) continue;
            expect(entry.enabled(), entry.id).toBe(false);
        }
    });

    it("is false while a transaction is open, as for every command that changes the document", () => {
        const document = open();
        setMoveTarget(2);
        const ids = [ADD_COLOUR, REMOVE_COLOUR, EDIT_COLOUR, MOVE_COLOUR, PALETTE_FROM_SPRITE];
        editorStore.getState().setForeground(0x123456ff);
        for (const id of [...ids, presetCommandId(PRESET_PALETTES[0])]) {
            expect(command(id).enabled(), id).toBe(true);
        }
        const { session } = document;
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        for (const id of [...ids, presetCommandId(PRESET_PALETTES[0])]) {
            expect(command(id).enabled(), id).toBe(false);
        }
        transaction.abort();
    });
});

describe("one undo step each", () => {
    it("add current colour appends the foreground and makes it the current swatch", () => {
        const document = open();
        const { session, history } = document;
        // The foreground is black, which the palette holds.
        expect(editorStore.getState().foreground).toBe(DEFAULT_FOREGROUND);
        expect(command(ADD_COLOUR).enabled()).toBe(false);
        editorStore.getState().setForeground(0x12345680);
        expect(run(ADD_COLOUR)).toBe(true);
        expect(session.doc.palette.colors).toEqual([...COLOURS, 0x12345680]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Add Current Colour");
        expect(currentSwatch(6)).toBe(5);
        expect(command(ADD_COLOUR).enabled()).toBe(false);
        history.undo();
        expect(session.doc.palette.colors).toEqual(COLOURS);
    });

    it("add current colour is disabled once the palette holds 256 colours", () => {
        open(Array.from({ length: 255 }, (_, index) => (index << 8) | 0xff));
        editorStore.getState().setForeground(0xfffffffe);
        expect(run(ADD_COLOUR)).toBe(true);
        editorStore.getState().setForeground(0xfffffffd);
        expect(command(ADD_COLOUR).enabled()).toBe(false);
        expect(run(ADD_COLOUR)).toBe(false);
        const { colors } = sessionsStore.getState().documents[0].session.doc.palette;
        expect(colors).toHaveLength(256);
    });

    it("remove takes out the current swatch; the current swatch stays within the palette", () => {
        const document = open();
        const { session, history } = document;
        setCurrentSwatch(4);
        expect(run(REMOVE_COLOUR)).toBe(true);
        expect(session.doc.palette.colors).toEqual(COLOURS.slice(0, 4));
        expect(history.undoLabel).toBe("Remove Colour");
        expect(currentSwatch(session.doc.palette.colors.length)).toBe(3);
        expect(run(REMOVE_COLOUR)).toBe(true);
        expect(session.doc.palette.colors).toEqual(COLOURS.slice(0, 3));
        expect(history.undoCount).toBe(2);
        history.undo();
        expect(session.doc.palette.colors).toEqual(COLOURS.slice(0, 4));
        // An empty palette has no current swatch.
        open([0x102030ff]);
        expect(run(REMOVE_COLOUR)).toBe(true);
        expect(command(REMOVE_COLOUR).enabled()).toBe(false);
        expect(command(EDIT_COLOUR).enabled()).toBe(false);
    });

    it("move puts the current swatch at the target and keeps it current; nothing without a target", () => {
        const document = open();
        const { session, history } = document;
        setCurrentSwatch(1);
        expect(command(MOVE_COLOUR).enabled()).toBe(false);
        setMoveTarget(1);
        expect(command(MOVE_COLOUR).enabled()).toBe(false);
        setMoveTarget(5);
        expect(command(MOVE_COLOUR).enabled()).toBe(false);
        setMoveTarget(3);
        expect(run(MOVE_COLOUR)).toBe(true);
        expect(session.doc.palette.colors).toEqual([
            0x000000ff, 0x00ff00ff, 0x0000ffff, 0xff0000ff, 0xffffffff,
        ]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Move Colour");
        expect(paletteStore.getState()).toMatchObject({ current: 3, target: null });
        history.undo();
        expect(session.doc.palette.colors).toEqual(COLOURS);
    });

    it("edit opens the swatch editor on the current swatch; finishing applies the draft once", () => {
        const document = open();
        const { session, history } = document;
        setCurrentSwatch(2);
        expect(run(EDIT_COLOUR)).toBe(true);
        const edit = paletteStore.getState().edit;
        expect(edit).toMatchObject({ documentId: document.id, index: 2, colour: 0x00ff00ff });
        expect(edit?.draft.getState().foreground).toBe(0x00ff00ff);
        // One edit at a time, and no change to the palette until it finishes.
        expect(command(EDIT_COLOUR).enabled()).toBe(false);
        edit?.draft.getState().setColourHsv("foreground", { h: 200, s: 0.5, v: 0.5 }, 128);
        edit?.draft.getState().setColour("foreground", 0x336699aa);
        expect(session.doc.palette.colors).toEqual(COLOURS);
        expect(history.undoCount).toBe(0);
        finishSwatchEdit();
        expect(paletteStore.getState().edit).toBeNull();
        expect(session.doc.palette.colors[2]).toBe(0x336699aa);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Edit Colour");
        // The foreground is not a reference to the swatch.
        expect(editorStore.getState().foreground).toBe(DEFAULT_FOREGROUND);
        history.undo();
        expect(session.doc.palette.colors).toEqual(COLOURS);
    });

    it("an edit that ends on the colour it began with records nothing", () => {
        const document = open();
        setCurrentSwatch(1);
        run(EDIT_COLOUR);
        const draft = paletteStore.getState().edit?.draft;
        draft?.getState().setColour("foreground", 0x808080ff);
        draft?.getState().setColour("foreground", 0xff0000ff);
        finishSwatchEdit();
        expect(document.history.undoCount).toBe(0);
        finishSwatchEdit();
        expect(document.history.undoCount).toBe(0);
    });

    it("Apply Colour Edit records the edit through the registry, in the edit's own document", () => {
        const first = open();
        expect(command(APPLY_EDIT).enabled()).toBe(false);
        setCurrentSwatch(3);
        run(EDIT_COLOUR);
        expect(command(APPLY_EDIT).enabled()).toBe(true);
        paletteStore.getState().edit?.draft.getState().setColour("foreground", 0x13579bdf);
        // Another document becomes the active one: the edit still goes to the first.
        const second = open();
        expect(sessionsStore.getState().activeId).toBe(second.id);
        expect(run(APPLY_EDIT)).toBe(true);
        expect(paletteStore.getState().edit).toBeNull();
        expect(first.session.doc.palette.colors[3]).toBe(0x13579bdf);
        expect(first.history.undoCount).toBe(1);
        expect(first.history.undoLabel).toBe("Edit Colour");
        expect(second.history.undoCount).toBe(0);
        expect(second.session.doc.palette.colors).toEqual(COLOURS);
        expect(command(APPLY_EDIT).enabled()).toBe(false);
    });

    it("Apply Colour Edit is disabled while the edit's document is in a stroke, or closed", () => {
        const document = open();
        run(EDIT_COLOUR);
        const { session } = document;
        const transaction = document.history.begin({
            layerId: session.activeLayerId,
            frameId: session.activeFrameId,
        });
        expect(command(APPLY_EDIT).enabled()).toBe(false);
        expect(run(APPLY_EDIT)).toBe(false);
        expect(paletteStore.getState().edit).not.toBeNull();
        transaction.abort();
        expect(command(APPLY_EDIT).enabled()).toBe(true);
        sessionsStore.getState().close(document.id);
        expect(command(APPLY_EDIT).enabled()).toBe(false);
    });

    it("loading a preset replaces the palette in one undo step; the same preset again records nothing", () => {
        const document = open();
        const { session, history } = document;
        const preset = PRESET_PALETTES[2];
        expect(run(presetCommandId(preset))).toBe(true);
        expect(session.doc.palette).toEqual({ name: preset.name, colors: [...preset.colors] });
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe(`Load ${preset.name} Palette`);
        run(presetCommandId(preset));
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(session.doc.palette).toEqual({ name: "Test", colors: COLOURS });
    });
});

/** Writes `colors` (0xRRGGBBAA, row-major) into the cel of the active layer at `frameId`. */
function paintCel(session: DocSession, frameId: string, colors: readonly number[]): void {
    const { doc } = session;
    const data = new Uint8ClampedArray(doc.width * doc.height * 4);
    colors.forEach((colour, index) => {
        data.set(
            [colour >>> 24, (colour >>> 16) & 0xff, (colour >>> 8) & 0xff, colour & 0xff],
            index * 4,
        );
    });
    const imageId = `image-${frameId}`;
    doc.images.set(imageId, { width: doc.width, height: doc.height, data });
    doc.cels.set(celKey(session.activeLayerId, frameId), { imageId, opacity: 255 });
}

describe("palette from sprite", () => {
    it("on a sprite of 5 colours gives exactly those 5, in one undo step", () => {
        const session = createDocument({ name: "five", width: 4, height: 2 });
        const five = [0x000000ff, 0xffffffff, 0xff0000ff, 0x2040c0ff, 0x80ff20ff];
        paintCel(session, session.activeFrameId, [...five, five[1], five[2], 0]);
        session.doc.frames.push({ id: "frame-2", durationMs: 100 });
        paintCel(session, "frame-2", [five[3], five[4], 0, 0, 0, 0, 0, 0]);
        const document = sessionsStore.getState().open(session);
        expect(activeComposites.cacheOf(session)).not.toBeNull();
        expect(run(PALETTE_FROM_SPRITE)).toBe(true);
        const { palette } = session.doc;
        expect(palette.name).toBe("five");
        expect(palette.colors).toHaveLength(5);
        expect([...palette.colors].sort((a, b) => a - b)).toEqual([...five].sort((a, b) => a - b));
        expect(document.history.undoCount).toBe(1);
        expect(document.history.undoLabel).toBe("Palette from Sprite");
        run(PALETTE_FROM_SPRITE);
        expect(document.history.undoCount).toBe(1);
        document.history.undo();
        expect(session.doc.palette.name).toBe("DawnBringer 32");
        expect(session.doc.palette.colors).toHaveLength(32);
    });

    it("reads the composites the cache holds and puts no other frame in it", () => {
        const session = createDocument({ name: "frames", width: 4, height: 2 });
        paintCel(session, session.activeFrameId, [0x102030ff, 0, 0, 0, 0, 0, 0, 0]);
        for (const id of ["frame-2", "frame-3"]) {
            session.doc.frames.push({ id, durationMs: 100 });
        }
        paintCel(session, "frame-3", [0x405060ff, 0, 0, 0, 0, 0, 0, 0]);
        sessionsStore.getState().open(session);
        const cache = activeComposites.cacheOf(session);
        if (!cache) throw new Error("no composite cache");
        // The viewport would hold the active frame.
        const held = cache.get(session.activeFrameId);
        expect(cache.has("frame-2")).toBe(false);
        expect(cache.has("frame-3")).toBe(false);
        expect(run(PALETTE_FROM_SPRITE)).toBe(true);
        expect(session.doc.palette.colors).toEqual([0x102030ff, 0x405060ff]);
        expect(cache.has(session.activeFrameId)).toBe(true);
        expect(cache.get(session.activeFrameId)).toBe(held);
        expect(cache.has("frame-2")).toBe(false);
        expect(cache.has("frame-3")).toBe(false);
    });
});
