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
| Aseprite Render Library (`src/render`) | <https://github.com/aseprite/aseprite> | v1.3.18.6, commit `331e898ef405d919539c03fd1675691cfa16c3a3` | MIT (`src/render/LICENSE.txt`) | Permissive |
| Oklab (Björn Ottosson, "A perceptual color space for image processing") | <https://bottosson.github.io/posts/oklab/> | The article as published on 23 December 2020 (modified 27 January 2021) | Public domain, or MIT (<https://bottosson.github.io/misc/License.txt>) | Permissive |
| mulberry32 (Tommy Ettinger, `mulberry32.c`) | <https://gist.github.com/tommyettinger/46a874533244883189143505d203312c> | Gist revision `fc93b8ad259c09a3635d80ed12a05309120795dc` | CC0 1.0 | Permissive |
| Graphics Gems (`gems/SeedFill.c`, Paul Heckbert) | <https://github.com/erich666/GraphicsGems> | Commit `75a9be5b7f` (the latest change to `SeedFill.c`, 2023-12-26) | The repository's own licence (`LICENSE.md`): use permitted in any program, credit not required | Unknown: not yet classified by the owner (licenses.md §1) |

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
- **Other Document Library and Render Library files**, recorded 2026-11-17 at commit `331e898`:
  `src/doc/algorithm/floodfill.cpp` (blob `adabca8`), `src/doc/color.h` (`0e99679`),
  `src/doc/blend_internals.h` (`e17c6e2`, which includes pixman's `pixman-combine32.h`) and
  `src/render/LICENSE.txt` (`2f96c9d`). Which revision was read in October 2026 is not
  recorded. `floodfill.cpp` credits its flood fill to Shawn Hargreaves (Allegro); Allegro's
  `src/flood.c` at `8a386b2` compares colours by equality only, so the tolerance rule
  `flood.ts` takes is the Document Library's. The golden generator attributes its cel opacity
  to Aseprite's renderer; whether `src/render/render.cpp` was read is not recorded, and the
  generator is listed under the Render Library's notice.
- **Oklab, mulberry32.** Recorded 2026-11-17 from the article and the gist; the versions are
  the ones published when the files were written (October 2026).

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
| `src/core/raster/curve.ts` | Aseprite Document Library (`algo.cpp`), Allegro: the sample count of `algo_spline` (factor 1.2, limits 4 and 64, the name `MAX_POINTS`), taken from the source; the samples are evaluated directly, not by forward differencing | Derived and noticed (listed and pointer added 2026-11-17) |
| `src/core/raster/flood.ts` | Heckbert, "A Seed Fill Algorithm" (1990); the colour-match rule from `color_equal_32` of the Document Library (`algorithm/floodfill.cpp`), in its order, with its separate case for tolerance 0 | Derived and noticed (listed and pointer added 2026-11-17; classified behaviour-dictated until then): the colour-match rule; the fill is a span stack, not that file's row flooder |
| `docs/SPEC.md` (§7.1: the magic wand's area; §7.2: Delete and Cut on a float, Flip and Rotate with a selection) | Aseprite application code: behaviour confirmed by reading its source | Behaviour-dictated: no source identifier, file or line reference or step structure found; comparison with the source not checked |
| `src/app/selection/transform/transform.commands.ts` (Flip and Rotate with a selection) | Aseprite application code: behaviour confirmed by reading its source | Behaviour-dictated: as above; comparison with the source not checked |
| `src/core/floating/floating.ts`, `tests/unit/se-032-floating.test.ts` (Delete and Cut on a float) | Aseprite application code: behaviour confirmed by reading its source | Behaviour-dictated: as above; comparison with the source not checked |
| The magic wand's selection modes (`src/app/selection/tools/`) | Aseprite application code: behaviour confirmed by reading its source | Behaviour-dictated; the comment of `wand.ts` that described the program's internal handling was reworded to its behaviour on 2026-11-17; comparison with the source not checked |
| `tests/e2e/se-015-pencil.spec.ts` (`line`), `tests/e2e/se-017-support.ts` (`lineTexels`) | Zingl (`plotLine`), the same code as `src/core/raster/line.ts` | Derived and noticed (listed and pointer added 2026-11-17) |
| `src/core/export/writers.ts` (`asepriteJsonText`), `tests/unit/se-051-aseprite.test.ts`, `docs/SPEC.md` §9.5 | Aseprite application code: the members and order of the sprite-sheet JSON confirmed by reading its source | Behaviour-dictated (a file format); the test's reference to a source file was replaced by the format's description on 2026-11-17; comparison with the source not checked |
| `src/core/raster/pixelPerfect.ts` | Aseprite application code: the pixel-perfect rule confirmed by reading its source; the file named a class of that source | Clean-room rewrite, 2026-11-17 (Clean-room records) |
| `docs/SPEC.md` §7.1 (Contour: the inside appears at the release) | Aseprite application code: the default named by an application preference key | Behaviour-dictated (the program's default, seen in use); the key was removed on 2026-11-17 |
| `docs/SPEC.md` §7.1 (Spray) | Aseprite application code: its spray rate, stated in constants and steps | The clause on Aseprite's rate was removed on 2026-11-17; `src/core/raster/spray.ts` follows its own rule (independent) |
| `src/core/composite/blend.ts`, `tests/unit/fixtures/se-061-blend-golden.generate.mjs` (the default blend method) | Aseprite application code: the default confirmed from the application's preferences file | Behaviour-dictated (the program's default, seen in its preferences); the key and file name were removed on 2026-11-16 |
| `tests/unit/se-061-blend.test.ts` (`preTicketComposite`) | Aseprite Document Library (`blend_funcs.cpp`, `rgba_blender_normal`), pixman (`MUL_UN8`): the compositor before SE-061, the same code as `blend.ts` | Derived and noticed (listed and pointer added 2026-11-17) |
| `tests/unit/fixtures/se-061-blend-golden.generate.mjs` (cel opacity) | Aseprite Render Library (`render.cpp`): the product of cel and layer opacity, rounded by `MUL_UN8` | Derived and noticed (listed 2026-11-17; whether `render.cpp` was read is not recorded) |
| `src/core/color/oklab.ts` | Oklab: `linear_srgb_to_oklab` and `oklab_to_linear_srgb` | Derived and noticed (listed and pointer added 2026-11-17) |
| `src/core/raster/spray.ts` (`createRandom`), `tests/unit/se-030-support.ts`, `tests/unit/se-032-floating.test.ts`, `tests/perf/se-032-move.perf.ts`, `tests/perf/se-033-transform.perf.ts`, `tests/e2e/se-070-soak.spec.ts`, `tests/unit/se-065-raster.test.ts` (a comment quoting its steps) | mulberry32 | Derived and noticed (listed and pointers added 2026-11-17) |
| `src/core/raster/flood.ts` (the span fill) | Graphics Gems (`SeedFill.c`), the code published with Heckbert's "A Seed Fill Algorithm" (1990), which the file cites | Pending the owner's classification of the Graphics Gems licence. Whether `SeedFill.c` was read is not recorded; compared on 2026-11-17, both keep the algorithm's stack of row segments, and the seeding, the scan of a row and the loop are written differently |
| `src/app/tools/curve/curve.tools.ts`, `docs/SPEC.md` §7.1 (the curve's three presses) | Aseprite application code: the flow was checked against its source (review record of 2026-10-17 in the history of `docs/REVIEW.md`) | Behaviour-dictated: the present text describes the flow by its behaviour, with no source identifier, file or line reference; comparison with the source not checked |
| `docs/SPEC.md` §7.1 (rail and keys), `docs/DESIGN.md` §5.1 (tool groups) | Aseprite application data (`gui.xml`), named as the source of the tool groups in the history of `docs/REVIEW.md` | Behaviour-dictated: the groups as the program's toolbar shows them; comparison with the file not checked |
| `tests/unit/se-010-support.ts` (`referencePixel`) | The normal blend as `blend.ts` states it, in floating point | Behaviour-dictated (the formula); no code in common |
| `tests/unit/se-066-fixtures/db32-aseprite.gpl` | The DawnBringer 32 colours of `db32.hex` (Lospec) in the GIMP palette layout Aseprite writes (`#` header, entries `Untitled`) | Independent data: written out again from `db32.hex` on 2026-11-17 in that layout, byte for byte the same file |
| `src/core/palettes/presets.ts`, `tests/unit/se-043-presets.test.ts`, `tests/unit/se-066-fixtures/` | Published palettes (DawnBringer, PICO-8, Sweetie 16, Endesga 32, AAP-64, Game Boy, 1-bit), with their Lospec addresses | Data: colour lists with their sources named |
| Textbook and standard algorithms: CRC-32 (`src/core/png/decode.ts`, `src/core/project/zip.ts`), FNV-1a (`src/core/export/pack.ts`, `src/app/pwa/precache.ts`, `tests/unit/se-050-pack.test.ts`), multiplicative hashing (`src/core/import/keyIndex.ts`), the sRGB transfer function and WCAG 2.1 contrast (`src/core/color/contrast.ts`, `oklab.ts`), HSV (`src/core/color/hsv.ts`), Bayer and Floyd-Steinberg (`src/core/import/mapToPalette.ts`), median cut and k-means (`src/core/import/buildPalette.ts`), the LCG constants 1664525 and 1013904223 (`tests/perf/se-043-import.perf.ts`, `tests/unit/se-005-fixtures/make_fixtures.py`), GIF LZW decoding (`tests/unit/se-063-support.ts`), Adler-32 (`tests/unit/se-040-support.ts`), fuzzy matching (`src/app/commandPalette/fuzzy.ts`) | None named: the algorithms of the standards (PNG, zip, zlib, GIF, sRGB, WCAG) and of textbooks | Independent: written in this project from the definitions, with the published constants; no source code named or found in common |

Every other file that names Aseprite does so to identify a file format, a palette or a
behaviour observed in the program. Every tracked file not listed above is independent: see
Inventory sweep.

## Bundled dependencies

- `gifenc` credits its colour quantizer as based on a port of PnnQuant.js. The GIF export does
  not use it: `vite.config.ts` resolves `gifenc` to its ES module build so the bundle keeps only
  the encoder, and the build fails if the quantizer comes back
  (`tests/unit/licences-excluded.test.ts`).
- `gifenc`'s LZW encoder is bundled. It credits gif.js and gif-codec (MIT, both in
  `THIRD_PARTY_NOTICES.md`), and Kevin Weiner's Java encoder, an ActionScript version, the
  Poskanzer and Elliott Java versions, `GIFCOMPR.C`, `compress.c` and JS optimisations by
  Mathieu Henri, whose licences are not established: accepted as a residual risk (Owner
  decisions, 2026-11-17).
- The icons are `lucide-react`'s, bundled from npm; its licence is in `licences.txt`.

## Inventory sweep

2026-11-17, on branch `chore/licence-audit`: every tracked file of a code, style, markup or
palette type (1,100 of 1,226; the rest are JSON data, PNG images, Markdown and configuration)
was scanned for:

- names of algorithms, colour spaces, generators, hashes and file codecs;
- credit wording in comments ("port", "adapted", "based on", "derived from", "after",
  "credit", "public domain", "copyright", "licence", "translated", "algorithm from");
- URLs, years in comments, 32-bit hexadecimal constants and decimal constants of five or more
  digits outside test expectations;
- copied component-library code (`cn`/`cva` helpers, `data-slot`, Radix wrapper signatures),
  inline SVG paths and font files.

Each hit was resolved: it is a row of the Files table, the project's own data or test
expectations (colours, file signatures, measured values), or a name of the project's own code.
No other third-party code was found. The per-file list is kept with the audit records, outside
the repository.

## Clean-room records

| Date | File | Process |
| --- | --- | --- |
| 2026-11-17 | `src/core/raster/pixelPerfect.ts` | Spec writer: the auditor of 2026-11-17, who had read the earlier file but not Aseprite's source; the spec gives the rule by its output (L corners, neighbours in the path as drawn, the pixel after a removed one kept), goldens and the interface the code and tests use. Implementer: a separate implementer given the spec, the tests and `docs/SPEC.md` only, in a worktree of `main` at `3c55bf9` with the file deleted, told not to read its history, any other checkout or any other program's source; it reported reading none. Acceptance: the existing tests unchanged; the new file and the earlier one give the same output on 200,000 random paths. |

## Audits

| Date | Revision | Scope | Result |
| --- | --- | --- | --- |
| 2026-11-17 | `main` at `3c55bf993e84e1e32a9ad4e578b5526cb58611c1` | Full audit (licenses.md §6) by an auditor who had not worked on the code: every tracked file that names or derives from a registered upstream, tests, fixtures, scripts, assets, docs, the build output, the generated code and the history of the restricted-source notes; permissive upstreams compared at the versions above; Aseprite's application source not read (owner decision of 2026-11-17). | Blocking items open (Open items). |
| 2026-11-17 | Branch `chore/licence-audit` on `main` at `3c55bf993e84e1e32a9ad4e578b5526cb58611c1`, with its uncommitted changes (`CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `docs/PROVENANCE.md`, `wand.ts`, `curve.ts`, `pixelPerfect.ts`, `se-015-pencil.spec.ts`, `se-017-support.ts`, `se-051-aseprite.test.ts`) | Second full audit (licenses.md §6) by another auditor, who had not worked on the code or read the first audit's report: every tracked file that names or derives from a registered upstream, tests, fixtures, scripts, assets, docs, the build output (`npm run build`), the generated code, the bundled-dependency notices and the `gifenc` quantizer exclusion, and the history of restricted-source names; permissive upstreams compared at the versions above; Aseprite's application source not read (owner decision of 2026-11-17). | The four blocking items of the first audit are closed in the audited state. Four blocking items open (Open items). |
| 2026-11-17 | Branch `chore/licence-audit` on `main` at `3c55bf993e84e1e32a9ad4e578b5526cb58611c1`, with its uncommitted changes (`CHANGELOG.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, `docs/PROVENANCE.md`, `docs/SPEC.md`, `wand.ts`, `curve.ts`, `pixelPerfect.ts`, `se-015-pencil.spec.ts`, `se-017-support.ts`, `se-051-aseprite.test.ts`) | Third full audit (licenses.md §6) by another auditor, who had not worked on the code or read the earlier audits' reports: every tracked file that names or derives from a registered upstream, tests, fixtures, scripts, assets, docs, the build output (`npm run build`), the generated code, the bundled-dependency notices and the `gifenc` quantizer exclusion, the history note and the history of every ref for restricted-source names; permissive upstreams compared at the versions above, and gif-codec at commit `40456125`; Aseprite's application source not read (owner decision of 2026-11-17). | The first audit's four items and two of the second audit's three are closed in the audited state. Three blocking items open (Open items); the gif-codec notice was added to `THIRD_PARTY_NOTICES.md` during the audit. |
| 2026-11-17 | Branch `chore/licence-audit` on `main` at `3c55bf993e84e1e32a9ad4e578b5526cb58611c1`, with its uncommitted changes (`CHANGELOG.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, `docs/PROVENANCE.md`, `docs/SPEC.md`, `wand.ts`, `curve.ts`, `flood.ts`, `pixelPerfect.ts`, `se-015-pencil.spec.ts`, `se-017-support.ts`, `se-051-aseprite.test.ts`) | Fourth full audit (licenses.md §6) by another auditor, who had not worked on the code or read the earlier audits' reports: every tracked file that names or derives from a registered upstream or a credited origin, tests, fixtures, scripts, assets, docs, the build output (`npm run build`: `dist/licences.txt`, the service worker and the bundle), the generated code, the bundled-dependency notices and the `gifenc` quantizer exclusion, the history note, and the history of every ref and tags `v1.0.0` to `v1.0.2` for restricted-source names; permissive upstreams compared at the versions above (Document Library and Render Library at `331e898`, pixman 0.46.4, Allegro `spline.c` and `flood.c` at `8a386b2`, Zingl at `ce9002f`, gif.js at `92d27a0`, gif-codec at `40456125`), and the Graphics Gems seed fill; Aseprite's application source not read (owner decision of 2026-11-17). | The items of the earlier audits that were pending the next full audit are closed in the audited state. One blocking item open, an owner decision (Open items). |
| 2026-11-17 | Branch `chore/licence-audit` on `main` at `3c55bf993e84e1e32a9ad4e578b5526cb58611c1`, with its uncommitted changes (`CHANGELOG.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, `docs/PROVENANCE.md`, `docs/SPEC.md`, `wand.ts`, `curve.ts`, `flood.ts`, `pixelPerfect.ts`, `se-015-pencil.spec.ts`, `se-017-support.ts`, `se-051-aseprite.test.ts`) | Fifth full audit (licenses.md §6) by another auditor, who had not worked on the code or read the earlier audits' reports: every tracked file that names or derives from a registered upstream or a credited origin, every tracked file searched for code of published sources (credits, citations, known constants), tests, fixtures, scripts, assets, docs, the build output (`npm run build`: `dist/licences.txt` and the bundle, with the credits in the bundled packages' sources), the generated code, the history note, and the history of every ref and tags `v1.0.0` to `v1.0.2` for restricted-source names; permissive upstreams compared at the versions above (Document Library and Render Library at `331e898`, pixman 0.46.4, Allegro `spline.c` and `flood.c` at `8a386b2`, Zingl at `ce9002f`, gif.js at `92d27a0`, gif-codec at `40456125`), Graphics Gems `SeedFill.c` at `75a9be5`, the code of Ottosson's Oklab article and Tommy Ettinger's `mulberry32.c`; Aseprite's application source not read (owner decision of 2026-11-17). | The fourth audit's blocking item is closed by the owner decision of 2026-11-17. Three blocking items open (Open items); their notices were added to `THIRD_PARTY_NOTICES.md` during the audit. |

## Owner decisions

| Date | Decision |
| --- | --- |
| 2026-11-13 | Code the export writes into users' projects (`<name>.sprites.ts`, `<name>.preview.config.mjs`) is licensed 0BSD, its full text in the head of each file (`src/core/export/generatedLicence.ts`). The editor stays MIT. |
| 2026-11-13 | Names from Aseprite's application source (classes, functions, members, file references) are removed from specs, comments and tests and replaced by behaviour-only wording, using the names Aseprite shows in its UI. Done in `docs/SPEC.md`, `transform.commands.ts`, `floating.ts`, `se-032-floating.test.ts` and the blend golden generator (a file reference). |
| 2026-11-13 | Reading Aseprite's application source: no approval is on record, so it is treated as not approved. The next full audit classifies every file in the table above whose behaviour was confirmed from it. From now on behaviour is confirmed by using the program, not by reading its source. |
| 2026-11-13 | Stand-in licence text approved: `scripts/licence-texts/react-remove-scroll-bar.txt` for `react-remove-scroll-bar` 2.3.8, whose npm package ships no licence file. It is the `LICENSE` of <https://github.com/theKashey/react-remove-scroll-bar> (MIT, Copyright (c) 2025 Anton Korzunov), the file's only revision (commit `7301c160`, 21 May 2025), compared byte for byte. |
| 2026-11-17 | The full licence audit does not read Aseprite's restricted application source. For files whose behaviour was confirmed from it, the auditor checks the project for source identifiers (function, class, member or file names), file or line references and step-by-step structure (licenses.md §3), and records the direct comparison as not checked. |
| 2026-11-17 | History note approved, as worded in `README.md` (after the licence paragraph): it names the files whose earlier versions held names and details from Aseprite's application source, and the rewrite of `pixelPerfect.ts`. The history is not rewritten. |
| 2026-11-17 | `gifenc`'s LZW encoder, bundled in the GIF export, is kept: the licences of the ActionScript version and of the Poskanzer and Elliott versions in its credit chain are not established, and that is accepted as a known residual risk. The gif.js MIT notice (Copyright (c) 2013-2018 Johan Nordberg) is added to `THIRD_PARTY_NOTICES.md`. |
| 2026-11-17 | The accepted residual risk of `gifenc`'s LZW encoder is extended to the other origins its header credits: "GIFCOMPR.C" with GIF modifications by David Rowley, `compress.c` by Spencer W. Thomas, Jim McKie, Steve Davies, Ken Turkowski, James A. Woods and Joe Orost, and the JS optimisations by Mathieu Henri. Their licences are not established. |

## Open items

From the audit of 2026-11-17. Release, deploy and tag stay on hold (licenses.md §7) until a
second full audit, by another auditor, finds nothing blocking.

- Pending the second full audit: the four blocking items of the 2026-11-17 audit, fixed on
  2026-11-17. `src/core/raster/pixelPerfect.ts` named a class of Aseprite's application
  source and described its rule step by step (added 2026-10-15): rewritten clean room.
  `tests/unit/se-051-aseprite.test.ts` cited a file of that source (added 2026-10-13): the
  comment now describes the exported format. `src/app/selection/tools/wand.ts` explained the
  wand by the program's internal handling: reworded to its behaviour. `curve.ts` and two E2E
  line helpers had no notice: listed in `THIRD_PARTY_NOTICES.md`, pointer lines added.
- `tests/unit/fixtures/se-061-blend-golden.generate.mjs` also uses `src/doc/color.h` (Document
  Library, MIT), which the record of files used does not list, and states the opacity of a cel
  as "Aseprite's renderer" computes it. Which source that was is not recorded; Aseprite's
  Render Library (`src/render`, MIT) is not registered.
- `gifenc`'s README credits its encoder to gif.js and gif-codec (both MIT, per their
  repositories' licence files); its LZW encoder's header credits Kevin Weiner's Java encoder
  and `compress.c`. The bundled-dependencies note above records only the quantizer.
- The history holds names, file references and details from Aseprite's application source
  (no history note exists yet, licenses.md §7):
  - `docs/SPEC.md` (the wand; Delete and Cut on a float; Flip and Rotate), `floating.ts` and
    `se-032-floating.test.ts`: class and member names, 2026-10-17 to 2026-11-13;
  - `transform.commands.ts`: `FlipCommand`, `RotateCommand`, `startFlipTransformation`,
    `startSelectionTransformation`, 2026-10-19 to 2026-11-13;
  - `docs/REVIEW.md`: `ToolLoopImpl`, `m_useMask`, `PixelsMovement`, `FourPointsController`,
    `FlipCommand`, `RotateCommand`, `Editor::startSelectionTransformation`,
    `MovingPixelsState` and the data file `gui.xml`, 2026-10-17 until it was untracked on
    2026-11-06 (tag `v1.0.0`);
  - `docs/SPEC.md`: `MovingPixelsState::onBeforeCommandExecution` (commit `2e5cdbd`), removed
    with the other names on 2026-11-13;
  - `blend.ts` and `se-061-blend-golden.generate.mjs`: the preference `experimental.new_blend`
    and, in the generator, the file `data/pref.xml`, 2026-10-20 to 2026-11-16 (`v1.0.0` to
    `v1.0.2`);
  - `se-051-aseprite.test.ts`: a source file reference, 2026-10-13 to 2026-11-17;
  - `pixelPerfect.ts`: a class name and the code rewritten clean room, 2026-10-15 to
    2026-11-17 (`v1.0.0` to `v1.0.2`);
  - `docs/SPEC.md` §7.1: the contour's preference key and Aseprite's spray rate, 2026-10-17 to
    2026-11-17;
  - `src/app/selection/tools/wand.ts`: a comment on the program's internal handling of the
    wand, 2026-10-17 to 2026-11-17 (`v1.0.0` to `v1.0.2`).
- Tags `v1.0.0` and `v1.0.1` shipped without `THIRD_PARTY_NOTICES.md`; `v1.0.2` shipped it.

From the second audit of 2026-11-17. Blocking:

- Pending the third full audit: `docs/SPEC.md` §7.1 named the contour's preference key
  `filled_preview` and stated Aseprite's spray rate (both added 2026-10-17); removed on
  2026-11-17, rows added to the Files table.
- Pending the third full audit: the history note (licenses.md §7), approved by the owner and
  added to `README.md` on 2026-11-17, names the files and the upstream of the history list
  above.
- Pending the third full audit: accepted by the owner on 2026-11-17 as a residual risk
  (Owner decisions), the gif.js notice added: `gifenc`'s LZW encoder, which the build bundles, credits Kevin Weiner's Java encoder, an
  ActionScript version by Thibault Imbert and gif.js. gif.js (MIT, Copyright (c) 2013-2018
  Johan Nordberg) and gif-codec (MIT, Copyright (c) 2018 Giovanni Cappellotto) have licence
  files; Kevin Weiner's page, archived on 2013-03-05, says his Java sources "may be freely
  used for any purpose", and his `LZWEncoder.java` is adapted from Jef Poskanzer's Java port
  by way of J. M. G. Elliott. The licences of the ActionScript version and of the Poskanzer
  and Elliott versions are not established (licenses.md §5: Unknown, an owner decision).

Not blocking:

- Not recorded above: `src/doc/color.h` (Document Library), used by the blend golden
  generator; which source gave the generator's cel opacity (`MUL_UN8` of cel and layer
  opacity, "Aseprite's renderer").
- The pixman notice leaves out the first line of `COPYING` and its comment marks; the
  copyright lines and licence text are as in `COPYING`.
- `src/app/selection/clipboard.ts` writes "as Aseprite does (`FloatingSelection.discard`)";
  the identifier is this project's (`src/core/floating/floating.ts`).
- `README.md` lists the ported upstreams without Allegro.
- No release-page note exists for `v1.0.0` to `v1.0.2` (licenses.md §7).
- Not checked: the comparison with Aseprite's application source of every item it confirmed;
  the clean-room process of `pixelPerfect.ts` beyond its record; `@ngne/core`'s own sources
  (adapted from the owner's `cluster-renderer`); the E2E suite.

From the third audit of 2026-11-17. Blocking:

- The bundled GIF encoder holds code of gif-codec (MIT, Copyright (c) 2018 Giovanni
  Cappellotto), which `gifenc`'s README credits: `gifenc`'s `src/constants.js` is the same as
  gif-codec's `src/constants.js` at commit `40456125`, its member names are in the built
  bundle, and `gifenc`'s `src/index.js` has gif-codec's encoder function names. The shipped
  notices had no gif-codec entry. Pending the next full audit: the notice was added to
  `THIRD_PARTY_NOTICES.md` on 2026-11-17.
- `src/core/raster/flood.ts` (added 2026-10-15) takes its match rule from `color_equal_32` of
  the Document Library's `algorithm/floodfill.cpp`, which `docs/SPEC.md` §7.1 says was checked
  against its source; `flood.ts` lines 81-90 follow that function's order, including its
  separate case for tolerance 0 (`floodfill.cpp` lines 53-73). The file has no pointer to the
  notices, `THIRD_PARTY_NOTICES.md` does not list it, and the Files table classifies it as
  behaviour-dictated. Pending the next full audit: listed in `THIRD_PARTY_NOTICES.md`, pointer
  added and reclassified derived and noticed on 2026-11-17.
- The history note in `README.md` does not name `src/app/selection/tools/wand.ts`, whose
  comment read "in Aseprite, whose selection inks fill with no mask" from 2026-10-17 (commit
  `a35457f`, which also put `ToolLoopImpl` and `m_useMask` in `docs/SPEC.md` as checked in
  Aseprite's source) to 2026-11-17, tags `v1.0.0` to `v1.0.2` included. The history list above
  does not name it either. Pending the next full audit: added to the history note and the
  history list on 2026-11-17.

Not blocking:

- `src/app/tools/curve/curve.tools.ts` and `docs/SPEC.md` §7.1 (the curve's three presses):
  the review record of 2026-10-17 in the history of `docs/REVIEW.md` says the flow was checked
  against Aseprite's `FourPointsController`. The Files table does not list them; their present
  text describes the flow by its behaviour, with no source identifier, file or line reference.
  The history list above names, for `docs/REVIEW.md`, neither `FourPointsController` nor
  `FlipCommand`, `RotateCommand` and `Editor::startSelectionTransformation`.
- `README.md` and `docs/SPEC.md` §4 list the notices without Allegro, gif.js and gif-codec.
- Bundled dependencies whose READMEs credit other projects, with no code compared:
  `aria-hidden` ("Based on smooth-ui modal dialogs") and `use-callback-ref` (`mergeRefs`
  "based on" react-merge-refs).
- `tests/unit/se-066-fixtures/db32-aseprite.gpl`: whether it was saved by Aseprite or written
  by hand is not recorded.
- Not checked: whether "keep selection after clear" (`docs/SPEC.md` §7.2) is the label
  Aseprite's preferences show; the rest of `gifenc`'s `src/index.js` against gif-codec beyond
  the constants and function names.

From the fourth audit of 2026-11-17. The items above marked "pending the third full audit" or
"pending the next full audit" are closed in the audited state. Release, deploy and tag stay on
hold (licenses.md §7) while the blocking item below is open.

Blocking:

- `gifenc`'s LZW encoder (`src/lzwEncode.js`, bundled in the GIF export) also credits, in its
  header, "GIFCOMPR.C - GIF Image compression routines" with GIF modifications by David Rowley,
  `compress.c` (IEEE Computer, June 1984) by Spencer W. Thomas, Jim McKie, Steve Davies, Ken
  Turkowski, James A. Woods and Joe Orost, and JS optimisations by Mathieu Henri. Their licences
  are not recorded, and the owner decision of 2026-11-17 names only the ActionScript, Poskanzer
  and Elliott versions (licenses.md §5, §8). Needs an owner decision: extend the accepted
  residual risk to these origins, or record their licences from a primary source. Pending the
  next full audit: the owner extended the accepted residual risk to these origins on
  2026-11-17 (Owner decisions).

Not blocking:

- `docs/REVIEW.md` (history; tag `v1.0.0`) named Aseprite's `gui.xml`, a data file under its
  EULA, as the source of the tool groups (review row F21, commit `3fb0151`, 2026-10-17). The
  present text (`docs/SPEC.md` §7.1, rail and keys; `docs/DESIGN.md` §5.1) describes the groups
  as the program's toolbar shows them, with no file name or identifier, and the rail does not
  follow them: behaviour-dictated, comparison with the source not checked. The README history
  note names `docs/REVIEW.md`; the history list above names neither `gui.xml` nor, for
  `docs/REVIEW.md`, `FourPointsController`, `FlipCommand`, `RotateCommand`,
  `Editor::startSelectionTransformation` and `MovingPixelsState`, nor, for `docs/SPEC.md`,
  `MovingPixelsState::onBeforeCommandExecution` (commit `2e5cdbd`).
- `src/core/raster/flood.ts` cites Heckbert's "A Seed Fill Algorithm" (Graphics Gems, 1990).
  Whether the code published with it (Graphics Gems `SeedFill.c`, under the Graphics Gems
  licence, which the owner has not classified) was read is not recorded (licenses.md §2). The
  span loop of `flood.ts` keeps the algorithm's segment stack and its pushes toward the parent
  row, in its own form.
- `src/doc/algorithm/floodfill.cpp`, which `flood.ts`'s colour rule comes from, credits "The
  floodfill routine. By Shawn Hargreaves" (Allegro). Allegro's `src/flood.c` at `8a386b2`
  compares colours by equality only; the tolerance rule is not in it. Not recorded above.
- How each version was established does not cover `floodfill.cpp` (blob `adabca8` at
  `331e898`; last changed in July and August 2026, a formatting change).
- `CHANGELOG.md` does not mention the gif-codec notice or the `flood.ts` notice added on
  2026-11-17.
- `THIRD_PARTY_NOTICES.md`, shipped in `licences.txt`, refers the reader to
  `docs/PROVENANCE.md`, which is not shipped.
- Not checked: whether Aseprite's shortcuts and menus (DESIGN §1, principle 4; SPEC §7.8) were
  taken from its `gui.xml` or from its public documentation; `gifenc`'s `lzwEncode.js` against
  its C and Java origins; Graphics Gems `SeedFill.c` was read at `master`, not a pinned
  revision; the E2E suite.

From the fifth audit of 2026-11-17. The fourth audit's blocking item is closed by the owner
decision of 2026-11-17. Release, deploy and tag stay on hold (licenses.md §7) while the
blocking items below are open.

Blocking (licenses.md §1, §2, §5: code ported from a permissive or public-domain source with
no notice; the notices were added to `THIRD_PARTY_NOTICES.md` during the audit, and what is
left is listed with each item):

- `tests/unit/se-061-blend.test.ts` lines 133-199 (`preTicketComposite`, added 2026-10-20,
  commit `1b87d42`, tags `v1.0.0` to `v1.0.2`): a copy of the compositor's normal blend before
  SE-061, pixman's `MUL_UN8` and the rules of the Document Library's `rgba_blender_normal`
  (`blend_funcs.cpp` lines 203-245), line for line as `blend.ts` lines 37-80. Not listed in
  the notices or the Files table; no pointer. Open: the pointer line and a Files row.
- `src/core/color/oklab.ts` (added 2026-10-12, commit `0b3c64d`, tags `v1.0.0` to `v1.0.2`,
  bundled): lines 44-49 and 69-75 are the code of `linear_srgb_to_oklab` and
  `oklab_to_linear_srgb` in Björn Ottosson's "A perceptual color space for image processing"
  (2020), with the same constants and one statement per line of it. The article makes that
  code available in the public domain and under MIT (Copyright (c) 2020 Björn Ottosson). The
  file cites the article; the upstream is not registered. Open: an Upstreams row, a Files row
  and the pointer line.
- mulberry32 (Tommy Ettinger, `mulberry32.c`, gist revision `fc93b8a`, CC0 1.0): its steps
  and constants (lines 49-52) are in `src/core/raster/spray.ts` lines 45-54 (`createRandom`,
  added 2026-10-17, commit `4555fad`, tags `v1.0.0` to `v1.0.2`, bundled), which credits it as
  public domain, and in five test files: `tests/unit/se-030-support.ts`,
  `tests/unit/se-032-floating.test.ts`, `tests/perf/se-032-move.perf.ts`,
  `tests/perf/se-033-transform.perf.ts` and `tests/e2e/se-070-soak.spec.ts`. Not registered.
  Open: an Upstreams row, Files rows and pointer lines.
- Pending the next full audit: for the three items above, the Upstreams rows, the Files rows
  and the pointer lines were added on 2026-11-17, also in `tests/unit/se-065-raster.test.ts`,
  whose comment quotes mulberry32's steps.

Not blocking:

- `tests/unit/se-010-support.ts` (`referencePixel`) computes the normal blend from the rules
  stated in `blend.ts`, in floating point; no code in common beyond the formula. Not listed
  in the Files table (behaviour-dictated by the formula).
- `src/core/raster/flood.ts` against Graphics Gems `SeedFill.c` (revision `75a9be5`): both keep
  a stack of row segments with a direction and push the parent row where a span reaches past
  its parent, the algorithm the paper describes; the seeding, the scan of a row and the loop
  are written differently. Whether `SeedFill.c` was read is not recorded.
- Textbook code with no source named: the CRC-32 table of `src/core/png/decode.ts` (the PNG
  specification's algorithm), FNV-1a in `src/core/export/pack.ts` and
  `src/app/pwa/precache.ts`, the 4 × 4 Bayer matrix and Floyd-Steinberg weights of
  `src/core/import/mapToPalette.ts`, median cut and k-means in
  `src/core/import/buildPalette.ts`.
- `README.md` and `docs/SPEC.md` §4 list the ported upstreams without Allegro, gif.js,
  gif-codec, Oklab and mulberry32.
- The Upstreams table does not register Aseprite's Render Library (`src/render`, MIT), whose
  `render.cpp` line 1071 holds the cel-opacity rule the blend golden generator states as
  "Aseprite's renderer"; the record of files used does not list `src/doc/color.h` or
  `src/doc/blend_internals.h` (the latter includes pixman's `pixman-combine32.h`).
- `src/core/export/generatedLicence.ts`: the generated files hold this project's code only,
  under 0BSD, as recorded.
- Not checked: the StackOverflow and other JavaScript copies of mulberry32 (the form in
  `spray.ts` is a direct translation of the C); `@ngne/core`'s sources against
  `cluster-renderer`, which they credit; whether the E2E suite holds other expected-image
  helpers beyond those searched by pattern; the comparison with Aseprite's application source
  of every item it confirmed.
