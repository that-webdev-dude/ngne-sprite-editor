# NGNE Sprite Editor

A desktop browser editor for pixel-art sprites and frame animation, rendered with the NGNE
WebGPU engine. Draw and transform pixels, arrange layers and animation tags, turn PNGs into
sprites with deterministic quantization, keep reference images beside your work, and export
an atlas with typed helpers for an NGNE game. Projects save locally as `.ngsprite` files;
the production build also supports offline use as an installable PWA.

## Requirements

- Desktop Chrome or Edge, current stable, with WebGPU and hardware acceleration enabled.
- A secure origin: HTTPS or localhost. Other browsers are unverified.
- A window of at least 1280 × 720 CSS pixels.
- Node.js ≥ 24 and npm for development, builds and tests.

## Install, build and test

From the repository root, on a clean checkout:

<!-- readme-commands:start -->

```sh
npm ci
npm run build
npm test
```

<!-- readme-commands:end -->

The CI job `readme-commands` extracts these three lines and runs each verbatim on a clean
Ubuntu runner with Node 24. `npm test` runs the Node unit suite, including the GUIDE example
comparison and the documentation link check.

## Run

After installing, `npm run dev` starts the development server; open the localhost URL it
prints. `npm run build` creates `dist/`, and `npm run preview` serves that production build
locally (including the service worker and manifest). Preview normally uses port 4173;
development normally uses 5173. Use separate ports to keep a production service worker from
serving a cached build to the development server; see the [PWA audit](docs/audit/pwa.md).

## Verification

`npm run check` runs typecheck, lint, formatting, unit tests and the production build.
The full E2E suite uses installed Chrome (`channel: "chrome"`). On Ubuntu, CI installs:

```sh
sudo apt-get update
sudo apt-get install -y libvulkan1 mesa-vulkan-drivers xvfb xauth
```

Run the complete suite as CI does, with `CI=1` and headed Chrome under xvfb (SwiftShader):

```sh
CI=1 E2E_HEADLESS=0 xvfb-run -a -s "-screen 0 4096x2304x24" npx playwright test
```

The CI `e2e` matrix splits that suite into five jobs, each with one worker: four runs of
the `parallel` project and one of `alone`. To reproduce the split sequentially on Ubuntu,
run `npm run check` first, then:

```sh
for i in 1 2 3 4; do
    CI=1 E2E_HEADLESS=0 xvfb-run -a -s "-screen 0 4096x2304x24" npx playwright test --project=parallel --no-deps --shard=$i/4
done
CI=1 E2E_HEADLESS=0 xvfb-run -a -s "-screen 0 4096x2304x24" npx playwright test --project=alone --no-deps
```

The separate `golden-path` job repeats the regression flow ten times. Frame and time budgets
are **reported, not asserted, under CI**; image content and other correctness checks remain
assertions. Budgets are enforced on reference hardware without `CI` ([SPEC §11](docs/SPEC.md#11-quality)).
Scripted performance measurements
are separate from `npm run check`; see the [benchmark instructions](tests/perf/README.md) and
[recorded results](docs/perf/README.md).

## Accessibility

The canvas is a pointer surface and is not operable by screen reader. Everything else is
keyboard and screen-reader operable: commands are available through menus or the command
palette, F6 / Shift+F6 cycle regions, and controls show keyboard focus. A document tab can be
closed with Delete while focused or Alt+W when active; its pointer close control is hidden
from assistive technology. The [accessibility audit](docs/audit/a11y.md) records the checks.

## Documentation and release

- [User guide](docs/GUIDE.md): authoring, import, reference images, export and NGNE integration.
- [File formats](docs/FORMAT.md): `.ngsprite` v1 and `ngne-sprite-atlas` v1, frozen from release
  1.0.0; any format change requires a new version number and a migration.
- [Specification](docs/SPEC.md): behaviour, architecture and limits.
- [Changelog](CHANGELOG.md): features and known limitations.

Releases: a `v*` tag runs the Pages workflow (`.github/workflows/deploy.yml`), which deploys the
site; branch pushes do not deploy. A release sets the version in `package.json` and
`package-lock.json`, the generator versions (`PROJECT_GENERATOR`, `src/core/project/format.ts`;
`ATLAS_GENERATOR`, `src/core/export/atlasFormat.ts`) and the changelog together, with
`npm run check` passing. Installing the app as a PWA is checked by hand: see the
[manual steps](docs/audit/pwa.md#manual-install-owner-to-do).

Licensed under [MIT](LICENSE). Code ported or adapted from Aseprite's MIT-licensed document
and render libraries, pixman, Allegro (through Aseprite's document library), Alois Zingl's
Bresenham algorithms, Björn Ottosson's Oklab, Tommy Ettinger's mulberry32, the Graphics Gems
seed fill and github-slugger (the documentation link check) is listed with its notices in
[third-party notices](THIRD_PARTY_NOTICES.md), as are the encoders that the bundled `gifenc`
credits (gif.js and gif-codec). The build writes `licences.txt` beside
`index.html`: this project's licence, those notices and the licence of every npm package the
build bundles. The app shows it in a dialog (View → Open Source Licences…). This project is not
affiliated with or endorsed by Aseprite or Igara Studio S.A.

Earlier versions of some files named parts of Aseprite's application source code, which is
distributed under Aseprite's End-User License Agreement, and described details confirmed by
reading it. Those names and details were removed on 2026-11-13, 2026-11-16 and 2026-11-17;
the Git history and tags `v1.0.0` to `v1.0.2` still contain them. The files concerned:
`docs/SPEC.md`, `docs/REVIEW.md` (no longer tracked; its history also names an application
data file as the source of the tool groups), `src/core/floating/floating.ts`,
`src/app/selection/transform/transform.commands.ts`, `src/app/selection/tools/wand.ts`,
`src/core/composite/blend.ts`, `tests/unit/fixtures/se-061-blend-golden.generate.mjs`,
`tests/unit/se-032-floating.test.ts`, `tests/unit/se-051-aseprite.test.ts` and
`src/core/raster/pixelPerfect.ts`, whose earlier version named a class of that source; it was
rewritten on 2026-11-17 from a description of its behaviour by a contributor who had not
seen the earlier file. `docs/PROVENANCE.md` records each file and date.
