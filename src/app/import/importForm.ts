import { fitRect } from "../../core/import";
import type {
    AlphaOptions,
    ColorSettings,
    DitherMethod,
    GridOptions,
    ImportPaletteMode,
    ImportSettings,
    ResampleFit,
    ResampleMethod,
} from "../../core/import";
import type { Palette } from "../../core/model";
import { paletteFromPreset, presetPalette } from "../../core/palettes";
import type { PixelRect } from "../../core/pixels";
import type { ReferenceRect } from "../../core/references";
import type { ImportPreference } from "../preferences/preferences";

// The settings of the Import PNG dialog (SPEC §8, DESIGN §7; SE-044): one field per control,
// the defaults it opens with, what it remembers for the session, and the `ImportSettings` of
// `core/import` it stands for.

/** Where the frames go (step 9): a new document, new frames, or a new layer of the active one. */
export type ImportPlace = "new" | "frames" | "layer";

/**
 * Step 6 and step 7 start "smart" (SPEC §8): the choice of `smartDefaults` for the cells, with
 * the threshold and the colour count of the preferences. A choice of the user replaces it.
 */
export type AlphaChoice = "smart" | "keep" | "threshold";

/** Step 7: keep, reduce, map to the document palette, or to a preset (`preset:<id>`). */
export type ColorsChoice = "smart" | "keep" | "reduce" | "document" | `preset:${string}`;

/** The stored dither preference says "ordered" where `core/import` says "bayer" (REVIEW D36). */
export type DitherChoice = "none" | "ordered" | "floyd-steinberg";

export interface ImportForm {
    /** Step 2: the crop rectangle, in source pixels; null for the whole image. */
    crop: PixelRect | null;
    /** Step 3, for a single source image. */
    cells: "single" | "grid";
    /** The grid: by cell size or by columns × rows. */
    gridBy: "size" | "count";
    cellWidth: number;
    cellHeight: number;
    columns: number;
    rows: number;
    offsetX: number;
    offsetY: number;
    spacingX: number;
    spacingY: number;
    skipEmpty: boolean;
    /** Step 4. */
    width: number;
    height: number;
    fit: ResampleFit;
    /** Step 5. */
    resample: ResampleMethod;
    /** Step 6. */
    alpha: AlphaChoice;
    threshold: number;
    colorKey: boolean;
    /** 0xRRGGBBAA; the alpha byte is not used. */
    keyColor: number;
    keyTolerance: number;
    /** Step 7. */
    colors: ColorsChoice;
    count: number;
    /** Step 8. */
    dither: DitherChoice;
    /** Step 9. */
    place: ImportPlace;
    paletteMode: ImportPaletteMode;
    keepReference: boolean;
}

/** The fields the session remembers once an import was made with them. */
export type RememberedField = Exclude<keyof ImportForm, "crop" | "keepReference">;

/** What the dialog knows of the document it may import into. */
export interface ImportTarget {
    width: number;
    height: number;
    palette: Palette;
}

export function ditherOf(choice: DitherChoice): DitherMethod {
    return choice === "ordered" ? "bayer" : choice;
}

export function ditherChoiceOf(method: DitherMethod): DitherChoice {
    return method === "bayer" ? "ordered" : method;
}

/**
 * The form the dialog opens with: the defaults of SPEC §8 and the preferences (target size
 * when no document is open, resampling, threshold, colour count, dither; fit "contain", the
 * preference store having no fit), then what this session remembers. With a document open the
 * target size is the document's and the frames go into it as new frames when the session last
 * placed them so; without one they go into a new document.
 */
export function initialForm(
    preference: ImportPreference,
    target: ImportTarget | null,
    remembered: Partial<Pick<ImportForm, RememberedField>>,
    options: { keepReference?: boolean } = {},
): ImportForm {
    const form: ImportForm = {
        crop: null,
        cells: "single",
        gridBy: "size",
        cellWidth: preference.targetWidth,
        cellHeight: preference.targetHeight,
        columns: 1,
        rows: 1,
        offsetX: 0,
        offsetY: 0,
        spacingX: 0,
        spacingY: 0,
        skipEmpty: false,
        width: preference.targetWidth,
        height: preference.targetHeight,
        fit: "contain",
        resample: preference.resample,
        alpha: "smart",
        threshold: preference.alphaThreshold,
        colorKey: false,
        keyColor: 0xff00ffff,
        keyTolerance: 0,
        colors: "smart",
        count: preference.colors,
        dither: preference.dither,
        place: "new",
        paletteMode: "replace",
        keepReference: options.keepReference ?? false,
        ...remembered,
    };
    if (target) {
        form.width = target.width;
        form.height = target.height;
    } else {
        form.place = "new";
    }
    if (form.colors === "document" && !target) form.colors = "smart";
    return form;
}

/** The fields of `form` to remember: those the user changed, and those remembered before. */
export function rememberedOf(
    form: ImportForm,
    changed: ReadonlySet<keyof ImportForm>,
    before: Partial<Pick<ImportForm, RememberedField>>,
): Partial<Pick<ImportForm, RememberedField>> {
    const kept: Partial<Record<RememberedField, unknown>> = { ...before };
    for (const key of changed) {
        if (key === "crop" || key === "keepReference") continue;
        kept[key] = form[key];
    }
    return kept as Partial<Pick<ImportForm, RememberedField>>;
}

/** The grid of step 3 that the form describes. */
export function gridOf(form: ImportForm): GridOptions {
    return {
        cell:
            form.gridBy === "size"
                ? { width: form.cellWidth, height: form.cellHeight }
                : { columns: form.columns, rows: form.rows },
        offset: { x: form.offsetX, y: form.offsetY },
        spacing: { x: form.spacingX, y: form.spacingY },
        skipEmpty: form.skipEmpty,
    };
}

/** Whether `form` cuts a single source image into a grid. */
export function slices(form: ImportForm, sourceCount: number): boolean {
    return sourceCount === 1 && form.cells === "grid";
}

/**
 * Steps 6 and 7 still "smart": the worker decides them from the cells (`smartDefaults`), with
 * these values for a threshold and a reduction.
 */
export interface SmartChoices {
    alpha: boolean;
    colors: boolean;
    threshold: number;
    count: number;
}

/**
 * The settings of `core/import` the form stands for, steps 6 and 7 as far as the form decides
 * them: a smart step is given here as Keep and decided by the worker (`smart`).
 */
export function settingsOf(
    form: ImportForm,
    sourceCount: number,
    documentPalette: Palette | null,
): { settings: ImportSettings; smart: SmartChoices } {
    const colorKey = form.colorKey
        ? { color: form.keyColor >>> 0, tolerance: form.keyTolerance }
        : undefined;
    const alpha: AlphaOptions = {
        ...(form.alpha === "threshold" && { threshold: form.threshold }),
        ...(colorKey && { colorKey }),
    };
    let colors: ColorSettings = { mode: "keep" };
    if (form.colors === "reduce") colors = { mode: "reduce", count: form.count };
    if (form.colors === "document" && documentPalette) {
        colors = {
            mode: "palette",
            palette: { ...documentPalette, colors: [...documentPalette.colors] },
        };
    }
    if (form.colors.startsWith("preset:")) {
        const preset = presetPalette(form.colors.slice("preset:".length));
        if (preset) colors = { mode: "palette", palette: paletteFromPreset(preset) };
    }
    const settings: ImportSettings = {
        ...(form.crop && { region: { ...form.crop } }),
        ...(slices(form, sourceCount) && { cells: { mode: "grid", grid: gridOf(form) } }),
        size: { width: form.width, height: form.height, fit: form.fit },
        resample: form.resample,
        alpha,
        colors,
        dither: ditherOf(form.dither),
    };
    return {
        settings,
        smart: {
            alpha: form.alpha === "smart",
            colors: form.colors === "smart",
            threshold: form.threshold,
            count: form.count,
        },
    };
}

/**
 * Whether "Keep source as reference" is available (SPEC §8): for a single-sprite import only,
 * one source image not cut into a grid.
 */
export function canKeepReference(form: ImportForm, sourceCount: number): boolean {
    return sourceCount === 1 && form.cells === "single";
}

/**
 * Why the frames cannot go where the form says, for the dialog's message line; null when they
 * can. Into a document the target size must be the document's (SPEC §8).
 */
export function placeProblem(form: ImportForm, target: ImportTarget | null): string | null {
    if (form.place === "new") return null;
    if (!target) return "No sprite is open to import into.";
    if (form.width !== target.width || form.height !== target.height) {
        const into = form.place === "frames" ? "Appending frames" : "A new layer";
        return (
            `${into} needs the target size to equal the sprite size, ` +
            `${target.width} × ${target.height}.`
        );
    }
    return null;
}

/**
 * Where a reference layer of the cropped region goes, in document pixels, so that the region
 * overlays the pixels it was fitted to (SPEC §8): the whole region scaled as the fit scales
 * it, the shown part on the target pixels that show it. A reference layer has one scale, so
 * for "stretch" it is placed as "contain" places it; `fitPlacement` then fits the region into
 * this rectangle with one scale, which for "contain" may differ from a side's own scale by
 * the rounding of `fitRect` (under one document pixel).
 */
export function referenceRectOf(
    region: { width: number; height: number },
    size: { width: number; height: number },
    fit: ResampleFit,
): ReferenceRect {
    const shown = fitRect(
        region.width,
        region.height,
        size.width,
        size.height,
        fit === "stretch" ? "contain" : fit,
    );
    const sx = shown.target.width / shown.source.width;
    const sy = shown.target.height / shown.source.height;
    return {
        x: shown.target.x - shown.source.x * sx,
        y: shown.target.y - shown.source.y * sy,
        width: region.width * sx,
        height: region.height * sy,
    };
}
