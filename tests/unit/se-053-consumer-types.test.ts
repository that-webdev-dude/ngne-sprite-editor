import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundle } from "../../src/core/export";
import { FIXTURES, FIXTURE_IDS, textOf } from "../e2e/se-053-documents";
import { compile } from "./se-051-support";

// SE-053: the consumer fixture against the generated modules, by the compiler. The consumer
// page loads a generated `<name>.sprites.ts` by its URL and hands its exports to the game
// under the names of the game's `Sheet` (tests/fixtures/ngne-consumer/game.ts); a cast stands
// between the two there. Here the same hand-over is written out for every fixture and
// compiled with the settings of a generated module (SPEC §9.5): what the game calls is what
// the modules export.

/** The folder of the consumer fixture: the sources below are compiled as files of it. */
const CONSUMER = fileURLToPath(new URL("../fixtures/ngne-consumer/", import.meta.url));

/** The hand-over of one generated module to the game, as a module of its own. */
function handOver(name: string, camel: string, pascal: string): string {
    return `import type { Sheet } from "./game";
import {
    draw${pascal},
    draw${pascal}TopLeft,
    ${camel}AnimationDone,
    ${camel}AnimationFrame,
    ${camel}Image,
} from "./${name}.sprites";

export const sheet: Sheet = {
    image: ${camel}Image,
    draw: draw${pascal},
    drawTopLeft: draw${pascal}TopLeft,
    animationFrame: ${camel}AnimationFrame,
    animationDone: ${camel}AnimationDone,
};
`;
}

// One compiler run over the game, four generated modules and the DOM library.
describe("the consumer fixture and the generated modules", { timeout: 120_000 }, () => {
    const sources: Record<string, string> = {};
    for (const id of FIXTURE_IDS) {
        const { name, camel, pascal, build } = FIXTURES[id];
        sources[`${name}.sprites.ts`] = textOf(bundle(build()).files, ".sprites.ts");
        sources[`sheet-${id}.ts`] = handOver(name, camel, pascal);
    }

    it("compile together under the settings of a generated module", () => {
        expect(compile(CONSUMER, sources)).toEqual([]);
    });

    it("do not compile when the game asks for what a module does not export", () => {
        // The control: the compiler does look at the hand-over.
        const wrong = handOver("walker", "walker", "Walker").replace(
            "animationDone: walkerAnimationDone,",
            "animationDone: walkerAnimationFrame,",
        );
        const diagnostics = compile(CONSUMER, {
            "walker.sprites.ts": sources["walker.sprites.ts"],
            "sheet-a.ts": wrong,
        });
        // The import that is no longer used, and a frame ID where a boolean is asked for.
        expect(diagnostics).toHaveLength(2);
        expect(diagnostics[0]).toMatch(/^sheet-a\.ts\(5\): TS6133 'walkerAnimationDone' /);
        expect(diagnostics[1]).toMatch(
            /^sheet-a\.ts\(15\): TS2322 .* is not assignable to type '\(animation: string, ageMs: number\) => boolean'/,
        );
    });
});
