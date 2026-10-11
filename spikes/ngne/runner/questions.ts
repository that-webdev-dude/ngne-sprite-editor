// The eleven questions of SE-002 (docs/tickets/M0-foundation.md). `method` and `threshold`
// are the ticket's wording; `go` and `noGo` are the consequence for the spec shown in the
// deliverable's summary table.

export interface QuestionMeta {
    readonly number: number;
    readonly title: string;
    /** Marked S in the ticket: the SwiftShader result is part of the question. */
    readonly swiftShader: boolean;
    readonly method: string;
    readonly threshold: string;
    readonly go: string;
    readonly noGo: string;
}

const UNDEFINED_FALLBACK = "No fallback is defined by the ticket or the SPEC: owner decision.";

export const QUESTIONS: readonly QuestionMeta[] = [
    {
        number: 1,
        title: "Upload latency and sustained rate",
        swiftShader: false,
        method: 'From a CPU `Uint8ClampedArray`: build bitmap, `texture("ed:f:0")`, `render()`; time to `texture()` resolution and to the next `render()` submitted. 64², 256², 512², 1024²; 200 samples each; then 5 s of replacements requested every animation frame',
        threshold:
            "256²: p95 ≤ 25 ms to submitted on Intel UHD and ≥ 30 completed replacements/s sustained. Other sizes recorded",
        go: "None. SPEC §6.6 keeps the echo as a fallback that SE-015 decides with its own measurement.",
        noGo: "SPEC §6.6: the overlay stroke echo becomes required (SE-015 implements it); recorded in REVIEW.md.",
    },
    {
        number: 2,
        title: "Single-flight queue",
        swiftShader: false,
        method: "Overlapping `texture()` calls; latest-wins queue during a 5 s continuous stream",
        threshold:
            'Earlier call rejects "superseded"; final content always shown; no starvation (≥ 1 publish per 100 ms)',
        go: "None. SPEC §6.2 #3 and the §6.4 upload queue stand.",
        noGo: `${UNDEFINED_FALLBACK} A starvation failure alone points to the §6.6 stroke echo.`,
    },
    {
        number: 3,
        title: "Pixel-exact placement, viewport path",
        swiftShader: true,
        method: "`pixelSnap = false`, integer top-left and size; DPR 1, 1.25, 1.5, 2; odd and even document sizes; scales 1, 3, 8",
        threshold: "In-page readback: zero device pixels differ from the expected pattern",
        go: "None. SPEC §6.2 #7 and the §6.4 view rules stand.",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 4,
        title: "Renderer replacement vs fixed oversized canvas",
        swiftShader: false,
        method: "(a) Dispose and create on a new canvas 50 times, including overlapping requests serialized by the caller. (b) One canvas with backing = logical = screen size in device pixels, CSS-clipped, window resized 50 times",
        threshold:
            "(a) No errors, one live device after each swap completes, never a blank viewport, median ≤ 250 ms. (b) Correct image, no recreation. Record which is adopted for SPEC §6.4",
        go: "The adopted strategy is written into SPEC §6.4 (texts for both outcomes are in section 4.4).",
        noGo: "If one strategy fails the other is adopted in SPEC §6.4. If both fail: no fallback is defined.",
    },
    {
        number: 5,
        title: "Two renderers",
        swiftShader: false,
        method: "Bare `WebGPURenderer` and a `BrowserGame` on two canvases for 60 s; `stop()`/`start()` the game 20 times through a serialized queue; host calls `app.renderer.texture()` after `start()` resolves; dispose and recreate the game on a new canvas 20 times",
        threshold: "No diagnostics other than dropped-tick notices; both keep rendering correctly",
        go: "None. SPEC §6.2 #12, #14 and §6.5 stand.",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 6,
        title: "Not-ready textures",
        swiftShader: false,
        method: "Reference an unuploaded slot, then gate on first-upload resolution",
        threshold: "Ungated frame is skipped with one diagnostic; gated path produces none",
        go: "None. SPEC §6.2 #5 stands.",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 7,
        title: "Readback and screenshots",
        swiftShader: true,
        method: "`readCanvas` after `render()` and inside `afterFrame`; Playwright screenshot of the same canvas; DPR 1.5 emulation; `devicePixelContentBoxSize` under emulation",
        threshold: "Readback exact for opaque texels in all modes; screenshot exact at DPR 1",
        go: "SPEC §6.7 stands. For tests at a DPR other than 1 see finding 7.1 (section 4.7).",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 8,
        title: "Device loss",
        swiftShader: false,
        method: "Wrap `GPUAdapter.prototype.requestDevice` before creating the renderer, keep the device, call `destroy()`",
        threshold:
            "NGNE returns to `ready` and manual slots show their content again within 2 s; polling per SPEC §6.4 redraws without user input",
        go: "None. SPEC §6.2 #13 and the §6.4 status polling stand.",
        noGo: `${UNDEFINED_FALLBACK} Candidate measured in section 4.8: also treat \`renderer.sprites === 0\` after a draw as a loss.`,
    },
    {
        number: 9,
        title: "Odd sizes through `BrowserGame`",
        swiftShader: true,
        method: "33×33 and 32×32 sprites drawn by a scene with default `pixelSnap` and with snapping off; even-padded rect per SPEC §9.2",
        threshold:
            "With snap off and with even rects under default snap: readback exact. Odd rect under default snap: result recorded (expected misaligned)",
        go: "None. SPEC §9.2 (even rectangles) and §6.5 (snap off) stand.",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 10,
        title: "`ngne-preview` acceptance",
        swiftShader: false,
        method: "Hand-written config per SPEC §9.5 with an odd-source, even-rect frame; run `node node_modules/@ngne/core/dist/preview/cli.js`; open the printed URL",
        threshold: "Page status starts with `Ready`, no error text",
        go: "None. SPEC §9.5 and §9.7 item 2 stand.",
        noGo: UNDEFINED_FALLBACK,
    },
    {
        number: 11,
        title: "Slot memory",
        swiftShader: false,
        method: "`renderer.inspect()` after filling all slots at 1024² and after replacing them with 1×1 images",
        threshold: "Estimated texture bytes fall back to within 1 MB of baseline",
        go: "None. SPEC §6.2 #4 (1×1 placeholders) stands.",
        noGo: UNDEFINED_FALLBACK,
    },
];
