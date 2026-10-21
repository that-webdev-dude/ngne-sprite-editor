# Checkpoint E — 2026-10-21

**Passed under delegated owner authority**, with an accepted RTX cel-opacity performance
exception and an explicit waiver of the native PWA install check. SE-073 remains Done.
Merging, tagging and deployment remain the owner's actions.

## Authority and scope

The owner instructed: "Resolve checkpoint yourself on my behalf alongside all the remaining
items. for the decisional items use your best judgment. leave me the merging, tagging and
deploy". This authorises the checkpoint decisions, remaining evidence and narrow fixes below,
including the F75 source correction and the missing preview script. It supersedes the earlier
documentation-only scope and historical instructions to leave checkpoint E pending.

After Computer Use refused Chrome access, the owner explicitly instructed: "waive the native
PWA check and tell me how to do it instead. I'll make it myself". The manual check is waived
for this checkpoint; it has not passed and no native install result is claimed.

## Disposition

| Earlier item | Result | Evidence and decision |
| ------------ | ------ | --------------------- |
| SE-073 / G3 | Done / Passed | All nine CI jobs passed on `bbcf49e` in [run 39638870937](https://github.com/that-webdev-dude/ngne-sprite-editor/actions/runs/39638870937). Earlier acceptance and test/tree identity are in [REVIEW](../REVIEW.md#se-073-acceptance-evidence-2026-10-21). The follow-up source change below requires its own CI, distinct from this baseline result |
| SE-071 audit | Accepted | All eleven [audit checklist](a11y.md) items are Pass with named tests; the baseline CI includes the axe, layout, keyboard, focus and motion checks. This is a delegated review of that evidence, not a new manual screen-reader test |
| H11 / H12 | Met | All seven SPEC §6.6 benchmarks meet their budgets on Intel UHD and RTX 4060. [Dated method, results and thirteen raw records](../perf/checkpoint-e-2026-10-21.md). Measurements were sequential on `bbcf49e`, before F75's unrelated gesture guard; no merge was performed |
| H15 / H23 | Accepted exception; decision closed | Without `CI`, Intel passes 10/10 `@alone` E2E; RTX passes 9/10, with cel-opacity application at 3 frames against 2. Keep immediate page interaction when a popover closes; do not take the experimental delayed modal unlock. Accept the v1.0.0 performance exception, track [issue #2](https://github.com/that-webdev-dude/ngne-sprite-editor/issues/2), retain the unchanged assertion |
| H16 | Accepted | Information toasts with an action remain until dismissed, so Reload stays available. DESIGN §4's Toast row now states this exception to the normal 4 seconds |
| F75: concurrent sprite operation | Fixed | A history step changing canvas dimensions cancels a reference drag immediately. Release cannot overwrite the operation, including after undo/redo. Regression tests cover Canvas Size and Sprite Size during move and scale; the browser covers both operations during a held pointer |
| F75: fractional zoom | Accepted display trade-off | A whole-pixel move can change rounded display width by 1 pixel and cause a CPU resample after 100 ms. Keep the source PNG, document placement and export contract; no engine/dependency change |
| H8 | Acknowledged residual risk | Three additional 500-command seeded soaks passed, with no real stall, invariant failure or uncaught error. Heap excluding code grew 5.2%, 6.0%, 4.5% (10% limit). The two watchdog control tests each passed three times; their deliberate spin is a test control. Retain capture of the next real stall; do not claim an unreproduced cause fixed |
| H18 | Explicitly waived, not performed | Native Chrome access was unavailable to Computer Use; the owner will perform the [manual install/standalone/shortcut checklist](pwa.md#manual-install-owner-to-do) personally. Automated installability/offline evidence does not substitute for it |
| Preview command | Fixed | README advertised `npm run preview` but package.json lacked it. Add `"preview": "vite preview"`; production build and local preview startup succeeded. Runtime and development dependencies are unchanged |

## Retained local evidence

The hardware E2E runs use the installed Chrome 155.0.8059.85, Windows 11, one worker,
`CI` unset and an explicitly selected hardware adapter. The temporary configuration imports
the unchanged repository Playwright configuration and adds only adapter selection, an adapter
probe and isolated output paths. Copies are retained as text for reproducibility:
[configuration](checkpoint-e/reference-config.txt), [probe](checkpoint-e/reference-probe.txt).
The probes record the selected adapter, browser version, flags and absent `CI`:
[Intel UHD](checkpoint-e/reference-intel-uhd.json), [RTX 4060](checkpoint-e/reference-rtx-4060.json).

- [Intel hardware `@alone` log](checkpoint-e/alone-intel-uhd.txt): 10 passed.
- [RTX hardware `@alone` log](checkpoint-e/alone-rtx-4060.txt): 9 passed, 1 failed at the
  unchanged two-frame assertion. The applied pixels were found at frame 3; assertions after
  that failure, including undo, did not execute for that test.
- [Reference-drag browser regression log](checkpoint-e/reference-drag-e2e.txt): 5 passed
  after the F75 fix, on Intel UHD. The new case covers both size operations.
- [Soak/watchdog repeat log](checkpoint-e/soak-repeat.txt): 9 passed after the F75 fix,
  comprising 3 soaks and 6 watchdog controls, on Intel UHD.
- `tests/unit/se-046-move.test.ts`: new regression
  "a canvas or sprite resize cancels a reference drag without overwriting the operation
  (F75)" failed before the fix; the focused reference move/app/geometry run passed 25 tests
  afterward. Existing assertions were not weakened, skipped or removed.
- [Final `npm run check` log](checkpoint-e/final-check.txt): typecheck, lint, formatting,
  224 unit files / 4577 tests and the production/PWA build passed. The tracked Markdown
  link checker also passed for all 27 files. Full CI on the follow-up commit is required
  before merge; it is separate from these local checks and the baseline CI above.

## Release boundary

The delegated checkpoint judgment accepts the documented exception, waiver and residual
risk for review of v1.0.0. It does not assert that every non-CI performance check passed or
that a native installation was observed. The follow-up commit's CI must be green before
the owner merges. The owner retains merge, tag and deployment/site verification, and has
reserved the native PWA check for themselves. No merge, tag, GitHub release, deployment
or workflow dispatch was performed by this checkpoint work.
