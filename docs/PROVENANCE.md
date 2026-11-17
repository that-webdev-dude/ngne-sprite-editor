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
| Graphics Gems (`gems/SeedFill.c`, Paul Heckbert) | <https://github.com/erich666/GraphicsGems> | Commit `75a9be5b7f` (the latest change to `SeedFill.c`, 2023-12-26) | The repository's own licence (`LICENSE.md`): use permitted in any program, credit not required | Permissive (owner decision, 2026-11-17) |
| NGNE (the owner's engine repository, `demo/`) | <https://github.com/that-webdev-dude/ngne> | Tag `v0.2.1`, commit `b0cc2ec` | MIT, Copyright (c) 2026 that-webdev-dude, the same holder as this project (owner decision, 2026-11-17) | Owner's own: registered, no notices entry (licenses.md §5) |
| github-slugger (Dan Flettre) | <https://github.com/Flet/github-slugger> | 2.0.0, commit `3461c4350868329c8530904d170358bca1d31448` (the latest; which version was read is not recorded) | ISC, Copyright (c) 2015, Dan Flettre | Permissive |

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
| `src/core/raster/flood.ts` (the span fill) | Graphics Gems (`SeedFill.c`), the code published with Heckbert's "A Seed Fill Algorithm" (1990), which the file cites | Derived and noticed (listed and pointer added 2026-11-17, after the owner classified the Graphics Gems licence permissive): both keep the algorithm's stack of row segments and its pushes toward the parent row; the seeding, the scan of a row and the loop are written differently |
| `tests/unit/se-051-support.ts` (`demoDrawSprite`) | NGNE `demo/sprites.ts` at `v0.2.1`, statement for statement | Derived (owner's own code, same holder: no notices entry) |
| `scripts/check-links.mjs` (heading slugs) | github-slugger (`script/generate-regex.js`, `index.js`): the characters a slug keeps and the numbering of repeated slugs | Derived and noticed (compared in the verification audit of 2026-11-17; listed and pointer added that day). A development script, not shipped |
| `src/app/tools/curve/curve.tools.ts`, `docs/SPEC.md` §7.1 (the curve's three presses) | Aseprite application code: the flow was checked against its source (review record of 2026-10-17 in the history of `docs/REVIEW.md`) | Behaviour-dictated: the present text describes the flow by its behaviour, with no source identifier, file or line reference; comparison with the source not checked |
| `docs/SPEC.md` §7.1 (rail and keys), `docs/DESIGN.md` §5.1 (tool groups) | Aseprite application data, named as the source of the tool groups in the history of `docs/REVIEW.md` | Behaviour-dictated: the groups as the program's toolbar shows them; comparison with the data not checked |
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
| 2026-11-17 | `ff66762` (branch `chore/licence-audit`) | Full audit (licenses.md §6) by six auditors who had not worked on the code or read earlier reports, one per area: all 1,226 tracked files (full review of the 131 that name an upstream, a scan of the rest), `dist/` with `licences.txt`, and the code generated into users' projects; permissive upstreams read at their registered versions; Aseprite's application source and data not read (no approved comparison) | No file derived from a copyleft or restricted source. Blocking candidates S-1 to S-4, record gaps S-5 to S-9 (Findings). |
| 2026-11-17 | `ff66762` with the fixes of S-1 to S-4 and S-8 (uncommitted) | First verification audit by another auditor: the fixes, the comparison of `scripts/check-links.mjs` with github-slugger, and the diff | S-2, S-3 and S-8 confirmed; S-1 partly fixed (Rolldown's third-party licence file not listed); S-4 code taken from github-slugger. Both fixed the same day (Findings). |
| 2026-11-17 | `ff66762` with all fixes (the commit that adds this row) | Second verification audit by another auditor: the fixes of S-1 and S-4, the earlier fixes, and the diff | Nothing blocking: S-1 and S-4 confirmed fixed, S-2, S-3 and S-8 still hold, the diff adds no blocking finding. Audited revision: the commit that adds this row. |

The "Open items" the first five rows name are summarised in Findings (S-0, S-9); their full
records are in the owner's private record.

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
| 2026-11-17 | The Graphics Gems licence (`LICENSE.md` at `75a9be5b7f`: use in any program, credit optional) is classified permissive. `flood.ts` is derived and noticed; its notice is added to `THIRD_PARTY_NOTICES.md`. |
| 2026-11-17 | NGNE (`@ngne/core`, MIT, "that-webdev-dude") has the same copyright holder as this project: code copied from it is registered here and needs no notices entry (licenses.md §5). |
| 2026-11-17 | github-slugger is registered so that `scripts/check-links.mjs` can be compared with it; a notice and pointer follow if code was taken. |
| 2026-11-17 | Names of classes, members, data files and preference keys of Aseprite's application source, and the step-by-step records of the earlier audit rounds, are kept in the owner's private record outside the repository. This file names the files, sections and dates in behaviour terms only (licenses.md §3). |
| 2026-11-17 | The bundle's build-tool code is listed: Rolldown's runtime helpers in `licences.txt` (`vite.config.ts`, `BUILD_PACKAGES`); Vite's module-preload polyfill is turned off. |

## Findings

The findings of the audits above, by the licenses.md §6 format: blocking candidates one row
each, non-blocking findings one row per kind. The five rounds of 2026-11-17 before `ff66762`
are summarised in S-0; their step-by-step records are in the owner's private record.

| ID | Audit | Files | Blocking | Disposition |
| --- | --- | --- | --- | --- |
| S-0 | Rounds 1-5, 2026-11-17 | `pixelPerfect.ts` (clean-room rewrite); source references and internal-handling comments in `se-051-aseprite.test.ts`, `wand.ts`, `docs/SPEC.md` §7.1; notices and pointers for `curve.ts`, the E2E line helpers, `flood.ts` (colour rule), `se-061-blend.test.ts`, `oklab.ts`, mulberry32, gif.js, gif-codec; the Render Library and Document Library files used; the README history note; the credits of `gifenc`'s LZW encoder | Yes | Fixed by `ff66762`, confirmed by the full audit at `ff66762`; the LZW encoder's credited origins are an accepted risk (Owner decisions) |
| S-1 | Full, `ff66762` | `dist/licences.txt`: Rolldown's runtime helpers and Vite's module-preload polyfill in the main chunk, not listed | Yes | Fixed 2026-11-17: Rolldown listed (`BUILD_PACKAGES` in `vite.config.ts`), the polyfill turned off; after the first verification audit, the collector also lists a package's third-party licence file (Rolldown's, with the Rollup and esbuild notices; `scripts/licences.ts`) |
| S-2 | Full, `ff66762` | `src/core/raster/flood.ts`, `THIRD_PARTY_NOTICES.md`: the span fill against Graphics Gems `SeedFill.c`, an upstream of Unknown class with no notice | Yes | Fixed 2026-11-17: Graphics Gems classified permissive (owner), notice and pointer added |
| S-3 | Full, `ff66762` | `tests/unit/se-051-support.ts`: code copied from NGNE `demo/sprites.ts`, not registered | Candidate | Rejected as a notice gap: same holder as this project (owner); NGNE registered (Upstreams, Files) |
| S-4 | Full, `ff66762` | `scripts/check-links.mjs`: names github-slugger as the source of its character rules; not registered or compared | Candidate | Fixed 2026-11-17: the verification audit found the slug rules taken from github-slugger; notice and pointer added |
| S-5 | Full, `ff66762` | Files rows missing or incomplete: `src/app/selection/clipboard.ts` (Delete and Cut on a float); the wand row covers all of `src/app/selection/tools/` while only the wand's area is tied; Deselect while floating (`selection.commands.ts`, `docs/SPEC.md` §7.2) has no row; the cel × layer opacity rule in `src/core/composite/compositeFrame.ts` and `tests/unit/se-061-blend.test.ts` (Render Library); `src/core/raster/contour.ts` and `src/app/tools/contour/contour.tools.ts` (contour default); `src/core/model/defaultPalette.ts` (DawnBringer 32); the flood test oracle in `tests/unit/se-017-flood.test.ts`; the LCG and hash constants in further tests, perf files and `spikes/ngne/runner/run.ts`; the credits inside bundled `aria-hidden` and `use-callback-ref` | No | Open |
| S-6 | Full, `ff66762` | Wording: `curve.ts`, this file and the notices name Allegro's `calc_spline` where the sample count is in `_soft_spline`; `README.md` "ported from" list; the README history note against this file; the 0BSD header of generated code names no grantor (`generatedLicence.ts`); the shipped notices point to this file, which is not shipped; carried from rounds 1-5: the pixman notice leaves out the first line of `COPYING`, `CHANGELOG.md` does not mention the notices added on 2026-11-17, `docs/SPEC.md` §4 lists the notices incompletely, and `clipboard.ts` writes "as Aseprite does" beside this project's own `FloatingSelection.discard` | No | Open |
| S-7 | Full, `ff66762` | Tooling: `sw.js` is built outside the licences collector (nothing missing today); `licenceAllowed` in `scripts/licences.ts` accepts some nested licence expressions | No | Open |
| S-8 | Full, `ff66762` | This file named classes, members, data files and preference keys of Aseprite's application source, and RULES 4 sends contributors here | No | Fixed 2026-11-17: moved to the owner's private record (Owner decisions) |
| S-9 | Rounds 1-5, 2026-11-17 | Tags `v1.0.0` and `v1.0.1` shipped without `THIRD_PARTY_NOTICES.md`; no release-page note for `v1.0.0` to `v1.0.2` (licenses.md §7) | No | Open |

The full audit at `ff66762` found no file derived from a copyleft or restricted source. Not
checked: the comparison with Aseprite's application source and data of every item confirmed
from it; NGNE `demo/` against this repository beyond the copied function; gif.js and gif-codec
licence texts at their registered commits; binary fixtures byte for byte.

## Open items

- No blocking finding is open (second verification audit, 2026-11-17). The release hold lifts
  when the owner lifts it.
- Record gaps S-5 to S-7 and S-9.
