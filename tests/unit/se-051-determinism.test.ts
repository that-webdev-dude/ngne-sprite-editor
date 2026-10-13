import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compositeFrame } from "../../src/core/composite";
import { atlasFor, bundle } from "../../src/core/export";
import type { Bundle } from "../../src/core/export";
import type { SpriteDoc } from "../../src/core/model";
import { exportSettings, heroWalk, noise, sprite, withGoldenGenerator } from "./se-051-support";

// A bundle is a function of the document and the settings, and of nothing else: not of the
// clock, the time zone, the order in which the document was built, or the run. Its text
// files are ASCII with line feeds, so they are the same bytes on every platform.

const originalZone = process.env.TZ;

afterEach(() => {
    vi.useRealTimers();
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
});

/** The fixture with every optional file. */
function everyFile(doc: SpriteDoc = heroWalk()): Bundle {
    return bundle(doc);
}

function sameFiles(a: Bundle, b: Bundle): boolean {
    return (
        a.files.length === b.files.length &&
        a.files.every(
            (file, index) =>
                file.name === b.files[index].name &&
                Buffer.compare(Buffer.from(file.bytes), Buffer.from(b.files[index].bytes)) === 0,
        )
    );
}

const TEXT_ENDINGS = [".atlas.json", ".sprites.ts", ".preview.config.mjs", ".aseprite.json"];

describe("bundle is deterministic", () => {
    it("writes five files for the fixture", () => {
        expect(everyFile().files.map((file) => file.name.replace("hero-walk", ""))).toEqual([
            ".png",
            ...TEXT_ENDINGS,
        ]);
    });

    it("yields identical bytes for every file, twice within one run", () => {
        const doc = heroWalk();
        const first = bundle(doc);
        const second = bundle(doc);

        expect(first.files[0].bytes).not.toBe(second.files[0].bytes);
        expect(sameFiles(first, second)).toBe(true);
        // And for an equal document built anew.
        expect(sameFiles(everyFile(), first)).toBe(true);
        // The comparison does see a difference: another duration is another bundle.
        const changed = heroWalk();
        changed.frames[1].durationMs = 81;
        expect(sameFiles(everyFile(changed), first)).toBe(false);
    });

    it("yields identical bytes in a second run: the files committed by an earlier one", () => {
        // The golden files were written by another process, on the day they were committed
        // (se-051-golden.test.ts compares them one by one). The generator names the version
        // of the editor, which that run and this one need not share.
        const made = everyFile();
        const directory = new URL("./se-051-fixtures/", import.meta.url);

        for (const file of made.files.slice(1)) {
            const committed = readFileSync(new URL(`${file.name}.golden`, directory));
            const written = Buffer.from(
                withGoldenGenerator(new TextDecoder().decode(file.bytes)),
                "utf8",
            );
            expect(Buffer.compare(written, committed), file.name).toBe(0);
        }
    });

    it("yields identical bytes from a module loaded anew", async () => {
        const first = everyFile();
        vi.resetModules();
        const fresh = await import("../../src/core/export");

        expect(fresh.bundle).not.toBe(bundle);
        expect(sameFiles(fresh.bundle(heroWalk()), first)).toBe(true);
    });

    it("yields identical bytes one second, one day and forty years apart", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-13T08:30:00Z"));
        const first = everyFile();

        for (const later of [
            "2026-10-13T08:30:01Z",
            "2026-10-14T08:30:00Z",
            "2066-12-31T23:59:59Z",
        ]) {
            vi.setSystemTime(new Date(later));
            expect(Date.now()).toBe(Date.parse(later));
            expect(sameFiles(everyFile(), first), later).toBe(true);
        }
    });

    it("yields identical bytes in every time zone", () => {
        process.env.TZ = "UTC";
        const first = everyFile();
        const offsets = new Set<number>();

        for (const zone of [
            "Pacific/Kiritimati",
            "Asia/Kolkata",
            "Europe/Rome",
            "America/Los_Angeles",
            "Pacific/Niue",
        ]) {
            process.env.TZ = zone;
            offsets.add(new Date(2026, 0, 1).getTimezoneOffset());
            expect(sameFiles(everyFile(), first), zone).toBe(true);
        }
        // The zones did take effect.
        expect(offsets.size).toBe(5);
    });

    it("holds no date and no path", () => {
        const year = String(new Date().getFullYear());
        for (const file of everyFile().files.slice(1)) {
            const text = new TextDecoder().decode(file.bytes);
            expect(text, file.name).not.toContain(year);
            expect(text, file.name).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/);
            expect(text, file.name).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\//);
        }
    });

    it("does not depend on the order in which the document's cels and images were added", () => {
        const doc = heroWalk();
        const reversed: SpriteDoc = {
            ...doc,
            cels: new Map([...doc.cels].reverse()),
            images: new Map([...doc.images].reverse()),
        };

        expect([...reversed.cels.keys()]).not.toEqual([...doc.cels.keys()]);
        expect(sameFiles(bundle(reversed), bundle(doc))).toBe(true);
    });

    it("does not depend on what the settings do not say: files switched off change no other file", () => {
        const all = everyFile();
        const some = bundle(
            heroWalk(),
            exportSettings({ trim: true, files: { spritesTs: false, asepriteJson: "none" } }),
        );

        expect(some.files.map((file) => file.name)).toEqual([
            "hero-walk.png",
            "hero-walk.atlas.json",
            "hero-walk.preview.config.mjs",
        ]);
        for (const file of some.files) {
            const twin = all.files.find((candidate) => candidate.name === file.name);
            expect(
                Buffer.compare(Buffer.from(file.bytes), Buffer.from(twin?.bytes ?? [])),
                file.name,
            ).toBe(0);
        }
    });

    it("atlasFor is deterministic as well: pixels and metadata", () => {
        const doc = heroWalk();
        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        const first = atlasFor(frames, doc);
        const second = atlasFor(frames, doc);

        expect(first.atlas).not.toBe(second.atlas);
        expect(Buffer.compare(Buffer.from(first.atlas.data), Buffer.from(second.atlas.data))).toBe(
            0,
        );
        expect(JSON.stringify(first.meta)).toBe(JSON.stringify(second.meta));
    });
});

/**
 * What ends a line besides a line feed: the separators of Unicode (U+2028, U+2029, U+0085),
 * vertical tab and form feed. Made from their numbers, so that this file holds none.
 */
const SEPARATORS = [0x2028, 0x2029, 0x85, 0x0b, 0x0c].map((code) => String.fromCharCode(code));

/** A document whose names hold line ends, a comment end, a template and a line separator. */
function hostile(): SpriteDoc {
    return sprite({
        name: `Ünï\r\ncödé */ \` \${x} ${SEPARATORS[0]} ★`,
        frames: [noise(3, 3, 1), noise(3, 3, 2)],
        tags: [{ name: `tab\there\r\n${SEPARATORS[1]}`, from: 0, to: 1 }],
        settings: { files: { asepriteJson: "hash" } },
    });
}

describe("the text files of a bundle", () => {
    const documents: [string, SpriteDoc][] = [
        ["the fixture", heroWalk()],
        ["a hostile name", hostile()],
    ];

    it.each(documents)("of %s end lines with a line feed and nothing else", (_name, doc) => {
        const made = bundle(doc);

        for (const ending of TEXT_ENDINGS) {
            const file = made.files.find((candidate) => candidate.name.endsWith(ending));
            const text = new TextDecoder("utf-8", { fatal: true }).decode(file?.bytes);
            expect(text.length, ending).toBeGreaterThan(100);
            expect(text, ending).not.toContain("\r");
            expect(
                SEPARATORS.some((separator) => text.includes(separator)),
                ending,
            ).toBe(false);
            // One line feed ends the file; no line ends in white space.
            expect(text.endsWith("\n"), ending).toBe(true);
            expect(text.endsWith("\n\n"), ending).toBe(false);
            expect(text, ending).not.toMatch(/[ \t]\n/);
        }
    });

    it.each(documents)("of %s are ASCII, without a byte order mark or a tab", (_name, doc) => {
        for (const file of bundle(doc).files.slice(1)) {
            const bytes = Array.from(file.bytes);
            expect(
                bytes.every((byte) => byte === 10 || (byte >= 32 && byte <= 126)),
                file.name,
            ).toBe(true);
        }
    });

    it("indent the JSON files by four spaces a level", () => {
        const made = everyFile();
        for (const ending of [".atlas.json", ".aseprite.json"]) {
            const text = new TextDecoder().decode(
                made.files.find((file) => file.name.endsWith(ending))?.bytes,
            );
            const lines = text.split("\n").slice(0, -1);

            expect(lines[0], ending).toBe("{");
            expect(lines[lines.length - 1], ending).toBe("}");
            for (const line of lines) {
                expect((line.match(/^ */)?.[0].length ?? 0) % 4, line).toBe(0);
            }
            expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 4)}\n`);
        }
    });

    it("write the members of the atlas JSON in a fixed order", () => {
        const { meta } = everyFile();

        expect(Object.keys(meta)).toEqual([
            "format",
            "version",
            "generator",
            "image",
            "width",
            "height",
            "frames",
            "animations",
        ]);
        for (const frame of Object.values(meta.frames)) {
            expect(Object.keys(frame)).toEqual([
                "x",
                "y",
                "w",
                "h",
                "sourceW",
                "sourceH",
                "offsetX",
                "offsetY",
                "pivot",
            ]);
        }
        for (const animation of Object.values(meta.animations)) {
            expect(Object.keys(animation)).toEqual(["playback", "durationMs", "entries"]);
            for (const entry of animation.entries)
                expect(Object.keys(entry)).toEqual(["frame", "ms"]);
        }
    });
});
