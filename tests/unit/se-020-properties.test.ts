import { describe, expect, it } from "vitest";
import { BLEND_FUNCTIONS } from "../../src/core/composite";
import { compositeCommand } from "../../src/core/history";
import {
    isLayerName,
    LayerError,
    normalizeLayerName,
    renameLayerCommand,
    setLayerBlendModeCommand,
    setLayerLockedCommand,
    setLayerOpacityCommand,
    setLayerVisibleCommand,
} from "../../src/core/layers";
import type { BlendMode } from "../../src/core/model";
import {
    A,
    B,
    C,
    composites,
    compositesOf,
    execute,
    fixture,
    FRAMES,
    history,
    layer,
    made,
    redo,
    stateOf,
    thrownBy,
    undo,
} from "./se-020-support";

// SE-020: the commands that set one property of a layer (SPEC §7.3).

const [F1, F2, F3, F4] = FRAMES;
const NOTHING = { frameIds: [], layerIds: [], structure: false };

describe("rename layer", () => {
    it("sets the name; undo restores the previous one and redo sets it again", () => {
        const session = fixture();
        const target = history(session);

        execute(target, renameLayerCommand(session, B, "Outline"));
        expect(layer(session.doc, B).name).toBe("Outline");
        expect(target.undoLabel).toBe("Rename Layer");

        undo(target);
        expect(layer(session.doc, B).name).toBe(B);
        redo(target);
        expect(layer(session.doc, B).name).toBe("Outline");
    });

    it("undoes a chain of renames one name at a time", () => {
        const session = fixture();
        const target = history(session);
        for (const name of ["a", "b", "c"]) execute(target, renameLayerCommand(session, B, name));

        const seen = [];
        while (target.undo()) seen.push(layer(session.doc, B).name);

        expect(seen).toEqual(["b", "a", B]);
    });

    it("stores the name without surrounding white space", () => {
        const session = fixture();

        execute(history(session), renameLayerCommand(session, B, "  walk cycle \n"));

        expect(layer(session.doc, B).name).toBe("walk cycle");
        expect(normalizeLayerName(" ink ")).toBe("ink");
    });

    it("accepts a name another layer has: names need not be unique", () => {
        const session = fixture();

        execute(history(session), renameLayerCommand(session, B, A));

        expect(session.doc.layers.map((entry) => entry.name)).toEqual([A, A, C]);
    });

    it("rejects an empty name and an unknown layer before anything changes", () => {
        const session = fixture();
        const before = stateOf(session);
        const target = history(session);

        for (const name of ["", "   ", "\t\n"]) {
            const error = thrownBy(() => execute(target, renameLayerCommand(session, B, name)));
            expect(error).toBeInstanceOf(LayerError);
            expect(error).toMatchObject({ name: "LayerError", code: "name" });
            expect(isLayerName(name)).toBe(false);
        }
        expect(thrownBy(() => renameLayerCommand(session, "missing", "x"))).toMatchObject({
            code: "layer-not-found",
        });
        expect(isLayerName("ink")).toBe(true);
        expect(stateOf(session)).toStrictEqual(before);
        expect(target.undoCount).toBe(0);
    });

    it("touches no pixels, layers or frames", () => {
        expect(made(renameLayerCommand(fixture(), B, "x")).touched).toEqual(NOTHING);
    });

    it("makes no command when the layer has the name already", () => {
        const session = fixture();
        const target = history(session);

        expect(renameLayerCommand(session, B, B)).toBeNull();
        // White space around the name does not make it another name.
        expect(renameLayerCommand(session, B, `  ${B}\n`)).toBeNull();
        expect(renameLayerCommand(session, B, A)).not.toBeNull();

        execute(target, renameLayerCommand(session, B, "Outline"));
        expect(renameLayerCommand(session, B, "Outline")).toBeNull();
        expect(renameLayerCommand(session, B, B)).not.toBeNull();
        expect(target.undoCount).toBe(1);
    });
});

describe("set layer visible", () => {
    it("hides and shows the layer, which the composite follows", () => {
        const session = fixture();
        const shown = composites(session.doc);
        const target = history(session);

        execute(target, setLayerVisibleCommand(session, C, false));

        expect(layer(session.doc, C).visible).toBe(false);
        expect(target.undoLabel).toBe("Hide Layer");
        expect(composites(session.doc)).toStrictEqual(compositesOf(session.doc, [A, B]));
        expect(composites(session.doc)).not.toStrictEqual(shown);

        execute(target, setLayerVisibleCommand(session, C, true));
        expect(target.undoLabel).toBe("Show Layer");
        expect(composites(session.doc)).toStrictEqual(shown);
    });

    it("makes no command when the layer is shown or hidden already", () => {
        const session = fixture();
        const target = history(session);

        expect(setLayerVisibleCommand(session, B, true)).toBeNull();
        execute(target, setLayerVisibleCommand(session, B, false));
        // Hiding a hidden layer is no step: one undo shows the layer again.
        expect(setLayerVisibleCommand(session, B, false)).toBeNull();
        expect(target.undoCount).toBe(1);

        undo(target);
        expect(layer(session.doc, B).visible).toBe(true);
        expect(target.canUndo).toBe(false);
    });

    it("undo restores the visibility the layer has when the command is done, not when it was made", () => {
        const session = fixture();
        const target = history(session);
        // Both made while the layer is visible; in one step the second finds it hidden.
        const hide = made(setLayerVisibleCommand(session, B, false));
        const hideAgain = made(setLayerVisibleCommand(session, B, false));
        execute(target, compositeCommand("Hide Twice", [hide, hideAgain]));
        expect(layer(session.doc, B).visible).toBe(false);

        undo(target);

        expect(layer(session.doc, B).visible).toBe(true);
    });

    it("leaves the active layer active when it is hidden", () => {
        const session = fixture();

        execute(history(session), setLayerVisibleCommand(session, B, false));

        expect(session.activeLayerId).toBe(B);
    });

    it("touches the layer and the frames where it has a cel, not the structure", () => {
        const session = fixture();

        expect(made(setLayerVisibleCommand(session, A, false)).touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: [A],
            structure: false,
        });
    });

    it("rejects a layer the document does not have", () => {
        expect(thrownBy(() => setLayerVisibleCommand(fixture(), "missing", true))).toMatchObject({
            name: "LayerError",
            code: "layer-not-found",
        });
    });
});

describe("set layer locked", () => {
    it("locks and unlocks the layer; undo restores the lock it had", () => {
        const session = fixture();
        const pixelsBefore = composites(session.doc);
        const target = history(session);

        execute(target, setLayerLockedCommand(session, A, true));
        expect(layer(session.doc, A).locked).toBe(true);
        expect(target.undoLabel).toBe("Lock Layer");
        execute(target, setLayerLockedCommand(session, A, false));
        expect(layer(session.doc, A).locked).toBe(false);
        expect(target.undoLabel).toBe("Unlock Layer");

        undo(target);
        expect(layer(session.doc, A).locked).toBe(true);
        undo(target);
        expect(layer(session.doc, A).locked).toBe(false);
        expect(composites(session.doc)).toStrictEqual(pixelsBefore);
    });

    it("touches no pixels, layers or frames, and rejects an unknown layer", () => {
        const session = fixture();

        expect(made(setLayerLockedCommand(session, A, true)).touched).toEqual(NOTHING);
        expect(thrownBy(() => setLayerLockedCommand(session, "missing", true))).toMatchObject({
            code: "layer-not-found",
        });
    });

    it("makes no command when the layer is locked or unlocked already", () => {
        const session = fixture();
        const target = history(session);

        expect(setLayerLockedCommand(session, A, false)).toBeNull();
        execute(target, setLayerLockedCommand(session, A, true));
        expect(setLayerLockedCommand(session, A, true)).toBeNull();
        expect(setLayerLockedCommand(session, A, false)).not.toBeNull();
        expect(target.undoCount).toBe(1);
    });
});

describe("set layer opacity", () => {
    it("sets the opacity, which the composite follows; undo restores the previous value", () => {
        const session = fixture();
        const before = composites(session.doc);
        const target = history(session);

        execute(target, setLayerOpacityCommand(session, B, 255));

        expect(layer(session.doc, B).opacity).toBe(255);
        expect(target.undoLabel).toBe("Layer Opacity");
        expect(composites(session.doc)).not.toStrictEqual(before);

        undo(target);
        expect(layer(session.doc, B).opacity).toBe(128);
        expect(composites(session.doc)).toStrictEqual(before);
    });

    it("accepts 0 and 255 and every integer between", () => {
        const session = fixture();
        const target = history(session);

        for (const opacity of [0, 1, 254, 255]) {
            execute(target, setLayerOpacityCommand(session, A, opacity));
            expect(layer(session.doc, A).opacity).toBe(opacity);
        }
    });

    it("rejects a value outside 0..255 with a typed error before anything changes", () => {
        const session = fixture();
        const before = stateOf(session);

        for (const opacity of [-1, 256, 127.5, Number.NaN, Infinity]) {
            const error = thrownBy(() => setLayerOpacityCommand(session, B, opacity));
            expect(error, String(opacity)).toBeInstanceOf(LayerError);
            expect(error, String(opacity)).toMatchObject({ code: "opacity" });
        }
        expect(thrownBy(() => setLayerOpacityCommand(session, "missing", 1))).toMatchObject({
            code: "layer-not-found",
        });
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("touches the layer and the frames where it has a cel, not the structure", () => {
        expect(made(setLayerOpacityCommand(fixture(), C, 10)).touched).toEqual({
            frameIds: [F1, F2, F3],
            layerIds: [C],
            structure: false,
        });
    });

    it("makes no command when the layer has the opacity already", () => {
        const session = fixture();
        const target = history(session);

        expect(setLayerOpacityCommand(session, A, 255)).toBeNull();
        expect(setLayerOpacityCommand(session, B, 128)).toBeNull();
        execute(target, setLayerOpacityCommand(session, B, 0));
        expect(setLayerOpacityCommand(session, B, 0)).toBeNull();
        expect(setLayerOpacityCommand(session, B, 128)).not.toBeNull();
        expect(target.undoCount).toBe(1);
        // A value outside the range is an error, also when nothing else would change.
        expect(() => setLayerOpacityCommand(session, B, 256)).toThrow(LayerError);
    });
});

describe("set layer blend mode", () => {
    it("sets the blend mode; undo restores the previous one", () => {
        const session = fixture();
        const target = history(session);

        execute(target, setLayerBlendModeCommand(session, B, "multiply"));
        expect(layer(session.doc, B)).toMatchObject({ blend: "multiply" });
        expect(target.undoLabel).toBe("Blend Mode");
        execute(target, setLayerBlendModeCommand(session, B, "screen"));

        undo(target);
        expect(layer(session.doc, B)).toMatchObject({ blend: "multiply" });
        undo(target);
        expect(layer(session.doc, B)).toMatchObject({ blend: "normal" });
    });

    it("accepts every blend mode of the model", () => {
        const session = fixture();
        const target = history(session);

        const modes = Object.keys(BLEND_FUNCTIONS) as BlendMode[];
        expect(modes).toHaveLength(19);
        // From the last mode on, so that the first of the list is a change as well.
        execute(target, setLayerBlendModeCommand(session, A, modes[18]));
        for (const blend of modes) {
            execute(target, setLayerBlendModeCommand(session, A, blend));
            expect(layer(session.doc, A)).toMatchObject({ blend });
        }
        expect(target.undoCount).toBe(20);
    });

    it("rejects a value that is not a blend mode, and an unknown layer", () => {
        const session = fixture();
        const before = stateOf(session);

        for (const blend of ["", "Normal", "toString", "constructor"]) {
            const error = thrownBy(() => setLayerBlendModeCommand(session, B, blend as BlendMode));
            expect(error, blend).toBeInstanceOf(LayerError);
            expect(error, blend).toMatchObject({ code: "blend-mode" });
        }
        expect(
            thrownBy(() => setLayerBlendModeCommand(session, "missing", "normal")),
        ).toMatchObject({ code: "layer-not-found" });
        expect(stateOf(session)).toStrictEqual(before);
    });

    it("touches the layer and the frames where it has a cel, not the structure", () => {
        expect(made(setLayerBlendModeCommand(fixture(), B, "hue")).touched).toEqual({
            frameIds: [F1, F2, F3, F4],
            layerIds: [B],
            structure: false,
        });
    });

    it("makes no command when the layer has the blend mode already", () => {
        const session = fixture();
        const target = history(session);

        expect(setLayerBlendModeCommand(session, B, "normal")).toBeNull();
        execute(target, setLayerBlendModeCommand(session, B, "multiply"));
        expect(setLayerBlendModeCommand(session, B, "multiply")).toBeNull();
        expect(setLayerBlendModeCommand(session, B, "normal")).not.toBeNull();
        expect(target.undoCount).toBe(1);
    });
});

describe("property commands as one step", () => {
    it("name and opacity in one composite are one history entry", () => {
        const session = fixture();
        const start = stateOf(session);
        const target = history(session);
        const command = compositeCommand("Layer Properties", [
            made(renameLayerCommand(session, B, "Outline")),
            made(setLayerOpacityCommand(session, B, 40)),
        ]);

        execute(target, command);

        expect(target.undoCount).toBe(1);
        expect(layer(session.doc, B)).toMatchObject({ name: "Outline", opacity: 40 });
        expect(command.touched).toEqual({
            frameIds: [F1, F2, F3, F4],
            layerIds: [B],
            structure: false,
        });
        undo(target);
        expect(stateOf(session)).toStrictEqual(start);
    });

    it("three layers hidden in one composite come back with one undo", () => {
        const session = fixture();
        const target = history(session);

        execute(
            target,
            compositeCommand(
                "Hide Layers",
                [A, B, C].map((id) => made(setLayerVisibleCommand(session, id, false))),
            ),
        );
        expect(session.doc.layers.map((entry) => entry.visible)).toEqual([false, false, false]);

        undo(target);
        expect(session.doc.layers.map((entry) => entry.visible)).toEqual([true, true, true]);
    });

    it("no property command retains pixel memory", () => {
        const session = fixture();

        expect(
            [
                renameLayerCommand(session, B, "x"),
                setLayerVisibleCommand(session, B, false),
                setLayerLockedCommand(session, B, true),
                setLayerOpacityCommand(session, B, 1),
                setLayerBlendModeCommand(session, B, "color"),
            ].map((command) => made(command).bytes),
        ).toEqual([0, 0, 0, 0, 0]);
    });

    it("a popover that changed one of two values makes its step from the command that is made", () => {
        const session = fixture();
        const target = history(session);
        // The name is the one the layer has; only the opacity is a change.
        const parts = [
            renameLayerCommand(session, B, B),
            setLayerOpacityCommand(session, B, 40),
        ].filter((command) => command !== null);

        expect(parts).toHaveLength(1);
        execute(target, compositeCommand("Layer Properties", parts));

        expect(layer(session.doc, B)).toMatchObject({ name: B, opacity: 40 });
        undo(target);
        expect(layer(session.doc, B).opacity).toBe(128);
    });
});
