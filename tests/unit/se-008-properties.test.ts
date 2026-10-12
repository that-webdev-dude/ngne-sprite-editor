import { describe, expect, it } from "vitest";
import { compositeCommand, History } from "../../src/core/history";
import {
    assertInvariants,
    createDocument,
    defaultDocSettings,
    sequentialIds,
} from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import {
    GridRangeError,
    isPivot,
    isSpriteName,
    MAX_GRID_OFFSET,
    MAX_GRID_SIDE,
    normalizeSpriteName,
    PIVOT_PRESET_COLUMNS,
    PIVOT_PRESETS,
    pivotPresetAt,
    PivotRangeError,
    renameSpriteCommand,
    setGrid,
    setPivotCommand,
    SpriteNameError,
} from "../../src/core/sprite";
import { movePivotPreset } from "../../src/ui/sprite/pivotGridKeys";

// SE-008: sprite properties in `core` (SPEC §7.7) — name and pivot as undoable commands, the
// grid as a `DocSettings` setter that makes no history entry (SPEC §5.2).

function sprite(): DocSession {
    return createDocument({ name: "hero", width: 32, height: 24 }, sequentialIds());
}

/** A session with a history whose every step is followed by the invariant check. */
function fixture() {
    const session = sprite();
    const history = new History(session);
    history.subscribe(() => assertInvariants(session));
    return { session, history };
}

const preset = (id: string) => {
    const found = PIVOT_PRESETS.find((entry) => entry.id === id);
    if (!found) throw new Error(`no preset ${id}`);
    return found;
};

describe("rename command", () => {
    it("sets the name; undo restores the previous one and redo sets it again", () => {
        const { session, history } = fixture();
        history.execute(renameSpriteCommand("villain"));
        expect(session.doc.name).toBe("villain");
        expect(history.undoLabel).toBe("Rename Sprite");
        expect(history.undoCount).toBe(1);

        expect(history.undo()).toBe(true);
        expect(session.doc.name).toBe("hero");
        expect(history.redoLabel).toBe("Rename Sprite");
        expect(history.redo()).toBe(true);
        expect(session.doc.name).toBe("villain");
    });

    it("undoes a chain of renames one name at a time", () => {
        const { session, history } = fixture();
        for (const name of ["a", "b", "c"]) history.execute(renameSpriteCommand(name));
        const seen = [];
        while (history.undo()) seen.push(session.doc.name);
        expect(seen).toEqual(["b", "a", "hero"]);
        while (history.redo()) seen.push(session.doc.name);
        expect(seen.slice(3)).toEqual(["a", "b", "c"]);
    });

    it("stores the name without surrounding white space", () => {
        const { session, history } = fixture();
        history.execute(renameSpriteCommand("  walk cycle \n"));
        expect(session.doc.name).toBe("walk cycle");
        expect(normalizeSpriteName(" hero ")).toBe("hero");
    });

    it("rejects an empty name with a typed error before anything changes", () => {
        const { session, history } = fixture();
        for (const name of ["", "   ", "\t\n"]) {
            expect(() => history.execute(renameSpriteCommand(name))).toThrow(SpriteNameError);
            expect(isSpriteName(name)).toBe(false);
        }
        expect(session.doc.name).toBe("hero");
        expect(history.undoCount).toBe(0);
        expect(isSpriteName("hero")).toBe(true);
    });

    it("touches no pixels, layers or frames", () => {
        expect(renameSpriteCommand("a").touched).toEqual({
            frameIds: [],
            layerIds: [],
            structure: false,
        });
    });
});

describe("pivot command", () => {
    it("setting pivot to bottom-centre stores { x: 0.5, y: 1 }; undo restores the previous value", () => {
        const { session, history } = fixture();
        // A new document has the centre pivot (SPEC §5.1).
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        history.execute(setPivotCommand(preset("bottom-centre").pivot));
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 1 });
        expect(history.undoLabel).toBe("Set Pivot");

        expect(history.undo()).toBe(true);
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        expect(history.redo()).toBe(true);
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 1 });
    });

    it("undo restores a previous value that is not the default", () => {
        const { session, history } = fixture();
        history.execute(setPivotCommand({ x: 0.25, y: 0.75 }));
        history.execute(setPivotCommand({ x: 1, y: 0 }));
        expect(session.doc.pivot).toEqual({ x: 1, y: 0 });
        history.undo();
        expect(session.doc.pivot).toEqual({ x: 0.25, y: 0.75 });
        history.undo();
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        history.redo();
        history.redo();
        expect(session.doc.pivot).toEqual({ x: 1, y: 0 });
    });

    it("keeps its own copy of the pivot it was given", () => {
        const { session, history } = fixture();
        const pivot = { x: 0, y: 1 };
        history.execute(setPivotCommand(pivot));
        pivot.x = 0.9;
        expect(session.doc.pivot).toEqual({ x: 0, y: 1 });
        // Nor is the document's pivot the object a later redo writes again.
        session.doc.pivot.x = 0.3;
        history.undo();
        history.redo();
        expect(session.doc.pivot).toEqual({ x: 0, y: 1 });
    });

    it("rejects a coordinate outside 0..1 with a typed error before anything changes", () => {
        const { session, history } = fixture();
        for (const pivot of [
            { x: -0.01, y: 0.5 },
            { x: 0.5, y: 1.01 },
            { x: Number.NaN, y: 0 },
            { x: 0, y: Number.POSITIVE_INFINITY },
        ]) {
            expect(() => history.execute(setPivotCommand(pivot))).toThrow(PivotRangeError);
            expect(isPivot(pivot)).toBe(false);
        }
        expect(session.doc.pivot).toEqual({ x: 0.5, y: 0.5 });
        expect(history.undoCount).toBe(0);
        // The edges are inside the range.
        expect(isPivot({ x: 0, y: 1 })).toBe(true);
    });

    it("names the offending pivot in its error", () => {
        try {
            setPivotCommand({ x: 2, y: 0.5 });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(PivotRangeError);
            expect(error).toMatchObject({ name: "PivotRangeError", x: 2, y: 0.5 });
        }
    });

    it("touches no pixels, layers or frames", () => {
        expect(setPivotCommand({ x: 0, y: 0 }).touched).toEqual({
            frameIds: [],
            layerIds: [],
            structure: false,
        });
    });
});

describe("name and pivot as one step", () => {
    it("a composite of both is one history entry that undo reverses as a whole", () => {
        const { session, history } = fixture();
        history.execute(
            compositeCommand("Sprite Properties", [
                renameSpriteCommand("villain"),
                setPivotCommand({ x: 0.5, y: 1 }),
            ]),
        );
        expect(history.undoCount).toBe(1);
        expect(session.doc).toMatchObject({ name: "villain", pivot: { x: 0.5, y: 1 } });
        history.undo();
        expect(session.doc).toMatchObject({ name: "hero", pivot: { x: 0.5, y: 0.5 } });
        history.redo();
        expect(session.doc).toMatchObject({ name: "villain", pivot: { x: 0.5, y: 1 } });
    });
});

describe("pivot presets", () => {
    it("are the nine pivots of a 3×3 grid, row by row from the top-left corner", () => {
        expect(PIVOT_PRESET_COLUMNS).toBe(3);
        expect(PIVOT_PRESETS.map((entry) => [entry.id, entry.pivot.x, entry.pivot.y])).toEqual([
            ["top-left", 0, 0],
            ["top-centre", 0.5, 0],
            ["top-right", 1, 0],
            ["centre-left", 0, 0.5],
            ["centre", 0.5, 0.5],
            ["centre-right", 1, 0.5],
            ["bottom-left", 0, 1],
            ["bottom-centre", 0.5, 1],
            ["bottom-right", 1, 1],
        ]);
        expect(PIVOT_PRESETS.map((entry) => entry.name)).toEqual([
            "Top left",
            "Top centre",
            "Top right",
            "Centre left",
            "Centre",
            "Centre right",
            "Bottom left",
            "Bottom centre",
            "Bottom right",
        ]);
        for (const entry of PIVOT_PRESETS) expect(isPivot(entry.pivot)).toBe(true);
    });

    it("finds the preset at a pivot, and none between presets", () => {
        expect(pivotPresetAt({ x: 0.5, y: 1 })?.id).toBe("bottom-centre");
        expect(pivotPresetAt(sprite().doc.pivot)?.id).toBe("centre");
        expect(pivotPresetAt({ x: 0.5, y: 0.99 })).toBeUndefined();
    });

    it("arrow keys move by one cell and stop at the edges of the grid", () => {
        const index = (id: string) => PIVOT_PRESETS.findIndex((entry) => entry.id === id);
        const move = (id: string, key: string) =>
            PIVOT_PRESETS[movePivotPreset(index(id), key) ?? -1]?.id;
        expect(move("centre", "ArrowLeft")).toBe("centre-left");
        expect(move("centre", "ArrowRight")).toBe("centre-right");
        expect(move("centre", "ArrowUp")).toBe("top-centre");
        expect(move("centre", "ArrowDown")).toBe("bottom-centre");
        // No wrapping: a corner stays where it is.
        expect(move("top-left", "ArrowLeft")).toBe("top-left");
        expect(move("top-left", "ArrowUp")).toBe("top-left");
        expect(move("bottom-right", "ArrowRight")).toBe("bottom-right");
        expect(move("bottom-right", "ArrowDown")).toBe("bottom-right");
        expect(move("top-right", "ArrowRight")).toBe("top-right");
        expect(move("bottom-left", "ArrowLeft")).toBe("bottom-left");
        // Other keys are not the grid's.
        for (const key of ["Enter", " ", "Tab", "Home", "a"]) {
            expect(movePivotPreset(4, key)).toBeNull();
        }
    });
});

describe("grid setter", () => {
    it("sets size and offset and leaves the rest of the settings alone", () => {
        const settings = defaultDocSettings(32, 32);
        settings.grid.visible = true;
        const before = structuredClone(settings);
        setGrid(settings, { width: 8, height: 12, offsetX: 3, offsetY: -4 });
        expect(settings.grid).toEqual({
            width: 8,
            height: 12,
            offsetX: 3,
            offsetY: -4,
            visible: true,
        });
        expect({ ...settings, grid: before.grid }).toEqual(before);
    });

    it("sets only the fields it is given", () => {
        const settings = defaultDocSettings(32, 32);
        setGrid(settings, { width: 24 });
        expect(settings.grid).toMatchObject({ width: 24, height: 16, offsetX: 0, offsetY: 0 });
        setGrid(settings, { offsetY: 2 });
        expect(settings.grid).toMatchObject({ width: 24, height: 16, offsetX: 0, offsetY: 2 });
    });

    it("accepts the limits of its ranges", () => {
        const settings = defaultDocSettings(32, 32);
        setGrid(settings, {
            width: 1,
            height: MAX_GRID_SIDE,
            offsetX: -MAX_GRID_OFFSET,
            offsetY: MAX_GRID_OFFSET,
        });
        expect(settings.grid).toMatchObject({
            width: 1,
            height: 1024,
            offsetX: -1024,
            offsetY: 1024,
        });
    });

    it("rejects a value outside its range with a typed error and changes nothing", () => {
        const settings = defaultDocSettings(32, 32);
        const before = structuredClone(settings.grid);
        const cases = [
            [{ width: 0 }, "width"],
            [{ width: 1025 }, "width"],
            [{ height: 2.5 }, "height"],
            [{ height: Number.NaN }, "height"],
            [{ offsetX: 1025 }, "offsetX"],
            [{ offsetY: -1025 }, "offsetY"],
            [{ offsetY: 0.5 }, "offsetY"],
            // A valid field does not get through next to an invalid one.
            [{ width: 8, offsetX: 4096 }, "offsetX"],
        ] as const;
        for (const [grid, field] of cases) {
            expect(() => setGrid(settings, grid), JSON.stringify(grid)).toThrow(GridRangeError);
            try {
                setGrid(settings, grid);
            } catch (error) {
                expect(error).toMatchObject({ name: "GridRangeError", field });
            }
            expect(settings.grid, JSON.stringify(grid)).toEqual(before);
        }
    });

    it("is not a command: a history sees nothing of it", () => {
        const { session, history } = fixture();
        const position = history.position;
        setGrid(session.doc.settings, { width: 8, height: 8 });
        expect(session.doc.settings.grid).toMatchObject({ width: 8, height: 8 });
        expect(history.position).toBe(position);
        expect(history.canUndo).toBe(false);
        assertInvariants(session);
    });
});
