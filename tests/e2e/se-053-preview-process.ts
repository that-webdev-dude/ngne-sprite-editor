import { execFile, spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// SE-053: the installed `ngne-preview` as a child process (SPEC §9.7, condition 2), and the
// process list that shows whether one was left behind. Node only; no test runner is imported,
// so the specs and a unit test use the same code.

/** Absolute path of the command `ngne-preview` runs: the CLI of the installed `@ngne/core`. */
export const PREVIEW_CLI = fileURLToPath(
    new URL("../../node_modules/@ngne/core/dist/preview/cli.js", import.meta.url),
);

/** The line the CLI prints once its server listens. */
const URL_LINE = /^NGNE preview: (http:\/\/127\.0\.0\.1:\d+\/)\r?$/m;

/**
 * How long `startPreview` waits for the address. Below the time a test has locally (30 s),
 * with room for what the test does before it: a start that hangs ends by the rejection of
 * `startPreview`, with what the process wrote, and not by the test running out of time.
 */
export const START_TIMEOUT_MS = 15_000;

/** A child process started on `ngne-preview`, from the moment it exists. */
export interface PreviewChild {
    pid: number;
    /** The adapter file it was started on. */
    config: string;
    /** What the process has written so far, both streams. */
    output(): string;
    /**
     * Ends the process and resolves once the system has reported its end: asks first, and
     * kills it when it has not gone within `graceMs`. Rejects when it is still there after
     * that. Whether a process is left is then a question for the process list
     * (`previewProcesses`): a process ID alone may be in use again by another process.
     */
    stop(graceMs?: number): Promise<void>;
}

/** A preview that has printed its address: its server listens. */
export interface PreviewProcess extends PreviewChild {
    /** The address the CLI printed. */
    url: string;
}

/**
 * Every child `startPreview` has spawned in this process that has not exited: entered when
 * it is spawned, before it has printed anything, and removed when it exits. A test that
 * runs out of time while a preview starts has no `PreviewProcess` to stop; the child is
 * here all the same.
 */
const running = new Map<number, PreviewChild>();

/** The previews of this process that have not exited, started or still starting. */
export function runningPreviews(): PreviewChild[] {
    return [...running.values()];
}

// A test run that is cut short must not leave servers behind: on Windows a child outlives
// its parent unless it is ended.
process.once("exit", () => {
    for (const preview of running.values()) {
        try {
            process.kill(preview.pid, "SIGKILL");
        } catch {
            // Already gone.
        }
    }
});

function exited(
    child: ChildProcessByStdio<null, Readable, Readable>,
    ms: number,
): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.off("exit", done);
            resolve(false);
        }, ms);
        const done = () => {
            clearTimeout(timer);
            resolve(true);
        };
        child.once("exit", done);
    });
}

/**
 * Starts `ngne-preview` on an adapter file, the way SPEC §9.7 states it: this Node binary
 * with the absolute path of the installed CLI and the absolute path of the adapter. Resolves
 * with the address the CLI prints (`NGNE preview: <url>`); the server picks a free port of
 * its own.
 *
 * Rejects, with everything the process wrote, when it exits first, when it is stopped
 * first (through `runningPreviews`), or when it prints no address within `timeoutMs`; the
 * process is gone by then. From the moment of the call the child is one of
 * `runningPreviews`.
 */
export function startPreview(
    config: string,
    timeoutMs: number = START_TIMEOUT_MS,
): Promise<PreviewProcess> {
    const child = spawn(process.execPath, [PREVIEW_CLI, config], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    const output = () => `${stdout}${stderr}`.trim();

    const stop = async (graceMs = 5_000) => {
        // Without a process ID nothing was started.
        if (child.pid === undefined) return;
        if (await exited(child, 0)) return;
        // SIGTERM lets the CLI close its server; on Windows `kill` ends the process.
        child.kill();
        if (await exited(child, graceMs)) return;
        child.kill("SIGKILL");
        if (await exited(child, graceMs)) return;
        throw new Error(`ngne-preview (pid ${child.pid}) did not end: ${output()}`);
    };

    const { pid } = child;
    if (pid !== undefined) {
        running.set(pid, { pid, config, output, stop });
        child.once("exit", () => running.delete(pid));
    }

    return new Promise((resolve, reject) => {
        const fail = (reason: string) => {
            cleanup();
            void stop().then(
                () => reject(new Error(`${reason}\n${output()}`)),
                (error: unknown) => reject(new Error(`${reason}\n${String(error)}`)),
            );
        };
        const timer = setTimeout(
            () => fail(`ngne-preview printed no address in ${timeoutMs} ms.`),
            timeoutMs,
        );
        const onData = (chunk: string) => {
            stdout += chunk;
            const match = URL_LINE.exec(stdout);
            if (!match || pid === undefined) return;
            cleanup();
            resolve({ url: match[1], pid, config, output, stop });
        };
        // "close" and not "exit": by then everything the process wrote has been read.
        const onClose = (code: number | null, signal: string | null) =>
            fail(`ngne-preview exited with ${code ?? signal} before it printed an address.`);
        const onError = (error: Error) => fail(`ngne-preview could not be started: ${error}`);
        const cleanup = () => {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            child.off("close", onClose);
            child.off("error", onError);
            // Keep reading, so that the process never waits on a full pipe.
            child.stdout.on("data", (chunk: string) => (stdout += chunk));
        };
        child.stdout.on("data", onData);
        child.once("close", onClose);
        child.once("error", onError);
    });
}

// --- the folder of a run --------------------------------------------------------------------------

/**
 * The temporary folder of one run of a test file: a new folder of the system's, named
 * `<prefix>` and six random characters. Every adapter the run starts a preview on lies in
 * it, so its path is in the command line of every preview of the run and of no other
 * process: not of another checkout, not of a run before it, not of a second run going on in
 * the same checkout.
 *
 * With `pointer`, the path is kept in that file, and a call that finds the file returns the
 * folder it names (made again when it was removed). The processes of one run then share one
 * folder: a test runner starts a new worker after a failed test, and the new one must look
 * for what the old one left. The pointer has to be a file of this run alone.
 */
export function runFolder(prefix: string, pointer?: string): string {
    if (pointer !== undefined && existsSync(pointer)) {
        const folder = readFileSync(pointer, "utf8");
        mkdirSync(folder, { recursive: true });
        return folder;
    }
    const folder = mkdtempSync(join(tmpdir(), prefix));
    if (pointer !== undefined) {
        mkdirSync(dirname(pointer), { recursive: true });
        writeFileSync(pointer, folder);
    }
    return folder;
}

// --- the process list -----------------------------------------------------------------------------

export interface ListedProcess {
    pid: number;
    /** The command line: the program and its arguments. */
    command: string;
}

/** `pid command` lines, one process each, into a list. */
function parseLines(text: string): ListedProcess[] {
    const list: ListedProcess[] = [];
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s(.*)$/.exec(line);
        if (match) list.push({ pid: Number(match[1]), command: match[2].trim() });
    }
    return list;
}

/**
 * Every process of the machine this user can see, with its command line.
 * - Windows: `Win32_Process` through PowerShell (`wmic` is no longer part of Windows 11).
 * - Linux: `/proc/<pid>/cmdline`.
 * - Elsewhere: `ps`.
 * A process that ends while the list is made may be missing from it; one whose command line
 * cannot be read has an empty one. Throws when the list cannot be made, or does not hold
 * this process: a check that finds nothing in it would otherwise pass for the wrong reason.
 */
export async function listProcesses(): Promise<ListedProcess[]> {
    const list = await readProcessList();
    if (!list.some((entry) => entry.pid === process.pid)) {
        throw new Error(`The process list (${list.length} entries) does not hold this process.`);
    }
    return list;
}

async function readProcessList(): Promise<ListedProcess[]> {
    const run = promisify(execFile);
    const limits = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true } as const;
    if (process.platform === "win32") {
        const script =
            "$ErrorActionPreference = 'Stop'\n" +
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" +
            "Get-CimInstance Win32_Process | ForEach-Object { " +
            "'{0} {1}' -f $_.ProcessId, ($_.CommandLine -replace '\\s+', ' ') }\n";
        const { stdout } = await run(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            limits,
        );
        return parseLines(stdout);
    }
    if (process.platform === "linux") {
        const list: ListedProcess[] = [];
        for (const entry of readdirSync("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            try {
                const raw = readFileSync(`/proc/${entry}/cmdline`, "utf8");
                const command = raw.split("\0").filter(Boolean).join(" ");
                list.push({ pid: Number(entry), command });
            } catch {
                // Ended since the directory was read.
            }
        }
        return list;
    }
    const { stdout } = await run("ps", ["-axww", "-o", "pid=,command="], limits);
    return parseLines(stdout);
}

/**
 * The processes of the list that run this checkout's `ngne-preview`: their command line
 * names its CLI file. With `marker`, only those whose command line also holds that text:
 * the folder of a run (`runFolder`), for the previews of that run alone.
 */
export async function previewProcesses(marker = ""): Promise<ListedProcess[]> {
    return (await listProcesses()).filter(
        ({ command }) => command.includes(PREVIEW_CLI) && command.includes(marker),
    );
}

/**
 * Ends the listed processes, whoever started them. For what a run finds left of itself:
 * the caller reports it, and it is not left for the next run of the machine to find.
 */
export function endProcesses(list: readonly ListedProcess[]): void {
    for (const { pid } of list) {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // Gone since it was listed.
        }
    }
}
