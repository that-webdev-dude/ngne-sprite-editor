# Provenance

Where third-party code in this repository comes from, which version, how each file that names
or derives from it is classified, and the audits of that classification. The licence texts and
copyright lines are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), which the build
ships; this file is not shipped.

Classes used below: **permissive** (may be ported with its notice), **restricted** (EULA:
behaviour only, from public docs and use of the program), **derived and noticed**,
**behaviour-dictated**, **independent**, **pending** (not yet classified by an audit).

## Upstreams

| Upstream | URL | Version | Licence | Class |
| --- | --- | --- | --- | --- |
| Aseprite Document Library (`src/doc`) | <https://github.com/aseprite/aseprite> | v1.3.18.6, commit `331e898ef405d919539c03fd1675691cfa16c3a3` | MIT (`src/doc/LICENSE.txt`) | Permissive |
| Aseprite application code (the parts its EULA covers, such as `src/app`) | <https://github.com/aseprite/aseprite> | — | Aseprite EULA | Restricted |
| pixman | <https://gitlab.freedesktop.org/pixman/pixman> | 0.46.4 | MIT (`COPYING`) | Permissive |
| Allegro 4 (`src/spline.c`) | <https://github.com/liballeg/allegro5>, branch `4.4` | Licence text of 4.4.3.1, commit `8a386b2754608b66d46f10abf993abf8ab16902d` | Giftware (`docs/src/license._tx`) | Permissive |
| Bresenham curve rasterizing algorithms (Alois Zingl) | <https://github.com/zingl/Bresenham> | commit `ce9002f5aa1d95bdb7d71a39ebdb0987df139db5` | MIT (`LICENSE`) | Permissive |

## How each version was established

Recorded 2026-11-13 from the upstreams' public histories; the ports themselves were made in
October 2026 without recording a version.

- **Aseprite Document Library.** The files used, `src/doc/blend_funcs.cpp`, `src/doc/algo.cpp`
  and `src/doc/LICENSE.txt`, have the same Git blobs (`74b0072`, `03ba12b`, `db7154f`) on
  `main` from 28 April 2026 on and in every release from v1.3.18 to v1.3.18.6, so a reading of
  `main` in October 2026 and v1.3.18.6 give the same text. `blend_funcs.cpp` last changed on
  27 August 2025 (commit `0995e72`, `set_sat`); the transcription in
  `tests/unit/fixtures/se-061-blend-golden.generate.mjs` matches the version after it.
- **pixman.** `pixman/pixman-combine32.h` (blob `59bb247`) and `COPYING` (blob `6168dea`) are
  the same in every release from 0.40.0 to 0.46.4, and in the pixman Aseprite v1.3.18.6 builds
  with (`third_party/pixman`, commit `285b9a907caffeb979322e629d4e57aa42061b5a` of
  <https://github.com/aseprite/pixman>). Which of these copies was read is not recorded; the
  macros used (`MUL_UN8`, `DIV_UN8`) are the same in all of them.
- **Allegro.** Not ported directly: Aseprite's `algo_spline` (Document Library, `algo.cpp`) is
  adapted from Allegro's `calc_spline`, with the comment "Algorightm from Allegro
  (allegro/src/spline.c)", and records no Allegro version. `src/spline.c` refers to Allegro's
  readme for its licence; the text is `docs/src/license._tx`, the same blob (`19bac23`) in
  4.4.3.1 and on branch `4.4`. The licence names no copyright holders; `spline.c` credits
  Seymour Shlien, optimised by Sven Sandberg.
- **Zingl.** Commit `ce9002f` (21 May 2020) is the only revision of `bresenham.c` in that
  repository.

## Files

| File | Upstream | Class |
| --- | --- | --- |
| `src/core/composite/blend.ts` | Aseprite Document Library (`blend_funcs.cpp`), pixman | Derived and noticed |
| `tests/unit/fixtures/se-061-blend-golden.generate.mjs` | Aseprite Document Library (`blend_funcs.cpp`), pixman | Derived and noticed |
| `tests/e2e/se-061-support.ts` | Aseprite Document Library (`blend_funcs.cpp`), pixman | Derived and noticed |
| `tests/unit/se-065-raster.test.ts` | Aseprite Document Library (`algo.cpp`), Allegro | Derived and noticed |
| `src/core/raster/line.ts` | Zingl (`plotLine`) | Derived and noticed |
| `src/core/raster/ellipse.ts` | Zingl (`plotEllipseRect`) | Derived and noticed |
| `src/core/raster/brush.ts` | Zingl (`plotEllipseRect`) | Derived and noticed |
| `src/core/selection/shapes.ts` | Zingl (`plotEllipseRect`) | Derived and noticed |
| `src/core/raster/curve.ts` | Aseprite Document Library (`algo.cpp`): behaviour confirmed against it | Pending |
| `src/core/raster/flood.ts` | Heckbert, "A Seed Fill Algorithm" (1990); the tolerance rule confirmed against the Document Library (`algorithm/floodfill.cpp`) | Pending |
| `docs/SPEC.md` (§7.1: the magic wand's area; §7.2: Delete and Cut on a float, Flip and Rotate with a selection) | Aseprite application code: behaviour confirmed by reading its source | Pending |
| `src/app/selection/transform/transform.commands.ts` (Flip and Rotate with a selection) | Aseprite application code: behaviour confirmed by reading its source | Pending |
| `src/core/floating/floating.ts`, `tests/unit/se-032-floating.test.ts` (Delete and Cut on a float) | Aseprite application code: behaviour confirmed by reading its source | Pending |
| The magic wand's selection modes (`src/app/selection/tools/`) | Aseprite application code: behaviour confirmed by reading its source | Pending |

Every other file that names Aseprite does so to identify a file format, a palette or a
behaviour observed in the program.

## Bundled dependencies

- `gifenc` credits its colour quantizer as based on a port of PnnQuant.js. The GIF export does
  not use it: `vite.config.ts` resolves `gifenc` to its ES module build so the bundle keeps only
  the encoder, and the build fails if the quantizer comes back
  (`tests/unit/licences-excluded.test.ts`).

## Clean-room records

None recorded.

## Audits

| Date | Revision | Scope | Result |
| --- | --- | --- | --- |
| — | — | No full audit recorded yet. | — |

## Owner decisions

| Date | Decision |
| --- | --- |
| 2026-11-13 | Code the export writes into users' projects (`<name>.sprites.ts`, `<name>.preview.config.mjs`) is licensed 0BSD, its full text in the head of each file (`src/core/export/generatedLicence.ts`). The editor stays MIT. |
| 2026-11-13 | Names from Aseprite's application source (classes, functions, members, file references) are removed from specs, comments and tests and replaced by behaviour-only wording, using the names Aseprite shows in its UI. Done in `docs/SPEC.md`, `transform.commands.ts`, `floating.ts`, `se-032-floating.test.ts` and the blend golden generator (a file reference). |
| 2026-11-13 | Reading Aseprite's application source: no approval is on record, so it is treated as not approved. The next full audit classifies every file in the table above whose behaviour was confirmed from it. From now on behaviour is confirmed by using the program, not by reading its source. |
| 2026-11-13 | Stand-in licence text approved: `scripts/licence-texts/react-remove-scroll-bar.txt` for `react-remove-scroll-bar` 2.3.8, whose npm package ships no licence file. It is the `LICENSE` of <https://github.com/theKashey/react-remove-scroll-bar> (MIT, Copyright (c) 2025 Anton Korzunov), the file's only revision (commit `7301c160`, 21 May 2025), compared byte for byte. |

## Open items

- A full audit (none recorded yet), which also classifies the files marked Pending.
