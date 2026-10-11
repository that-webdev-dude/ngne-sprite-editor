import { Frame } from "@ngne/core";
import { describeError, runSpike } from "../lib/harness.ts";
import { camera, createRenderer, placeDoc, readDiff, upload } from "../lib/ngne.ts";
import { makeDoc, type Placement } from "../lib/pattern.ts";

// Question 3 (S): pixel-exact placement on the viewport path.
// Method (ticket): `pixelSnap = false`, integer top-left and size; DPR 1, 1.25, 1.5, 2 (one
// run of this page per DPR); odd and even document sizes; scales 1, 3, 8.
// Go: in-page readback, zero device pixels differ from the expected pattern.

const SLOT = "ed:f:0";
const CLEAR = 0x202830;
const DOCS: readonly (readonly [number, number])[] = [
    [32, 32],
    [33, 33],
    [33, 32],
    [16, 31],
    [64, 64],
    [1, 1],
    [255, 256],
];
const SCALES = [1, 3, 8];
const ORIGINS: readonly (readonly [number, number])[] = [
    [0, 0],
    [7, 5],
    [10, 11],
    [-3, -2],
];

/** Size of an element in device pixels, as the viewport reads it (SPEC §6.4). */
function devicePixelSize(element: Element): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const observer = new ResizeObserver((entries) => {
            observer.disconnect();
            const box = entries[0]?.devicePixelContentBoxSize?.[0];
            resolve(box ? { width: box.inlineSize, height: box.blockSize } : null);
        });
        try {
            observer.observe(element, { box: "device-pixel-content-box" });
        } catch {
            resolve(null);
        }
    });
}

runSpike(3, async (spike) => {
    spike.variant ||= `DPR ${devicePixelRatio}`;
    // The viewport element: an odd CSS size at an odd offset, so fractional DPRs do not land
    // on whole device pixels by accident.
    const viewport = document.createElement("div");
    viewport.style.cssText =
        "position:absolute;left:7px;top:5px;width:801px;height:601px;overflow:hidden";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%";
    viewport.append(canvas);
    const stage = document.querySelector<HTMLElement>("#stage");
    if (!stage) throw new Error("Missing stage");
    stage.style.height = "620px";
    stage.append(viewport);

    const box = await devicePixelSize(viewport);
    const rect = viewport.getBoundingClientRect();
    const rounded = {
        width: Math.round(rect.width * devicePixelRatio),
        height: Math.round(rect.height * devicePixelRatio),
    };
    spike.metric("viewport", {
        cssSize: [rect.width, rect.height],
        devicePixelContentBox: box,
        roundedCssTimesDpr: rounded,
    });
    spike.info(
        "devicePixelContentBoxSize is reported for the viewport element",
        box !== null,
        box
            ? `${box.width}x${box.height}; round(CSS x DPR) ${rounded.width}x${rounded.height}`
            : "",
    );
    const size = box ?? rounded;

    const errors: string[] = [];
    const renderer = await createRenderer(canvas, size.width, size.height, (error) =>
        errors.push(describeError(error)),
    );
    const frame = new Frame();
    const draw = (placement: Placement, pixelSnap: boolean) => {
        frame.reset();
        frame.scene(camera(pixelSnap), 1);
        placeDoc(frame, SLOT, placement);
        renderer.render(frame, CLEAR);
    };

    let cases = 0;
    let exact = 0;
    let differing = 0;
    let snappedCases = 0;
    let snappedMisaligned = 0;
    const failures: string[] = [];
    for (const [index, [width, height]] of DOCS.entries()) {
        const doc = makeDoc(width, height, index + 1);
        await upload(renderer, SLOT, doc);
        for (const scale of SCALES)
            for (const [x, y] of ORIGINS) {
                const placement: Placement = { doc, x, y, scale };
                draw(placement, false);
                const diff = readDiff(canvas, CLEAR, [placement]);
                cases++;
                if (diff.count === 0) exact++;
                else {
                    differing += diff.count;
                    if (failures.length < 5)
                        failures.push(
                            `${width}x${height} scale ${scale} at ${x},${y}: ` +
                                `${diff.count} px; ${diff.first}`,
                        );
                }
                // Recorded only: the same quad under NGNE's default centre snapping.
                draw(placement, true);
                snappedCases++;
                if (readDiff(canvas, CLEAR, [placement]).count !== 0) snappedMisaligned++;
            }
        spike.log(`${width}x${height}: ${exact}/${cases} cases exact so far`);
    }

    spike.metric("cases", {
        documents: DOCS,
        scales: SCALES,
        origins: ORIGINS,
        backing: [size.width, size.height],
        cases,
        exact,
        differingPixels: differing,
        defaultSnapMisalignedCases: snappedMisaligned,
    });
    spike.check(
        "pixelSnap off: zero device pixels differ from the expected pattern",
        exact === cases && differing === 0,
        `${exact}/${cases} cases exact, ${differing} differing pixels` +
            (failures.length ? `; ${failures.join("; ")}` : ""),
    );
    spike.info(
        "Default pixelSnap misaligns some of the same quads (expected; recorded per adapter)",
        snappedMisaligned > 0,
        `${snappedMisaligned}/${snappedCases} cases differ with pixelSnap = true`,
    );
    spike.check("No renderer diagnostic", errors.length === 0, errors.join(" | "));
    spike.summary(
        "Backing size (device px) of the 801x601 CSS px viewport",
        `${size.width}x${size.height}`,
    );
    spike.summary("pixelSnap off: exact cases / cases", `${exact} / ${cases}`);
    spike.summary("pixelSnap off: differing device pixels", `${differing}`);
    spike.summary(
        "Default pixelSnap: misaligned cases / cases (recorded)",
        `${snappedMisaligned} / ${snappedCases}`,
    );
    renderer.dispose();
});
