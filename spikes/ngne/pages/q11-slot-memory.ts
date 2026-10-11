import { Frame } from "@ngne/core";
import { describeError, integerParam, round2, runSpike } from "../lib/harness.ts";
import { camera, createRenderer, placeDoc, readDiff, upload, VIEWPORT_SLOTS } from "../lib/ngne.ts";
import { makeDoc, solidDoc } from "../lib/pattern.ts";

// Question 11: slot memory.
// Method (ticket): `renderer.inspect()` after filling all slots at 1024² and after replacing
// them with 1×1 images. Go: estimated texture bytes fall back to within 1 MB of baseline.

const CLEAR = 0x101820;
const GO_BYTES = 1024 * 1024;
const MB = 1024 * 1024;

runSpike(11, async (spike) => {
    const size = integerParam(spike.params, "size", 1024);
    const cycles = integerParam(spike.params, "cycles", 3);
    const canvas = document.createElement("canvas");
    canvas.style.width = canvas.style.height = "256px";
    document.querySelector("#stage")?.append(canvas);
    const errors: string[] = [];
    const renderer = await createRenderer(canvas, 256, 256, (error) =>
        errors.push(describeError(error)),
    );
    const snapshot = () => {
        const { entries, ...totals } = renderer.inspect(100);
        return { ...totals, entryCount: entries.length };
    };
    const baseline = snapshot();
    const large = makeDoc(size, size, 9);
    const placeholder = solidDoc(1, 1, 0, 0);
    const probe = makeDoc(64, 64, 10);
    const frame = new Frame();
    const view = camera(false);

    const rounds = [];
    for (let cycle = 0; cycle < cycles; cycle++) {
        for (const slot of VIEWPORT_SLOTS) await upload(renderer, slot, large);
        const filled = snapshot();
        // The renderer still draws from a slot while every slot is full.
        frame.reset();
        frame.scene(view, 1);
        frame.sprite({ x: 128, y: 128, width: 256, height: 256, texture: "ed:f:0" });
        renderer.render(frame, CLEAR);
        const drewFull = renderer.sprites === 1;

        for (const slot of VIEWPORT_SLOTS) await upload(renderer, slot, placeholder);
        const released = snapshot();
        rounds.push({ cycle, filled, released, drewFull });
        spike.log(
            `cycle ${cycle}: filled ${round2(filled.estimatedTextureBytes / MB)} MB, ` +
                `after 1×1 ${released.estimatedTextureBytes} bytes`,
        );
    }

    // A slot is usable again after it held a placeholder.
    await upload(renderer, "ed:f:0", probe);
    const placement = { doc: probe, x: 32, y: 32, scale: 2 };
    frame.reset();
    frame.scene(view, 1);
    placeDoc(frame, "ed:f:0", placement);
    renderer.render(frame, CLEAR);
    const reuse = readDiff(canvas, CLEAR, [placement]);

    const first = rounds[0];
    const last = rounds[rounds.length - 1];
    if (!first || !last) throw new Error("No cycle ran");
    const expectedFilled = VIEWPORT_SLOTS.length * size * size * 4;
    const worstTexture = Math.max(
        ...rounds.map(
            (round) => round.released.estimatedTextureBytes - baseline.estimatedTextureBytes,
        ),
    );
    const worstSource = Math.max(
        ...rounds.map(
            (round) => round.released.estimatedSourceBytes - baseline.estimatedSourceBytes,
        ),
    );
    spike.metric("inspect", { baseline, rounds, slots: VIEWPORT_SLOTS.length, size });
    spike.check(
        "Filling every slot is visible in inspect()",
        first.filled.estimatedTextureBytes - baseline.estimatedTextureBytes === expectedFilled &&
            first.filled.manualSources === VIEWPORT_SLOTS.length,
        `${first.filled.estimatedTextureBytes} texture bytes, ${first.filled.manualSources} manual sources ` +
            `(expected +${expectedFilled} bytes)`,
    );
    spike.check(
        "Estimated texture bytes fall back to within 1 MB of baseline after 1×1 replacement",
        worstTexture <= GO_BYTES && worstTexture >= 0,
        `${worstTexture} bytes above baseline (worst of ${cycles} cycles)`,
    );
    spike.info(
        "Estimated source (retained bitmap) bytes also fall back to within 1 MB of baseline",
        worstSource <= GO_BYTES,
        `${worstSource} bytes above baseline`,
    );
    spike.info(
        "No growth across fill and release cycles",
        last.released.estimatedTextureBytes === first.released.estimatedTextureBytes &&
            last.released.textures === first.released.textures,
        `textures ${first.released.textures} -> ${last.released.textures}`,
    );
    spike.check(
        "Slots keep drawing while full and after holding a placeholder",
        rounds.every((round) => round.drewFull) && reuse.count === 0,
        reuse.count ? reuse.first : "",
    );
    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    spike.summary("Baseline estimated texture bytes", `${baseline.estimatedTextureBytes}`);
    spike.summary(
        `All ${VIEWPORT_SLOTS.length} slots at ${size}²: estimated texture / source bytes (MB)`,
        `${round2(first.filled.estimatedTextureBytes / MB)} / ${round2(first.filled.estimatedSourceBytes / MB)}`,
    );
    spike.summary(
        "After 1×1 replacement: estimated texture / source bytes",
        `${last.released.estimatedTextureBytes} / ${last.released.estimatedSourceBytes}`,
    );
    spike.summary("Above baseline after replacement (bytes, worst cycle)", `${worstTexture}`);
    renderer.dispose();
});
