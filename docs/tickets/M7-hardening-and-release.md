# M7 — Hardening and release

Goal: a releasable v1: regression coverage, accessibility, installability, documentation.

---

## SE-070 · End-to-end regression suite and performance record

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | L                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-033, SE-044, SE-052, SE-053, SE-054                   |
| Blocks       | SE-071, SE-073                                           |
| Blocked until | Gate G4 passed                                          |
| Spec         | SPEC §11, §6.6                                           |

Scope
- One scripted "golden path" E2E: new sprite → draw on two layers → add frames → tag → import a
  PNG sheet as frames with a reference kept → select/transform → save → reload → open → export
  bundle → conformance fixture renders it.
- Viewport screenshot baselines at DPR 1 and 1.5 for: checkerboard, grid, onion skin, reference
  behind and in front, selection ants (reduced motion), tiled mode if SE-062 landed.
- Performance page `tests/perf/` scripting the SPEC §6.6 scenarios; results written to
  `docs/perf/<date>.md` with hardware, browser version and method.
- Soak: 500 random commands (property-based, seeded) through the UI layer with invariants
  checked and no console errors; memory after closing all documents returns to within 10% of
  baseline.
- CI wiring: unit + E2E under SwiftShader on every push.

Acceptance
- The golden path passes 10 consecutive runs locally and in CI.
- Every budget in SPEC §6.6 is recorded on reference hardware; any miss has an issue filed and
  linked in the perf record.
- Soak run completes with zero invariant violations and zero uncaught errors.
- Screenshot baselines are committed and compared with zero tolerance for opaque regions.

---

## SE-071 · Accessibility and interface audit

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-064, SE-070                                           |
| Blocks       | SE-073                                                   |
| Blocked until | —                                                       |
| Spec         | DESIGN §1–§8                                             |

Scope
- Automated axe run on every dialog, panel and menu in both themes.
- Keyboard walk-through: every command reachable; focus order logical; focus never lost after
  dialogs close; Escape behaviour consistent.
- `prefers-reduced-motion` and 200% browser zoom checks.
- Side-by-side review of the running app against DESIGN.md and the mockup: tokens, spacing,
  type sizes, icon stroke, empty and error states; fix deviations or record deliberate ones in
  DESIGN.md.
- Remaining raw colours, ad-hoc spacing or unlabelled icon buttons removed.

Acceptance
- Zero axe violations of level A/AA outside the canvas element.
- A written checklist (`docs/audit/a11y.md`) with each DESIGN §8 item marked pass, with evidence.
- Token lint from SE-006 still passes with no exceptions added.
- Light and dark themes both pass the contrast check.

---

## SE-072 · Installable PWA and offline use

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-041                                                   |
| Blocks       | SE-073                                                   |
| Blocked until | —                                                       |
| Spec         | SPEC §3, §13 (shortcuts)                                 |

Scope
- Web app manifest (name, icons, standalone display, theme colours), maskable icon set.
- Service worker precaching the built assets; cache-first for the shell; update prompt toast
  when a new version is waiting.
- File handling: register `.ngsprite` so installed-app double-click opens the document
  (launch queue).
- Works at a nested base path (Vite `base`), since static hosts often serve from a subfolder.

Acceptance
- Lighthouse installability checks pass; the app installs from Chrome and launches standalone.
- With the network disabled after first load, the app starts and can create, draw, save and
  export.
- Opening a `.ngsprite` from the OS in the installed app loads that document.
- A new deployment shows the update toast and activates after reload without losing autosave
  snapshots.
- Build served from `/sub/path/` works (E2E against a preview server with that base).

---

## SE-073 · Documentation and release

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| Size         | M                                                        |
| Status       | Draft                                                    |
| Depends on   | SE-053, SE-070, SE-071, SE-072                           |
| Blocks       | —                                                        |
| Blocked until | Gate G4 passed                                          |
| Spec         | SPEC §9, §10                                             |

Scope
- `README.md`: what it is, requirements (WebGPU, Chrome/Edge), run, build, test.
- `docs/GUIDE.md`: the authoring loop, import/quantize walkthrough, reference images, export,
  and "use the bundle in an NGNE game" with a complete scene example built on the generated
  module and the `ngne-preview` command.
- `docs/FORMAT.md` finalized: `.ngsprite` v1 and `ngne-sprite-atlas` v1.
- Engine gap notes from SPEC §6.7 updated with what was actually hit, as a short report for
  the engine owner.
- Production build, static deploy configuration (GitHub Pages or equivalent), version 1.0.0,
  changelog.
- Git repository initialized if the owner has not already done so (ask first).

Acceptance
- A reader following README + GUIDE on a clean machine gets from clone to an exported bundle
  drawn in the conformance fixture game without other help.
- The GUIDE's scene example is compiled and run by a test (it is the SE-053 fixture or imports
  from it).
- All internal doc links resolve (link check).
- `npm run check` and the full E2E suite pass on the release commit; the tag is created only
  after the owner approves.
