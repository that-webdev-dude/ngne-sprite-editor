# M7 — Hardening and release

Goal: a releasable v1: regression coverage, accessibility, installability, documentation.
Exit: gate G3 ([README](README.md#gates)).

---

## SE-070 · End-to-end regression suite and performance record

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Done                                                     |
| Depends on   | SE-023, SE-025, SE-033, SE-044, SE-052, SE-053, SE-054   |
| Blocks       | SE-071, SE-072, SE-073                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §11, §6.6                                           |

Scope
- One scripted "golden path" E2E: new sprite → draw on two layers → add frames → tag → import a
  PNG as a sprite with the source kept as reference → select/transform → save → reload → open →
  export bundle → the SE-053 consumer fixture renders it.
- Viewport baselines at DPR 1 and 1.5 (readback for image content, screenshots for overlay
  alignment): checkerboard, grid, onion skin, reference behind and in front, selection ants
  (reduced motion).
- Cross-feature exclusions: reference layers, onion skins (and, if those tickets are Done,
  symmetry axes and tiled copies) are absent from the exported PNG and from the preview panel.
- Performance page `tests/perf/` scripting every SPEC §6.6 scenario; results written to
  `docs/perf/<date>.md` with hardware, browser version and method.
- Soak: 500 random registry commands (seeded) with invariants checked after each and no console
  errors; after closing all documents and forcing GC, JS heap is within 10% of the post-load
  baseline.

Acceptance
- The golden path passes 10 consecutive runs locally and in CI.
- Every budget in SPEC §6.6 is recorded on reference hardware; any miss has an issue filed and
  linked in the perf record.
- Soak run completes with zero invariant violations and zero uncaught errors.
- Readback baselines are compared exactly for opaque regions; screenshot baselines exactly at
  DPR 1.

---

## SE-071 · Accessibility and interface audit

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-064, SE-070                                           |
| Blocks       | SE-073                                                   |
| Blocked until | —                                                       |
| Spec         | DESIGN §1–§8                                             |

Scope
- Automated axe run on every dialog, popover, panel and menu in both themes.
- Keyboard walk-through: every command reachable; F6 region cycling; focus returns to its
  origin after dialogs close; Escape behaviour consistent.
- `prefers-reduced-motion`; layout at 1280×720 and at 125% browser zoom on 1920×1080.
- Side-by-side review of the running app against DESIGN.md and the mockup: tokens, spacing,
  type sizes, icon stroke, empty and error states; fix deviations or record deliberate ones in
  DESIGN.md.
- Remaining raw colours, ad-hoc spacing or unlabelled icon buttons removed.
- From the SE-064 review: one idiom for on/off settings (Preferences uses On/Off segments for
  the two `enabled` flags and Toggle buttons for Tint and Within tag), recorded in DESIGN §4;
  and a write to storage that fails (full or blocked) is reported once by a toast instead of
  being lost silently (preferences, theme, layout, recent commands).
- From the SE-011 and SE-012 reviews: the cursor field of the status bar is not rendered
  while it is blank, so the fields beside it move when the pointer crosses the edge of the
  document; and the toast of a renderer that could not recover shows the engine's text
  ("Reload to create a new renderer") although the viewport has already replaced it. Both
  are settled here.

Acceptance
- Zero axe violations of level A/AA outside the canvas elements.
- A written checklist (`docs/audit/a11y.md`) with each DESIGN §8 item marked pass, with evidence
  (test name or screenshot).
- Token lint from SE-006 passes with no exceptions added.
- Bounding-box E2E at 1280×720 and at 1536×864 (125% of 1920×1080): no clipped or overlapping
  controls in the shell and in every dialog.

---

## SE-072 · Installable PWA and offline use

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Done                                                     |
| Depends on   | SE-042, SE-070                                           |
| Blocks       | SE-073                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §3, §13 (shortcuts)                                 |

Scope
- Web app manifest (name, icons, standalone display, theme colours), maskable icon set.
- Service worker precaching the built assets; cache-first for the shell; update toast when a new
  version is waiting.
- File handling: register `.ngsprite` so the installed app opens the document (launch queue).
- Works at a nested base path (Vite `base`).

Acceptance
- In Chrome, `beforeinstallprompt` fires for the production build (E2E), and a manual install
  launches a standalone window (recorded once in `docs/audit/pwa.md`).
- The SE-070 golden path passes with the network disabled after first load.
- Launching with a `.ngsprite` file through the launch queue (E2E with a stubbed
  `launchQueue`) opens that document.
- A new deployment shows the update toast and activates after reload; an autosave snapshot
  created before the update is still offered for recovery.
- The golden path passes against a preview server with base `/sub/path/`.

---

## SE-073 · Documentation and release (gate G3)

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | In progress                                              |
| Depends on   | SE-070, SE-071, SE-072                                   |
| Blocks       | —                                                        |
| Blocked until | Gate G3: every other v1 ticket Done, or descoped by the owner in writing in REVIEW.md |
| Spec         | SPEC §9, §10                                             |

Scope
- `README.md`: what it is, requirements (WebGPU, Chrome/Edge), run, build, test, the canvas
  accessibility statement.
- `docs/GUIDE.md`: the authoring loop, import/quantize walkthrough, reference images, export,
  and "use the bundle in an NGNE game" with a complete scene example built on the generated
  module and the `ngne-preview` command.
- `docs/FORMAT.md` finalized: `.ngsprite` v1 and `ngne-sprite-atlas` v1, declared frozen.
- Engine gap notes from SPEC §6.8 updated with what was actually hit, as a short report for
  the engine owner.
- Production build, static deploy workflow per A8, version 1.0.0, changelog.

Acceptance
- A CI job on a clean runner executes the README's commands verbatim (install, build, test) and
  they succeed.
- The GUIDE's scene example is the SE-053 consumer fixture source, included from the file (a
  test fails if the GUIDE's code block and the fixture differ).
- All internal doc links resolve (link check in CI).
- `npm run check` and the full E2E suite pass on the release commit.
- The release tag and the deployment are created only after the owner approves in writing.
