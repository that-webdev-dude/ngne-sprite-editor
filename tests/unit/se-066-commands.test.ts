import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { invokeCommand } from "../../src/app/commands/invoke";
import { buildContextMenu, menuCommands } from "../../src/app/commands/menuModel";
import type { Command } from "../../src/app/commands/types";
import { keyContextStore, setKeyContext } from "../../src/app/keymap/contextState";
import { resolveKey } from "../../src/app/keymap/resolve";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import {
    EXPORT_FORMATS,
    IMPORT_PALETTE,
    ORIGINAL_ORDER,
    REPLACE_COLOUR,
    SORT_BY_HUE,
    SORT_BY_LIGHTNESS,
    exportPaletteCommandId,
} from "../../src/app/palette/paletteActionIds";
import {
    EDIT_COLOUR,
    MOVE_COLOUR,
    PALETTE_FROM_SPRITE,
    PALETTE_MENU,
    REMOVE_COLOUR,
} from "../../src/app/palette/paletteCommandIds";
import { createPaletteFiles } from "../../src/app/palette/paletteFiles";
import type { PaletteFileOptions } from "../../src/app/palette/paletteFiles";
import { forgetPaletteOrders } from "../../src/app/palette/paletteOrder";
import { currentSwatch, paletteStore, setCurrentSwatch } from "../../src/app/palette/paletteState";
import { createReplaceColour } from "../../src/app/palette/replaceColour";
import type {
    ReplaceColourRequest,
    ReplaceColourValues,
} from "../../src/app/palette/replaceColour";
import type { ChosenPaletteFile } from "../../src/app/platform/paletteFiles";
import { isFloating } from "../../src/app/selection/floating";
import { floatingState } from "../../src/app/selection/floatingState";
import { editorStore } from "../../src/app/state/editor";
import { activeDocument, sessionsStore } from "../../src/app/state/sessions";
import type { OpenDocument } from "../../src/app/state/sessions";
import { celAt, celKey, createDocument } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { MAX_PALETTE_FILE_BYTES, readGpl, readHex, readPal } from "../../src/core/palettes";
import { rectMask, selectCommand } from "../../src/core/selection";

// SE-066: the palette commands of the app registry for palette files, sort and Replace
// Colour… — their places in the palette's overflow menu and the Edit menu, the import that
// changes nothing and reports a malformed file, the export through the exports of SE-052, the
// sort with its original order, and Replace Colour… as one undo step — each applying a floating
// selection first and disabled during a stroke.

/** Animation frames that run when the test says so (the app's float follows them). */
const frames = vi.hoisted(() => ({ next: 1, queue: new Map<number, () => void>() }));

beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
        const id = frames.next++;
        frames.queue.set(id, callback);
        return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.queue.delete(id));
});

afterEach(() => {
    floatingState.cancel();
    for (const document of sessionsStore.getState().documents) {
        sessionsStore.getState().close(document.id);
    }
    frames.queue.clear();
    setKeyContext("floating", false);
    paletteStore.setState({ current: 0, target: null, edit: null });
    editorStore.getState().resetColours();
    forgetPaletteOrders();
    vi.unstubAllGlobals();
});

const W = 4;
const H = 2;
const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const BLACK = 0x000000ff;
const WHITE = 0xffffffff;
const COLOURS = [WHITE, RED, BLACK, GREEN, BLUE];

/** A document whose palette is `COLOURS` and whose one cel holds red and green pixels. */
function open(colors: number[] = COLOURS): OpenDocument {
    const session: DocSession = createDocument({ name: "sheet", width: W, height: H });
    session.doc.palette = { name: "Test", colors: [...colors] };
    const data = new Uint8ClampedArray(W * H * 4);
    const view = new DataView(data.buffer);
    [RED, RED, GREEN, RED, GREEN, GREEN, RED, BLUE].forEach((colour, index) =>
        view.setUint32(index * 4, colour),
    );
    session.doc.images.set("image-0", { width: W, height: H, data });
    session.doc.cels.set(celKey(session.activeLayerId, session.activeFrameId), {
        imageId: "image-0",
        opacity: 255,
    });
    const document = sessionsStore.getState().open(session);
    sessionsStore.getState().touch(document.id);
    return active();
}

function active(): OpenDocument {
    const document = activeDocument(sessionsStore.getState());
    if (!document) throw new Error("no active document");
    return document;
}

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** Runs a command as a menu does: not at all while it is disabled; failures thrown. */
function run(id: string): boolean {
    return invokeCommand(command(id), (error) => {
        throw error;
    });
}

function cel(): number[] {
    const { session } = active();
    const found = celAt(session.doc, session.activeLayerId, session.activeFrameId);
    return Array.from(session.doc.images.get(found!.imageId)!.data);
}

function colourAt(bytes: number[], index: number): number {
    return new DataView(Uint8Array.from(bytes).buffer).getUint32(index * 4);
}

/** Selects the rectangle through the history, as a marquee does. */
function select(rect: { x: number; y: number; width: number; height: number }): void {
    const { session, history } = active();
    const made = selectCommand(session, rectMask(W, H, rect), "replace", "Select");
    if (made) history.execute(made);
}

/** Lifts the selection with the arrow key of the viewport: the pixels float, moved right. */
function float(): void {
    select({ x: 0, y: 0, width: 1, height: 1 });
    const environment: KeyEnvironment = {
        overlayOpen: false,
        focus: "viewport",
        inTimeline: false,
        nativeKeys: new Set(),
        typeahead: false,
        gesture: false,
        floating: keyContextStore.getState().floating,
    };
    const resolution = resolveKey(appCommands, "ArrowRight", environment);
    if (resolution.action !== "run") throw new Error("ArrowRight runs nothing");
    void resolution.command.run();
    expect(isFloating()).toBe(true);
}

/** The labels of the steps undo would take back, newest first, `count` of them. */
function labels(count: number): (string | null)[] {
    const { history } = active();
    const found: (string | null)[] = [];
    for (let index = 0; index < count; index++) {
        found.push(history.undoLabel);
        history.undo();
    }
    for (let index = 0; index < count; index++) history.redo();
    return found;
}

/** Opens a stroke's transaction on the active cel; returns the function that aborts it. */
function stroke(): () => void {
    const { session, history } = active();
    const transaction = history.begin({
        layerId: session.activeLayerId,
        frameId: session.activeFrameId,
    });
    return () => transaction.abort();
}

const OWN = [
    IMPORT_PALETTE,
    ...EXPORT_FORMATS.map(exportPaletteCommandId),
    SORT_BY_HUE,
    SORT_BY_LIGHTNESS,
    ORIGINAL_ORDER,
    REPLACE_COLOUR,
];

describe("registration", () => {
    it("registers the commands from app/palette, without keys", () => {
        for (const id of OWN) {
            const found = command(id);
            expect(found.planned, id).toBe(false);
            expect(found.source, id).toMatch(
                /(^|\/)palette\/(paletteFiles|paletteSort|replaceColour)\.commands\.ts$/,
            );
            expect(found.shortcuts, id).toEqual([]);
        }
        expect(command(IMPORT_PALETTE).title()).toBe("Import Palette…");
        expect(
            EXPORT_FORMATS.map((format) => command(exportPaletteCommandId(format)).title()),
        ).toEqual([
            "Export Palette as .gpl…",
            "Export Palette as .hex…",
            "Export Palette as .pal…",
        ]);
        expect(command(SORT_BY_HUE).title()).toBe("Sort by Hue");
        expect(command(SORT_BY_LIGHTNESS).title()).toBe("Sort by Lightness");
        expect(command(ORIGINAL_ORDER).title()).toBe("Original Order");
        expect(command(REPLACE_COLOUR).title()).toBe("Replace Colour…");
    });

    it("Replace Colour… takes the Edit menu item planned for it", () => {
        const found = command(REPLACE_COLOUR);
        expect(found.menuPath).toEqual(["Edit"]);
        expect(found.planned).toBe(false);
    });

    it("puts its items in the overflow menu in DESIGN §5.4's order and groups", () => {
        const nodes = buildContextMenu(appCommands.list(), PALETTE_MENU);
        const ids = menuCommands(nodes).map((entry) => entry.id);
        const order = [
            REMOVE_COLOUR,
            EDIT_COLOUR,
            IMPORT_PALETTE,
            ...EXPORT_FORMATS.map(exportPaletteCommandId),
            PALETTE_FROM_SPRITE,
            SORT_BY_HUE,
            SORT_BY_LIGHTNESS,
            ORIGINAL_ORDER,
            REPLACE_COLOUR,
        ];
        expect(ids.filter((id) => order.includes(id))).toEqual(order);
        // Separators: after edit, after the exports, after the palette from the sprite.
        const kinds = nodes.map((node) => (node.kind === "command" ? node.command.id : "|"));
        const between = (a: string, b: string) => kinds.slice(kinds.indexOf(a), kinds.indexOf(b));
        expect(between(EDIT_COLOUR, IMPORT_PALETTE)).toContain("|");
        expect(between(IMPORT_PALETTE, exportPaletteCommandId("pal"))).not.toContain("|");
        expect(between(exportPaletteCommandId("pal"), PALETTE_FROM_SPRITE)).toContain("|");
        expect(between(PALETTE_FROM_SPRITE, SORT_BY_HUE)).toContain("|");
        expect(between(SORT_BY_HUE, REPLACE_COLOUR)).not.toContain("|");
    });

    it("is disabled without a document, and those that change the document during a stroke", () => {
        for (const id of OWN) expect(command(id).enabled(), id).toBe(false);
        open();
        for (const id of [IMPORT_PALETTE, SORT_BY_HUE, SORT_BY_LIGHTNESS, REPLACE_COLOUR]) {
            expect(command(id).enabled(), id).toBe(true);
        }
        const abort = stroke();
        for (const id of OWN) expect(command(id).enabled(), id).toBe(false);
        abort();
    });
});

describe("Import Palette…", () => {
    const encoder = new TextEncoder();
    const file = (name: string, content: string | Uint8Array): ChosenPaletteFile => {
        const bytes = typeof content === "string" ? encoder.encode(content) : content;
        return { name, size: bytes.byteLength, read: async () => bytes };
    };

    function workflow(chosen: ChosenPaletteFile | null, more: Partial<PaletteFileOptions> = {}) {
        const notices = { info: vi.fn(), error: vi.fn() };
        const files = createPaletteFiles({
            choose: async () => chosen,
            notices,
            files: { run: (task) => task(), canSave: () => true },
            ...more,
        });
        return { files, notices };
    }

    it("replaces the palette by the file's colours in one undo step, named by the file", async () => {
        const document = open();
        const { files, notices } = workflow(
            file("sunset.gpl", "GIMP Palette\nName: Sunset\n#\n255 0 0\n0 0 255 Blue\n"),
        );
        expect(await files.importPalette()).toBe(true);
        expect(document.session.doc.palette).toEqual({ name: "Sunset", colors: [RED, BLUE] });
        expect(document.history.undoCount).toBe(1);
        expect(document.history.undoLabel).toBe("Import Palette");
        expect(notices.info).toHaveBeenCalledWith("Imported 2 colours from “sunset.gpl”");
        expect(notices.error).not.toHaveBeenCalled();
        document.history.undo();
        expect(document.session.doc.palette).toEqual({ name: "Test", colors: COLOURS });

        const hex = workflow(file("Lospec 3.HEX", "ff0000\n00ff00\n0000ff\n"));
        expect(await hex.files.importPalette()).toBe(true);
        expect(document.session.doc.palette).toEqual({
            name: "Lospec 3",
            colors: [RED, GREEN, BLUE],
        });
    });

    it.each([
        ["broken.gpl", "GIMP Palette\n300 0 0\n", /Line 2/],
        ["broken.hex", "ff0000\nnot a colour\n", /Line 2/],
        ["broken.pal", "JASC-PAL\n0100\n4\n1 2 3\n", /says 4/],
        ["empty.hex", "", /no colours/],
        ["broken.png", "not a png", /cannot be read/],
        ["colours.txt", "ff0000\n", /not a palette file/],
    ])(
        "a malformed file (%s) is one error toast and changes nothing",
        async (name, content, why) => {
            const document = open();
            const { files, notices } = workflow(file(name, content));
            expect(await files.importPalette()).toBe(false);
            expect(notices.error).toHaveBeenCalledTimes(1);
            expect(notices.error.mock.calls[0][0]).toMatch(`Could not import “${name}”.`);
            expect(notices.error.mock.calls[0][0]).toMatch(why);
            expect(notices.info).not.toHaveBeenCalled();
            expect(document.session.doc.palette).toEqual({ name: "Test", colors: COLOURS });
            expect(document.history.undoCount).toBe(0);
        },
    );

    it("a cancelled picker reports nothing; a failing picker is one error toast", async () => {
        const document = open();
        const cancelled = workflow(null);
        expect(await cancelled.files.importPalette()).toBe(false);
        expect(cancelled.notices.error).not.toHaveBeenCalled();
        const failing = workflow(null, {
            choose: async () => {
                throw new Error("Picker refused.");
            },
        });
        expect(await failing.files.importPalette()).toBe(false);
        expect(failing.notices.error).toHaveBeenCalledWith(
            "Could not import a palette. Picker refused.",
        );
        expect(document.history.undoCount).toBe(0);
    });

    it("a stroke begun while the picker is open stops it before it changes the palette", async () => {
        const document = open();
        let abort = () => {};
        const { files, notices } = workflow(null, {
            choose: async () => {
                abort = stroke();
                return file("a.hex", "ff0000\n");
            },
        });
        expect(await files.importPalette()).toBe(false);
        expect(notices.error).toHaveBeenCalledWith(
            "Could not import “a.hex”. A stroke is in progress.",
        );
        abort();
        expect(document.session.doc.palette.colors).toEqual(COLOURS);
    });

    it("another document made active while the picker is open: one error toast, no palette changes", async () => {
        const first = open();
        let second: OpenDocument | null = null;
        const { files, notices } = workflow(null, {
            choose: async () => {
                const session = createDocument({ name: "other", width: 2, height: 2 });
                session.doc.palette = { name: "Other", colors: [GREEN] };
                second = sessionsStore.getState().open(session);
                return file("a.hex", "ff0000\n");
            },
        });
        expect(await files.importPalette()).toBe(false);
        expect(active().id).toBe(second!.id);
        expect(notices.error).toHaveBeenCalledTimes(1);
        expect(notices.error).toHaveBeenCalledWith(
            "Could not import “a.hex”. Another document became the active one meanwhile.",
        );
        expect(notices.info).not.toHaveBeenCalled();
        expect(first.session.doc.palette).toEqual({ name: "Test", colors: COLOURS });
        expect(first.history.undoCount).toBe(0);
        expect(second!.session.doc.palette).toEqual({ name: "Other", colors: [GREEN] });
        expect(second!.history.undoCount).toBe(0);
    });

    it("a file larger than the limit is refused before it is read", async () => {
        const document = open();
        const read = vi.fn(async (): Promise<Uint8Array> => {
            throw new Error("read() must not be called");
        });
        const { files, notices } = workflow({
            name: "huge.png",
            size: MAX_PALETTE_FILE_BYTES + 1,
            read,
        });
        expect(await files.importPalette()).toBe(false);
        expect(read).not.toHaveBeenCalled();
        expect(notices.error).toHaveBeenCalledWith(
            "Could not import “huge.png”. The file is larger than 64 MiB.",
        );
        expect(document.history.undoCount).toBe(0);
    });

    it("the app's command applies a floating selection first: a Move step, then the import", async () => {
        open();
        float();
        const files = createPaletteFiles({
            choose: async () => file("one.hex", "123456\n"),
            notices: { info: vi.fn(), error: vi.fn() },
            files: { run: (task) => task(), canSave: () => true },
        });
        expect(await files.importPalette()).toBe(true);
        expect(isFloating()).toBe(false);
        expect(active().session.doc.palette.colors).toEqual([0x123456ff]);
        expect(labels(2)).toEqual(["Import Palette", "Move"]);
    });
});

describe("Export Palette", () => {
    it("hands the palette as a file of each format to the exports beside the bundle", async () => {
        const document = open();
        document.session.doc.palette.name = "My Colours";
        const made: { name: string; bytes: Uint8Array; kind: string; extension: string }[] = [];
        const files = createPaletteFiles({
            exports: {
                canExport: () => true,
                async otherExport(make) {
                    const result = await make(document, { current: () => document });
                    if (!result) return false;
                    made.push({
                        ...result.file,
                        kind: result.type.kind,
                        extension: result.type.extension,
                    });
                    return true;
                },
            },
        });
        for (const format of EXPORT_FORMATS) expect(await files.exportPalette(format)).toBe(true);
        expect(made.map((entry) => [entry.name, entry.kind, entry.extension])).toEqual([
            ["my-colours.gpl", "gpl", ".gpl"],
            ["my-colours.hex", "hex", ".hex"],
            ["my-colours.pal", "pal", ".pal"],
        ]);
        const readers = [readGpl, readHex, readPal];
        made.forEach((entry, index) => expect(readers[index](entry.bytes).colors).toEqual(COLOURS));
        expect(readGpl(made[0].bytes).name).toBe("My Colours");
        expect(document.history.undoCount).toBe(0);
    });

    it("is disabled for an empty palette", () => {
        open([]);
        for (const format of EXPORT_FORMATS) {
            expect(command(exportPaletteCommandId(format)).enabled(), format).toBe(false);
        }
        expect(command(IMPORT_PALETTE).enabled()).toBe(true);
    });
});

describe("sort", () => {
    it("each sort is one undo step; Original Order puts back the order held before the first sort", () => {
        const document = open();
        const { history, session } = document;
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);

        expect(run(SORT_BY_LIGHTNESS)).toBe(true);
        expect(session.doc.palette.colors).toEqual([BLACK, BLUE, RED, GREEN, WHITE]);
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Sort Palette by Lightness");

        expect(run(SORT_BY_HUE)).toBe(true);
        expect(session.doc.palette.colors).toEqual([BLACK, WHITE, RED, GREEN, BLUE]);
        expect(history.undoCount).toBe(2);

        // The order held before the first sort, not the one before the last.
        expect(command(ORIGINAL_ORDER).enabled()).toBe(true);
        expect(run(ORIGINAL_ORDER)).toBe(true);
        expect(session.doc.palette).toEqual({ name: "Test", colors: COLOURS });
        expect(history.undoCount).toBe(3);
        expect(history.undoLabel).toBe("Original Palette Order");
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);

        // Sorted again: the original order is still the first one.
        run(SORT_BY_HUE);
        history.undo();
        history.undo();
        expect(session.doc.palette.colors).toEqual([BLACK, WHITE, RED, GREEN, BLUE]);
        run(ORIGINAL_ORDER);
        expect(session.doc.palette.colors).toEqual(COLOURS);
    });

    it("a sort that would change nothing records nothing", () => {
        const document = open([BLACK, RED, WHITE]);
        run(SORT_BY_LIGHTNESS);
        expect(document.history.undoCount).toBe(0);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);
    });

    it("a colour removed after a sort ends the original order; the next sort keeps a new one", () => {
        const document = open();
        run(SORT_BY_LIGHTNESS);
        setCurrentSwatch(0);
        run(REMOVE_COLOUR);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);
        const before = [...document.session.doc.palette.colors];
        run(SORT_BY_HUE);
        run(ORIGINAL_ORDER);
        expect(document.session.doc.palette.colors).toEqual(before);
    });

    it("a colour removed after a sort and the removal undone: Original Order is available again", () => {
        const document = open();
        run(SORT_BY_LIGHTNESS);
        setCurrentSwatch(0);
        run(REMOVE_COLOUR);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);
        document.history.undo();
        expect(command(ORIGINAL_ORDER).enabled()).toBe(true);
        run(ORIGINAL_ORDER);
        expect(document.session.doc.palette.colors).toEqual(COLOURS);
    });

    it("an undone sort leaves its kept order: Original Order then puts back the order before it", () => {
        const document = open();
        run(SORT_BY_LIGHTNESS);
        document.history.undo();
        expect(document.session.doc.palette.colors).toEqual(COLOURS);
        // A move after the undo: the kept order is still the one before the undone sort.
        setCurrentSwatch(0);
        paletteStore.setState({ target: 1 });
        run(MOVE_COLOUR);
        expect(document.session.doc.palette.colors).toEqual([RED, WHITE, BLACK, GREEN, BLUE]);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(true);
        run(ORIGINAL_ORDER);
        expect(document.session.doc.palette.colors).toEqual(COLOURS);
    });

    it("Import Palette… after a sort forgets the kept order", async () => {
        const document = open();
        run(SORT_BY_LIGHTNESS);
        const files = createPaletteFiles({
            // The same colours in another order: without the import they could be put back.
            choose: async () => {
                const bytes = new TextEncoder().encode("0000ff\nffffff\nff0000\n000000\n00ff00\n");
                return { name: "same.hex", size: bytes.byteLength, read: async () => bytes };
            },
            notices: { info: vi.fn(), error: vi.fn() },
            files: { run: (task) => task(), canSave: () => true },
        });
        expect(await files.importPalette()).toBe(true);
        expect(document.session.doc.palette.colors).toEqual([BLUE, WHITE, RED, BLACK, GREEN]);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);
    });

    it("a new session of the same document id starts with no kept order", () => {
        const document = open();
        run(SORT_BY_HUE);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(true);
        // Revert gives the document a new session with its id: here holding the sorted colours.
        const session = createDocument({ name: "sheet", width: W, height: H });
        session.doc.id = document.session.doc.id;
        session.doc.palette = { name: "Test", colors: [...document.session.doc.palette.colors] };
        const replaced = sessionsStore.getState().replaceActive(session);
        expect(replaced.id).toBe(document.id);
        expect(active().session).toBe(session);
        expect(command(ORIGINAL_ORDER).enabled()).toBe(false);
    });

    it("the current swatch keeps its colour through a sort and Original Order; undo leaves its index", () => {
        const document = open();
        const current = () => currentSwatch(document.session.doc.palette.colors.length);
        setCurrentSwatch(COLOURS.indexOf(RED));
        run(SORT_BY_LIGHTNESS);
        expect(document.session.doc.palette.colors[current()]).toBe(RED);
        expect(current()).toBe(2);
        run(ORIGINAL_ORDER);
        expect(current()).toBe(1);
        // As for SE-060's commands, an undo does not move the current swatch.
        document.history.undo();
        expect(current()).toBe(1);

        // Of equal colours, the same occurrence: the second red stays the second red.
        const twice = open([RED, BLUE, RED]);
        setCurrentSwatch(2);
        run(SORT_BY_LIGHTNESS);
        expect(twice.session.doc.palette.colors).toEqual([BLUE, RED, RED]);
        expect(currentSwatch(3)).toBe(2);
        setCurrentSwatch(0);
        run(ORIGINAL_ORDER);
        expect(currentSwatch(3)).toBe(1);
    });

    it("a palette of one colour cannot be sorted", () => {
        open([RED]);
        expect(command(SORT_BY_HUE).enabled()).toBe(false);
        expect(command(SORT_BY_LIGHTNESS).enabled()).toBe(false);
    });

    it("applies a floating selection first: a Move step, then the sort", () => {
        open();
        float();
        expect(command(SORT_BY_HUE).enabled()).toBe(true);
        run(SORT_BY_HUE);
        expect(isFloating()).toBe(false);
        expect(labels(2)).toEqual(["Sort Palette by Hue", "Move"]);
        float();
        run(ORIGINAL_ORDER);
        expect(isFloating()).toBe(false);
        expect(labels(2)).toEqual(["Original Palette Order", "Move"]);
    });
});

describe("Replace Colour…", () => {
    function workflow(answer: (request: ReplaceColourRequest) => ReplaceColourValues | null) {
        const notices = { info: vi.fn(), error: vi.fn() };
        const asked: ReplaceColourRequest[] = [];
        const replace = createReplaceColour({
            notices,
            dialogs: {
                async ask(options) {
                    const request = {
                        kind: "replace-colour",
                        ...options,
                        answer: () => {},
                    } as const;
                    asked.push(request);
                    return answer(request);
                },
            },
        });
        return { replace, notices, asked };
    }

    it("replaces across the sprite in one undo step, only the matching pixels", async () => {
        const document = open();
        const before = cel();
        const { replace, notices, asked } = workflow((request) => ({
            ...request.initial,
            from: RED,
            to: WHITE,
            scope: "sprite",
        }));
        expect(await replace.run()).toBe(true);
        const after = cel();
        for (let index = 0; index < W * H; index++) {
            const was = colourAt(before, index);
            expect(colourAt(after, index), `pixel ${index}`).toBe(was === RED ? WHITE : was);
        }
        expect(document.history.undoCount).toBe(1);
        expect(document.history.undoLabel).toBe("Replace Colour");
        expect(notices.info).toHaveBeenCalledWith("Replaced 4 pixels in the sprite");
        // The dialog opened with the foreground, the background and the cel.
        expect(asked[0].initial).toEqual({ from: BLACK, to: WHITE, tolerance: 0, scope: "cel" });
        expect(asked[0].hasSelection).toBe(false);
        document.history.undo();
        expect(cel()).toEqual(before);
    });

    it("with a selection and the scope 'selection', pixels outside it are untouched", async () => {
        open();
        select({ x: 0, y: 0, width: 2, height: 1 });
        const before = cel();
        const { replace, asked } = workflow((request) => ({
            ...request.initial,
            from: RED,
            to: BLUE,
        }));
        expect(await replace.run()).toBe(true);
        expect(asked[0].initial.scope).toBe("selection");
        expect(asked[0].hasSelection).toBe(true);
        const after = cel();
        expect([0, 1].map((index) => colourAt(after, index))).toEqual([BLUE, BLUE]);
        for (let index = 2; index < W * H; index++) {
            expect(colourAt(after, index), `pixel ${index}`).toBe(colourAt(before, index));
        }
    });

    it("offers the tolerance and the scope answered last", async () => {
        open();
        const { replace, asked } = workflow((request) => ({
            ...request.initial,
            from: 0x123456ff,
            tolerance: 9,
            scope: "frame",
        }));
        await replace.run();
        await replace.run();
        expect(asked[1].initial).toMatchObject({ tolerance: 9, scope: "frame" });
    });

    it("cancelled, it changes nothing; nothing to replace is an info toast and no step", async () => {
        const document = open();
        const cancelled = workflow(() => null);
        expect(await cancelled.replace.run()).toBe(false);
        expect(cancelled.notices.info).not.toHaveBeenCalled();
        const none = workflow((request) => ({
            ...request.initial,
            from: 0x123456ff,
            scope: "sprite",
        }));
        expect(await none.replace.run()).toBe(false);
        expect(none.notices.info).toHaveBeenCalledWith(
            "No pixel of #123456 to replace in the sprite",
        );
        expect(document.history.undoCount).toBe(0);
    });

    it("a locked active layer is refused with an error toast and no step", async () => {
        const document = open();
        document.session.doc.layers[0].locked = true;
        const { replace, notices } = workflow((request) => ({ ...request.initial, from: RED }));
        expect(await replace.run()).toBe(false);
        expect(notices.error).toHaveBeenCalledWith(
            "Could not replace the colour. Layer is locked.",
        );
        expect(document.history.undoCount).toBe(0);
    });

    it("applies a floating selection first: a Move step, then the replacement", async () => {
        open();
        float();
        expect(command(REPLACE_COLOUR).enabled()).toBe(true);
        const { replace } = workflow((request) => ({
            ...request.initial,
            from: RED,
            to: BLUE,
            scope: "sprite",
        }));
        expect(await replace.run()).toBe(true);
        expect(isFloating()).toBe(false);
        expect(labels(2)).toEqual(["Replace Colour", "Move"]);
    });
});
