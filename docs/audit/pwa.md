# PWA audit (SE-072)

What makes the editor an installable app that works offline, what the automated tests prove,
and the one check that needs a person: installing it and seeing it open in a window of its own.

## What the build contains

- `vite build` (vite.config.ts) adds, through `vite-plugin-pwa` 2.0.0 (`injectManifest`):
  - `manifest.webmanifest`, linked from `index.html`: name "NGNE Sprite Editor", short name
    "NGNE Sprites", `display: standalone`, `id`/`start_url`/`scope` "./" (relative, so the app
    works at any Vite `base`), `theme_color` `--bg-panel` and `background_color`
    `--bg-workspace` of the default theme (read from `src/ui/styles/tokens.css`), icons 192 and
    512 px in "any" and "maskable" versions, a file handler for `.ngsprite`, and
    `launch_handler: focus-existing` (a file opened while the app runs opens in a tab of that
    window);
  - `sw.js`, compiled from `src/app/pwa/sw.ts`, with the list of every file of the build.
- The icons are drawn by `scripts/icons.ts` (`node scripts/icons.ts` writes `public/icons/`);
  a unit test fails when the committed files differ from its output.
- The dev server (`npm run dev`, which the E2E suite runs on) has no worker and no manifest.

## Service worker

- Install: every file of the build into one cache per deployment.
- Fetch: cache first for the shell (a navigation to the app's base) and for every file of the
  build; anything else goes to the network.
- A new deployment: its worker installs and waits; the page shows the toast "A new version of
  the editor is ready." with Reload. Reload makes the new worker take over and reloads the
  page; the browser asks first when a document has unsaved changes, which autosave has kept
  and the new page offers for recovery. Nothing changes without Reload. The page asks for a
  new deployment when it is shown again and every hour.

## What the E2E proves (Chrome, headed under xvfb with SwiftShader, as CI)

| Ticket acceptance | Test |
| --- | --- |
| `beforeinstallprompt` fires for the production build | `tests/e2e/se-072-install.spec.ts` › "the production build is installable: Chrome fires beforeinstallprompt" (Chrome with a profile of its own: an incognito profile is never offered an install; `Page.getInstallabilityErrors` is empty) |
| Manifest, icons, theme colours, file handler | `se-072-install.spec.ts` › "the manifest names the app, opens it standalone, has its icons and its file handler" |
| Development builds unchanged | `se-072-install.spec.ts` › "the dev server registers no service worker and links no manifest" |
| The SE-070 golden path with the network disabled after first load | `tests/e2e/se-072-offline.spec.ts` (the server stopped and the context offline once the worker controls the page) |
| A `.ngsprite` through the launch queue opens | `tests/e2e/se-072-launch.spec.ts` (stubbed `launchQueue`; Save then writes back through the launched handle) |
| A new deployment: update toast, activation after reload, autosave snapshot offered | `tests/e2e/se-072-update.spec.ts` |
| The golden path at base `/sub/path/` | `tests/e2e/se-072-base-path.spec.ts` |

The golden path reads the editor's stores through its development test hooks, so the offline
and base-path specs build the app with them (`vite build --mode development`,
`NODE_ENV=development`): bundled, served by `vite preview`, with the same service worker and
manifest as the production build. The other SE-072 specs use the production build itself.
Every spec builds on demand into a temporary folder; no `npm run build` is needed first.

## Manual install: owner to do

Not possible in the cloud container (no desktop to install into). Once, on Windows 11 with
Chrome (current stable):

1. `npm ci`, then `npm run build`, then `npx vite preview --host 127.0.0.1 --port 4173`.
2. Open `http://127.0.0.1:4173/` in Chrome. Wait until DevTools → Application → Service
   workers shows `sw.js` "activated and is running", and Application → Manifest shows no
   installability error.
3. Install: the install icon at the right of the address bar (or ⋮ → Cast, save and share →
   Install page as app…) → Install.
4. Expected: the editor opens in a window of its own, without tabs or address bar, its title
   bar in the panel colour, the app's "N" icon in the taskbar; Start menu lists "NGNE Sprite
   Editor".
5. Optional, file handling: right-click a `.ngsprite` file in Explorer → Open with → NGNE
   Sprite Editor (Chrome asks once to allow it). Expected: the document opens in a tab.
6. Optional, offline: stop the preview server, close and start the installed app again.
   Expected: it starts and works.
7. Record the date, the Chrome version and the result here, under "Manual install record".

## Manual install record

- Not yet done (owner).
