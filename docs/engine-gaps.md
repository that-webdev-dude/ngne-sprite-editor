# Engine gap report

For the NGNE owner, from Sprite Editor runs 1–4 against the pinned `@ngne/core` 0.2.1.
These are consumer workarounds already in use, with possible generic engine improvements;
they are not requests to make the engine understand editor documents or export formats.
No engine change is required to ship this release candidate.

Evidence: [SPEC §6.8](SPEC.md#68-engine-gaps-and-workarounds),
[SE-002 integration spike](spikes/SE-002-ngne-integration.md),
[review record](REVIEW.md), and the
[run 4 performance record](perf/se-070-2026-10-21-cloud-swiftshader.md).
Costs below are qualitative unless an existing measurement is named.

| Gap | Workaround | Cost observed here | Engine change that would remove it |
| --- | ---------- | ------------------ | ---------------------------------- |
| Manual textures cannot be released; a bitmap is retained per ID | Reuse bounded slot IDs and replace idle textures with 1×1 images | Slot bookkeeping and retained placeholders. SE-002 Q11's estimate fell to 56 bytes above baseline after clearing on both reference GPUs | Public release of a manual texture, including its retained bitmap and GPU allocation |
| Upload replaces a whole texture asynchronously; repeated calls supersede; validation awaits GPU round trips | Single-flight latest-wins uploads, cached composites, eight frame slots and a playback grid; stroke echo on the overlay until the matching NGNE submit | Whole-frame bitmap/copy work for a small dab, queue/version bookkeeping and a second display path. RTX 4060 stroke p95 34.1 ms against 33 ms without echo (E61), 20.2 ms with it (E69). Run 4 frame switch needing upload: **80.8 ms p95 against 50 ms on cloud SwiftShader**, not reference hardware (H11); the reference result is unknown. F31 identifies two error-scope round trips on the update path | Reusable texture storage with dirty-region updates and a documented upload-ready signal that does not wait for diagnostic round trips; preserve error reporting separately |
| Only source-over blending and multiplicative tint | Composite layer/cel blend modes and red/blue onion tints on the CPU | Recompute dirty regions and upload pixels; tinted onion variants need their own cached buffers. A black ghost cannot become red through multiply (§7.5) | Per-draw blend modes and a tint operation able to add colour, with colour/alpha semantics matching the CPU contract |
| Renderer size is fixed; create has no public abort; instances on one canvas share a context | Serialize creates, render a new canvas before swapping, dispose the old renderer afterward | New devices/pipelines during resizes and a temporarily stretched old canvas. SE-002 Q4 medians 34.3–50.5 ms across replacement variants on reference GPUs; a create that never settles holds later creates (run 2 leg 1) | Public resize preserving renderer state and an abortable create/lifecycle contract with independent canvas ownership |
| Sampler is nearest/clamp, with no repeat or linear mode | Make a finite checker texture; resample reference display images on the CPU after 100 ms of settled zoom | Extra reference bitmaps/uploads; 4096-pixel source-side and 16 MP total display caps. F75: a whole-pixel move at fractional zoom can change rounded width by 1 px and resample; still open | Per-texture/per-draw repeat addressing and linear filtering so references can stay at source resolution |
| Camera has no zoom | Apply device-pixel scale and translation to the frame's sprite positions and sizes | Consumer mapping and hit-testing must agree at fractional DPR; SE-002 Q3 and SE-012 cover this | Public camera zoom with an explicit coordinate transform and snapping contract |
| No texture readback | Keep authoritative CPU buffers for export; test the canvas in-page immediately after render | Export cannot use GPU-only results; test infrastructure owns readback/synchronization. SE-002 Q7 and SE-053 compare opaque pixels exactly | Supported asynchronous texture/canvas readback with explicit colour, alpha and completion semantics |
| Default pixel snapping rounds centres | Disable it for editor/preview; even-pad atlas rectangles and round helper placement, taking exact quarter turns | Up to one transparent row/column per rectangle; helper offset/rotation logic. SE-002 Q9 differs for odd sprites on RTX 4060; D33 found a 1 px turn discrepancy from floating-point sine | Edge/top-left snapping or an explicit odd-size placement contract that keeps texel edges aligned |
| Recovery has no notification | Poll status plus the `sprites` counter, rearm dirty drawing and rebuild after failure | Polling even when idle and reliance on a 0.2.1 implementation detail. SE-002 Q8 status-only polling redrew 0/5 Intel UHD and 1/5 RTX losses; counter fallback 5/5 each, slowest 945/1047 ms | Public device-lost/restored/failed events, plus notification that restored manual textures are drawable |
| Animation entries have no repeat count or direction | Expand reverse/ping-pong and finite repeats into the consumer-owned atlas sequence | More entries; refuse exports beyond 65 536 total entries (D31). Editor playback itself keeps one pass and a counter | Generic animation repeat/direction support and matching preview adapter support; the atlas remains consumer-owned |
| BrowserGame lifecycle and uploads are not available inside a scene | Upload from the host after start, gate frames until ready, serialize start/stop and recreate on failure | Separate host orchestration and a demand scheduler; F68 also required sliced CPU preparation and clock catch-up after wakes | Stable ready/lifecycle hooks, a host asset-update API and a documented demand-render clock mode |

The SwiftShader result does not establish a hardware regression or a reference-budget miss.
H11/H12 leave reference measurements to the owner; H15 keeps CI frame/time budgets report-only.
The open popover trade-off H23, reference move F75 and soak stall H8 remain owner items in
[REVIEW H25](REVIEW.md#stop-checkpoint-e).
