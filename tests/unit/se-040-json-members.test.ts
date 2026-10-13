import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ProjectError, deserialize, serialize } from "../../src/core/project";
import { parseJson } from "../../src/core/project/json";
import {
    expectFailure,
    fixtureDocJson,
    fixtureDocument,
    fixtureFile,
    fixtureSources,
    rebuilt,
} from "./se-040-support";

// An object of a JSON entry has every member once (docs/FORMAT.md §1.2). `JSON.parse` keeps
// the last of two members with one name and says nothing, so a file could show one value to
// this reader and another to a reader that keeps the first. The reader refuses such an entry.

const DUPLICATE = /one of its objects has two members of the same name/;

/** The error `parseJson` throws for this text, or null when it returns a value. */
function refusal(text: string): ProjectError | null {
    try {
        parseJson(Buffer.from(text), "doc.json");
    } catch (error) {
        expect(error).toBeInstanceOf(ProjectError);
        return error as ProjectError;
    }
    return null;
}

describe("parseJson and repeated members", () => {
    it.each([
        ["at the top", '{"a": 1, "a": 2}'],
        ["with equal values", '{"a": 1, "a": 1}'],
        ["not next to each other", '{"a": 1, "b": 2, "a": 3}'],
        ["in a nested object", '{"a": {"b": 1, "c": 2, "b": 3}}'],
        ["in an object of an array", '[{"a": 1}, {"a": 1, "a": 2}]'],
        ["three times", '{"a": 1, "a": 2, "a": 3}'],
        ["with one name written with an escape", '{"name": 1, "na\\u006de": 2}'],
        ["with an empty name", '{"": 1, "": 2}'],
        ["with a name that holds a quote and a colon", '{"a\\":": 1, "a\\":": 2}'],
        ["named __proto__", '{"__proto__": 1, "__proto__": 2}'],
        ["whose values are objects", '{"a": {"x": 1}, "a": {"y": 2}}'],
        ["deep inside", `${'{"a":'.repeat(50)}{"b": 1, "b": 2}${"}".repeat(50)}`],
    ])("refuses a member twice %s", (_name, text) => {
        const error = refusal(text);

        expect(error?.code).toBe("corrupt-entry");
        expect(error?.message).toMatch(DUPLICATE);
        expect(error?.message).toContain('Entry "doc.json" is damaged: ');
        expect(error?.entry).toBe("doc.json");
    });

    it.each([
        ["the same name in two objects", '{"a": {"x": 1}, "b": {"x": 2}}'],
        ["the same name in the objects of an array", '[{"a": 1}, {"a": 2}, {"a": 3}]'],
        ["a colon in a string", '{"a": "b: c", "d": ":"}'],
        ["a quote and a colon in a string", '{"a": "\\": \\"", "b": "\\"a\\": 1"}'],
        ["a string that ends with a backslash", '{"a": "\\\\", "b": ":", "c": "\\\\\\\\"}'],
        ["a member in a string", '{"a": "{\\"a\\": 1, \\"a\\": 2}"}'],
        ["names that differ in case", '{"a": 1, "A": 2}'],
        ["names of which one ends where the other goes on", '{"a": 1, "ab": 2, "a ": 3}'],
        ["an escaped and a plain character that differ", '{"\\u0061": 1, "b": 2}'],
        ["no object at all", '[1, "a: b", [":", ":"]]'],
        ["a string alone", '"a: b"'],
        ["an empty object", "{}"],
        ["white space around everything", ' { "a" : 1 ,\n\t"b" : { "a" : 2 } } '],
    ])("accepts %s", (_name, text) => {
        expect(refusal(text)).toBeNull();
        expect(parseJson(Buffer.from(text), "doc.json")).toEqual(JSON.parse(text));
    });

    // Generated names hold no character that JSON escapes. Node 24.15.0 (V8 13.6) gives an
    // escaped name of an object the name that an object parsed before it had in that place,
    // when both are as long in the text: after `{"a": 1, "\\\\": 2}`, the names of
    // `{"a": 1, "\\\"": 2}` come back as `a` and two backslashes. Project files have fixed
    // names, so only a generated name meets this; values keep every character.
    const plainNames = fc.string({ unit: fc.constantFrom(":", "{", "}", ",", "a", "b", " ") });

    it("accepts any JSON value that a writer makes, whatever its strings hold", () => {
        // Strings with quotes, colons, backslashes and braces in values; colons, braces and
        // commas in names.
        const tricky = fc.string({
            unit: fc.constantFrom('"', ":", "\\", "{", "}", ",", "a", " "),
        });
        const values = fc.letrec((tie) => ({
            value: fc.oneof(
                { depthSize: "small" },
                tricky,
                fc.integer(),
                fc.boolean(),
                fc.constant(null),
                fc.array(tie("value"), { maxLength: 4 }),
                fc.dictionary(plainNames, tie("value"), { maxKeys: 4 }),
            ),
        })).value;
        fc.assert(
            fc.property(values, fc.constantFrom(undefined, 2, "\t"), (value, indent) => {
                const text = JSON.stringify(value, null, indent);
                expect(refusal(text)).toBeNull();
            }),
            { numRuns: 500 },
        );
    });

    it("refuses a member that is added a second time to any object a writer makes", () => {
        const texts = fc.string({ unit: fc.constantFrom('"', ":", "\\", "a", "b") });
        fc.assert(
            fc.property(
                fc.dictionary(plainNames, fc.oneof(fc.integer(), texts), {
                    minKeys: 1,
                    maxKeys: 5,
                }),
                fc.nat(),
                (object, pick) => {
                    const members = Object.entries(object).map(
                        ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
                    );
                    // One of the members once more, at the end.
                    const text = `{${[...members, members[pick % members.length]].join(", ")}}`;
                    expect(JSON.parse(text)).toEqual(object);
                    expect(refusal(text)?.message).toMatch(DUPLICATE);
                },
            ),
            { numRuns: 300 },
        );
    });

    it("counts the members of a value nested ten thousand deep without recursion", () => {
        const depth = 10_000;
        const nested = `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
        // Whether the engine parses it or not, the answer is an error of this module or none.
        const error = refusal(nested);
        if (error) expect(error.message).toMatch(/it is not valid JSON/);
        const arrays = `${"[".repeat(depth)}{"a": 1, "a": 2}${"]".repeat(depth)}`;
        expect(refusal(arrays)?.code).toBe("corrupt-entry");
    });
});

describe("deserialize and repeated members", () => {
    const manifestText = (versions: string) =>
        `{"format": "ngne-sprite-project", ${versions}, "generator": "a test"}`;

    it("refuses a manifest that states two versions, in either order", async () => {
        for (const versions of ['"version": 99, "version": 1', '"version": 1, "version": 99']) {
            const bytes = rebuilt(fixtureFile(), {
                "manifest.json": Buffer.from(manifestText(versions)),
            });
            const error = await expectFailure(bytes, "corrupt-entry", DUPLICATE);
            expect(error.entry).toBe("manifest.json");
        }
        // With one version the same manifest is read.
        const once = rebuilt(fixtureFile(), {
            "manifest.json": Buffer.from(manifestText('"version": 1')),
        });
        expect((await deserialize(once)).doc).toEqual(fixtureDocument());
    });

    it("refuses a doc.json with a member twice, at the top or inside", async () => {
        const text = JSON.stringify(fixtureDocJson());
        const twice: [string, string][] = [
            ['"width":4', '"width":4,"width":1024'],
            ['"opacity":128,"sourceId"', '"opacity":128,"opacity":128,"sourceId"'],
            ['"durationMs":80', '"durationMs":80,"durationMs":65535'],
            ['"pixelGrid":false', '"pixelGrid":false,"pixelGrid":true'],
            ['"tagId":"tag-idle"', '"tagId":"tag-idle","tagId":"tag-blink"'],
        ];
        for (const [once, repeated] of twice) {
            expect(text, once).toContain(once);
            const bytes = rebuilt(fixtureFile(), {
                "doc.json": Buffer.from(text.replace(once, repeated)),
            });
            const error = await expectFailure(bytes, "corrupt-entry", DUPLICATE);
            expect(error.entry, once).toBe("doc.json");
        }
    });

    it("reads names that look like JSON", async () => {
        const doc = fixtureDocument();
        doc.name = 'a: "b", \\ {"name": "c", "name": "d"} \\';
        doc.layers[1].name = '":"';
        doc.tags[0].name = "\\";
        doc.palette.name = '\\"';
        const project = await deserialize(serialize(doc, fixtureSources()));

        expect(project.doc).toEqual(doc);
    });
});
