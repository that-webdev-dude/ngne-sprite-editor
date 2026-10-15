import type { Page } from "@playwright/test";
import type { Point } from "./se-012-support";

// Shared helpers of the SE-015 specs: the pixels of the active cel, the options and colours
// of the tools, and a drag of the real mouse at a given speed.

/** The RGBA bytes of the active cel of a document; null while that cel is empty. */
export function celBytes(page: Page, id: string): Promise<number[] | null> {
    return page.evaluate((id) => {
        const document = window
            .__ngneTest!.sessions.getState()
            .documents.find((entry) => entry.id === id);
        if (!document) throw new Error(`se-015: no document ${id}`);
        const { doc, activeLayerId, activeFrameId } = document.session;
        const cel = doc.cels.get(`${activeLayerId}:${activeFrameId}`);
        const image = cel ? doc.images.get(cel.imageId) : undefined;
        return image ? Array.from(image.data) : null;
    }, id);
}

/** The texels of an image (RGBA rows of `width`) whose colour is `rgba`, row by row. */
export function texelsOf(
    pixels: readonly number[],
    width: number,
    rgba: readonly number[],
): Point[] {
    const found: Point[] = [];
    for (let at = 0; at < pixels.length; at += 4) {
        if (rgba.every((value, channel) => pixels[at + channel] === value)) {
            const index = at / 4;
            found.push({ x: index % width, y: Math.floor(index / width) });
        }
    }
    return found;
}

/** Sets options of a tool through the editor store, as the context bar does. */
export function setToolOptions(
    page: Page,
    tool: string,
    options: Record<string, number | string | boolean>,
): Promise<void> {
    return page.evaluate(
        ({ tool, options }) => window.__ngneTest!.editor.getState().setToolOptions(tool, options),
        { tool, options },
    );
}

/** Sets the foreground and background colours (0xRRGGBBAA) through the editor store. */
export function setColours(page: Page, foreground: number, background: number): Promise<void> {
    return page.evaluate(
        ({ foreground, background }) => {
            const editor = window.__ngneTest!.editor.getState();
            editor.setForeground(foreground);
            editor.setBackground(background);
        },
        { foreground, background },
    );
}

/**
 * Drags the real mouse with the left button from client `from` to `to` in a straight line at
 * `speed` CSS pixels per second, reported as a mouse reports at `rate` Hz: every `1000 / rate`
 * ms the pointer moves to where it is at that moment. A report that comes late goes where the
 * pointer is by then, so the drag keeps its speed. Returns the moves sent.
 */
export async function dragAtSpeed(
    page: Page,
    from: Point,
    to: Point,
    speed: number,
    rate = 125,
): Promise<number> {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = (length / speed) * 1000;
    const period = 1000 / rate;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const start = performance.now();
    let moves = 0;
    for (let tick = 1; ; tick++) {
        const due = start + tick * period;
        const wait = due - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const fraction = Math.min(1, (performance.now() - start) / duration);
        await page.mouse.move(
            from.x + (to.x - from.x) * fraction,
            from.y + (to.y - from.y) * fraction,
        );
        moves++;
        if (fraction === 1) break;
    }
    await page.mouse.up();
    return moves;
}

/**
 * Records the pointer samples the overlay receives from now on (coalesced events included),
 * in device pixels of the page; `pointerSamples` reads them.
 */
export function recordPointerSamples(page: Page): Promise<void> {
    return page.evaluate(() => {
        const samples: { x: number; y: number }[] = [];
        (window as unknown as { __se015Samples: typeof samples }).__se015Samples = samples;
        const overlay = document.querySelector("[data-viewport-overlay]");
        if (!overlay) throw new Error("se-015: no overlay");
        overlay.addEventListener("pointermove", (event) => {
            const pointer = event as PointerEvent;
            const all = pointer.getCoalescedEvents?.() ?? [];
            for (const sample of all.length > 0 ? all : [pointer]) {
                samples.push({
                    x: sample.clientX * devicePixelRatio,
                    y: sample.clientY * devicePixelRatio,
                });
            }
        });
    });
}

/** The samples recorded since `recordPointerSamples`, in device pixels. */
export function pointerSamples(page: Page): Promise<Point[]> {
    return page.evaluate(
        () => (window as unknown as { __se015Samples: Point[] }).__se015Samples ?? [],
    );
}
