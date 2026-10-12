# Review record

Covers [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), [design/mockup.html](design/mockup.html) and
[tickets/](tickets/README.md).

## Status

| Item                         | State                                             |
| ---------------------------- | ------------------------------------------------- |
| Round 1 — technical review   | READY WITH CHANGES (23 findings, 0 blockers)      |
| Round 1 — plan review        | READY WITH CHANGES (36 findings, 1 blocker)       |
| Revision after round 1       | Applied 2026-10-11 (tables below)                 |
| Round 2 — technical review   | READY WITH CHANGES: 22 of 23 round 1 findings resolved, T7 partial; 1 new Major (N1), 10 Minor/Nit |
| Round 2 — plan review        | READY WITH CHANGES: 35 of 36 resolved, P21 partial; 2 new Major (Q1, Q2), 9 Minor/Nit |
| Revision after round 2       | Applied 2026-10-11 (tables below)                 |
| Round 3 — plan review (confirmation) | **READY**: Q1 and Q2 resolved, dependency audit (a)–(g) passed; 5 Minor/Nit, since applied |
| Marked ready                 | **Yes, 2026-10-11 — owner acknowledgements A1–A9 recorded 2026-10-11** |

What "Ready" means here: every document and ticket is specified and has passed independent
review with no open Blocker or Major finding. It does not waive start conditions: no ticket can
start until the owner acknowledgements below are recorded (SE-001 needs A1, A4, A5, A6, A8 and
every other ticket depends on SE-001). A different owner decision on A1 or A2 returns the
affected tickets to Draft.

Limits of the review, stated plainly:

- The technical reviewer's last verdict was READY WITH CHANGES with one Major item, N1. N1 is
  the same defect as the plan reviewer's Q1; it was fixed with the option the technical
  reviewer preferred and called sufficient without further technical review, and the plan
  reviewer confirmed the fix in round 3. The technical reviewer did not re-read the final text.
- Minor and Nit items from round 2 (technical: T7 residual, N2–N11) and round 3 (R1–R5) were
  applied after the reviewers' final verdicts and have not been re-reviewed.
- No reviewer ran code. Engine claims were verified by reading `@ngne/core` 0.2.1 source; the
  runtime unknowns (upload latency, pixel exactness, device loss, two devices) are deliberately
  left to the SE-002 spike and gate G0.

## Method

- Two independent reviewers, each a separate agent with a fresh context that had not seen the
  authoring session. Both were read-only.
- **Technical reviewer**: verified every NGNE claim in SPEC §6 and §9 against the `@ngne/core`
  0.2.1 source checkout and contracts, the architecture, the SE-002 spike and engine-related
  acceptance criteria. Cited file and line evidence.
- **Plan reviewer**: requirement coverage, dependency integrity (parsed all tickets with a
  script), gates and assumptions, ticket quality, spec consistency, design and mockup (computed
  contrast ratios and layout heights).
- After revision the same reviewers re-check their findings and re-audit the changed documents.
- Dependency integrity is also checked mechanically by the author: Blocks is the exact inverse
  of Depends on, the graph is acyclic, and the suggested order respects every dependency.

## Round 1 — technical findings

| ID  | Sev   | Finding (short)                                                        | Resolution |
| --- | ----- | ---------------------------------------------------------------------- | ---------- |
| T1  | Major | Odd-sized sprites misalign under NGNE's centre snapping (preview, helper, `ngne-preview`) | Export rects are always even (SPEC §9.2, SE-050); preview scene disables snapping (§6.5, SE-054); helper rounds for integer edges (§9.2); SE-002 Q9/Q10 added; SE-053 fixtures include odd sizes; engine gap recorded (§6.8) |
| T2  | Major | Atlas format frozen before NGNE conformance                            | Freeze moved to release gate G3; SE-052 now depends on SE-053 (gate G2) |
| T3  | Major | Generated preview config: `src` must be a `file:` URL; array shapes unspecified | SPEC §9.5 shows the exact config; SE-051 validates with NGNE's own `loadAdapter` |
| T4  | Major | "Starts without diagnostic" does not prove `ngne-preview` acceptance   | SPEC §9.7(2) and SE-053 open the page and assert `Ready`, per frame; spawn via `node …/cli.js` |
| T5  | Major | Frame-switch budget contradicted the upload path; playback would drop frames | Frame slot cache `ed:f:0..7` and playback atlas `ed:play` (SPEC §6.4); budgets redefined (§6.6); SE-002 Q1 measures buffer→submitted and sustained rate |
| T6  | Major | Wrong/missing `BrowserGame` details (renderer access, gating, lifecycle, input listeners) | SPEC §6.2 #14 and §6.5 rewritten; SE-054 scope and acceptance updated |
| T7  | Minor | Device-loss test method; `recovering` loses the dirty frame            | SE-002 Q8 uses `requestDevice` wrap; SPEC §6.4 keeps dirty flag and polls status |
| T8  | Minor | Shared canvas context race between renderer instances                  | One canvas per renderer, serialized lifecycle, queue scoped to instance (SPEC §6.2 #12, §6.4) |
| T9  | Minor | Fixed oversized canvas not evaluated                                   | SE-002 Q4 evaluates both and records the choice in SPEC §6.4 |
| T10 | Minor | Slot memory unaccounted                                                | Bitmap closed on settle, 1×1 placeholders, 16 MP reference budget, `inspect()` acceptance (SPEC §6.4, §7.6; SE-011, SE-045; SE-002 Q11) |
| T11 | Minor | Helper maths for rotation/scale/flip, identifiers, raw source, TS flags | General formula in SPEC §9.2; identifier rule, `?raw` runtime file and flags in §9.5; SE-051/SE-053 tests |
| T12 | Minor | SE-054 used SE-011's queue without depending on it; FORMAT.md ownership | Dependency added; either ticket creates FORMAT.md |
| T13 | Minor | Preview canvas scaling at fractional DPR                               | CSS size `k × size / DPR` (SPEC §6.5, SE-054 acceptance) |
| T14 | Minor | Screenshots are not the most reliable readback                         | In-page readback for content, screenshots for overlay alignment (SPEC §6.7, SE-001) |
| T15 | Minor | Preview cost and oversize behaviour undefined                          | Worker repack, selected-animation fallback, message (SPEC §6.5); frame limits stated (§9.4) |
| T16 | Minor | Undo budget edge cases, allocation failure, transaction snapshot       | SPEC §5.2 and SE-004 |
| T17 | Minor | Zip determinism needs fixed mtime; do not deflate PNGs                 | SPEC §10, SE-040 |
| T18 | Minor | Reference pipeline details (cap, premultiplied resize, ICC, test)      | SPEC §7.6, SE-045 acceptance uses a defined gradient and kernel |
| T19 | Minor | Onion tint by multiply cannot tint dark pixels                         | CPU tint variants in the frame cache (SPEC §6.4, §7.5; SE-025 acceptance) |
| T20 | Nit   | Fractional zoom steps are not pixel-exact                              | Qualified in SPEC §6.4 |
| T21 | Nit   | No completion signal for `once`; `screen` not passed through           | `durationMs`, `AnimationDone`, `screen` option (SPEC §9.2, §9.5) |
| T22 | Nit   | Autosave re-serializes everything                                      | Raw buffers per image, dirty images only (SPEC §10, SE-042) |
| T23 | Nit   | Retry rule pointless under `failed`                                    | Retry only on a fresh renderer (SPEC §6.4) |

## Round 1 — plan findings

| ID  | Sev     | Finding (short)                                              | Resolution |
| --- | ------- | ------------------------------------------------------------ | ---------- |
| P1  | Blocker | Missing hard dependencies                                    | Edges added: 007→004, 011→007, 014→013, 030→014, 040→010, 054→007/011, 062→017, 063→043, 066→030; SE-045 split (canvas handles → SE-046, depends on SE-032) |
| P2  | Major   | Release did not require all v1 tickets                       | Release gate G3; SE-070 depends on 023 and 025; M6 header corrected |
| P3  | Major   | Painting on an empty cel unowned in M1                       | Lazy cel creation moved into the SE-004 transaction |
| P4  | Major   | Commands needed UI state that `core` cannot import           | `DocSession` in core (SPEC §5.2); floating-selection rules stated |
| P5  | Major   | Parity matrix incomplete                                     | Rows added with tiers (SPEC §2.3); A1 is an explicit owner acknowledgement |
| P6  | Major   | Aseprite JSON vs new bundle not offered as a choice          | Aseprite-format JSON is an optional bundle file in M5 (SPEC §9.1, SE-051); recorded in A2 |
| P7  | Major   | G0 had no numeric thresholds; fallback unowned               | Per-question thresholds in SE-002; SE-015 owns the fallback |
| P8  | Major   | Format freeze vs later per-document state; undefined types   | `DocSettings`, `ExportSettings`, `BlendMode`, `Cel.opacity` defined (SPEC §5.1); freeze at G3 |
| P9  | Major   | History → cache → viewport wiring unowned                    | In SE-011 scope with an undo acceptance item |
| P10 | Major   | No document creation before M4                               | New ticket SE-008 (M0); matrix corrected |
| P11 | Major   | Layout did not fit the minimum window                        | Minimum 1280×720 with explicit overflow rules (DESIGN §2); SE-006 acceptance at that size |
| P12 | Major   | Token contrast failures                                      | Light accent and warn darkened, `--border-input` added, `--text-faint` restricted (DESIGN §3.1); mockup updated |
| P13 | Major   | A7 override point wrong; "not overridden" uncheckable        | A7 before SE-003, A2 before SE-050; criterion is an acknowledgement recorded here |
| P14 | Major   | Pivot, rename, grid had no UI owner                          | Sprite properties dialog in SE-008; pivot also in the export dialog (SE-052) |
| P15 | Major   | No keymap with contexts; collisions                          | Keymap and contexts in SPEC §7.8; SE-007 verifies interceptability |
| P16 | Major   | Git and CI arrived last; hosting and licence unflagged       | Moved to SE-001; assumption A8 added |
| P17 | Major   | "Keep source as reference" wrong for sliced sheets           | Restricted to single-sprite imports (SPEC §8, SE-044 acceptance) |
| P18 | Major   | Reference alignment after flip/rotate impossible with the model | Promise limited to canvas size, crop, trim, sprite size (SPEC §7.6, SE-034 acceptance) |
| P19 | Minor   | Preset palettes needed by import shipped in M6               | Preset data moved to SE-043 |
| P20 | Minor   | Undersized tickets                                           | 014, 015, 021 → L; 023 → M; 022, 041, 060 split (SE-026, SE-047, SE-066) |
| P21 | Minor   | Acceptance items outside dependency closure                  | Restated at compositor level, moved to SE-070, or gated by G1 |
| P22 | Minor   | Preferences had no store for consumers                       | Preference store in SE-007; SE-064 is the dialog only |
| P23 | Minor   | Zoom tool unowned; wheel and key rules unclear               | SE-014 owns Hand and Zoom tools; rules in SPEC §7.8, SE-012 |
| P24 | Minor   | Identifier derivation from slugs                             | SPEC §9.1, §9.5; SE-051 golden cases |
| P25 | Minor   | Conflicting limits                                           | Reconciled in SPEC §5.1, §5.2, §7.6, §8, §9.4 |
| P26 | Minor   | Active tag with overlaps; repeat in editor playback; ping-pong wording | SPEC §7.4, §7.5 |
| P27 | Minor   | Dialog width; undesigned surfaces; context-menu conflict     | DESIGN §4, §7 |
| P28 | Minor   | Hit-target and zoom claims                                   | DESIGN §8 exceptions; 125% check replaces 200% |
| P29 | Minor   | DESIGN/mockup mismatches                                     | DESIGN governs (stated); cells 24×28; mockup tokens, reference opacity and muted text fixed |
| P30 | Minor   | Dependency rule ignored dev tooling                          | SPEC §4 separates runtime dependencies from tooling |
| P31 | Minor   | Vague or untestable criteria                                 | Reworded in SE-013, 022, 034, 042, 052, 060, 072, 073 |
| P32 | Minor   | Scope without acceptance                                     | Items added in SE-044, SE-045, SE-046, SE-052 |
| P33 | Minor   | Error channels and toast ownership                           | DESIGN §4 rule; toast service and error boundary in SE-006 |
| P34 | Minor   | Single-file import; lossy defaults                           | Multi-file import (one cell per file) and smart defaults (SPEC §8, SE-043, SE-044) |
| P35 | Minor   | Loose track and critical-path text                           | Rewritten from the computed graph (tickets/README) |
| P36 | Nit     | Small inconsistencies                                        | This file exists; redundant gate removed; atlas example fixed; SE-063 no longer cites an external path |

## Round 2 — technical findings

Round 1 status: T1–T6 and T8–T23 resolved; T7 partially resolved.

| ID  | Sev   | Finding (short)                                                        | Resolution |
| --- | ----- | ---------------------------------------------------------------------- | ---------- |
| N1  | Major | `ed:play` used the exporter's packer, outside SE-024's dependencies    | Local grid blit, no packer (SPEC §6.4, SE-024) |
| T7  | Minor | Idle, focused device loss was never noticed                            | 1 s status timer while visible (SPEC §6.4, SE-011 acceptance) |
| N2  | Minor | Dispose-before-create would blank the viewport on resize               | Create–upload–draw–swap–dispose order (SPEC §6.4, SE-002 Q4, SE-011) |
| N3  | Minor | Slot re-keying could pair new metadata with an old texture             | Key/metadata change only when the upload resolves (SPEC §6.4; SE-011, SE-054 acceptance) |
| N4  | Minor | Even padding lets a rect exceed the source frame; Aseprite JSON semantics | Stated with the content-size rule (SPEC §9.2, §9.5; SE-050, SE-051) |
| N5  | Minor | Preview anchor rule for odd documents unspecified                      | Top-left placement in the runtime, used by the preview (SPEC §6.5, §9.2) |
| N6  | Minor | SE-053 spawn path, wait condition and foreground requirement           | Absolute paths, wait on `#details`, foreground page (SPEC §9.7, SE-053) |
| N7  | Minor | CI flags and packages for WebGPU on GitHub Actions                     | Ubuntu runner with NGNE's flags and packages (SE-001) |
| N8  | Nit   | Runtime file in `core/` vs engine import; `?raw` typing                | Structural sprite-sink type; `*?raw` declaration (SPEC §9.5, SE-051, SE-001) |
| N9  | Nit   | Worker data transfer for preview repack                                | Frame composites only; `atlasFor()` without writers (SPEC §6.5, SE-051, SE-054) |
| N10 | Nit   | Semi-transparent reference untested                                    | Acceptance item added (SE-045) |
| N11 | Nit   | "Reduces to demo/sprites.ts" only for even untrimmed frames            | Reworded; rounding rules stated (SPEC §9.2) |

## Round 2 — plan findings

Round 1 status: P1–P20 and P22–P36 resolved; P21 partially resolved (fixed as Q4).
Dependency audit (a)–(f) passed; (g) found Q1 and Q4.

| ID  | Sev   | Finding (short)                                              | Resolution |
| --- | ----- | ------------------------------------------------------------ | ---------- |
| Q1  | Major | SE-024 needed SE-050's packer                                | Same fix as N1 |
| Q2  | Major | `canvas` context applied only with viewport focus; `text` blocked Ctrl+S | Context definitions and focus rules rewritten (SPEC §7.8); SE-012, SE-013, SE-014 updated |
| Q3  | Minor | Ctrl+V had two meanings                                      | Import chooser only when no document is open (SPEC §8, SE-044) |
| Q4  | Minor | Acceptance outside closure in SE-064, SE-072, SE-023         | SE-072 depends on SE-042; SE-064 store-level; tag context menu moved to SE-026 |
| Q5  | Minor | View toggles would enter the undo stack                      | `DocSettings`/`ExportSettings` use setters, no history entry (SPEC §5.2) |
| Q6  | Minor | No keys for the SE-065 tools                                 | Keymap rows added (SPEC §7.8) |
| Q7  | Minor | Aseprite JSON fields and padding mapping                     | SPEC §9.5, SE-051 acceptance |
| Q8  | Minor | Three surfaces without an owner                              | Confirm rule changed; Cel properties popover (SE-061); tag menu (SE-026) |
| Q9  | Minor | `exportSettings.frames` could dangle                         | Invariant and reset rule (SPEC §5.1, SE-021) |
| Q10 | Minor | Sizes                                                        | SE-046 → M, SE-041 → L |
| Q11 | Nit   | Small leftovers                                              | Default palette, default grid consumer, wording fixes |

## Round 3 — plan confirmation

Verdict READY. Q1 and Q2 resolved; dependency audit (a)–(g) passed on 52 tickets and 119
edges. Non-blocking items, applied afterwards (not re-reviewed):

| ID | Sev   | Finding (short)                                       | Resolution |
| -- | ----- | ----------------------------------------------------- | ---------- |
| R1 | Minor | Dirty tracking vs setters; flag ownership             | Dirty rule in SPEC §5.2; flag in SE-007; SE-041 sets the saved position |
| R2 | Minor | Tag context menu needs SE-023                         | Edge SE-026 → SE-023 (120 edges; mechanical audit re-run, no problems) |
| R3 | Minor | Timeline clicks and tool keys                         | `canvas` is the fallback inside the timeline (SPEC §7.8) |
| R4 | Minor | View toggles marked the document dirty                | `DocSettings` changes do not set dirty (SPEC §5.2) |
| R5 | Nit   | Browser defaults for bound chords in text fields      | Suppressed; typeahead listed (SPEC §7.8) |

## Owner acknowledgements

Start conditions from SPEC §12. A ticket listing one of these under "Blocked until" may start
only when the row below is filled in.

| ID | Assumption (short)                                                    | Needed before | Owner decision | Date |
| -- | --------------------------------------------------------------------- | ------------- | -------------- | ---- |
| A1 | v1 scope = M0–M7 tiers of SPEC §2.3; "Later" rows out; ~145–215 developer-days | SE-001 | Acknowledged | 2026-10-11 |
| A2 | NGNE-ready = bundle of SPEC §9 (+ optional Aseprite-format JSON)      | SE-050        | Acknowledged | 2026-10-11 |
| A3 | Quantize = cells → resample to W×H → reduce colours (SPEC §8)         | SE-043        | Acknowledged | 2026-10-11 |
| A4 | Use published `@ngne/core` 0.2.1; no engine changes                   | SE-001        | Acknowledged | 2026-10-11 |
| A5 | Runtime dependencies of SPEC §4                                       | SE-001        | Acknowledged | 2026-10-11 |
| A6 | Desktop Chrome/Edge, WebGPU only, minimum window 1280×720             | SE-001        | Acknowledged | 2026-10-11 |
| A7 | Reference images behind or in front of all pixel layers only          | SE-003        | Acknowledged | 2026-10-11 |
| A8 | GitHub repository, GitHub Actions, GitHub Pages, MIT licence          | SE-001        | Acknowledged | 2026-10-11 |
| A9 | Reference hardware (Intel UHD gen-12, RTX 4060) available             | SE-002        | Acknowledged | 2026-10-11 |

## SE-002 amendments (gate G0)

Results and raw data: [spikes/SE-002-ngne-integration.md](spikes/SE-002-ngne-integration.md).
Measured 2026-10-11 on Intel UHD and RTX 4060; questions 1–7 and 9–11 met their thresholds.

| Question | Result | SPEC change | Owner decision | Date |
| -------- | ------ | ----------- | -------------- | ---- |
| 4 Sizing strategy | (a) and (b) both go on both GPUs | §6.4 Lifecycle: (a) renderer replacement is the sizing strategy; the fixed oversized canvas is not adopted | (a) adopted | 2026-10-12 |
| 8 Device loss | No-go on both GPUs: status polling on a 1 s timer redrew an idle viewport after 0/5 (Intel UHD) and 1/5 (RTX 4060) losses | §6.4 rendering bullet and §6.8 "No recovery event": a read also treats `renderer.sprites === 0` after a draw that submitted sprites as a loss. Measured: 5/5 losses redrawn, slowest 945 ms (Intel UHD) and 1047 ms (RTX 4060) against 2 s. Relies on an NGNE 0.2.1 implementation detail | Fallback adopted | 2026-10-12 |

| 2 Single-flight queue | Go in the recorded run (largest gap 99.4 ms against 100 ms). Five reruns on Intel UHD: 55.4, 58.2, 56.0, 109.5 and 58.7 ms, so one run in six is over the limit. The pauses come about once a second and lengthen through the stream (garbage collection in the spike page); the queue published about 400 times a second in every run with no stale render | §6.6: the pauses are recorded, and SE-015's stroke measurement covers a continuous stroke of at least 5 s and reports the longest gap; the stroke echo is the fallback. SE-015 acceptance amended to match | Kept as go; delegated to the orchestrator by the owner | 2026-10-12 |

Gate G0: Passed 2026-10-12 (every question go, or amended as above).

## Checkpoint B decisions (run 1, M0)

The owner delegated these to the orchestrator on 2026-10-12 after the M0 tickets of run 1.
Each row is a finding of a wave review or of an implementing agent's report.

| # | Finding | Decision | Applied in |
| - | ------- | -------- | ---------- |
| B1 | `eslint .` on `main` linted the agent worktrees under `.claude/` | `.claude` is ignored by ESLint | `eslint.config.js` |
| B2 | SE-006's shell test asserted an exact button count, which every ticket adding a shell control had to edit | The count is now "more than 20"; the assertion that matters (no target under 24×24 px) is unchanged | `tests/e2e/se-006-gallery.spec.ts` |
| B3 | Placeholder assertions of earlier tickets block the ticket that fills the placeholder (three cases in run 1: smoke test, menu bar, viewport) | Standing exception to "never weaken a test", limited to the placeholder assertion and listed in the report | `AGENTS.md`, "Working on a ticket" |
| B4 | `decodePng` is the project's own asynchronous decoder (`fast-png` 8.0.0 failed two SE-005 acceptance items); the SPEC still named `fast-png` | Accepted. Dependants await it | SPEC §4, §8 |
| B5 | The decoder had no size cap: rejecting a malformed 16384×8192 file took 1.04 s against SE-005's 1 s item | The decoder refuses more than 8192 px per side (the §8 source limit) before allocating, with `PngError` code `size` | `src/core/png`, `tests/unit/se-005-png.test.ts`, SPEC §8 |
| B6 | `PixelBuffer` was declared twice, in `core/model` and `core/pixels` | Declared once in `core/model` (SPEC §5.1); `core/pixels` re-exports it | `src/core/pixels/buffer.ts` |
| B7 | SPEC §5.1 "invariants asserted after every command in development builds" had no owning ticket | The sessions store asserts them after every do, undo and redo when `import.meta.env.DEV` is set; a violation throws where the command ran | `src/app/state/sessions.ts`, `tests/unit/se-007-invariants.test.ts` |
| B8 | `touched.structure` had no definition | Defined: true when the list of layers, frames or tags changes or the document's size changes; pixel and cel changes report it false | SPEC §5.2 |
| B9 | `src/app/preferences` imported the storage helper from `src/ui`, against the direction of SPEC §5 | The helper moved to `src/app/platform/storage.ts`; `ui` imports it from `app` | `src/app/platform`, six import lines |
| B10 | SE-064 expected the theme in the SE-007 preference store; it lives in SE-006's theme store | The theme store stays the single owner; SE-064 edits the theme through it | SE-064 scope |
| B11 | SE-008's dialog host is mounted inside the menu-bar region: if that region fails, New sprite and Sprite properties do nothing | Moved to the app root with its own boundary by the next dialog ticket | SE-034 scope and acceptance |
| B12 | SE-008's pivot fields round to hundredths | Four decimals on entry; arrow keys keep the 0.01 step | SE-034 scope and acceptance |
| B13 | SE-007's chord E2E cannot see a chord Chrome keeps for itself (Playwright injects keys below the browser's accelerators) | Hand check by the owner at checkpoint D, "Alt (hold)" and F6 first | EXECUTION.md, checkpoint D |
| B14 | SE-002 question 4: "never blank" was sampled by screenshots about every 40 ms | Accepted as a limit of the method; the replacement order of SPEC §6.4 is what prevents a blank | SE-002 deliverable, Outcome |
| B15 | SE-006's two gallery axe tests ran about 26–30 s against the 30 s default (owner decision of 2026-10-12: 120 s for those two tests); a cold dev server took over 5 s to serve the gallery once; `se-001-lint-boundaries` timed out twice on a cold ESLint start | Playwright: test timeout 30 s locally and 120 s in CI, assertion timeout 10 s locally and 20 s in CI. The lint boundary tests get 60 s. No assertion changed | `playwright.config.ts`, `tests/unit/se-001-lint-boundaries.test.ts` |

Not decided here, left as they are:

- Ctrl+Alt+N cannot open New sprite on a keyboard layout where AltGr+N types a character
  (SE-007 keymap rule: characters typed with AltGr are never chords). File → New Sprite and
  the empty state remain.
- A stored preference record of a newer version than the code knows reads as defaults and is
  overwritten by the next change.
- The number field shows a size message when the value is applied (Enter, blur, arrows), not
  on each keystroke; no invalid size can be created.

## Descoped tickets

None.
