import { MAX_ATLAS_EXTRUDE, MAX_ATLAS_PADDING } from "../../core/export";
import type { ExportSettings, SpriteDoc } from "../../core/model";

// The changes the Export dialog makes to a document's export settings (SE-052 review): plain
// values, checked here before the `ExportSettings` setter applies them, so no code of the
// interface runs on the document's own settings object.

/** Some of the export settings, and some of their files. */
export type ExportSettingsPatch = Partial<Omit<ExportSettings, "files">> & {
    files?: Partial<ExportSettings["files"]>;
};

const LAYOUTS: readonly unknown[] = ["grid", "row", "column"];
const ASEPRITE_FORMS: readonly unknown[] = ["none", "array", "hash"];

function wholeIn(value: unknown, max: number): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * What keeps the patch from applying to the document's export settings, or null when it
 * applies: a value of the wrong type or outside its range (SPEC §5.1, §9.4), or a tag the
 * document does not have.
 */
export function exportSettingsProblem(
    doc: Pick<SpriteDoc, "tags">,
    patch: ExportSettingsPatch,
): string | null {
    const { layout, padding, extrude, frames, files } = patch;
    if (layout !== undefined && !LAYOUTS.includes(layout)) return `Unknown layout "${layout}".`;
    if (padding !== undefined && !wholeIn(padding, MAX_ATLAS_PADDING)) {
        return `The padding must be a whole number from 0 to ${MAX_ATLAS_PADDING}.`;
    }
    if (extrude !== undefined && !wholeIn(extrude, MAX_ATLAS_EXTRUDE)) {
        return `The extrusion must be a whole number from 0 to ${MAX_ATLAS_EXTRUDE}.`;
    }
    for (const key of ["trim", "mergeDuplicates", "exportOnSave"] as const) {
        const value = patch[key];
        if (value !== undefined && typeof value !== "boolean") return `"${key}" is on or off.`;
    }
    if (frames !== undefined && frames !== "all") {
        const tagId: unknown = typeof frames === "object" && frames ? frames.tagId : null;
        if (!doc.tags.some((tag) => tag.id === tagId)) {
            return "The frames to export are all frames or a tag of the document.";
        }
    }
    if (files) {
        for (const key of ["spritesTs", "previewConfig"] as const) {
            const value = files[key];
            if (value !== undefined && typeof value !== "boolean") return `"${key}" is on or off.`;
        }
        if (files.asepriteJson !== undefined && !ASEPRITE_FORMS.includes(files.asepriteJson)) {
            return `Unknown Aseprite JSON form "${files.asepriteJson}".`;
        }
    }
    return null;
}

/** Applies a checked patch to export settings (the setter's update). */
export function applyExportSettingsPatch(
    settings: ExportSettings,
    patch: ExportSettingsPatch,
): void {
    const { files, frames, ...rest } = patch;
    // A key given as undefined changes nothing.
    const defined = (values: object) =>
        Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
    Object.assign(settings, defined(rest));
    if (frames !== undefined) settings.frames = frames === "all" ? "all" : { tagId: frames.tagId };
    if (files) Object.assign(settings.files, defined(files));
}
