import { expect, test } from "@playwright/test";
import type { CDPSession, Locator, Page } from "@playwright/test";
import type * as CommandsModule from "../../src/app/commands/appCommands";
import type * as EnvironmentModule from "../../src/app/keymap/environment";
import type * as ResolveModule from "../../src/app/keymap/resolve";
import type * as PlaybackModule from "../../src/app/playback/playbackState";
import type * as CoreModel from "../../src/core/model";
import { collectErrors, settleTimers } from "./se-006-support";
import { openEditor } from "./se-007-support";
import { stubFileSystemAccess } from "./se-041-support";
import { stubExportFolders } from "./se-052-support";
import { watchStalls } from "./se-070-stall-support";

// SE-070: the soak. 500 commands of the registry, each picked at random from a fixed seed
// among those a user can reach at that moment: registered (not planned), enabled, and bound in
// a key context that applies (SPEC §7.8: `applicableContexts` of the page's own key
// environment) or placed in a menu or a context menu. The candidates are read from the
// registry before every pick, so a command added later takes part without an edit here. Each
// runs as a menu runs it (playback stops first unless the command keeps it, `invokeCommand`),
// a hold binding is released after it, and the spec waits until its promise settles or it
// opens a surface. Surfaces are answered: New sprite is created or cancelled, the discard
// question cancelled or answered Discard, at random from the same seed; every other dialog,
// menu or popover is dismissed with Escape. The pickers of File System Access are the stubs of
// SE-041 and SE-052, which cancel, and a file input's chooser is cancelled the same way.
//
// After every command: `assertInvariants` on every open document (SPEC §5.1), a command that
// threw or rejected, a command whose promise is still unsettled once its surfaces were answered,
// a navigation of the main frame, and the page's console errors and uncaught errors; any of
// them fails the run, with the seed and the commands so far. A step with nothing reachable
// runs no command: the loop goes on until exactly 500 have run. At the end every document is
// closed with the File menu's Close (Discard where asked), the garbage collector is run
// several times through the DevTools protocol, and the heap is within 10% of the baseline
// taken the same way after the app had loaded, before the first document. The heap compared
// is a heap snapshot's nodes but V8's compiled code: the code of every function the commands
// ran for the first time (machine code, bytecode, feedback) is V8's, not held by the app, and a
// collection does not take it back. That code has a fixed ceiling of its own, and
// `Runtime.getHeapUsage`, which counts it, is reported beside both.
//
// The check can see a leak: the start document holds more pixel bytes than the 10% margin
// (asserted), and keeps more than the margin even flattened, so a closed document left
// reachable fails it (SE-070 review A: a control run that kept the closed start session in a
// global failed the check at +20%).

const SEED = 0x5e070;
const COMMANDS = 500;
const HEAP_MARGIN = 0.1;
/**
 * The most V8's compiled code (`code` nodes) may grow over the soak. Measured growth: about
 * 6.6 MB in SE-070's first runs, 6.3 to 7.0 MB in 18 runs of the review fix round (SwiftShader,
 * cloud). The ceiling is more than twice the largest, so a slower tier of the compiler or a
 * later command's code does not reach it, while code that keeps growing with the commands
 * (functions made anew and compiled each time) does.
 */
const CODE_CEILING = 16 * 1024 * 1024;
/** A step with nothing reachable runs no command; the loop gives up after this many steps. */
const MAX_STEPS = 2 * COMMANDS;

/** A small fast generator of numbers in [0, 1) from a seed (mulberry32). */
function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
}

interface SoakPage {
    /** Whether the promise of the command picked last has settled. */
    settled: boolean;
    /** Commands that threw or rejected. */
    failures: string[];
}

declare global {
    interface Window {
        __se070soak?: SoakPage;
    }
}

/**
 * Opens the document the soak starts from: 256 × 256, 2 layers, 32 frames, a tag, pixels in 48
 * of its 64 cels (about 12.6 MB). Every frame has pixels, so a flatten still leaves 32 cels
 * (about 8.4 MB), more than the heap margin. Returns the bytes of its pixels.
 */
function openStart(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const path = "/src/core/model/index.ts";
        const core = (await import(/* @vite-ignore */ path)) as typeof CoreModel;
        const width = 256;
        const height = 256;
        const session = core.createDocument({ name: "soak", width, height });
        const { doc } = session;
        const base = doc.layers[0]!;
        doc.layers = Array.from({ length: 2 }, (_, index) => ({
            ...base,
            id: index === 0 ? base.id : `layer-${index + 1}`,
            name: `Layer ${index + 1}`,
        }));
        const first = doc.frames[0]!;
        doc.frames = Array.from({ length: 32 }, (_, index) => ({
            id: index === 0 ? first.id : `frame-${index + 1}`,
            durationMs: 100,
        }));
        let pixelBytes = 0;
        doc.layers.forEach((layer, l) => {
            doc.frames.forEach((frame, f) => {
                if ((l + f) % 4 === 3) return;
                const data = new Uint8ClampedArray(width * height * 4);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if ((x + y + l + f) % (l + 2) !== 0) continue;
                        data.set(
                            [(x * 10 + l * 80) & 255, (y * 15 + f * 60) & 255, 128, 255],
                            (y * width + x) * 4,
                        );
                    }
                }
                const imageId = `image-${l}-${f}`;
                doc.images.set(imageId, { width, height, data });
                pixelBytes += data.byteLength;
                doc.cels.set(core.celKey(layer.id, frame.id), { imageId, opacity: 255 });
            });
        });
        doc.tags = [
            {
                id: "tag-1",
                name: "walk",
                color: 0x73bed3ff,
                fromFrameId: doc.frames[1]!.id,
                toFrameId: doc.frames[5]!.id,
                direction: "forward",
                repeat: 0,
            },
        ];
        session.activeLayerId = doc.layers[1]!.id;
        session.activeFrameId = first.id;
        window.__ngneTest!.sessions.getState().open(session);
        window.__ngneTest!.assertInvariants();
        return pixelBytes;
    });
}

/** Installs the page's side of the soak: the record of command failures. */
function installSoak(page: Page): Promise<void> {
    return page.evaluate(() => {
        window.__se070soak = { settled: true, failures: [] };
    });
}

/** A command the soak picked, and how many were reachable when it was picked. */
interface Picked {
    id: string | null;
    candidates: number;
}

/**
 * Picks the next command among those reachable now, with `pick` in [0, 1), and runs it as a
 * menu does. Returns its id (null when no command is reachable) and the number of candidates.
 */
function runPicked(page: Page, pick: number): Promise<Picked> {
    return page.evaluate(async (pick) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { appCommands } = (await load(
            "/src/app/commands/appCommands.ts",
        )) as typeof CommandsModule;
        const { readKeyEnvironment } = (await load(
            "/src/app/keymap/environment.ts",
        )) as typeof EnvironmentModule;
        const { applicableContexts } = (await load(
            "/src/app/keymap/resolve.ts",
        )) as typeof ResolveModule;
        const { keepsPlaying, stopPlaybackForEdit } = (await load(
            "/src/app/playback/playbackState.ts",
        )) as typeof PlaybackModule;
        const soak = window.__se070soak!;
        const hooks = window.__ngneTest!;
        const contexts = applicableContexts(
            readKeyEnvironment(document, hooks.keyContexts.getState()),
        );
        const candidates = appCommands.list().filter((command) => {
            if (command.planned || !command.enabled()) return false;
            const bound =
                command.shortcuts.length > 0 && command.contexts.some((c) => contexts.includes(c));
            return bound || command.menuPath !== null || command.contextMenus.length > 0;
        });
        if (candidates.length === 0) return { id: null, candidates: 0 };
        const command =
            candidates[Math.min(candidates.length - 1, Math.floor(pick * candidates.length))]!;
        soak.settled = false;
        const fail = (error: unknown) =>
            soak.failures.push(
                `${command.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
            );
        try {
            if (!keepsPlaying(command.id)) stopPlaybackForEdit();
            const result = command.run();
            if (result instanceof Promise) {
                result.then(
                    () => (soak.settled = true),
                    (error: unknown) => {
                        fail(error);
                        soak.settled = true;
                    },
                );
            } else {
                soak.settled = true;
            }
            command.release?.();
        } catch (error) {
            fail(error);
            soak.settled = true;
        }
        return { id: command.id, candidates: candidates.length };
    }, pick);
}

const SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The surfaces open on the page: dialogs, menus, popovers. */
const surfaces = (page: Page): Locator => page.locator(SURFACES).filter({ visible: true });

/** Answers or dismisses every open surface; returns what it did. */
async function answerSurfaces(page: Page, random: () => number): Promise<string[]> {
    const done: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        if ((await surfaces(page).count()) === 0) return done;
        const top = surfaces(page).last();
        const name =
            (await top.getAttribute("aria-label")) ??
            (await top.evaluate((element) => {
                const id = element.getAttribute("aria-labelledby");
                return (
                    (id && document.getElementById(id)?.textContent) ||
                    element.getAttribute("role") ||
                    ""
                );
            }));
        // Radix moves the focus into a surface one timer after it opens.
        await settleTimers(page);
        if (name === "New sprite" && random() < 0.5) {
            await top.getByRole("button", { name: "Create", exact: true }).click();
            done.push("New sprite: Create");
        } else if (name === "Discard unsaved changes?" && random() < 0.5) {
            await top.getByRole("button", { name: "Discard", exact: true }).click();
            done.push("Discard: Discard");
        } else {
            await page.keyboard.press("Escape");
            done.push(`${name}: Escape`);
        }
        await expect(top)
            .toBeHidden({ timeout: 10_000 })
            .catch(() => undefined);
        await settleTimers(page);
    }
    if ((await surfaces(page).count()) > 0) throw new Error("se-070: a surface would not close");
    return done;
}

/** Waits until the last command's promise has settled or a surface is open (at most `ms`). */
async function commandSettled(page: Page, ms: number): Promise<boolean> {
    try {
        await page.waitForFunction(
            (selector) =>
                window.__se070soak!.settled ||
                Array.from(document.querySelectorAll<HTMLElement>(selector)).some((element) =>
                    element.checkVisibility(),
                ),
            SURFACES,
            { timeout: ms, polling: 20 },
        );
        return true;
    } catch {
        return false;
    }
}

/** Whether the last command's promise has settled. */
function isSettled(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__se070soak!.settled);
}

/** The page's heap after the collector has run five times. */
interface Heap {
    /** `Runtime.getHeapUsage`: everything V8 holds, compiled code included. */
    used: number;
    /** A heap snapshot's nodes by their own size: the code V8 compiled (`code` nodes)… */
    code: number;
    /** …and everything else: the objects, strings, arrays, closures and native memory. */
    withoutCode: number;
}

async function heapAfterGc(cdp: CDPSession): Promise<Heap> {
    for (let run = 0; run < 5; run++) {
        await cdp.send("HeapProfiler.collectGarbage");
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    const chunks: string[] = [];
    const take = (event: { chunk: string }) => void chunks.push(event.chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", take);
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    cdp.off("HeapProfiler.addHeapSnapshotChunk", take);
    const snapshot = JSON.parse(chunks.join("")) as {
        snapshot: { meta: { node_fields: string[]; node_types: [string[]] } };
        nodes: number[];
    };
    const fields = snapshot.snapshot.meta.node_fields;
    const types = snapshot.snapshot.meta.node_types[0];
    const typeAt = fields.indexOf("type");
    const sizeAt = fields.indexOf("self_size");
    let code = 0;
    let rest = 0;
    for (let at = 0; at < snapshot.nodes.length; at += fields.length) {
        const size = snapshot.nodes[at + sizeAt]!;
        if (types[snapshot.nodes[at + typeAt]!] === "code") code += size;
        else rest += size;
    }
    return { used: usedSize, code, withoutCode: rest };
}

test("soak: 500 seeded commands of the registry keep every document valid with no error, and the heap returns within 10% once all are closed", async ({
    page,
    context,
}, testInfo) => {
    // Measured at about 4 min on SwiftShader at one worker; the rest is margin.
    test.setTimeout(20 * 60_000);
    const errors = collectErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubFileSystemAccess(page);
    await stubExportFolders(page);
    // A file input's chooser is taken by the test and cancelled: the input gets the `cancel`
    // event Chrome sends when the user closes the chooser, so the command that asked settles.
    page.on("filechooser", (chooser) => {
        void chooser
            .element()
            .evaluate((input) => input.dispatchEvent(new Event("cancel", { bubbles: true })))
            .catch(() => undefined);
    });
    await openEditor(page);
    await installSoak(page);
    // A command that navigates or reloads the page fails the run with its id (review J).
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const baseline = await heapAfterGc(cdp);

    // A stuck main thread fails the run with the page's stack (fix round 2: a run hung).
    const watch = await watchStalls(page, cdp, testInfo);
    const pixelBytes = await openStart(page);
    // Review A: a closed document kept reachable would hold more than the margin.
    expect(
        pixelBytes,
        `start pixels against the margin of ${baseline.withoutCode} B`,
    ).toBeGreaterThan(HEAP_MARGIN * baseline.withoutCode);
    const random = generator(SEED);
    const sequence: string[] = [];
    /** Each step: the command run (null: nothing reachable) and the candidates it was one of. */
    const steps: Picked[] = [];
    let executed = 0;
    const report = () =>
        `seed ${SEED}, after ${executed} commands; the last: ${sequence.slice(-12).join(" → ")}`;
    const expectNoNavigation = (id: string | null) =>
        expect(
            navigations,
            `${id ?? "(nothing reachable)"} navigated the main frame; ${report()}`,
        ).toEqual([]);
    try {
        for (let step = 0; executed < COMMANDS && step < MAX_STEPS; step++) {
            let picked: Picked;
            try {
                picked = await runPicked(page, random());
            } catch (error) {
                expectNoNavigation("the command being picked");
                throw error;
            }
            steps.push(picked);
            const { id } = picked;
            if (id === null) {
                // Nothing to do (no document, a surface in the way): start a new sprite.
                sequence.push("(nothing reachable)");
                await answerSurfaces(page, random);
                expectNoNavigation(id);
                continue;
            }
            executed++;
            sequence.push(id);
            await commandSettled(page, 10_000);
            expectNoNavigation(id);
            // A surface answered may open the next (Discard, then New sprite): answered until
            // the command settles or no surface opens.
            const answers: string[] = [];
            for (let round = 0; round < 4; round++) {
                const answered = await answerSurfaces(page, random);
                expectNoNavigation(id);
                if (answered.length === 0) break;
                answers.push(...answered);
                await commandSettled(page, 10_000);
                expectNoNavigation(id);
            }
            if (answers.length > 0) sequence.push(`[${answers.join("; ")}]`);
            // Review F: still pending once its surfaces were answered and the second wait is
            // over, the command fails the run.
            expect(
                (await isSettled(page)) ? null : `${id}: its promise did not settle`,
                report(),
            ).toBeNull();
            const state = await page.evaluate(() => {
                let invariant: string | null = null;
                try {
                    window.__ngneTest!.assertInvariants();
                } catch (error) {
                    invariant = error instanceof Error ? error.message : String(error);
                }
                return { invariant, failures: [...window.__se070soak!.failures] };
            });
            expect(state.invariant, report()).toBeNull();
            expect(state.failures, report()).toEqual([]);
            expect(errors, report()).toEqual([]);
        }
        // Review E: exactly 500 commands ran.
        expect(executed, report()).toBe(COMMANDS);

        // Close everything with File → Close, answering Discard.
        for (let tries = 0; tries < 50; tries++) {
            const open = await page.evaluate(
                () => window.__ngneTest!.sessions.getState().documents.length,
            );
            if (open === 0) break;
            await answerSurfaces(page, () => 1);
            await page.evaluate(() => void window.__ngneTest!.commands.get("file.close")!.run());
            const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
            await expect
                .poll(
                    async () =>
                        (await discard.count()) > 0 ||
                        (await page.evaluate(
                            () => window.__ngneTest!.sessions.getState().documents.length,
                        )) < open,
                )
                .toBe(true);
            if ((await discard.count()) > 0) {
                await settleTimers(page);
                await discard.getByRole("button", { name: "Discard", exact: true }).click();
                await expect(discard).toHaveCount(0);
            }
        }
        expect(
            await page.evaluate(() => window.__ngneTest!.sessions.getState().documents.length),
        ).toBe(0);
        // The debugger the watch enabled holds every script the page parsed: let go first.
        await watch.stop();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const after = await heapAfterGc(cdp);
        const change = (key: keyof Heap) =>
            `${key} ${baseline[key]} → ${after[key]} B (${(((after[key] - baseline[key]) / baseline[key]) * 100).toFixed(1)}%)`;
        const description = [
            ...(["withoutCode", "code", "used"] as const).map(change),
            `start pixels ${pixelBytes} B`,
        ].join("; ");
        testInfo.annotations.push({ type: "heap", description });
        console.log(`se-070 soak heap: ${description}`);
        // The code V8 compiled for the functions the commands ran for the first time stays
        // (about 6.6 MB of machine code, bytecode and feedback in the first runs, REVIEW
        // decision of SE-070); everything the app holds is compared.
        expect(Math.abs(after.withoutCode - baseline.withoutCode), description).toBeLessThanOrEqual(
            HEAP_MARGIN * baseline.withoutCode,
        );
        // Review B: the code has a ceiling of its own.
        expect(after.code - baseline.code, description).toBeLessThanOrEqual(CODE_CEILING);
        expect(errors).toEqual([]);
    } catch (error) {
        watch.rethrow(error);
    } finally {
        await watch.stop();
        await testInfo.attach("soak-sequence.json", {
            body: JSON.stringify({ seed: SEED, executed, sequence, steps }, null, 4),
            contentType: "application/json",
        });
    }
});
