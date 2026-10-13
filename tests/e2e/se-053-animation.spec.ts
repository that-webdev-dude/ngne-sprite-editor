import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { FIXTURES, FIXTURE_IDS } from "./se-053-documents";
import type { FixtureId } from "./se-053-documents";
import {
    ANCHOR,
    boundaryAges,
    compareCanvas,
    expectedAnimationState,
    expectedCanvas,
} from "./se-053-expected";
import { advance, expectHealthy, openStage, play, resolveAnimation } from "./se-053-support";

// SE-053, the animation check: an NGNE game plays the animations of an exported sprite with
// `<name>AnimationFrame` and `<name>AnimationDone` of the generated module, on a scheduler
// the test controls. A tick of the game is 1 ms, the unit of an entry's duration, and the
// test lets whole ticks pass, so the age of an animation is exact: the game stands on the
// last millisecond before a boundary, and then on the boundary.
//
// For every time the test states the frame by its ID, and the canvas must show the composite
// of that frame: the frame the module names is the frame the game draws.

/** One moment of an animation: its age, the frame shown, and whether it has ended. */
type Moment = readonly [ageMs: number, frame: string, done: boolean];

interface Expected {
    playback: "loop" | "once";
    durationMs: number;
    /** The entries of the atlas: frame index in the document and milliseconds. */
    entries: readonly (readonly [index: number, ms: number])[];
    /** Moments in ascending order of age, the first at age 0; frames by index. */
    moments: readonly (readonly [ageMs: number, index: number, done: boolean])[];
}

/** Plays one animation of a fixture through the moments and checks each. */
async function expectAnimation(
    page: Page,
    testInfo: TestInfo,
    id: FixtureId,
    animation: string,
    expected: Expected,
): Promise<void> {
    const { fixture, doc, meta, composites } = await openStage(page, testInfo, id);
    const frameId = (index: number) => `${fixture.name}-${index}`;
    expect(await page.evaluate(() => window.__se053!.tickMs)).toBe(1);

    // What the test steps through is what the bundle holds.
    expect(meta.animations[animation]).toEqual({
        playback: expected.playback,
        durationMs: expected.durationMs,
        entries: expected.entries.map(([index, ms]) => ({ frame: frameId(index), ms })),
    });

    const [x, y] = ANCHOR;
    const moments: Moment[] = expected.moments.map(([age, index, done]) => [
        age,
        frameId(index),
        done,
    ]);
    expect(moments[0][0]).toBe(0);
    let age = 0;
    for (const [at, frame, done] of moments) {
        const shown = at === 0 ? await play(page, animation, x, y) : await advance(page, at - age);
        age = at;
        const label = `${animation} at ${at} ms`;
        // The game's own clock: the sum of its ticks, exact.
        expect(shown.ageMs, label).toBe(at);
        expect({ frame: shown.frame, done: shown.done }, label).toEqual({ frame, done });
        const composite = composites.get(frame);
        if (!composite) throw new Error(`No frame ${frame}`);
        const canvas = expectedCanvas(composite, doc.pivot, { frame, x, y });
        expect(compareCanvas(shown.canvas, canvas), label).toEqual([]);
    }
    await expectHealthy(page);
}

test.describe("an NGNE game playing the animations of an exported sprite", () => {
    test("a loop shows the expected frame at 0, mid-entry, at an entry boundary and after the end, and is never done", async ({
        page,
    }, testInfo) => {
        // Frames 0 to 2 of 100, 50 and 150 ms: the boundaries are at 100, 150 and 300.
        await expectAnimation(page, testInfo, "a", "walk", {
            playback: "loop",
            durationMs: 300,
            entries: [
                [0, 100],
                [1, 50],
                [2, 150],
            ],
            moments: [
                [0, 0, false],
                [1, 0, false],
                // Mid-entry, and the last millisecond before the boundary.
                [50, 0, false],
                [90, 0, false],
                [99, 0, false],
                // An entry starts on its boundary and ends before the next.
                [100, 1, false],
                [101, 1, false],
                [120, 1, false],
                [125, 1, false],
                [140, 1, false],
                [149, 1, false],
                [150, 2, false],
                [151, 2, false],
                [220, 2, false],
                [290, 2, false],
                [299, 2, false],
                // At `durationMs` the loop starts over; after the end it goes on.
                [300, 0, false],
                [301, 0, false],
                [350, 0, false],
                [399, 0, false],
                [400, 1, false],
                [449, 1, false],
                [450, 2, false],
                [590, 2, false],
                [599, 2, false],
                [600, 0, false],
                [1040, 1, false],
                [1199, 2, false],
                [1200, 0, false],
            ],
        });
    });

    test("a once animation shows the expected frames and stays on the last; AnimationDone flips at durationMs", async ({
        page,
    }, testInfo) => {
        // Frames 2 and 3 of 150 and 80 ms, played twice: the tag's repeat is written out
        // (SPEC §9.3). The boundaries are at 150, 230, 380 and the end at 460.
        await expectAnimation(page, testInfo, "a", "blink", {
            playback: "once",
            durationMs: 460,
            entries: [
                [2, 150],
                [3, 80],
                [2, 150],
                [3, 80],
            ],
            moments: [
                [0, 2, false],
                [70, 2, false],
                [140, 2, false],
                [149, 2, false],
                [150, 3, false],
                [190, 3, false],
                [220, 3, false],
                [229, 3, false],
                // The second pass.
                [230, 2, false],
                [370, 2, false],
                [379, 2, false],
                [380, 3, false],
                // The last millisecond before the end, the end, and after it.
                [450, 3, false],
                [459, 3, false],
                [460, 3, true],
                [461, 3, true],
                [470, 3, true],
                [920, 3, true],
                [5000, 3, true],
            ],
        });
    });

    test("a ping-pong played once goes there and back without repeating its ends", async ({
        page,
    }, testInfo) => {
        await expectAnimation(page, testInfo, "a", "turn", {
            playback: "once",
            durationMs: 580,
            entries: [
                [0, 100],
                [1, 50],
                [2, 150],
                [3, 80],
                [2, 150],
                [1, 50],
            ],
            moments: [
                [0, 0, false],
                [99, 0, false],
                [100, 1, false],
                [149, 1, false],
                [150, 2, false],
                [299, 2, false],
                [300, 3, false],
                [370, 3, false],
                [379, 3, false],
                [380, 2, false],
                [520, 2, false],
                [529, 2, false],
                [530, 1, false],
                [570, 1, false],
                [579, 1, false],
                [580, 1, true],
                [600, 1, true],
            ],
        });
    });

    test("a reversed loop of trimmed frames of odd size plays backwards", async ({
        page,
    }, testInfo) => {
        await expectAnimation(page, testInfo, "b", "flap", {
            playback: "loop",
            durationMs: 300,
            entries: [
                [3, 60],
                [2, 120],
                [1, 60],
                [0, 60],
            ],
            moments: [
                [0, 3, false],
                [50, 3, false],
                [59, 3, false],
                [60, 2, false],
                [170, 2, false],
                [179, 2, false],
                [180, 1, false],
                [239, 1, false],
                [240, 0, false],
                [290, 0, false],
                [299, 0, false],
                [300, 3, false],
                [480, 1, false],
            ],
        });
    });

    test("a document without tags loops over all its frames, merged ones under their own IDs", async ({
        page,
    }, testInfo) => {
        // Frames 0, 2 and 4 share one rectangle of the atlas, frames 1 and 3 another: the
        // animation names each frame by its own ID.
        await expectAnimation(page, testInfo, "c", "twice", {
            playback: "loop",
            durationMs: 300,
            entries: [
                [0, 70],
                [1, 30],
                [2, 70],
                [3, 30],
                [4, 100],
            ],
            moments: [
                [0, 0, false],
                [60, 0, false],
                [69, 0, false],
                [70, 1, false],
                [99, 1, false],
                [100, 2, false],
                [160, 2, false],
                [169, 2, false],
                [170, 3, false],
                [199, 3, false],
                [200, 4, false],
                [290, 4, false],
                [299, 4, false],
                [300, 0, false],
                [370, 1, false],
            ],
        });
    });

    test("a reversed loop of the pivot fixture keeps the bottom centre on the anchor", async ({
        page,
    }, testInfo) => {
        await expectAnimation(page, testInfo, "d", "idle", {
            playback: "loop",
            durationMs: 200,
            entries: [
                [1, 110],
                [0, 90],
            ],
            moments: [
                [0, 1, false],
                [100, 1, false],
                [109, 1, false],
                [110, 0, false],
                [190, 0, false],
                [199, 0, false],
                [200, 1, false],
                [310, 0, false],
            ],
        });
    });

    test("a looping ping-pong of the fixture with the off-centre pivot passes its middle frame twice", async ({
        page,
    }, testInfo) => {
        await expectAnimation(page, testInfo, "e", "sway", {
            playback: "loop",
            durationMs: 380,
            entries: [
                [0, 80],
                [1, 120],
                [2, 60],
                [1, 120],
            ],
            moments: [
                [0, 0, false],
                [79, 0, false],
                [80, 1, false],
                [199, 1, false],
                [200, 2, false],
                [259, 2, false],
                [260, 1, false],
                [379, 1, false],
                [380, 0, false],
                [460, 1, false],
            ],
        });
    });
});

test.describe("the animation functions of an exported module", () => {
    for (const id of FIXTURE_IDS) {
        const { title } = FIXTURES[id];

        test(`${title}: every animation changes frame on each boundary, to the millisecond`, async ({
            page,
        }, testInfo) => {
            // The functions the game calls, called without it: one millisecond and a
            // thousandth of one before every boundary, on it, and after it; laps later; and
            // before the start. An error of less than a tick of any game shows here.
            const { meta } = await openStage(page, testInfo, id);
            const animations = Object.entries(meta.animations);
            expect(animations.length).toBeGreaterThan(0);
            for (const [animation, data] of animations) {
                const ages = boundaryAges(data);
                const resolved = await resolveAnimation(page, animation, ages);
                expect(
                    resolved.map((state, index) => [ages[index], state.frame, state.done]),
                    animation,
                ).toEqual(
                    ages.map((age) => {
                        const state = expectedAnimationState(data, age);
                        return [age, state.frame, state.done];
                    }),
                );

                // Written out for the end, where a "once" animation flips: not done one
                // millisecond before `durationMs`, done on it.
                const { durationMs, entries, playback } = data;
                const last = entries[entries.length - 1].frame;
                const [before, justBefore, at, after] = await resolveAnimation(page, animation, [
                    durationMs - 1,
                    durationMs - 0.001,
                    durationMs,
                    durationMs + 1,
                ]);
                expect([before, justBefore], animation).toEqual([
                    { frame: last, done: false },
                    { frame: last, done: false },
                ]);
                const once = playback === "once";
                // A loop is back on its first entry and never done.
                const then = { frame: once ? last : entries[0].frame, done: once };
                expect([at, after], animation).toEqual([then, then]);
            }
            await expectHealthy(page);
        });
    }
});
