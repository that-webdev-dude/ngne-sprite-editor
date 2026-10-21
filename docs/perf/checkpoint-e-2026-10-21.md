# Checkpoint E reference measurements — 2026-10-21

Delegated by the owner after PR #1's `bbcf49e` CI passed. Measured on that checkout before
the F75 reference-drag correction, alone: no other benchmark or E2E ran at the same time.
No merge was performed; the owner's instruction to leave merging to them supersedes the
historical instruction to measure only after merging the wave.

Environment: Windows 11 10.0.26200, i7-12650H (16 logical processors), 16 GB RAM, AC power;
installed Chrome 155.0.8059.85, Node 24.15.0. Intel UHD gen-12lp driver 31.0.101.4314;
RTX 4060 Laptop GPU (nvidia/lovelace) driver 32.0.16.1078. Every browser benchmark verified
the requested WebGPU adapter. These are reference-hardware measurements, not SwiftShader.

Method: the unchanged [benchmark scripts](../../tests/perf/README.md), one process at a time,
`PERF_RECORD=1`, `PERF_GPU=intel-uhd` / `rtx-4060` and a fresh `PERF_ID` for each retained
record. The CPU benchmark ran once without `PERF_GPU`. Previous records were not replaced.
Stroke measurements were followed immediately by an unrecorded repeat.

| SPEC §6.6 scenario | Budget | Intel UHD | RTX 4060 |
| ----------------- | ------ | --------- | -------- |
| Stroke, largest of four p95s | 33 ms | [22.4 ms](se-070-stroke-checkpoint-e-intel-uhd-r2-2026-10-21.json) | [15.6 ms](se-070-stroke-checkpoint-e-rtx-4060-2026-10-21.json) |
| Dirty-rectangle composite, CPU | 2 ms | [0.0228 ms, GPU-independent](se-070-dirty-rectangle-checkpoint-e-2026-10-21.json) | Same CPU record |
| Cached frame switch | 1 animation frame | [1](se-070-frame-switch-cached-checkpoint-e-intel-uhd-2026-10-21.json) | [1](se-070-frame-switch-cached-checkpoint-e-rtx-4060-2026-10-21.json) |
| Frame switch requiring upload, p95 | 50 ms | [26.0 ms](se-070-frame-switch-upload-checkpoint-e-intel-uhd-2026-10-21.json) | [29.7 ms](se-070-frame-switch-upload-checkpoint-e-rtx-4060-2026-10-21.json) |
| Playback | 0 skipped | [0](se-070-playback-checkpoint-e-intel-uhd-2026-10-21.json) | [0](se-070-playback-checkpoint-e-rtx-4060-2026-10-21.json) |
| Idle viewport | 0 frames/s | [0](se-070-idle-checkpoint-e-intel-uhd-2026-10-21.json) | [0](se-070-idle-checkpoint-e-rtx-4060-2026-10-21.json) |
| Cold load to interactive, largest of 10 | 2000 ms | [273.7 ms](se-070-cold-load-checkpoint-e-intel-uhd-2026-10-21.json) | [1687.5 ms](se-070-cold-load-checkpoint-e-rtx-4060-2026-10-21.json) |

All seven benchmark budgets are met. H11's cloud upload-switch result (80.8 ms against
50 ms) did not reproduce as a reference-hardware miss.

## Stroke validity

- Intel: an initial unrecorded run submitted 480 frames, and the first recorded attempt
  submitted 577. Neither is accepted against the documented usual-frame-count rule.
  The latter remains only in the local diagnostic output, not this retained record set.
- Retained Intel repeat: 719 frames in the six-second stroke, 22.4 ms; immediate unrecorded
  confirmation: 730 frames, 22.7 ms. These meet the usual-count and agreement rules.
- RTX: retained run 674 frames, 15.6 ms; immediate unrecorded confirmation 683 frames,
  19.6 ms. Both counts are in the documented 650–700 range, both are below budget, and the
  4 ms spread is retained explicitly as the few-millisecond confirmation difference.
- Every sample was shown by the NGNE or overlay path, as required by the unchanged script.

## Separate E2E performance exception

The `@alone` E2E budget checks are separate from the seven scenarios above. With `CI`
unset and one worker, Intel passed 10/10; RTX passed 9/10. Its cel-opacity application took
three animation frames against two. The assertion is unchanged. The owner delegated the
decision: retain immediate page interaction after popovers close and accept this v1.0.0
performance exception, tracked in [issue #2](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/2).
This is not a claim that the complete non-CI hardware E2E suite passed.

The [checkpoint record](../audit/checkpoint-e-2026-10-21.md) contains the E2E logs, PWA check
and the disposition of the earlier owner items.
