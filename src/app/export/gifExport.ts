import { exportName } from "../../core/export";
import {
    MAX_GIF_SCALE,
    MIN_GIF_SCALE,
    encodeGif,
    gifFileName,
    gifSequence,
    nextTask,
} from "../../core/gif";
import type { GifFrames } from "../../core/gif";
import type { SpriteDoc } from "../../core/model";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import type { ExportFileType } from "../platform/exportFiles";
import { exportWorkflows as appExportWorkflows } from "./exportWorkflows";
import type { ExportWorkflows } from "./exportWorkflows";
import { gifDialogs as appGifDialogs } from "./gifDialog";
import type { GifChoice, GifDialogs } from "./gifDialog";

// Export GIF… (SPEC §9.6; SE-063): an export beside the bundle, through `otherExport` of the
// export workflows, so it is a file operation like the others (one at a time, not during a
// stroke, a floating selection applied first) and saves through the save picker or downloads.
// Its dialog asks for the frames (every frame, or one tag) and the scale; it opens with the
// frames the export settings name and the scale last chosen in this session. The file is
// chosen first (save picker), then encoded in steps (`encodeGif`), so a long encode neither
// freezes the page nor outlasts the user's gesture the picker needs. Colours reduced in a
// frame are reported by an info toast after the export's own.

/** The GIF's file type: what the save picker offers and the download's media type. */
export const GIF_FILE: ExportFileType = {
    kind: "gif",
    description: "GIF image",
    mime: "image/gif",
    extension: ".gif",
};

const ALL_FRAMES = "all";

/** The frames a choice of the dialog stands for. */
function framesOf(choice: string): GifFrames {
    return choice === ALL_FRAMES ? "all" : { tagId: choice.slice("tag:".length) };
}

/** The choices of the dialog's Frames select for a document. */
export function gifChoices(doc: SpriteDoc): GifChoice[] {
    const choice = (value: string, label: string, frames: GifFrames): GifChoice => {
        const { entries, plays } = gifSequence(doc, frames);
        return { value, label, frameCount: entries.length, plays };
    };
    const position = (id: string) => doc.frames.findIndex((frame) => frame.id === id) + 1;
    return [
        choice(ALL_FRAMES, "All frames", "all"),
        ...doc.tags.map((tag) =>
            choice(
                `tag:${tag.id}`,
                `${tag.name} (${position(tag.fromFrameId)}–${position(tag.toFrameId)})`,
                { tagId: tag.id },
            ),
        ),
    ];
}

/** The warning after an export that reduced the colours of `count` of the document's frames. */
export function reducedColoursMessage(count: number): string {
    return `Colours reduced in ${count} of the document's frames: a GIF frame holds at most 256.`;
}

/** Why an export stops when the document changed while its GIF was being made. */
export const CHANGED_DURING_ENCODE =
    "The document changed while the GIF was made. Export it again.";

export interface GifExportOptions {
    /** The export workflows whose `otherExport` runs it; the default is the app's. */
    workflows?: Pick<ExportWorkflows, "otherExport">;
    /** Where the dialog is shown; the default is the app's dialog host. */
    dialogs?: GifDialogs;
    /** Where the warning goes; the default is the app's toasts. */
    notices?: Pick<Notices, "info">;
    /** The encoder; the default is `encodeGif`, which pauses between frames. */
    encode?: typeof encodeGif;
}

/** Export GIF…: resolves true when a GIF was saved or downloaded. */
export function createGifExport(options: GifExportOptions = {}): () => Promise<boolean> {
    const workflows = options.workflows ?? appExportWorkflows;
    const dialogs = options.dialogs ?? appGifDialogs;
    const notices = options.notices ?? appNotices;
    const encode = options.encode ?? encodeGif;
    /** The scale the dialog last answered with. */
    let lastScale = MIN_GIF_SCALE;

    return async () => {
        let reduced = 0;
        const done = await workflows.otherExport(async (document, context) => {
            const { doc } = document.session;
            const name = exportName(doc.name);
            const choices = gifChoices(doc);
            const settings = doc.exportSettings.frames;
            const named = settings === "all" ? ALL_FRAMES : `tag:${settings.tagId}`;
            const answer = await dialogs.gif({
                width: doc.width,
                height: doc.height,
                choices,
                initialChoice: choices.some((entry) => entry.value === named) ? named : ALL_FRAMES,
                initialScale: lastScale,
                minScale: MIN_GIF_SCALE,
                maxScale: MAX_GIF_SCALE,
                fileName: (choice, scale) => gifFileName(doc, name, framesOf(choice), scale),
            });
            if (answer === null) return null;
            lastScale = answer.scale;
            const gifOptions = { frames: framesOf(answer.choice), scale: answer.scale };

            /** The document as it is now, when it may be read: open and without a stroke. */
            const ready = () => {
                const now = context.current();
                if (!now) throw new Error("The document was closed meanwhile.");
                if (now.history.transaction) throw new Error("A stroke is in progress.");
                return now;
            };
            const answered = ready().session.doc;
            // Made once the file is chosen (the save picker within the user's gesture), and in
            // steps: between frames the page runs, and a stroke begun or a change made
            // meanwhile stops the export.
            const produce = async () => {
                const start = ready();
                let changed = false;
                const stop = start.history.subscribe(() => {
                    changed = true;
                });
                try {
                    const result = await encode(start.session.doc, gifOptions, async () => {
                        await nextTask();
                        ready();
                        if (changed) throw new Error(CHANGED_DURING_ENCODE);
                    });
                    reduced = result.reducedFrames;
                    return result.file.bytes;
                } finally {
                    stop();
                }
            };
            const fileName = gifFileName(answered, name, gifOptions.frames, gifOptions.scale);
            return {
                file: { name: fileName, bytes: new Uint8Array(0) },
                type: GIF_FILE,
                count: 1,
                produce,
            };
        });
        if (done && reduced > 0) notices.info(reducedColoursMessage(reduced));
        return done;
    };
}

/** Export GIF… of the app. */
export const exportGif = createGifExport();
