import { chainedCommand } from "../history";
import type { Command, CommandFactory } from "../history";
import { addLayerCommand } from "../layers";
import {
    DEFAULT_FRAME_DURATION_MS,
    assertCanAdd,
    assertNameLength,
    celAt,
    celKey,
    createDocument,
    frameIndex,
    randomId,
} from "../model";
import type {
    DocSession,
    DocumentLimits,
    FrameInfo,
    GridSettings,
    IdGenerator,
    Palette,
    SpriteDoc,
} from "../model";
import { clonePixelBuffer } from "../pixels";
import type { PixelBuffer } from "../pixels";
import { MAX_PALETTE_COLORS } from "./errors";

// Step 9 of SPEC §8: where the frames of an import go. A new document, new frames at the end
// of a document, or a new layer of a document whose cels start at the active frame (frames
// added at the end where the layer needs more). The palette the import made can replace the
// document's palette, add the colours it lacks, or leave it as it is. Into a document, the
// import is one undo step (SE-044).

/** What happens to the document palette (SPEC §8, step 7). */
export type ImportPaletteMode = "replace" | "append" | "keep";

/** Where the frames of an import go into a document. */
export type ImportDestination = "frames" | "layer";

/** The label of the undo step of an import into a document. */
export const IMPORT_LABEL = "Import PNG";

/** Opacity of a new cel. */
const CEL_OPACITY = 255;

/**
 * The palette a document has after an import: the imported palette (`replace`); the
 * document's palette followed by the imported colours it does not hold yet, in their order,
 * as many as fit in `MAX_PALETTE_COLORS` (`append`); or the document's palette (`keep`).
 * Always a new object.
 */
export function paletteAfterImport(
    current: Palette,
    imported: Palette,
    mode: ImportPaletteMode,
): Palette {
    if (mode === "replace") return { name: imported.name, colors: [...imported.colors] };
    const colors = [...current.colors];
    if (mode === "append") {
        const present = new Set(colors);
        for (const colour of imported.colors) {
            if (colors.length >= MAX_PALETTE_COLORS) break;
            if (present.has(colour)) continue;
            present.add(colour);
            colors.push(colour);
        }
    }
    return { name: current.name, colors };
}

/** Thrown when the frames of an import cannot go into a document. */
export class ImportPlacementError extends Error {
    override readonly name = "ImportPlacementError";
}

/** Throws `ImportPlacementError` unless there are frames and each has the document's size. */
function assertFrames(doc: Pick<SpriteDoc, "width" | "height">, frames: readonly PixelBuffer[]) {
    if (frames.length === 0) throw new ImportPlacementError("The import has no frames.");
    for (const frame of frames) {
        if (frame.width !== doc.width || frame.height !== doc.height) {
            throw new ImportPlacementError(
                `The frames are ${frame.width}×${frame.height}; the sprite is ` +
                    `${doc.width}×${doc.height}. The target size must equal the sprite size.`,
            );
        }
    }
}

/** Options of `importedDocument`. */
export interface ImportedDocumentOptions {
    /** The document's name. */
    name: string;
    /** The frames, all of one size, which becomes the document's size. */
    frames: readonly PixelBuffer[];
    /** The palette the import made, and what becomes of the default palette. */
    palette: Palette;
    paletteMode: ImportPaletteMode;
    /** Overrides fields of the default grid, as `createDocument` takes them. */
    grid?: Partial<GridSettings>;
}

/**
 * A session on a new document holding the frames of an import (SPEC §8, place "New
 * document"): one pixel layer with one cel per frame, frames of the default duration, and
 * the palette that `paletteMode` makes of the default palette and the imported one. The
 * pixels are copied. Throws `ImportPlacementError` when there is no frame or the frames
 * differ in size, and as `createDocument` does.
 */
export function importedDocument(
    options: ImportedDocumentOptions,
    newId: IdGenerator = randomId,
): DocSession {
    const [first] = options.frames;
    if (!first) throw new ImportPlacementError("The import has no frames.");
    const session = createDocument(
        {
            name: options.name,
            width: first.width,
            height: first.height,
            ...(options.grid && { grid: options.grid }),
        },
        newId,
    );
    const { doc } = session;
    assertFrames(doc, options.frames);
    assertCanAdd(doc, {
        frames: options.frames.length - 1,
        cels: options.frames.length,
        images: options.frames.length,
        pixelBytes: options.frames.length * doc.width * doc.height * 4,
    });
    const layerId = session.activeLayerId;
    options.frames.forEach((pixels, index) => {
        let frame = doc.frames[index];
        if (!frame) {
            frame = { id: newId(), durationMs: DEFAULT_FRAME_DURATION_MS };
            doc.frames.push(frame);
        }
        const imageId = newId();
        doc.images.set(imageId, clonePixelBuffer(pixels));
        doc.cels.set(celKey(layerId, frame.id), { imageId, opacity: CEL_OPACITY });
    });
    doc.palette = paletteAfterImport(doc.palette, options.palette, options.paletteMode);
    return session;
}

/**
 * The part that puts `frames` into the empty cels of `layerId` from frame position `start`
 * on, adding frames at the end of the document where it has too few (with the duration of
 * its last frame). New images under IDs of `newId`; the pixels are kept by the command and
 * copied at each `do`. The active frame becomes the first frame of the import when
 * `activateFirst`. Its `do` throws, with the session unchanged, when the document is not the
 * one it was made from.
 */
function placeCelsCommand(
    session: DocSession,
    layerId: string,
    start: number,
    frames: readonly PixelBuffer[],
    activateFirst: boolean,
    newId: IdGenerator,
    limits?: Readonly<DocumentLimits>,
): Command {
    const { doc } = session;
    assertFrames(doc, frames);
    const layer = doc.layers.find((candidate) => candidate.id === layerId);
    if (layer?.kind !== "pixel") {
        throw new ImportPlacementError(`The sprite has no pixel layer "${layerId}".`);
    }
    const before = doc.frames.length;
    const extra = Math.max(0, start + frames.length - before);
    const pixelBytes = frames.length * doc.width * doc.height * 4;
    assertCanAdd(
        doc,
        { frames: extra, cels: frames.length, images: frames.length, pixelBytes },
        limits,
    );
    const lastDuration = doc.frames[before - 1]?.durationMs ?? DEFAULT_FRAME_DURATION_MS;
    const added: FrameInfo[] = Array.from({ length: extra }, () => ({
        id: newId(),
        durationMs: lastDuration,
    }));
    const frameIds = [
        ...doc.frames.slice(start, start + frames.length).map((frame) => frame.id),
        ...added.map((frame) => frame.id),
    ];
    for (const frameId of frameIds) {
        if (celAt(doc, layerId, frameId)) {
            throw new ImportPlacementError("The cels the import goes into are not empty.");
        }
    }
    const imageIds = frames.map(() => newId());
    const kept = frames.map(clonePixelBuffer);
    const planned = doc.frames.map((frame) => frame.id);
    /** The active frame `do` found. */
    let activeBefore = session.activeFrameId;
    return {
        label: IMPORT_LABEL,
        bytes: pixelBytes,
        touched: { frameIds: [...frameIds], layerIds: [layerId], structure: extra > 0 },
        do(target) {
            const current = target.doc;
            const unchanged =
                current.frames.length === planned.length &&
                current.frames.every((frame, index) => frame.id === planned[index]) &&
                current.layers.some((entry) => entry.id === layerId && entry.kind === "pixel") &&
                frameIds.every((frameId) => !celAt(current, layerId, frameId));
            if (!unchanged) {
                throw new Error(
                    `"${IMPORT_LABEL}": the document changed since the command was made.`,
                );
            }
            // A new list, as the frame commands make: readers compare it by identity.
            if (added.length > 0) {
                current.frames = [...current.frames, ...added.map((frame) => ({ ...frame }))];
            }
            frameIds.forEach((frameId, index) => {
                current.images.set(imageIds[index]!, clonePixelBuffer(kept[index]!));
                current.cels.set(celKey(layerId, frameId), {
                    imageId: imageIds[index]!,
                    opacity: CEL_OPACITY,
                });
            });
            activeBefore = target.activeFrameId;
            if (activateFirst) target.activeFrameId = frameIds[0]!;
        },
        undo(target) {
            const current = target.doc;
            target.activeFrameId = activeBefore;
            frameIds.forEach((frameId, index) => {
                current.cels.delete(celKey(layerId, frameId));
                current.images.delete(imageIds[index]!);
            });
            if (current.frames.length !== planned.length) {
                current.frames = current.frames.slice(0, planned.length);
            }
        },
    };
}

/** The part that makes `next` the document palette; null when it is the palette already. */
function paletteCommand(session: DocSession, next: Palette): Command | null {
    assertNameLength(next.name);
    const before: Palette = {
        name: session.doc.palette.name,
        colors: [...session.doc.palette.colors],
    };
    const same =
        before.name === next.name &&
        before.colors.length === next.colors.length &&
        before.colors.every((colour, index) => colour === next.colors[index]);
    if (same) return null;
    const after: Palette = { name: next.name, colors: [...next.colors] };
    return {
        label: IMPORT_LABEL,
        bytes: 8 * (before.colors.length + after.colors.length),
        touched: { frameIds: [], layerIds: [], structure: false },
        do(target) {
            target.doc.palette = { name: after.name, colors: [...after.colors] };
        },
        undo(target) {
            target.doc.palette = { name: before.name, colors: [...before.colors] };
        },
    };
}

/** Options of `importIntoDocumentCommand`. */
export interface ImportIntoDocumentOptions {
    /**
     * `frames`: new frames at the end of the document, in the active layer (the top pixel
     * layer while a reference layer is the active one); the first of them becomes the active
     * frame. `layer`: a new pixel layer above the active layer (as New Layer adds it), with
     * the frames from the active frame on, frames added at the end where needed.
     */
    destination: ImportDestination;
    /** The palette the import made, and what becomes of the document palette. */
    palette: Palette;
    paletteMode: ImportPaletteMode;
    /** The name of a new layer; the default is the next "Layer N". */
    layerName?: string;
    /**
     * A command to do first, in the same step: the reference layer of "Keep source as
     * reference" (SE-045's `referenceLayerCommandFromPng`), made for the document as it is.
     */
    first?: Command;
    newId?: IdGenerator;
    limits?: Readonly<DocumentLimits>;
}

/**
 * The import of `frames` into the document of `session` as one undo step labelled "Import
 * PNG" (SPEC §8, place "New frames" and "New layer"; SE-044), not yet executed: pass it to
 * the document's `History.execute` at once. Throws `ImportPlacementError` when there is no
 * frame or a frame does not have the document's size (SPEC §8: placing into a document
 * requires the target size to equal its size), `DocumentLimitError` past the limits of SPEC
 * §5.1, and what `addLayerCommand` throws.
 */
export function importIntoDocumentCommand(
    session: DocSession,
    frames: readonly PixelBuffer[],
    options: ImportIntoDocumentOptions,
): Command {
    const { newId = randomId, limits } = options;
    assertFrames(session.doc, frames);
    const factories: CommandFactory[] = [];
    if (options.first) {
        const first = options.first;
        factories.push(() => first);
    }
    if (options.destination === "layer") {
        factories.push((current) =>
            addLayerCommand(current, {
                newId,
                ...(options.layerName !== undefined && { name: options.layerName }),
                ...(limits && { limits }),
            }),
        );
        factories.push((current) =>
            placeCelsCommand(
                current,
                current.activeLayerId,
                Math.max(0, frameIndex(current.doc, current.activeFrameId)),
                frames,
                false,
                newId,
                limits,
            ),
        );
    } else {
        factories.push((current) => {
            const { doc } = current;
            const active = doc.layers.find((layer) => layer.id === current.activeLayerId);
            const pixelLayers = doc.layers.filter((layer) => layer.kind === "pixel");
            const target = active?.kind === "pixel" ? active : pixelLayers[pixelLayers.length - 1];
            if (!target) throw new ImportPlacementError("The sprite has no pixel layer.");
            return placeCelsCommand(
                current,
                target.id,
                doc.frames.length,
                frames,
                true,
                newId,
                limits,
            );
        });
    }
    factories.push((current) =>
        paletteCommand(
            current,
            paletteAfterImport(current.doc.palette, options.palette, options.paletteMode),
        ),
    );
    const command = chainedCommand(IMPORT_LABEL, session, factories);
    // The cels part always makes a command, so the chain is never empty.
    if (!command) throw new ImportPlacementError("The import changes nothing.");
    return command;
}
