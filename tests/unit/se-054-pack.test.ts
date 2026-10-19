import { describe, expect, it, vi } from "vitest";
import { atlasFor, MAX_ATLAS_FRAMES } from "../../src/core/export";
import { defaultExportSettings } from "../../src/core/model";
import type { ExportSettings, FrameInfo, SpriteDoc, Tag } from "../../src/core/model";
import {
    createPackState,
    handlePack,
    PREVIEW_ATLAS_BYTES,
} from "../../src/app/preview/previewPack";
import type { PackDocument, PackFrame, PackRequest } from "../../src/app/preview/previewPack";
import type * as Pixels from "../../src/core/pixels";
import { noise } from "./se-051-support";

/** Every pixel buffer `createPixelBuffer` made, by size: the atlas is one of them. */
const allocations = vi.hoisted(() => [] as { width: number; height: number }[]);
vi.mock("../../src/core/pixels", async (importOriginal) => {
    const actual = await importOriginal<typeof Pixels>();
    return {
        ...actual,
        createPixelBuffer: (width: number, height: number, color?: number) => {
            allocations.push({ width, height });
            return actual.createPixelBuffer(width, height, color);
        },
    };
});

// SE-054: the packing of the preview, as it runs in the worker (SPEC §6.5): `atlasFor` over the
// composites the worker keeps, so only changed frames travel after the first pack; the
// one-tag fallback when the whole atlas is too large; the errors of the export in place of an
// atlas.

function frames(count: number, durationMs = 100): FrameInfo[] {
    return Array.from({ length: count }, (_, index) => ({ id: `f${index}`, durationMs }));
}

function tag(id: string, name: string, from: number, to: number, extra: Partial<Tag> = {}): Tag {
    return {
        id,
        name,
        color: 0x4080c0ff,
        fromFrameId: `f${from}`,
        toFrameId: `f${to}`,
        direction: "forward",
        repeat: 0,
        ...extra,
    };
}

function packDoc(width: number, height: number, count: number, tags: Tag[] = []): PackDocument {
    return { name: "Hero", width, height, frames: frames(count), tags, pivot: { x: 0.5, y: 0.5 } };
}

function composites(doc: PackDocument, seed = 0): PackFrame[] {
    return doc.frames.map((frame, index) => ({
        id: frame.id,
        data: noise(doc.width, doc.height, index + seed).data,
    }));
}

let nextId = 0;
function request(
    doc: PackDocument,
    sent: PackFrame[],
    options: {
        reset?: boolean;
        settings?: Partial<ExportSettings>;
        fallbackTagId?: string | null;
    } = {},
): PackRequest {
    return {
        id: ++nextId,
        reset: options.reset ?? false,
        doc,
        settings: { ...defaultExportSettings(), ...options.settings },
        fallbackTagId: options.fallbackTagId ?? null,
        frames: sent,
    };
}

/** `atlasFor` of the same document and composites, as the export makes it. */
function exported(doc: PackDocument, sent: PackFrame[], settings: Partial<ExportSettings> = {}) {
    const full = { ...doc, layers: [], cels: new Map(), images: new Map() } as unknown as SpriteDoc;
    const buffers = sent.map((frame) => ({
        width: doc.width,
        height: doc.height,
        data: frame.data,
    }));
    return atlasFor(buffers, full, { ...defaultExportSettings(), ...settings });
}

describe("handlePack", () => {
    it('packs what atlasFor packs, with an "All frames" loop over every frame', () => {
        const base = packDoc(5, 3, 3, [tag("t1", "Walk", 0, 1)]);
        const doc = {
            ...base,
            frames: base.frames.map((frame) =>
                frame.id === "f2" ? { ...frame, durationMs: 250 } : frame,
            ),
        };
        const sent = composites(doc);
        const response = handlePack(createPackState(), request(doc, sent, { reset: true }));
        if (response.kind !== "packed") throw new Error(response.kind);
        const expected = exported(doc, sent);
        expect(response.scope).toBe("all");
        expect(response.meta).toEqual(expected.meta);
        expect(response.atlas).toEqual(expected.atlas);
        expect(response.allFrames).toEqual({
            playback: "loop",
            durationMs: 450,
            entries: [
                { frame: "hero-0", ms: 100 },
                { frame: "hero-1", ms: 100 },
                { frame: "hero-2", ms: 250 },
            ],
        });
    });

    it("keeps the composites it was sent: a later request carries the changed frames only", () => {
        const doc = packDoc(4, 4, 3);
        const state = createPackState();
        const first = composites(doc);
        expect(handlePack(state, request(doc, first, { reset: true })).kind).toBe("packed");

        const changed = { id: "f1", data: noise(4, 4, 99).data };
        const response = handlePack(state, request(doc, [changed]));
        if (response.kind !== "packed") throw new Error(response.kind);
        expect(response.atlas).toEqual(exported(doc, [first[0]!, changed, first[2]!]).atlas);
    });

    it("forgets the composites on reset and of frames the document no longer has", () => {
        const doc = packDoc(4, 4, 2);
        const state = createPackState();
        handlePack(state, request(doc, composites(doc), { reset: true }));
        expect([...state.frames.keys()]).toEqual(["f0", "f1"]);

        const fewer = { ...doc, frames: doc.frames.slice(0, 1) };
        handlePack(state, request(fewer, []));
        expect([...state.frames.keys()]).toEqual(["f0"]);

        // A reset without the frames: the worker has nothing to pack them from.
        const response = handlePack(state, request(fewer, [], { reset: true }));
        expect(response).toMatchObject({ kind: "failed" });
        expect(state.frames.size).toBe(0);
    });

    it("packs the whole document whatever frames the export settings name", () => {
        const doc = packDoc(4, 4, 3, [tag("t1", "Walk", 1, 2)]);
        const sent = composites(doc);
        const response = handlePack(
            createPackState(),
            request(doc, sent, { reset: true, settings: { frames: { tagId: "t1" } } }),
        );
        if (response.kind !== "packed") throw new Error(response.kind);
        expect(Object.keys(response.meta.frames)).toEqual(["hero-0", "hero-1", "hero-2"]);
    });

    it("falls back to the selected tag when the whole atlas is past the side limit", () => {
        // 9 different frames of 1024 px in one column: 9 × 1025 + 1 px.
        const doc = packDoc(2, 1024, 9, [tag("t1", "Short", 0, 2), tag("t2", "Long", 0, 8)]);
        const sent = composites(doc);
        const settings = { layout: "column" as const };

        const whole = handlePack(createPackState(), request(doc, sent, { reset: true, settings }));
        expect(whole).toMatchObject({ kind: "too-large" });
        if (whole.kind !== "too-large") return;
        expect(whole.message).toContain("8192");

        const short = handlePack(
            createPackState(),
            request(doc, sent, { reset: true, settings, fallbackTagId: "t1" }),
        );
        if (short.kind !== "packed") throw new Error(short.kind);
        expect(short.scope).toBe("tag");
        expect(short.allFrames).toBeNull();
        expect(Object.keys(short.meta.animations)).toEqual(["short"]);
        expect(short.meta.height).toBe(3 * 1025 + 1);

        // The selected tag alone is too large as well.
        const long = handlePack(
            createPackState(),
            request(doc, sent, { reset: true, settings, fallbackTagId: "t2" }),
        );
        expect(long).toMatchObject({ kind: "too-large" });
    });

    it("refuses an atlas within the side limit above 64 MB as too large", () => {
        // 5 × 4 frames of 1024 × 1024 with padding 0: 5120 × 4096 px, 80 MB.
        const doc = packDoc(1024, 1024, 17);
        const sent = composites(doc);
        const response = handlePack(
            createPackState(),
            request(doc, sent, { reset: true, settings: { padding: 0 } }),
        );
        expect(response).toMatchObject({ kind: "too-large" });
        if (response.kind !== "too-large") return;
        expect(response.message).toContain(`${PREVIEW_ATLAS_BYTES / 1024 / 1024} MB`);
    });

    it("refuses an atlas over 64 MB from its size, before the atlas is allocated", () => {
        // As above: 5120 × 4096 px, 80 MB.
        const doc = packDoc(1024, 1024, 17);
        const sent = composites(doc);
        allocations.length = 0;
        const response = handlePack(
            createPackState(),
            request(doc, sent, { reset: true, settings: { padding: 0 } }),
        );
        expect(response).toMatchObject({ kind: "too-large" });
        if (response.kind !== "too-large") return;
        expect(response.message).toContain("would be 5120 × 4096 px (80 MB)");
        const over = allocations.filter(
            ({ width, height }) => width * height * 4 > PREVIEW_ATLAS_BYTES,
        );
        expect(over).toEqual([]);
        // The mock sees the packer's allocations: an atlas that fits is allocated through it.
        allocations.length = 0;
        const small = packDoc(4, 4, 2);
        handlePack(createPackState(), request(small, composites(small), { reset: true }));
        expect(allocations.length).toBeGreaterThan(0);
    });

    it("answers more frames than an atlas holds with the too-many-frames message", () => {
        const count = MAX_ATLAS_FRAMES + 1;
        const doc = packDoc(1, 1, count);
        const sent = doc.frames.map((frame) => ({ id: frame.id, data: new Uint8ClampedArray(4) }));
        const response = handlePack(createPackState(), request(doc, sent, { reset: true }));
        expect(response).toMatchObject({ kind: "failed" });
        if (response.kind !== "failed") return;
        expect(response.message).toContain(`${count} frames`);
        expect(response.message).toContain(`${MAX_ATLAS_FRAMES}`);
    });

    it("answers an export error with its message: too many animation entries", () => {
        const tags = Array.from({ length: 258 }, (_, index) =>
            tag(`t${index}`, `t${index}`, 0, 0, { repeat: 255 }),
        );
        const doc = packDoc(2, 2, 1, tags);
        const response = handlePack(
            createPackState(),
            request(doc, composites(doc), { reset: true }),
        );
        expect(response).toMatchObject({ kind: "failed" });
        if (response.kind !== "failed") return;
        expect(response.message).toContain("65536");
    });
});
