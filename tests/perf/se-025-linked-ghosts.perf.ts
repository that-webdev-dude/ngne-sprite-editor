import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import { createActiveComposites } from "../../src/app/state/composites";
import { createSessionsStore } from "../../src/app/state/sessions";
import { connectViewport } from "../../src/app/viewport/viewportController";
import { celKey, createDocument, sequentialIds } from "../../src/core/model";
import { tintOnion } from "../../src/core/onion";
import type { ViewportGhost } from "../../src/engine/viewport/types";
import { RecordingViewport } from "../unit/se-011-support";
import { record } from "./record";

// SE-025 review (F): one animation frame of a stroke on a linked cel with onion skin on, tint
// on, three frames each side, every ghost showing the stroked image. Each frame the live
// composite reports the other frames that show the image (`composites.invalidate`, as
// `liveComposite.ts` does), so the viewport uploads every ghost again: its composite is made in
// full and tinted. Timed here in Node through the app's controller (`connectViewport`): a dab
// written into the image, the invalidation, and the six ghosts' pixels read as their uploads
// read them (`ViewportDocument.pixels`, tinted into the buffer kept per ghost). No bitmap, upload
// or GPU work. Beside it (`allocating`), the same with a new tinted buffer per ghost per frame,
// as before the review.
//
// No budget: the record is for information. Run alone, without PERF_RECORD:
// npx vitest run --config vitest.perf.config.ts tests/perf/se-025-linked-ghosts.perf.ts

const SIDE = 1024;
const FRAMES = 7;
const STROKE_FRAMES = 40;

class GhostViewport extends RecordingViewport {
    ghosts: readonly ViewportGhost[] = [];
    setOnion(ghosts: readonly ViewportGhost[]): void {
        this.ghosts = ghosts;
    }
}

function percentile(samples: readonly number[], share: number): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
}

it("times a stroke frame with six linked tinted ghosts at 1024²", () => {
    const sessions = createSessionsStore();
    const composites = createActiveComposites(sessions);
    const viewport = new GhostViewport();
    connectViewport(viewport, { sessions, preferences: createPreferenceStore(null), composites });

    const session = createDocument(
        { name: "linked", width: SIDE, height: SIDE },
        sequentialIds("l-"),
    );
    const { doc } = session;
    const first = doc.frames[0]!;
    doc.frames = Array.from({ length: FRAMES }, (_, index) => ({
        id: index === 0 ? first.id : `frame-${index + 1}`,
        durationMs: 100,
    }));
    const image = { width: SIDE, height: SIDE, data: new Uint8ClampedArray(SIDE * SIDE * 4) };
    for (let at = 0; at < image.data.length; at += 4) {
        image.data.set([(at >> 2) & 255, (at >> 10) & 255, 90, (at >> 4) % 3 === 0 ? 0 : 255], at);
    }
    doc.images.set("shared", image);
    for (const frame of doc.frames) {
        doc.cels.set(celKey(session.activeLayerId, frame.id), { imageId: "shared", opacity: 255 });
    }
    session.activeFrameId = doc.frames[3]!.id;
    doc.settings.onion = { ...doc.settings.onion, enabled: true, before: 3, after: 3, tint: true };
    sessions.getState().open(session);
    const document = viewport.document!;
    expect(viewport.ghosts).toHaveLength(6);
    const others = doc.frames
        .filter((frame) => frame.id !== session.activeFrameId)
        .map((f) => f.id);

    const strokeFrame = (index: number, read: (key: string) => void) => {
        // A 16 px dab moving along a row.
        const x0 = (index * 16) % (SIDE - 16);
        for (let y = 500; y < 516; y++) {
            for (let x = x0; x < x0 + 16; x++) image.data.set([0, 0, 0, 255], (y * SIDE + x) * 4);
        }
        composites.invalidate({
            frameIds: others,
            layerIds: [session.activeLayerId],
            structure: false,
        });
        for (const ghost of viewport.ghosts) read(ghost.key);
    };

    const measure = (read: (key: string) => void) => {
        // Warm up.
        for (let index = 0; index < 3; index++) strokeFrame(index, read);
        const samples: number[] = [];
        for (let index = 0; index < STROKE_FRAMES; index++) {
            const start = performance.now();
            strokeFrame(index, read);
            samples.push(performance.now() - start);
        }
        return samples;
    };

    const kept = measure((key) => void document.pixels(key));
    const cache = composites.cacheOf(session)!;
    const allocating = measure((key) => {
        const [frameId, side] = [
            key.slice(0, key.lastIndexOf(":")),
            key.slice(key.lastIndexOf(":") + 1),
        ];
        tintOnion(cache.get(frameId), side as "before" | "after");
    });

    record({
        id: "se-025-linked-ghosts",
        ticket: "SE-025",
        measurement:
            "One stroke frame on a linked cel at 1024² with six linked tinted ghosts: the dab, the invalidation and the six ghosts' pixels as their uploads read them (composite and tint), in Node.",
        statistic: `median of ${STROKE_FRAMES} frames`,
        resultMs: percentile(kept, 0.5),
        details: {
            p95Ms: percentile(kept, 0.95),
            allocatingMedianMs: percentile(allocating, 0.5),
            allocatingP95Ms: percentile(allocating, 0.95),
            side: SIDE,
            ghosts: viewport.ghosts.length,
        },
    });
});
