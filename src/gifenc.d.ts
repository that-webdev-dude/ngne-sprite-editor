// `gifenc` 1.0.3 ships no declarations; the part of its API that `core/gif` uses is declared
// here (SE-063). The app program includes this file through `src`, the Node program by name
// (tsconfig.node.json).
declare module "gifenc" {
    /** A colour of a palette: red, green, blue, each 0..255. */
    export type GifPaletteColor = [number, number, number];

    export interface GifFrameOptions {
        /** The colour table of the frame: the global one for the first frame, else local. */
        palette?: readonly GifPaletteColor[];
        /** Whether `transparentIndex` is transparent. */
        transparent?: boolean;
        transparentIndex?: number;
        /** Milliseconds; written as hundredths of a second, `Math.round(delay / 10)`. */
        delay?: number;
        /** Read with the first frame: -1 writes no loop block, 0 loops forever, n > 0 repeats n times. */
        repeat?: number;
        /** The disposal method (0..7); -1: 2 for a transparent frame, else 0. */
        dispose?: number;
        colorDepth?: number;
    }

    export interface GifEncoder {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            options?: GifFrameOptions,
        ): void;
        /** Writes the trailer. */
        finish(): void;
        /** A copy of the bytes written. */
        bytes(): Uint8Array<ArrayBuffer>;
    }

    export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
}
