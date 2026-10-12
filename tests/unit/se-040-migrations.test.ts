import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_VERSION, ProjectError, deserialize, docFromJson } from "../../src/core/project";
import { MIGRATIONS, migrateDocJson } from "../../src/core/project/migrations";
import type { Migration } from "../../src/core/project/migrations";
import {
    expectFailure,
    fixtureDocJson,
    fixtureDocument,
    fixtureFile,
    jsonBytes,
    rebuilt,
    thrown,
    withDocJson,
} from "./se-040-support";

/** Three migrations, as schema version 4 would have them. Each records that it ran. */
function chain(): { migrations: Migration[]; log: string[] } {
    const log: string[] = [];
    const step =
        (name: string, field: string): Migration =>
        (docJson) => {
            log.push(name);
            return { ...(docJson as object), [field]: name };
        };
    return { migrations: [step("1→2", "b"), step("2→3", "c"), step("3→4", "d")], log };
}

// The module's list is empty in schema version 1. Two tests below put a migration into it to
// see `deserialize` and `docFromJson` use it, and take it out again.
const installed = MIGRATIONS as Migration[];

afterEach(() => {
    installed.length = 0;
});

describe("migration scaffold", () => {
    it("has one migration for every schema version below the current one: none in version 1", () => {
        expect(PROJECT_VERSION).toBe(1);
        expect(MIGRATIONS).toHaveLength(PROJECT_VERSION - 1);
    });

    it("applies every migration from the file's version on, in order, each once", () => {
        const { migrations, log } = chain();

        expect(migrateDocJson({ a: 1 }, 1, migrations)).toEqual({
            a: 1,
            b: "1→2",
            c: "2→3",
            d: "3→4",
        });
        expect(log).toEqual(["1→2", "2→3", "3→4"]);
    });

    it("starts at the version the file has", () => {
        const second = chain();
        expect(migrateDocJson({ a: 1 }, 2, second.migrations)).toEqual({
            a: 1,
            c: "2→3",
            d: "3→4",
        });
        expect(second.log).toEqual(["2→3", "3→4"]);

        const third = chain();
        expect(migrateDocJson({ a: 1 }, 3, third.migrations)).toEqual({ a: 1, d: "3→4" });
        expect(third.log).toEqual(["3→4"]);
    });

    it("returns the value of the newest version as it is", () => {
        const { migrations, log } = chain();
        const docJson = { a: 1 };

        expect(migrateDocJson(docJson, 4, migrations)).toBe(docJson);
        expect(log).toEqual([]);
        // In schema version 1 that is every file.
        expect(migrateDocJson(docJson, 1)).toBe(docJson);
    });

    it("refuses a version above the newest and anything that is no version", () => {
        const { migrations, log } = chain();

        const newer = thrown(() => migrateDocJson({}, 5, migrations));
        expect(newer.code).toBe("newer-version");
        expect(newer.message).toMatch(
            /schema version 5, and this version of the editor reads up to version 4/,
        );
        for (const version of [0, -1, 2.5, Number.NaN, Infinity]) {
            const error = thrown(() => migrateDocJson({}, version, migrations));
            expect(error.code, String(version)).toBe("invalid-manifest");
        }
        expect(thrown(() => migrateDocJson({}, 2)).code).toBe("newer-version");
        expect(log).toEqual([]);
    });

    it("lets a migration refuse what it cannot rewrite", () => {
        const failing: Migration[] = [
            () => {
                throw new ProjectError("invalid-document", "doc.json: `title` is missing.");
            },
        ];
        expect(thrown(() => migrateDocJson({}, 1, failing)).code).toBe("invalid-document");
    });

    it("deserialize migrates doc.json before it checks it against the schema", async () => {
        // A file of an imagined older schema, which called the document's name `title`.
        const { name, ...rest } = fixtureDocJson();
        const older = rebuilt(fixtureFile(), { "doc.json": jsonBytes({ title: name, ...rest }) });
        await expectFailure(older, "invalid-document", /has no field `name`/);

        installed.push((docJson) => {
            const { title, ...others } = docJson as Record<string, unknown>;
            return { ...others, name: title };
        });
        // The module now counts two versions and takes the file for the first.
        const project = await deserialize(older);
        expect(project.doc).toEqual(fixtureDocument());
        // A file that is not of that older schema fails where the migrated value is checked.
        await expectFailure(
            withDocJson({ title: 5, ...rest }),
            "invalid-document",
            /`name` must be a string, got 5/,
        );
    });

    it("docFromJson migrates the JSON of the version it is told", () => {
        const { name, ...rest } = fixtureDocJson();
        installed.push((docJson) => {
            const { title, ...others } = docJson as Record<string, unknown>;
            return { ...others, name: title };
        });
        const images = fixtureDocument().images;

        expect(docFromJson({ title: name, ...rest }, images, 1)).toEqual(fixtureDocument());
        // Version 2 is then the newest: its JSON is read as it is.
        expect(docFromJson(fixtureDocJson(), images, 2)).toEqual(fixtureDocument());
        expect(thrown(() => docFromJson(fixtureDocJson(), images, 3)).code).toBe("newer-version");
    });
});
