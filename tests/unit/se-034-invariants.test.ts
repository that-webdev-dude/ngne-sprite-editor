import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InvariantError, assertInvariants, createDocument } from "../../src/core/model";
import type { DocSession } from "../../src/core/model";
import { ProjectError, docFromJson, docToJson } from "../../src/core/project";

// SE-034: `assertInvariants` checks tag ranges with a frame-index map instead of a search per
// tag, and `core/project` no longer works around the search (`assertTagRanges` is gone).

/** A document of `frames` frames with IDs of 64 characters, and `tags` tags over the last two. */
function documentWith(frames: number, tags: number): DocSession {
    const session = createDocument({ name: "tags", width: 1, height: 1 });
    const { doc } = session;
    const id = (prefix: string, index: number) => `${prefix}${index}`.padEnd(64, "_");
    doc.frames = Array.from({ length: frames }, (_, index) => ({
        id: id("frame", index),
        durationMs: 100,
    }));
    session.activeFrameId = doc.frames[0].id;
    doc.tags = Array.from({ length: tags }, (_, index) => ({
        id: id("tag", index),
        name: "T",
        color: 0xffffffff,
        fromFrameId: doc.frames[frames - 2].id,
        toFrameId: doc.frames[frames - 1].id,
        direction: "forward",
        repeat: 0,
    }));
    return session;
}

function invariantOf(run: () => void): string | null {
    try {
        run();
    } catch (error) {
        if (error instanceof InvariantError) return error.invariant;
        throw error;
    }
    return null;
}

describe("tag ranges in assertInvariants", () => {
    it("still finds a missing endpoint and a range that runs backwards", () => {
        const missing = documentWith(4, 2);
        missing.doc.tags[1].toFrameId = "nowhere";
        expect(invariantOf(() => assertInvariants(missing))).toBe("tag-endpoints-exist");

        const backwards = documentWith(4, 2);
        backwards.doc.tags[0].fromFrameId = backwards.doc.frames[3].id;
        backwards.doc.tags[0].toFrameId = backwards.doc.frames[1].id;
        expect(invariantOf(() => assertInvariants(backwards))).toBe("tag-order");

        const sound = documentWith(4, 2);
        sound.doc.tags[0].fromFrameId = sound.doc.frames[2].id;
        sound.doc.tags[0].toFrameId = sound.doc.frames[2].id;
        expect(invariantOf(() => assertInvariants(sound))).toBeNull();
    });

    it("reads the frame list a number of times linear in frames + tags, not their product", () => {
        const frames = 2000;
        const tags = 500;
        const session = documentWith(frames, tags);
        let reads = 0;
        // Counts every read of an element of `doc.frames`, by index, whichever method makes it.
        session.doc.frames = new Proxy(session.doc.frames, {
            get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property)) reads++;
                return Reflect.get(target, property, receiver) as unknown;
            },
        });
        assertInvariants(session);
        // A search per tag would read up to 2 × tags × frames = 2 000 000 elements.
        expect(reads).toBeGreaterThan(0);
        expect(reads).toBeLessThanOrEqual(4 * (frames + tags));
    });

    it("checks 1024 tags over 65 535 frames with full-length IDs in time linear in their sum", () => {
        // A search per tag compares about 134 million IDs here, which takes seconds.
        const session = documentWith(65_535, 1024);
        const start = performance.now();
        assertInvariants(session);
        expect(performance.now() - start).toBeLessThan(1000);
    });

    it("a project file is checked by the model's own invariants: no workaround is left", () => {
        const source = readFileSync(
            new URL("../../src/core/project/docFromJson.ts", import.meta.url),
            "utf8",
        );
        expect(source).not.toContain("assertTagRanges");

        const session = documentWith(3, 1);
        const json = docToJson(session.doc);
        json.tags[0].fromFrameId = session.doc.frames[2].id;
        json.tags[0].toFrameId = session.doc.frames[0].id;
        let caught: unknown = null;
        try {
            docFromJson(json, new Map());
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(ProjectError);
        expect(caught).toMatchObject({ code: "invariant" });
        expect((caught as ProjectError).cause).toMatchObject({ invariant: "tag-order" });
    });

    it("a project file at the limits of tags and frames is checked in time linear in their sum", () => {
        const session = documentWith(65_535, 1024);
        const json = docToJson(session.doc);
        const start = performance.now();
        const doc = docFromJson(json, new Map());
        expect(performance.now() - start).toBeLessThan(5000);
        expect(doc.tags).toHaveLength(1024);
    }, 60_000);
});
