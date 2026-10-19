import { exportName } from "../../core/export";
import { MAX_GIF_SCALE, MIN_GIF_SCALE, gifFile, gifFileName, gifSequence } from "../../core/gif";
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
// frames the export settings name and the scale last chosen in this session. Colours reduced
// in a frame are reported by an info toast after the export's own.

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

/** The warning after an export that reduced the colours of `count` frames. */
export function reducedColoursMessage(count: number): string {
    const frames = count === 1 ? "1 frame" : `${count} frames`;
    return `Colours reduced in ${frames} of the GIF: a GIF frame holds at most 256.`;
}

export interface GifExportOptions {
    /** The export workflows whose `otherExport` runs it; the default is the app's. */
    workflows?: Pick<ExportWorkflows, "otherExport">;
    /** Where the dialog is shown; the default is the app's dialog host. */
    dialogs?: GifDialogs;
    /** Where the warning goes; the default is the app's toasts. */
    notices?: Pick<Notices, "info">;
}

/** Export GIF…: resolves true when a GIF was saved or downloaded. */
export function createGifExport(options: GifExportOptions = {}): () => Promise<boolean> {
    const workflows = options.workflows ?? appExportWorkflows;
    const dialogs = options.dialogs ?? appGifDialogs;
    const notices = options.notices ?? appNotices;
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
            // The document as it is once the dialog is answered.
            const now = context.current();
            if (!now) throw new Error("The document was closed meanwhile.");
            if (now.history.transaction) throw new Error("A stroke is in progress.");
            const result = gifFile(now.session.doc, {
                frames: framesOf(answer.choice),
                scale: answer.scale,
            });
            reduced = result.reducedFrames;
            return { file: result.file, type: GIF_FILE, count: 1 };
        });
        if (done && reduced > 0) notices.info(reducedColoursMessage(reduced));
        return done;
    };
}

/** Export GIF… of the app. */
export const exportGif = createGifExport();
