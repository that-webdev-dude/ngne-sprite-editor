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
  It does not remove one either: a worker that an earlier `vite preview` left on the same host
  and port (`npx vite preview --port 5173` after `npm run dev` on 5173, say) keeps serving the
  old build's cached shell, cache first, to the dev server's pages. Remove it in DevTools →
  Application → Service workers → Unregister, and Application → Storage → Clear site data, or
  use another port for `vite preview` (its default, 4173, differs from the dev server's).
  The E2E contexts start empty, so the tests are not affected.

## Service worker

- Install: every file of the build into one cache per deployment (a redirected response is
  rebuilt before it is kept, as Workbox does, since Chrome refuses one for a navigation).
- Fetch: cache first for the shell (a navigation to the app's base) and for every file of the
  build, from this deployment's cache, then the older ones. A file of the app's scope that is
  not in this build may be an older deployment's: it is looked for in the older caches before
  the network. Anything else goes to the network.
- Older caches stay while a window that was open when the new worker took over is still open
  (it runs the older files, and still asks for some, such as its web workers' scripts). They
  go when the new worker activates with no window open, or when a page it served starts and
  none of those windows is left. A unit test checks that every file `vite build` emits, except
  `sw.js`, is in the worker's list (`se-072-install.spec.ts`).
- A new deployment: its worker installs and waits; the page shows the toast "A new version of
  the editor is ready." with Reload. Reload makes the new worker take over and reloads the
  page; the browser asks first when a document has unsaved changes, which autosave has kept
  and the new page offers for recovery. Nothing changes without Reload. The page asks for a
  new deployment when it is shown again and every hour. When the browser's question is
  answered Stay, the page keeps running and Reload is offered again; nothing reloads the page
  without being asked.
- Launched files are queued and opened one after another, each once no other file operation
  runs; every project file of a launch opens in a tab, and one that cannot be read is reported
  by an error toast.

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

The native check is **waived for checkpoint E by the owner on 2026-10-21**, not passed.
The owner will perform it personally. Once, on Windows 11 with Chrome:

1. `npm ci`, then `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4173`.
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
7. Browser-reserved shortcuts (SPEC §13: its risk row names the PWA window as the remedy for
   keys the browser keeps): in the installed window, with a document open and the canvas
   focused, press Ctrl+N, Ctrl+W and Ctrl+T in turn. Record for each whether the browser acts
   on it (a new browser window, the app window closing, a new tab or window) or nothing
   happens, so the key reaches the editor. The editor binds Ctrl+Alt+N and Alt+W for New
   Sprite and Close today (SPEC §13), so a key that reaches it does nothing yet.
8. Record the date, the Chrome version and the results here, under "Manual install record".

## Manual install record

- 2026-10-21: **Waived, not performed.** Computer Use was not approved to use Google Chrome
  in this chat; no native install, standalone-window observation or shortcut result was
  obtained. The owner explicitly replied: "waive the native PWA check and tell me how to do
  it instead. I'll make it myself". Automated installability/offline evidence is separate
  from this manual check. See the [checkpoint record](checkpoint-e-2026-10-21.md).
- Owner's later manual result: date, Chrome version, standalone launch, Ctrl+N, Ctrl+W,
  Ctrl+T, and any optional file/offline observations to be recorded here.
