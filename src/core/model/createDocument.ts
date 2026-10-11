import { defaultPalette } from "./defaultPalette";
import {
    DEFAULT_FRAME_DURATION_MS,
    MAX_DOCUMENT_SIDE,
    MIN_DOCUMENT_SIDE,
    defaultDocSettings,
    defaultExportSettings,
} from "./defaults";
import { type IdGenerator, randomId } from "./ids";
import type { DocSession, FrameInfo, GridSettings, PixelLayer } from "./types";

/** Thrown when a document side is not an integer in 1..1024 (SPEC §5.1). */
export class DocumentSizeError extends Error {
    override readonly name = "DocumentSizeError";
    readonly width: number;
    readonly height: number;

    constructor(width: number, height: number) {
        super(
            `Document size ${width}×${height} is not allowed: each side must be an integer ` +
                `from ${MIN_DOCUMENT_SIDE} to ${MAX_DOCUMENT_SIDE}.`,
        );
        this.width = width;
        this.height = height;
    }
}

function isDocumentSide(value: number): boolean {
    return Number.isInteger(value) && value >= MIN_DOCUMENT_SIDE && value <= MAX_DOCUMENT_SIDE;
}

export interface CreateDocumentOptions {
    name: string;
    width: number;
    height: number;
    /** Overrides fields of the default grid. */
    grid?: Partial<GridSettings>;
}

/**
 * A session on a new document: one pixel layer, one frame, no cel, the default palette and
 * a centre pivot. `newId` is called for the document, the layer and the frame, in that order.
 */
export function createDocument(
    options: CreateDocumentOptions,
    newId: IdGenerator = randomId,
): DocSession {
    const { name, width, height, grid } = options;
    if (!isDocumentSide(width) || !isDocumentSide(height)) {
        throw new DocumentSizeError(width, height);
    }

    const id = newId();
    const layer: PixelLayer = {
        id: newId(),
        name: "Layer 1",
        kind: "pixel",
        visible: true,
        locked: false,
        opacity: 255,
        blend: "normal",
    };
    const frame: FrameInfo = { id: newId(), durationMs: DEFAULT_FRAME_DURATION_MS };
    const settings = defaultDocSettings(width, height);
    const defaultGrid = settings.grid;
    settings.grid = {
        width: grid?.width ?? defaultGrid.width,
        height: grid?.height ?? defaultGrid.height,
        offsetX: grid?.offsetX ?? defaultGrid.offsetX,
        offsetY: grid?.offsetY ?? defaultGrid.offsetY,
        visible: grid?.visible ?? defaultGrid.visible,
    };

    return {
        doc: {
            id,
            name,
            width,
            height,
            colorMode: "rgba",
            layers: [layer],
            frames: [frame],
            cels: new Map(),
            images: new Map(),
            tags: [],
            palette: defaultPalette(),
            pivot: { x: 0.5, y: 0.5 },
            settings,
            exportSettings: defaultExportSettings(),
        },
        selection: null,
        activeLayerId: layer.id,
        activeFrameId: frame.id,
    };
}
