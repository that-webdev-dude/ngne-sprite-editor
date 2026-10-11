import { readCanvas } from "../../../src/engine/testing/readCanvas.ts";
import { describeError, runSpike, sleep } from "../lib/harness.ts";
import { createPreview, isOverloadNotice, upload } from "../lib/ngne.ts";
import {
    blit,
    cropDoc,
    diffImages,
    expectedImage,
    makeDoc,
    solidDoc,
    type Doc,
} from "../lib/pattern.ts";

// Question 9 (S): odd sizes through `BrowserGame`.
// Method (ticket): 33×33 and 32×32 sprites drawn by a scene with default `pixelSnap` and with
// snapping off; even-padded rect per SPEC §9.2.
// Go: with snap off and with even rects under default snap, readback exact. Odd rect under
// default snap: result recorded (expected misaligned).

const ATLAS = "pv:atlas";
const BG = 0x283848;

interface Rect {
    readonly name: string;
    /** Atlas rectangle (SPEC §9.2 x, y, w, h) and the source frame it belongs to. */
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly source: Doc;
    /** True when the result must be exact under both snapping modes. */
    readonly evenRect: boolean;
}

// One atlas, padding 1: a 33×33 frame at (1, 1) whose even-padded rectangle is 34×34 (one
// transparent column and row on the right and bottom), and a 32×32 frame at (36, 1).
const odd = makeDoc(33, 33, 31);
const even = makeDoc(32, 32, 32);
const atlas = solidDoc(1 + 34 + 1 + 32 + 1, 1 + 34 + 1, 0, 0);
blit(atlas, odd, 1, 1);
blit(atlas, even, 36, 1);

const RECTS: readonly Rect[] = [
    { name: "32×32 source, 32×32 rect", x: 36, y: 1, w: 32, h: 32, source: even, evenRect: true },
    {
        name: "33×33 source, odd 33×33 rect",
        x: 1,
        y: 1,
        w: 33,
        h: 33,
        source: odd,
        evenRect: false,
    },
    {
        name: "33×33 source, even-padded 34×34 rect",
        x: 1,
        y: 1,
        w: 34,
        h: 34,
        source: odd,
        evenRect: true,
    },
];

/** Where the source frame's top-left is drawn, and the logical size of the canvas. */
const PLACEMENTS = [
    { name: "canvas = source size, top-left at 0,0", canvas: "source", x: 0, y: 0 },
    { name: "80×60 canvas, top-left at 7,5", canvas: "fixed", x: 7, y: 5 },
] as const;

runSpike(9, async (spike) => {
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    stage.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:8px";
    interface Case {
        rect: string;
        evenRect: boolean;
        pixelSnap: boolean;
        placement: string;
        canvas: [number, number];
        frames: number;
        differingPixels: number;
        first: string;
        diagnostics: string[];
    }
    const results: Case[] = [];

    for (const rect of RECTS)
        for (const pixelSnap of [true, false])
            for (const place of PLACEMENTS) {
                const width = place.canvas === "source" ? rect.source.width : 80;
                const height = place.canvas === "source" ? rect.source.height : 60;
                const canvas = document.createElement("canvas");
                canvas.style.cssText =
                    `width:${(width * 2) / devicePixelRatio}px;` +
                    `height:${(height * 2) / devicePixelRatio}px;` +
                    "image-rendering:pixelated;pointer-events:none";
                stage.append(canvas);
                // What the rectangle holds: the frame, plus transparent padding if any.
                const content = cropDoc(atlas, rect.x, rect.y, rect.w, rect.h);
                const want = expectedImage(width, height, BG, [
                    { doc: content, x: place.x, y: place.y, scale: 1 },
                ]);
                const notices: string[] = [];
                const seen = { ready: false, frames: 0, differing: -1, first: "" };
                const preview = createPreview({
                    canvas,
                    width,
                    height,
                    clear: 0,
                    pixelSnap,
                    draw: (frame) => {
                        if (!seen.ready) return;
                        frame.rect(width / 2, height / 2, width, height, BG);
                        // Top-left placement of SPEC §9.2 with offsetX = offsetY = 0.
                        frame.sprite({
                            x: place.x + rect.w / 2,
                            y: place.y + rect.h / 2,
                            width: rect.w,
                            height: rect.h,
                            texture: ATLAS,
                            u: rect.x / atlas.width,
                            v: rect.y / atlas.height,
                            uw: rect.w / atlas.width,
                            vh: rect.h / atlas.height,
                            layer: 1,
                        });
                    },
                    diagnostic: (error) => {
                        if (!isOverloadNotice(error)) notices.push(describeError(error));
                    },
                    afterFrame: () => {
                        if (!seen.ready) return;
                        const image = readCanvas(canvas);
                        const diff = diffImages(image.data, want, image.width);
                        seen.frames++;
                        seen.differing = diff.count;
                        seen.first = diff.first;
                    },
                });
                await preview.start();
                const renderer = preview.app.renderer;
                if (!renderer) throw new Error("renderer is undefined after start() resolved");
                await upload(renderer, ATLAS, atlas);
                seen.ready = true;
                for (let wait = 0; wait < 150 && seen.frames < 3; wait++) await sleep(20);
                await preview.app.dispose();
                results.push({
                    rect: rect.name,
                    evenRect: rect.evenRect,
                    pixelSnap,
                    placement: place.name,
                    canvas: [width, height],
                    frames: seen.frames,
                    differingPixels: seen.differing,
                    first: seen.first,
                    diagnostics: notices,
                });
                spike.log(
                    `${rect.name}, snap ${pixelSnap}, ${place.name}: ${seen.differing} differing`,
                );
            }

    spike.metric("cases", results);
    const exact = (list: Case[]) =>
        list.filter((entry) => entry.differingPixels === 0 && entry.frames >= 3).length;
    const describe = (list: Case[]) =>
        list
            .filter((entry) => entry.differingPixels !== 0 || entry.frames < 3)
            .map(
                (entry) =>
                    `${entry.rect}, ${entry.placement}: ${entry.differingPixels} px` +
                    (entry.first ? ` (${entry.first})` : ""),
            )
            .join("; ");
    const snapOff = results.filter((entry) => !entry.pixelSnap);
    const evenSnapped = results.filter((entry) => entry.pixelSnap && entry.evenRect);
    const oddSnapped = results.filter((entry) => entry.pixelSnap && !entry.evenRect);
    spike.check(
        "Snap off: readback exact for 32×32, odd 33×33 and even-padded rects",
        exact(snapOff) === snapOff.length,
        `${exact(snapOff)}/${snapOff.length} exact. ${describe(snapOff)}`,
    );
    spike.check(
        "Default snap with even rects (32×32 and even-padded 34×34): readback exact",
        exact(evenSnapped) === evenSnapped.length,
        `${exact(evenSnapped)}/${evenSnapped.length} exact. ${describe(evenSnapped)}`,
    );
    // The snapped centre puts every pixel centre on a texel boundary, so which texel is
    // sampled is up to the GPU: the outcome is recorded per adapter, not required.
    spike.info(
        "Default snap with an odd 33×33 rect is misaligned (expected; recorded per adapter)",
        exact(oddSnapped) === 0,
        oddSnapped
            .map((entry) => `${entry.placement}: ${entry.differingPixels} differing pixels`)
            .join("; "),
    );
    const diagnostics = results.flatMap((entry) => entry.diagnostics);
    spike.check("No diagnostic", diagnostics.length === 0, diagnostics.slice(0, 3).join(" | "));
    spike.summary("Snap off: exact cases", `${exact(snapOff)}/${snapOff.length}`);
    spike.summary(
        "Default snap, even rects: exact cases",
        `${exact(evenSnapped)}/${evenSnapped.length}`,
    );
    spike.summary(
        "Default snap, odd 33×33 rect: differing pixels per case (recorded)",
        oddSnapped.map((entry) => entry.differingPixels).join(", "),
    );
});
