import { describe, expect, it } from "vitest";
import { installFileWorkflows } from "../../src/app/file/install";
import {
    canKeepReference,
    ditherChoiceOf,
    ditherOf,
    initialForm,
    placeProblem,
    referenceRectOf,
    rememberedOf,
    settingsOf,
} from "../../src/app/import/importForm";
import type { ImportForm, ImportTarget } from "../../src/app/import/importForm";
import { decodeSources, isImageDrop } from "../../src/app/import/importWorkflow";
import { baseNameOf } from "../../src/app/import/pickImages";
import { defaultPreferences } from "../../src/app/preferences/preferences";
import type { ImportPreference } from "../../src/app/preferences/preferences";
import type { ChosenFile } from "../../src/app/platform/projectFiles";
import { createSessionsStore } from "../../src/app/state/sessions";
import { fitRect } from "../../src/core/import";
import { PRESET_PALETTES } from "../../src/core/palettes";
import { encodePng } from "../../src/core/png";
import { fitPlacement } from "../../src/core/references";

// SE-044: the settings of the Import PNG dialog: defaults from the preference store, what the
// session remembers, the settings of `core/import` they stand for, when "Keep source as
// reference" is available and where its layer goes, and how a drop reaches the import.

const preference: ImportPreference = {
    ...defaultPreferences().import,
    targetWidth: 24,
    targetHeight: 40,
    resample: "nearest",
    alphaThreshold: 99,
    colors: 12,
    dither: "ordered",
};
const target: ImportTarget = {
    width: 16,
    height: 16,
    palette: { name: "Mine", colors: [0x000000ff, 0xffffffff] },
};

describe("the dialog's form", () => {
    it("opens with the preferences: size without a sprite, resampling, threshold, count, dither; fit contain", () => {
        const form = initialForm(preference, null, {});
        expect(form).toMatchObject({
            width: 24,
            height: 40,
            fit: "contain",
            resample: "nearest",
            alpha: "smart",
            threshold: 99,
            colors: "smart",
            count: 12,
            dither: "ordered",
            place: "new",
            crop: null,
            cells: "single",
        });
        // With a sprite open the target size is the sprite's.
        expect(initialForm(preference, target, {})).toMatchObject({ width: 16, height: 16 });
    });

    it('maps the stored dither "ordered" to core\'s "bayer" and back (REVIEW D36)', () => {
        expect(ditherOf("ordered")).toBe("bayer");
        expect(ditherOf("none")).toBe("none");
        expect(ditherOf("floyd-steinberg")).toBe("floyd-steinberg");
        expect(ditherChoiceOf("bayer")).toBe("ordered");
        const { settings } = settingsOf(initialForm(preference, null, {}), 1, null);
        expect(settings.dither).toBe("bayer");
        expect(settings.size.fit).toBe("contain");
    });

    it("remembers for the session the fields changed in the last import, not the crop", () => {
        const form: ImportForm = {
            ...initialForm(preference, null, {}),
            fit: "cover",
            resample: "dominant",
            crop: { x: 1, y: 1, width: 4, height: 4 },
            keepReference: true,
            width: 64,
        };
        const kept = rememberedOf(form, new Set(["fit", "crop", "keepReference", "width"]), {
            dither: "none",
        });
        expect(kept).toEqual({ fit: "cover", width: 64, dither: "none" });
        // The next dialog starts from them: the size only while no sprite is open.
        expect(initialForm(preference, null, kept)).toMatchObject({
            fit: "cover",
            width: 64,
            dither: "none",
            resample: "nearest",
            crop: null,
            keepReference: false,
        });
        expect(initialForm(preference, target, kept)).toMatchObject({ fit: "cover", width: 16 });
        // A place into a sprite is kept only while one is open.
        const into = rememberedOf({ ...form, place: "layer" }, new Set(["place"]), {});
        expect(initialForm(preference, target, into).place).toBe("layer");
        expect(initialForm(preference, null, into).place).toBe("new");
    });

    it("stands for the settings of core/import, smart steps left to the worker", () => {
        const form: ImportForm = {
            ...initialForm(preference, target, {}),
            crop: { x: 2, y: 3, width: 10, height: 8 },
            cells: "grid",
            gridBy: "count",
            columns: 2,
            rows: 1,
            spacingX: 1,
            colorKey: true,
            keyColor: 0xff00ffff,
            keyTolerance: 4,
        };
        const { settings, smart } = settingsOf(form, 1, target.palette);
        expect(settings).toEqual({
            region: { x: 2, y: 3, width: 10, height: 8 },
            cells: {
                mode: "grid",
                grid: {
                    cell: { columns: 2, rows: 1 },
                    offset: { x: 0, y: 0 },
                    spacing: { x: 1, y: 0 },
                    skipEmpty: false,
                },
            },
            size: { width: 16, height: 16, fit: "contain" },
            resample: "nearest",
            alpha: { colorKey: { color: 0xff00ffff, tolerance: 4 } },
            colors: { mode: "keep" },
            dither: "bayer",
        });
        expect(smart).toEqual({ alpha: true, colors: true, threshold: 99, count: 12 });
        // Several files: no grid.
        expect(settingsOf(form, 3, null).settings.cells).toBeUndefined();
        // The user's choices.
        const chosen = settingsOf(
            { ...form, alpha: "threshold", threshold: 7, colors: "reduce", count: 3 },
            1,
            null,
        );
        expect(chosen.settings.alpha.threshold).toBe(7);
        expect(chosen.settings.colors).toEqual({ mode: "reduce", count: 3 });
        expect(chosen.smart).toMatchObject({ alpha: false, colors: false });
        expect(
            settingsOf({ ...form, colors: "document" }, 1, target.palette).settings.colors,
        ).toEqual({
            mode: "palette",
            palette: target.palette,
        });
        const preset = PRESET_PALETTES[2]!;
        const mapped = settingsOf({ ...form, colors: `preset:${preset.id}` }, 1, null).settings;
        expect(mapped.colors).toEqual({
            mode: "palette",
            palette: { name: preset.name, colors: [...preset.colors] },
        });
    });

    it("offers Keep source as reference for one source image as a single sprite only", () => {
        const form = initialForm(preference, null, {});
        expect(canKeepReference(form, 1)).toBe(true);
        expect(canKeepReference({ ...form, cells: "grid" }, 1)).toBe(false);
        expect(canKeepReference(form, 3)).toBe(false);
    });

    it("blocks a place into a sprite of another size with a message", () => {
        const form = initialForm(preference, target, {});
        expect(placeProblem({ ...form, place: "frames" }, target)).toBeNull();
        expect(placeProblem({ ...form, place: "frames", width: 32 }, target)).toBe(
            "Appending frames needs the target size to equal the sprite size, 16 × 16.",
        );
        expect(placeProblem({ ...form, place: "layer", height: 8 }, target)).toBe(
            "A new layer needs the target size to equal the sprite size, 16 × 16.",
        );
        expect(placeProblem({ ...form, place: "new", width: 32 }, target)).toBeNull();
        expect(placeProblem({ ...form, place: "frames" }, null)).not.toBeNull();
    });
});

describe("where the reference of the cropped region goes", () => {
    /** The rectangle the reference covers once `fitPlacement` placed the region. */
    function placed(
        region: { width: number; height: number },
        fit: "stretch" | "contain" | "cover",
    ) {
        const size = { width: 32, height: 32 };
        const rect = referenceRectOf(region, size, fit);
        const placement = fitPlacement(region.width, region.height, rect);
        return {
            x: placement.x,
            y: placement.y,
            width: region.width * placement.scale,
            height: region.height * placement.scale,
        };
    }

    it("covers the canvas for a region of its aspect ratio, with every fit", () => {
        for (const fit of ["stretch", "contain", "cover"] as const) {
            expect(placed({ width: 64, height: 64 }, fit)).toEqual({
                x: 0,
                y: 0,
                width: 32,
                height: 32,
            });
        }
    });

    it("lies on the fitted image for contain, and for stretch as contain places it", () => {
        const fitted = fitRect(64, 32, 32, 32, "contain").target;
        for (const fit of ["contain", "stretch"] as const) {
            expect(placed({ width: 64, height: 32 }, fit)).toEqual(fitted);
        }
    });

    it("for cover, overflows the canvas as the region does, its shown part on the canvas", () => {
        // 64 × 32 covering 32 × 32: scale 1, the middle 32 columns shown.
        expect(placed({ width: 64, height: 32 }, "cover")).toEqual({
            x: -16,
            y: 0,
            width: 64,
            height: 32,
        });
    });
});

describe("files for the import", () => {
    it("decodes PNG files in natural name order and names each file it cannot read", async () => {
        const png = (value: number) =>
            encodePng({ width: 1, height: 1, data: new Uint8ClampedArray([value, 0, 0, 255]) });
        const file = (name: string, bytes: Uint8Array) => ({ name, read: async () => bytes });
        const { sources, errors } = await decodeSources([
            file("f10.png", png(10)),
            file("notes.txt", new TextEncoder().encode("hello")),
            file("f9.png", png(9)),
        ]);
        expect(sources.map((source) => source.name)).toEqual(["f9.png", "f10.png"]);
        expect(sources[0]!.pixels.data[0]).toBe(9);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^“notes\.txt” could not be read as a PNG image\./);
    });

    it("names a document or layer by the file without its extension", () => {
        expect(baseNameOf("walk.png", "Sprite")).toBe("walk");
        expect(baseNameOf("a.b.PNG", "Sprite")).toBe("a.b");
        expect(baseNameOf(".png", "Sprite")).toBe("Sprite");
    });

    it("a drop with a PNG file and no project file goes to the import, with the drop point", () => {
        expect(isImageDrop(["a.png"])).toBe(true);
        expect(isImageDrop(["notes.txt", "B.PNG"])).toBe(true);
        expect(isImageDrop(["notes.txt"])).toBe(false);

        const target = new EventTarget();
        const opened: string[][] = [];
        const imported: { names: string[]; point: { x: number; y: number } }[] = [];
        const stop = installFileWorkflows({
            target,
            sessions: createSessionsStore(),
            overlayOpen: () => false,
            workflows: {
                busy: false,
                async openFiles(files: readonly ChosenFile[]) {
                    opened.push(files.map((file) => file.name));
                    return true;
                },
            },
            importImages: (files, point) =>
                imported.push({ names: files.map((file) => file.name), point }),
        });
        const drop = (names: string[]) => {
            const event = new Event("drop", { cancelable: true });
            const items = names.map((name) => ({
                kind: "file",
                getAsFile: () => new File([Uint8Array.of(1)], name),
            }));
            Object.assign(event, {
                dataTransfer: { types: ["Files"], items, files: [], dropEffect: "none" },
                clientX: 120,
                clientY: 80,
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(drop(["walk.png", "notes.txt"])).toBe(true);
        expect(drop(["hero.ngsprite", "walk.png"])).toBe(true);
        expect(drop(["notes.txt"])).toBe(true);
        expect(imported).toEqual([{ names: ["walk.png", "notes.txt"], point: { x: 120, y: 80 } }]);
        // A project file wins; a file that is neither is reported by `openFiles`, as before.
        expect(opened).toEqual([["hero.ngsprite", "walk.png"], ["notes.txt"]]);
        stop();
    });
});
