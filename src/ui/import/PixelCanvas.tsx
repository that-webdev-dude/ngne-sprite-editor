import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { PixelBuffer } from "../../core/pixels";

/**
 * A canvas showing straight RGBA8 pixels at their own size, drawn with `putImageData` (no
 * colour management, no resampling); CSS scales it, pixelated.
 */
export function PixelCanvas({
    pixels,
    className,
    style,
    ...data
}: {
    pixels: PixelBuffer;
    className?: string;
    style?: CSSProperties;
} & Record<`data-${string}`, string | number | undefined>) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context) return;
        const { width, height, data: bytes } = pixels;
        element.width = width;
        element.height = height;
        context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0);
    }, [pixels]);
    return (
        <canvas
            ref={canvas}
            className={className}
            style={style}
            width={pixels.width}
            height={pixels.height}
            {...data}
        />
    );
}
