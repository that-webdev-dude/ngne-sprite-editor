import type { PixelBuffer, Rect } from "../model";
import { blitPixels } from "../pixels";
import { AllocationError } from "./errors";

/**
 * Returns `byteLength` zero bytes of pixel memory, or throws when it cannot. A history takes
 * one as an option so that a test can make allocation fail.
 */
export type PixelAllocator = (byteLength: number) => Uint8ClampedArray;

/** The allocator used unless another is given. */
export const defaultPixelAllocator: PixelAllocator = (byteLength) =>
    new Uint8ClampedArray(byteLength);

/** A transparent `width` × `height` buffer. Any failure of `allocate` is an `AllocationError`. */
export function allocateBuffer(
    allocate: PixelAllocator,
    width: number,
    height: number,
): PixelBuffer {
    const bytes = width * height * 4;
    try {
        return { width, height, data: allocate(bytes) };
    } catch (cause) {
        throw new AllocationError(bytes, cause);
    }
}

/** A new buffer holding the part of `source` inside `rect`, which lies within the source. */
export function copyRect(allocate: PixelAllocator, source: PixelBuffer, rect: Rect): PixelBuffer {
    const copy = allocateBuffer(allocate, rect.width, rect.height);
    blitPixels(copy, source, -rect.x, -rect.y);
    return copy;
}
