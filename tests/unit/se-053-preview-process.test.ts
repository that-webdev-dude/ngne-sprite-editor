import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bundle } from "../../src/core/export";
import { FIXTURES } from "../e2e/se-053-documents";
import {
    PREVIEW_CLI,
    START_TIMEOUT_MS,
    endProcesses,
    listProcesses,
    previewProcesses,
    runFolder,
    runningPreviews,
    startPreview,
} from "../e2e/se-053-preview-process";

// SE-053: the process handling of the `ngne-preview` check (SPEC §9.7, condition 2), without
// a browser. The command is started as the spec starts it, found in the process list by its
// command line, ended, and looked for again: none is left. That holds for a preview that
// never printed its address too. The spec makes the same check after its last test; here it
// runs with `npm run check`, on Windows and on Linux alike.

/**
 * The folder of this run of the file. Every adapter of the file lies in it, so its path
 * tells the previews of this run from those of the spec and from those of a second
 * `vitest run` going on in the same checkout.
 */
const RUN = runFolder("se-053-unit-process-");

afterAll(async () => {
    for (const preview of runningPreviews()) await preview.stop().catch(() => undefined);
    const left = await previewProcesses(RUN);
    endProcesses(left);
    rmSync(RUN, { recursive: true, force: true, maxRetries: 5 });
    expect(left).toEqual([]);
});

/** A new folder inside the folder of the run. */
function folder(): string {
    return mkdtempSync(join(RUN, "bundle-"));
}

/** The bundle of fixture (a) in a new folder; the path of its adapter. */
function writtenBundle(): string {
    const directory = folder();
    const { files } = bundle(FIXTURES.a.build());
    for (const file of files) writeFileSync(join(directory, file.name), file.bytes);
    return join(directory, "walker.preview.config.mjs");
}

/**
 * An adapter the command never gets past: the module stays alive and never finishes
 * loading, so `ngne-preview` prints nothing, neither an address nor an error.
 */
function hangingAdapter(): string {
    const path = join(folder(), "hanging.preview.config.mjs");
    writeFileSync(
        path,
        "setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport default {};\n",
    );
    return path;
}

// Each case starts Node once or twice, and on Windows asks PowerShell for the process list.
describe("ngne-preview as a child process", { timeout: 120_000 }, () => {
    it("is the CLI of the installed package, by an absolute path", () => {
        expect(isAbsolute(PREVIEW_CLI)).toBe(true);
        expect(PREVIEW_CLI.replaceAll("\\", "/")).toMatch(
            /\/node_modules\/@ngne\/core\/dist\/preview\/cli\.js$/,
        );
        expect(existsSync(PREVIEW_CLI)).toBe(true);
    });

    it("starts on a bundle, is seen in the process list, and is gone after stop()", async () => {
        const config = writtenBundle();
        const preview = await startPreview(config);
        try {
            expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
            expect(preview.config).toBe(config);
            expect(preview.output()).toBe(`NGNE preview: ${preview.url}`);
            // The server answers: the adapter data of the bundle.
            const response = await fetch(new URL("config", preview.url));
            expect(response.status).toBe(200);
            const served = (await response.json()) as { frames: { id: string }[] };
            expect(served.frames.map((frame) => frame.id)).toEqual([
                "walker-0",
                "walker-1",
                "walker-2",
                "walker-3",
            ]);

            // The process list shows it by its command line: this Node binary, the CLI and
            // the adapter, each by its absolute path.
            const listed = await previewProcesses(RUN);
            expect(listed.map((entry) => entry.pid)).toEqual([preview.pid]);
            expect(listed[0].command).toContain(PREVIEW_CLI);
            expect(listed[0].command).toContain(config);
            expect(runningPreviews().map((entry) => entry.pid)).toEqual([preview.pid]);
            // The list is the whole machine's: this process is in it too.
            const everything = await listProcesses();
            expect(everything.some((entry) => entry.pid === process.pid)).toBe(true);
        } finally {
            await preview.stop();
        }

        expect(runningPreviews()).toEqual([]);
        expect(await previewProcesses(RUN)).toEqual([]);
        await expect(fetch(new URL("config", preview.url))).rejects.toThrow();
        // Stopping it again does nothing.
        await expect(preview.stop()).resolves.toBeUndefined();
    });

    it("picks a free port for every preview", async () => {
        const first = await startPreview(writtenBundle());
        const second = await startPreview(writtenBundle());
        try {
            expect(first.url).not.toBe(second.url);
            expect(first.pid).not.toBe(second.pid);
            const listed = await previewProcesses(RUN);
            expect(listed.map((entry) => entry.pid).sort()).toEqual([first.pid, second.pid].sort());
        } finally {
            await first.stop();
            await second.stop();
        }
        expect(await previewProcesses(RUN)).toEqual([]);
    });

    it("rejects with what the command wrote when it does not start, and leaves no process", async () => {
        const missing = join(folder(), "missing.preview.config.mjs");

        await expect(startPreview(missing)).rejects.toThrow(
            /ngne-preview exited with 1 before it printed an address\.\nNGNE preview failed: /,
        );
        expect(runningPreviews()).toEqual([]);
        expect(await previewProcesses(RUN)).toEqual([]);
    });
});

// A test that runs out of time while a preview starts has nothing in hand to stop it with.
describe("ngne-preview before it has printed its address", { timeout: 120_000 }, () => {
    it("is tracked from the moment it is spawned, and is gone once it is stopped", async () => {
        const config = hangingAdapter();
        const outcome = startPreview(config, 90_000).then(
            () => "started",
            (error: unknown) => String(error),
        );

        // Known at once, though `startPreview` has returned nothing yet.
        const [child, ...others] = runningPreviews();
        expect(others).toEqual([]);
        expect(child.config).toBe(config);
        // A process of the machine, on the adapter of this run, that has printed nothing.
        const listed = await previewProcesses(RUN);
        expect(listed.map((entry) => entry.pid)).toEqual([child.pid]);
        expect(listed[0].command).toContain(config);
        expect(child.output()).toBe("");

        // What the `afterAll` of a spec does with it.
        for (const preview of runningPreviews()) await preview.stop();

        expect(await outcome).toMatch(
            /^Error: ngne-preview exited with \S+ before it printed an address\.\n$/,
        );
        expect(runningPreviews()).toEqual([]);
        expect(await previewProcesses(RUN)).toEqual([]);
    });

    it("is ended by startPreview itself when the address does not come in time", async () => {
        const config = hangingAdapter();
        const began = Date.now();

        await expect(startPreview(config, 1_500)).rejects.toThrow(
            /^ngne-preview printed no address in 1500 ms\.\n$/,
        );
        expect(Date.now() - began).toBeGreaterThanOrEqual(1_400);
        // The rejection comes after the process has gone, not before.
        expect(runningPreviews()).toEqual([]);
        expect(await previewProcesses(RUN)).toEqual([]);
    });

    it("waits less for the address than a test has time", () => {
        // 30 s locally (playwright.config.ts); the export page is opened before the start.
        expect(START_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
        expect(START_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    });
});

describe("the folder of a run", () => {
    const made: string[] = [];
    afterAll(() => {
        for (const path of made) rmSync(path, { recursive: true, force: true });
    });

    it("is a new temporary folder for every run, named by the prefix", () => {
        const first = runFolder("se-053-unit-run-");
        const second = runFolder("se-053-unit-run-");
        made.push(first, second);

        expect(first).not.toBe(second);
        for (const path of [first, second]) {
            expect(dirname(path)).toBe(tmpdir());
            expect(basename(path)).toMatch(/^se-053-unit-run-.{6}$/);
            expect(existsSync(path)).toBe(true);
        }
        // The folder of this file is one of them, and none of these two.
        expect(basename(RUN)).toMatch(/^se-053-unit-process-.{6}$/);
        expect([first, second]).not.toContain(RUN);
    });

    it("is shared by the processes of one run through its pointer file", () => {
        const pointer = join(folder(), "nested", "run.txt");
        const first = runFolder("se-053-unit-run-", pointer);
        made.push(first);
        expect(readFileSync(pointer, "utf8")).toBe(first);

        // A second process of the run, a worker started after a failed test, asks again.
        expect(runFolder("se-053-unit-run-", pointer)).toBe(first);
        // Also after the first one has cleaned up behind itself: the folder is made again.
        rmSync(first, { recursive: true, force: true });
        expect(runFolder("se-053-unit-run-", pointer)).toBe(first);
        expect(existsSync(first)).toBe(true);

        // Another run has another pointer, and another folder.
        const other = runFolder("se-053-unit-run-", join(folder(), "run.txt"));
        made.push(other);
        expect(other).not.toBe(first);
    });
});
