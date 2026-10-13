import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bundle } from "../../src/core/export";
import { FIXTURES } from "../e2e/se-053-documents";
import {
    PREVIEW_CLI,
    listProcesses,
    previewProcesses,
    runningPreviews,
    startPreview,
} from "../e2e/se-053-preview-process";

// SE-053: the process handling of the `ngne-preview` check (SPEC §9.7, condition 2), without
// a browser. The command is started as the spec starts it, found in the process list by its
// command line, ended, and looked for again: none is left. The spec makes the same check
// after its last test; here it runs with `npm run check`, on Windows and on Linux alike.

/** Part of the name of every folder of this file: tells its previews from the spec's. */
const MARKER = "se-053-unit-process-";

const directories: string[] = [];

afterAll(async () => {
    for (const preview of runningPreviews()) await preview.stop().catch(() => undefined);
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** The bundle of fixture (a) in a new temporary folder; the path of its adapter. */
function writtenBundle(): string {
    const directory = mkdtempSync(join(tmpdir(), MARKER));
    directories.push(directory);
    const { files } = bundle(FIXTURES.a.build());
    for (const file of files) writeFileSync(join(directory, file.name), file.bytes);
    return join(directory, "walker.preview.config.mjs");
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
            const listed = await previewProcesses(MARKER);
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
        expect(await previewProcesses(MARKER)).toEqual([]);
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
            const listed = await previewProcesses(MARKER);
            expect(listed.map((entry) => entry.pid).sort()).toEqual([first.pid, second.pid].sort());
        } finally {
            await first.stop();
            await second.stop();
        }
        expect(await previewProcesses(MARKER)).toEqual([]);
    });

    it("rejects with what the command wrote when it does not start, and leaves no process", async () => {
        const directory = mkdtempSync(join(tmpdir(), MARKER));
        directories.push(directory);
        const missing = join(directory, "missing.preview.config.mjs");

        await expect(startPreview(missing)).rejects.toThrow(
            /ngne-preview exited with 1 before it printed an address\.\nNGNE preview failed: /,
        );
        expect(runningPreviews()).toEqual([]);
        expect(await previewProcesses(MARKER)).toEqual([]);
    });
});
