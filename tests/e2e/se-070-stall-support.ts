import type { CDPSession, Page, TestInfo } from "@playwright/test";

// A watch on the page's main thread for the SE-070 specs (fix round 2: a soak run hung for
// 20 minutes inside the page, and the trace could not say where). Every few seconds the
// watch asks the page for a trivial evaluation through the DevTools protocol; one that is not
// answered within `stallMs` means the main thread is stuck in a task. The watch then pauses
// the page's JavaScript (`Debugger.pause` interrupts a running script: the agent is enabled
// up front, since `Debugger.enable` itself waits for the busy thread), takes the stack with
// the source line of each frame, attaches it to the test, and closes the page so the test's
// pending calls fail; `rethrow` turns that failure into one that names the stack. When no
// script pauses, the thread is stuck outside JavaScript (a synchronous call into the browser
// or the GPU process), and the report says so.
//
// The debugger holds every script the page parsed while it is enabled; `stop` disables it, so
// a heap measured after `stop` does not count them.

export interface StallWatch {
    /** The report of a stall, once one was seen; null until then. */
    readonly stall: string | null;
    /** Ends the watch and disables the debugger. */
    stop(): Promise<void>;
    /** Throws the stall report when there was a stall, else `error`. */
    rethrow(error: unknown): never;
}

interface CallFrame {
    functionName: string;
    url: string;
    location: { scriptId: string; lineNumber: number; columnNumber?: number };
}

interface StackTrace {
    description?: string;
    callFrames: { functionName: string; url: string; lineNumber: number; columnNumber: number }[];
    parent?: StackTrace;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves with the value of `promise`, or with `null` once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), ms);
        }),
    ]);
}

/** The page's JavaScript stack at a pause, each frame with its line of source. */
async function pausedStack(cdp: CDPSession, frames: CallFrame[]): Promise<string[]> {
    const sources = new Map<string, string[]>();
    const lines: string[] = [];
    for (const frame of frames) {
        const { scriptId, lineNumber, columnNumber } = frame.location;
        if (!sources.has(scriptId)) {
            const source = await within(
                cdp
                    .send("Debugger.getScriptSource", { scriptId })
                    .then((result) => result.scriptSource.split("\n"))
                    .catch(() => []),
                5_000,
            );
            sources.set(scriptId, source ?? []);
        }
        const text = sources.get(scriptId)![lineNumber]?.trim().slice(0, 200) ?? "";
        lines.push(
            `at ${frame.functionName || "(anonymous)"} ${frame.url}:${lineNumber + 1}:${(columnNumber ?? 0) + 1}`,
            `    ${text}`,
        );
    }
    return lines;
}

/** Starts the watch on `page` through `cdp`, a DevTools session of that page. */
export async function watchStalls(
    page: Page,
    cdp: CDPSession,
    testInfo: TestInfo,
    { stallMs = 30_000, everyMs = 5_000 }: { stallMs?: number; everyMs?: number } = {},
): Promise<StallWatch> {
    await cdp.send("Debugger.enable");
    let stopped = false;
    let stall: string | null = null;

    const diagnose = async (since: number) => {
        const paused = new Promise<{ callFrames: CallFrame[]; asyncStackTrace?: StackTrace }>(
            (resolve) => cdp.once("Debugger.paused", resolve),
        );
        await within(
            cdp.send("Debugger.pause").catch(() => undefined),
            5_000,
        );
        const event = await within(paused, 10_000);
        const report = [
            `se-070: the page's main thread did not answer an evaluation for ${Math.round((Date.now() - since) / 1000)} s.`,
        ];
        if (event) {
            report.push(
                "Its JavaScript was paused here:",
                ...(await pausedStack(cdp, event.callFrames)),
            );
            for (let parent = event.asyncStackTrace; parent; parent = parent.parent) {
                report.push(`-- ${parent.description ?? "async"} --`);
                for (const frame of parent.callFrames) {
                    report.push(
                        `at ${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`,
                    );
                }
            }
            await within(
                cdp.send("Debugger.resume").catch(() => undefined),
                5_000,
            );
        } else {
            report.push(
                "No script paused within 10 s: the thread is stuck outside JavaScript (a synchronous call into the browser or the GPU process).",
            );
        }
        stall = report.join("\n");
        console.log(stall);
        await testInfo
            .attach("stall-stack.txt", { body: stall, contentType: "text/plain" })
            .catch(() => undefined);
        // The test's pending calls into the page fail once it is closed.
        await within(
            page.close().catch(() => undefined),
            10_000,
        );
    };

    const loop = (async () => {
        while (!stopped && stall === null) {
            const since = Date.now();
            const answered = await within(
                cdp
                    .send("Runtime.evaluate", { expression: "0", returnByValue: true })
                    .then(() => true)
                    .catch(() => false),
                stallMs,
            );
            if (stopped) return;
            // A closed page or session ends the watch; the test reports that on its own.
            if (answered === false) return;
            if (answered === null) {
                await diagnose(since);
                return;
            }
            await delay(everyMs);
        }
    })();

    return {
        get stall() {
            return stall;
        },
        async stop() {
            stopped = true;
            await within(loop, stallMs + 30_000);
            if (stall === null) await cdp.send("Debugger.disable").catch(() => undefined);
        },
        rethrow(error: unknown): never {
            if (stall !== null) throw new Error(stall, { cause: error });
            throw error;
        },
    };
}
