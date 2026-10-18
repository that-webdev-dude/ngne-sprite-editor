import { MAX_NAME_LENGTH } from "../../core/model";
import type { Tag } from "../../core/model";
import { isTagRepeat, MAX_TAG_REPEAT } from "../../core/tags";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type {
    DialogRequestBase,
    DialogRequests,
    DialogState,
    DialogView,
} from "../dialogs/dialogRequests";

/**
 * The Tag dialog of the tag commands (DESIGN §7, SE-023): name, colour, range, direction and
 * repeat. New Tag… and Tag Properties… ask for it and wait for the answer; the dialog host
 * shows it (app/dialogs/dialogRequests.ts). Tag Properties… lets it choose among the tags at
 * the active frame and delete the one chosen, so every tag is reached from the keyboard, also
 * one that another tag covers. The document is changed by the command, never by the dialog
 * (SPEC §5).
 */

export type TagDirection = Tag["direction"];

/** What the Tag dialog edits. The range is in frame numbers, from 1, as the timeline shows. */
export interface TagValues {
    name: string;
    /** 0xRRGGBBAA. */
    color: number;
    from: number;
    to: number;
    direction: TagDirection;
    repeat: number;
}

/** A tag Tag Properties… can edit, with its values. */
export interface TagChoice {
    readonly id: string;
    /** What names it: "walk, frames 2–5" (`tagRangeLabel`). */
    readonly label: string;
    readonly values: TagValues;
}

/** What the Tag dialog answers: values to apply (to the tag chosen), or the tag to delete. */
export type TagAnswer =
    | {
          readonly action: "apply";
          /** The tag the values are for; null for a new tag. */
          readonly tagId: string | null;
          readonly values: TagValues;
      }
    | { readonly action: "delete"; readonly tagId: string };

export interface TagRequest {
    kind: "tag";
    /** `new`: the answer creates a tag (New tag, Create); `edit`: it changes one (OK). */
    mode: "new" | "edit";
    /** The values it opens with: the new tag's, or those of the tag `chosen`. */
    initial: TagValues;
    /** `edit`: the tags it can edit, in creation order; none for a new tag. */
    choices: readonly TagChoice[];
    /** `edit`: the tag it opens with, one of `choices`; null for a new tag. */
    chosen: string | null;
    /** Frames of the document: the range fields run from 1 to this. */
    frameCount: number;
    /** Apply or delete, or null to cancel. Closes the dialog. */
    answer(answer: TagAnswer | null): void;
}

export type TagDialogState = DialogState<TagRequest>;

/** Whether a request of the shared store is the Tag dialog, by its kind. */
export function isTagRequest(request: DialogRequestBase): request is TagRequest {
    return request.kind === "tag";
}

export interface TagDialogs {
    /** The open request when it is the Tag dialog, otherwise null. */
    readonly store: DialogView<TagRequest>;
    /** Attaches a host (`DialogRequests.attachHost`); returns the function that detaches it. */
    attachHost(): () => void;
    /** Opens the Tag dialog; resolves with what to apply or delete, or null. */
    tag(
        options: Pick<TagRequest, "mode" | "initial" | "choices" | "chosen" | "frameCount">,
    ): Promise<TagAnswer | null>;
}

/** The Tag dialog over `requests`: by default requests of its own, which a test attaches. */
export function createTagDialogs(requests: DialogRequests = createDialogRequests()): TagDialogs {
    return {
        store: dialogView(requests.store, isTagRequest),
        attachHost: () => requests.attachHost(),
        tag: (options) =>
            requests.open<TagAnswer>((answer): TagRequest => ({ kind: "tag", ...options, answer })),
    };
}

/** The Tag dialog of the app, shown by the app's one dialog host (`commandDialogs`). */
export const tagDialogs = createTagDialogs(commandDialogs);

/**
 * How a tag is named to assistive technology and in the dialog's choice of tags: its name and
 * its frames, numbered from 1 ("walk, frames 2–5"; "jump, frame 3").
 */
export function tagRangeLabel(name: string, from: number, to: number): string {
    return from === to ? `${name}, frame ${from}` : `${name}, frames ${from}–${to}`;
}

/** The name New Tag… proposes. */
export const NEW_TAG_NAME = "Tag";

/**
 * The colours a tag can be given with one click in the Tag dialog (DESIGN §7), 0xRRGGBBAA. A
 * new tag takes the first one no tag of the document has (`newTagColour`).
 */
export const TAG_COLOURS: readonly { readonly name: string; readonly color: number }[] = [
    { name: "Blue", color: 0x73bed3ff },
    { name: "Orange", color: 0xf2a65aff },
    { name: "Green", color: 0xa8ca58ff },
    { name: "Violet", color: 0xb48ee0ff },
    { name: "Yellow", color: 0xe8c65bff },
    { name: "Red", color: 0xe06c6cff },
    { name: "Teal", color: 0x4fb5a0ff },
    { name: "Pink", color: 0xe68ac1ff },
];

/**
 * The colour of a new tag: the first of `TAG_COLOURS` no tag in `tags` has; when every one is
 * taken, the list again in order, by the number of tags.
 */
export function newTagColour(tags: readonly Pick<Tag, "color">[]): number {
    const used = new Set(tags.map((tag) => tag.color >>> 0));
    const free = TAG_COLOURS.find((preset) => !used.has(preset.color));
    return (free ?? TAG_COLOURS[tags.length % TAG_COLOURS.length]!).color;
}

/** The dialog's values while they are edited: the colour is null while its text is not one. */
export type TagDraft = Omit<TagValues, "color"> & { color: number | null };

/** What keeps the Tag dialog from answering; all false, and no message, when nothing does. */
export interface TagProblems {
    name: boolean;
    color: boolean;
    /** A frame number outside the document, or `from` after `to`. */
    range: boolean;
    repeat: boolean;
    /** One sentence per problem, in the order of the fields. */
    messages: readonly string[];
}

/**
 * Checks the values of the Tag dialog against SPEC §5.1: a name that is not empty once its
 * surrounding white space is gone, a colour, frames 1..`frameCount` with `from` not after
 * `to`, and a repeat 0..255.
 */
export function tagProblems(draft: TagDraft, frameCount: number): TagProblems {
    const messages: string[] = [];
    const trimmed = draft.name.trim();
    const name = trimmed === "" || trimmed.length > MAX_NAME_LENGTH;
    if (trimmed === "") messages.push("Enter a name.");
    else if (name) messages.push(`A name has at most ${MAX_NAME_LENGTH} characters.`);
    const color = draft.color === null;
    if (color) messages.push("Enter a colour as #RRGGBB.");
    const isFrame = (value: number) => Number.isInteger(value) && value >= 1 && value <= frameCount;
    const outside = !isFrame(draft.from) || !isFrame(draft.to);
    const reversed = !outside && draft.from > draft.to;
    if (outside) messages.push(`Frames run from 1 to ${frameCount}.`);
    else if (reversed) messages.push("From must not be after To.");
    const repeat = !isTagRepeat(draft.repeat);
    if (repeat) messages.push(`Repeat must be from 0 to ${MAX_TAG_REPEAT}.`);
    return { name, color, range: outside || reversed, repeat, messages };
}
