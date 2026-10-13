import type { ExportSettings, SpriteDoc } from "../model";
import { MAX_ATLAS_ID_LENGTH } from "./atlasFormat";

// The names of an export (SPEC §9.1, §9.3, §9.5), derived from the names the user gave the
// document and its tags. A user's name reaches a file only as a slug, so every file name, ID
// and identifier is made of ASCII letters, digits and "-", whatever was typed: no name can
// leave its folder, end a comment or a string, or differ from another only by case.

/** Longest slug, in characters. File names and IDs stay short however long the name is. */
export const MAX_SLUG_LENGTH = 64;

/** Slug of a document whose name leaves nothing (SPEC §9.1). */
const FALLBACK_NAME = "sprite";

/** Slug of a tag whose name leaves nothing. */
const FALLBACK_TAG = "tag";

/**
 * Base names Windows keeps for devices, whatever the extension: `con.png` cannot be
 * written there.
 */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * The slug of a name, or "" when nothing of the name is left:
 * 1. the letters A–Z become a–z. No other character is changed: there is no Unicode case
 *    mapping and no transliteration ("É" is not "e"), so the result does not depend on the
 *    Unicode tables of the browser;
 * 2. every run of characters other than a–z and 0–9 becomes one "-";
 * 3. a "-" at the start or the end is removed;
 * 4. the result is cut to `MAX_SLUG_LENGTH` characters, and a "-" the cut leaves at the end
 *    is removed.
 * A slug matches `[a-z0-9][a-z0-9-]*`, has no "--" and does not end with "-".
 */
function slugify(text: string): string {
    const slug = text
        .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return slug.slice(0, MAX_SLUG_LENGTH).replace(/-$/, "");
}

/**
 * `<name>` of SPEC §9.1: the base name of every file of a bundle, the prefix of its frame
 * IDs and the ID of its image in NGNE. It is the slug of the document's name (see
 * `slugify`); `sprite` when the slug is empty; and with `-sprite` appended when the slug is
 * a device name of Windows (`con` gives `con-sprite`).
 */
export function exportName(documentName: string): string {
    const slug = slugify(documentName) || FALLBACK_NAME;
    return DEVICE_NAME.test(slug) ? `${slug}-${FALLBACK_NAME}` : slug;
}

function capitalized(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The two forms of a document's name in the identifiers of `<name>.sprites.ts`. */
export interface ExportIdentifiers {
    /** `<name>` of SPEC §9.5, as in `<name>Image`: starts with a lower-case letter. */
    camel: string;
    /** `<Name>` of SPEC §9.5, as in `draw<Name>`: `camel` with its first letter in upper case. */
    pascal: string;
}

/**
 * The identifier forms of a document's name (SPEC §9.5): the parts of `exportName` between
 * its hyphens joined in camel case, with `sprite` in front when that starts with a digit.
 * `Hero Walk` gives `heroWalk` and `HeroWalk`; `2d-hero` gives `sprite2dHero` and
 * `Sprite2dHero`. Both are made of ASCII letters and digits.
 *
 * A generated module declares no identifier that is one of these alone. Each has a fixed
 * word before or after it: `<name>Image`, `<name>Atlas`, `<name>AnimationFrame`,
 * `<name>AnimationDone`, `draw<Name>`, `draw<Name>TopLeft`, and the types `<Name>FrameId` and
 * `<Name>AnimationId`. So a name such as `class` or `new` gives no reserved word, and the
 * sprite runtime, which every generated module carries, has no top-level name of one of
 * these forms.
 */
export function exportIdentifiers(documentName: string): ExportIdentifiers {
    const [first, ...rest] = exportName(documentName).split("-");
    const joined = first + rest.map(capitalized).join("");
    const camel = /^[0-9]/.test(joined) ? `${FALLBACK_NAME}${joined}` : joined;
    return { camel, pascal: capitalized(camel) };
}

/**
 * Whether the value has the form of a frame or animation ID of `ngne-sprite-atlas`: 1 to
 * `MAX_ATLAS_ID_LENGTH` characters of a–z, 0–9, `_` and `-`, the first a letter or a digit.
 * IDs have no upper-case letter, so no two IDs differ only by case.
 */
export function isAtlasId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length <= MAX_ATLAS_ID_LENGTH &&
        /^[a-z0-9][a-z0-9_-]*$/.test(value)
    );
}

/** The ID of the frame at `index` of the document (SPEC §9.3): `<name>-<index>`. */
export function frameId(name: string, index: number): string {
    return `${name}-${index}`;
}

/** The export name of one tag of a document. */
export interface TagAnimationId {
    tagId: string;
    /** The slug of the tag's name; `tag` when the name leaves nothing. */
    slug: string;
    /**
     * The ID of the tag's animation in the atlas: the slug, or the slug with `-2`, `-3`, …
     * when an earlier tag has taken it. It differs from `slug` when the tag was renamed.
     */
    id: string;
}

/**
 * The animation ID of every tag of a document, in the order of its tags (SPEC §9.3). The
 * first tag of a slug keeps it; each later one takes the lowest suffix from `-2` that gives
 * an ID no earlier tag has. Names that differ only by case, or by characters a slug drops,
 * have one slug: `Walk`, `walk` and `WALK!` become `walk`, `walk-2` and `walk-3`.
 *
 * An ID depends on the tags before it and not on what is exported: a tag exported alone
 * (`exportSettings.frames`) keeps the ID it has in the full export.
 */
export function animationIds(doc: Pick<SpriteDoc, "tags">): TagAnimationId[] {
    const taken = new Set<string>();
    /** By slug: the suffix to try next. */
    const next = new Map<string, number>();
    return doc.tags.map((tag) => {
        const slug = slugify(tag.name) || FALLBACK_TAG;
        let id = slug;
        let suffix = next.get(slug) ?? 2;
        while (taken.has(id)) id = `${slug}-${suffix++}`;
        next.set(slug, suffix);
        taken.add(id);
        return { tagId: tag.id, slug, id };
    });
}

/**
 * The file names of the bundle of a document, in the order of SPEC §9.1: the image and the
 * atlas JSON, then each optional file the settings switch on.
 */
export function bundleFileNames(documentName: string, files: ExportSettings["files"]): string[] {
    const name = exportName(documentName);
    const names = [`${name}.png`, `${name}.atlas.json`];
    if (files.spritesTs) names.push(`${name}.sprites.ts`);
    if (files.previewConfig) names.push(`${name}.preview.config.mjs`);
    if (files.asepriteJson !== "none") names.push(`${name}.aseprite.json`);
    return names;
}
