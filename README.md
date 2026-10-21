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
assertions. Budgets are enforced on reference hardware without `CI` ([SPEC §11](docs/SPEC.md#11-quality),
[REVIEW H15](docs/REVIEW.md#frame-budgets-in-ci-owner-decision)). Scripted performance measurements
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
- [Engine gap report](docs/engine-gaps.md): workarounds and possible NGNE improvements.

This branch is a release candidate. The owner must review and merge the PR and record written
release approval in [REVIEW.md](docs/REVIEW.md#run-5-decisions) before creating and pushing
`v1.0.0`. The tag triggers the Pages workflow; branch pushes do not deploy. The owner then
checks the Pages site and handles the open items recorded in REVIEW H25. Checkpoint E
remains pending.

Licensed under [MIT](LICENSE).
