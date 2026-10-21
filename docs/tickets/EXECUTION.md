# Parallel execution plan

How to implement the tickets of [README.md](README.md) with several agents at once (Claude Code
dynamic workflows, "ultracode"). It adds no requirement to the product; it only orders the work
and prevents agents from colliding. Agent rules live in [AGENTS.md](../../AGENTS.md).

## Waves

Computed from the ticket index: a ticket's wave is one more than the latest wave among its
dependencies and the tickets that set its gates (G0 ← SE-002, G1 ← SE-017, G2 ← SE-053).
Tickets in one wave have no dependency on each other. Letters are sizes.

| Wave | Tickets                                              | Count |
| ---- | ---------------------------------------------------- | ----- |
| W0   | 001L                                                 | 1     |
| W1   | 002L · 003M · 005M · 006L                            | 4     |
| W2   | 004L · 010M · 043L                                   | 3     |
| W3   | 007L · 020M · 021L · 040M · 050M                     | 5     |
| W4   | 008M · 011L · 051L · 064M                            | 4     |
| W5   | 012M · 053L                                          | 2     |
| W6   | 013M                                                 | 1     |
| W7   | 014L                                                 | 1     |
| W8   | 015L · 016M · 030M                                   | 3     |
| W9   | 017M · 034L · 060M                                   | 3     |
| W10  | 022L · 031M · 041L · 054L · 062M · 065M · 066M       | 7     |
| W11  | 023M · 032L · 042M · 045L · 047M · 052L · 061M       | 7     |
| W12  | 024M · 026M · 033M · 044L · 046M · 063M              | 6     |
| W13  | 025M                                                 | 1     |
| W14  | 070L                                                 | 1     |
| W15  | 071M · 072M                                          | 2     |
| W16  | 073M                                                 | 1     |

W5–W9 is the M1 chain (`011 → 012 → 013 → 014 → 015 → 017`): it cannot be parallelized, so
more agents do not shorten it.

## Runs

One run is one workflow session. Runs end where a person has to look at something. Do not
merge two runs into one. A run that does not fit one usage window is carried out in legs
([Legs](#legs)).

| Run | Waves   | Tickets                                                        | Agents | Ends at |
| --- | ------- | -------------------------------------------------------------- | ------ | ------- |
| 0   | W0      | 001                                                            | 1      | Checkpoint A |
| 1   | W1–W4   | 002 003 005 006 · 004 010 043 · 007 020 021 040 050 · 008 051 064 | 15  | Checkpoint B (G0) |
| 2   | W4–W9   | 011 · 012 053 · 013 · 014 · 015 016 030 · 017 034 060          | 11     | Checkpoint C (G1, G2) |
| 3   | W10–W13 | every ticket of W10–W13                                        | 21     | Checkpoint D |
| 4   | W14–W16 | 070 · 071 072 · 073                                            | 4      | Checkpoint E (G3) |

- Run 0 needs no workflow: one ticket, one normal session.
- Runs 1 and 3 exceed the default workflow size guideline (small on Pro, under 10 agents on
  medium). Either raise "Dynamic workflow size" for those runs or start them one wave at a time.
- SE-011 is in W4 but is gated by G0, so it opens run 2.

## Checkpoints

| ID | After | What the owner checks before the next run                                         |
| -- | ----- | --------------------------------------------------------------------------------- |
| A  | Run 0 | `npm ci && npm run check && npm run test:e2e` pass locally; the commit is pushed and CI is green on GitHub (A8). Pushing is the owner's action |
| B  | Run 1 | `docs/spikes/SE-002-ngne-integration.md`: every question has numbers from both GPUs; G0 state in README; any SPEC §6/§9 amendment and its REVIEW.md record |
| C  | Run 2 | Draw by hand in the dev build (pencil, eraser, shapes, undo). Stroke latency record in `docs/perf/`; G1 and G2 states in README |
| D  | Run 3 | Hand test of timeline, selection, save/open, import, export and preview. Every chord of SPEC §7.8 pressed by hand in Chrome, "Alt (hold)" and F6 first: the SE-007 E2E cannot see a chord the browser keeps for itself; a chord that does not arrive gets an alternate in SPEC §7.8. Ticket index: every W10–W13 ticket Done or its unmet acceptance items listed |
| E  | Run 4 | SE-071 audit and SE-072 install record. The release tag and the deployment need written owner approval (SE-073 acceptance); the run stops before both |

Checkpoint E: **Passed 2026-10-21 under delegated owner authority**, with the accepted
RTX cel-opacity performance exception and the owner's explicit native PWA check waiver.
The audit, measurements, decisions and evidence are in the
[checkpoint record](../audit/checkpoint-e-2026-10-21.md) and REVIEW J12–J20. This closes the
historical run-4 owner queue below. Merging, tagging and deployment remain the owner's actions.

## Orchestration

- One worktree and one branch `se-0xx` per ticket, created from `main` after the previous wave
  is merged. `npm ci` in each worktree.
- An implementing agent finishes with `npm run check` and its own E2E files passing, then
  reports (format in AGENTS.md). It does not merge.
- The orchestrator merges a wave's branches into `main` one at a time in ticket order, running
  `npm run check` after each merge. After the last merge of a wave it runs `npm run check` and
  the full `npm run test:e2e` once; the next wave starts only when both pass.
- A ticket whose acceptance is not met is not merged. Its dependants are held back; unrelated
  tickets of later waves continue. The orchestrator never edits a test to make a wave pass.
- After merging, the orchestrator sets the ticket's Status to Done in the README index and in
  the ticket file. Implementing agents do not touch Status.
- One reviewing agent per wave (not per ticket) reads the merged diff against each ticket's
  acceptance list and reports unmet items. It is read-only.

## Shared modules

Tickets of one wave that edit the same module are not started together: the later one in the
order below starts after the earlier one is merged. Everything else in the wave runs at once.

| Module                                   | Wave | Order within the wave |
| ---------------------------------------- | ---- | --------------------- |
| `core` commands (layer vs frame/cel/tag) | W3   | 020 and 021 together; each owns its own files, no shared index edit |
| Tool rail variants, `core/raster`, stroke path | W10 | 031 → 065 → 062 |
| Timeline panel and layer properties popover | W11 | 023 → 045 → 061 |
| Timeline panel                           | W12  | 024 → 026             |
| Move tool and overlay handles            | W12  | 033 → 046             |
| `docs/FORMAT.md`                         | W3, W4 | 040 creates it; 051 appends in the next wave |

`engine/NgneViewport` is edited by one ticket per wave (062 in W10, 045 in W11, 024 in W12,
025 in W13), so it needs no order. With the orders above the largest number of agents working
at once is 5 (W3, W10, W11).

## Measurements

Timing results are wrong when other agents load the CPU or GPU. Every acceptance item that
records a number on reference hardware is run by the orchestrator, alone, after the wave is
merged and all other agents of the wave have finished:

| Ticket | Measurement                                                     |
| ------ | --------------------------------------------------------------- |
| SE-002 | Every question on both GPUs (the agent writes the pages and does the SwiftShader runs) |
| SE-010 | Dirty-rectangle benchmark                                       |
| SE-015 | Stroke latency budget (decides the echo fallback)               |
| SE-017 | Flood-fill timing                                               |
| SE-024 | Playback from `ed:play` without skipped frames                  |
| SE-026 | Scroll frame rate at 200 × 30                                   |
| SE-031 | Magic-wand timing                                               |
| SE-042 | Autosave long-task check                                        |
| SE-043 | Import timing (2048² to 16 colours at 64²)                      |
| SE-044 | Preview update time for a 1024² source                          |
| SE-070 | Every SPEC §6.6 budget                                          |

SE-015 is the exception to "the agent leaves the number out": its echo fallback depends on
the result, so the orchestrator runs that ticket's agent alone in W8 before 016 and 030 start.

Reference hardware is this development machine (Intel UHD and RTX 4060 Laptop GPU, Chrome
installed, Node 24). The GPU under test is selected as described in SE-002's method notes and
recorded from the adapter info.

## Additions to SE-001 for parallel work

Three items the ticket does not state. They change no product behaviour.

- The Playwright web server takes its port from the environment or picks a free one, so E2E
  runs in several worktrees do not collide.
- Every development tool named in SPEC §4 is installed in this ticket (including the
  property-testing library and axe), so later tickets do not edit `package.json`. Exceptions
  stay as ticketed: `gifenc` in SE-063, the PWA plugin in SE-072.
- Test files are named after their ticket (`se-0xx-*.test.ts`, `se-0xx-*.spec.ts`).

## Prompts

Start each run in a clean working tree on `main`.

Run 0 (normal session):

```text
Implement SE-001 from docs/tickets/M0-foundation.md, including the three additions in
docs/tickets/EXECUTION.md. Follow AGENTS.md. Do not push; stop at checkpoint A.
```

Run 1 (one session). Runs 2 to 4 do not fit one usage window: they are carried out in legs,
each started with the leg prompt of [Legs](#legs).

```text
ultracode: execute run 1 of docs/tickets/EXECUTION.md. One agent per ticket, each in its own
worktree, following AGENTS.md and the orchestration, shared-module and measurement rules of
that file. Stop at the run's checkpoint and report per ticket: Done or the unmet acceptance
items.
```

## Legs

A run that does not fit one 5-hour usage window is carried out in legs. A leg is one session:
it takes as many tickets to Done as the usage gate allows and stops at a ticket boundary.
Run 2 was carried out this way (owner decision of 2026-10-13) in 5 legs; run 3 is carried out
the same way. Measured in run 2, each ticket with its review and fixes: an M ticket about 18%
of a window, an L ticket about 25–35%. Run 3's 21 tickets take about 8 to 10 legs, so the
weekly limit, not the 5-hour one, is likely to end some legs.

Each leg:

1. Wait for a fresh window: start right after a 5-hour reset, with the machine cool.
2. Open a new session in the project folder and send the leg prompt below. It is the same for
   every leg.
3. The leg stops by itself and ends with a warning that states the usage and the reset time.
4. Read the report, then push: `git push origin main`.
5. Wait for the reset named in the warning, then repeat from step 2.

Rules of a leg, beside those of Orchestration:

- Unit of work: one ticket taken to Done (implement, merge, check, review, fix).
- Usage gate, read before each start: one ticket only at or below 55% of the 5-hour limit, two
  in parallel only at or below 40%, a review or a review fix only at or below 80%, nothing new
  above 90% of the weekly limit.
- A ticket is set to In progress when its agent starts, so the next leg knows what to resume.
- A ticket starts when its dependencies are Done; it need not wait for the rest of its wave.
  Two tickets that share a module ([Shared modules](#shared-modules)) never run together.
- One read-only review per ticket before Done, in place of one per wave: a leg merges one or
  two tickets at a time.
- Before a ticket is Done the orchestrator runs `npm run check` and the full E2E suite with
  `CI=1 E2E_WORKERS=4` (SwiftShader, headless; four workers, then the `@alone` tests one at a
  time) in the main checkout. GitHub CI keeps one worker per job and splits the suite into
  four shards and an `@alone` job (`.github/workflows/ci.yml`).
- Measurements ([Measurements](#measurements)) are taken by the orchestrator alone, after the
  ticket is merged and with no agent running.
- At most two agents at a time.
- Nothing is scheduled. The owner starts every leg.

The stop report holds: the tickets Done in the leg; any ticket In progress and its exact
state; the warning with the 5-hour and weekly usage and the reset time in local time; the
commits waiting for the push.

| Situation                      | What to do                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------- |
| The limit is hit in mid-ticket | Nothing is lost. Keep `.claude/worktrees`; the next leg resumes that ticket first |
| The machine runs hot           | Say "pause". Later, send the leg prompt again                                     |
| CI is red after the push       | Start the next leg as usual; it fixes CI before anything else                     |
| The push was forgotten         | The next leg continues from local `main` and says so                              |
| Weekly limit above 90%         | The leg starts no ticket and names the weekly reset                               |

Leg prompt for run 3 (run 2's, with its own tickets, decisions and checkpoint, is in the git
history of this file):

```text
ultracode: continue run 3 of docs/tickets/EXECUTION.md (every ticket of W10–W13: SE-022,
SE-031, SE-041, SE-054, SE-062, SE-065, SE-066, SE-023, SE-032, SE-042, SE-045, SE-047,
SE-052, SE-061, SE-024, SE-026, SE-033, SE-044, SE-046, SE-063, SE-025) from the state of
the ticket index.

Autonomy and hard limits: as recorded in docs/REVIEW.md, "Run 1 decisions (W2–W4)" and
"Run 2 decisions", and in your memory notes for this project. Decide instead of "stop and
report"; never push; no package.json change except SE-063's, as its ticket states; never
weaken a test; never record a number that was not measured. Record decisions in
docs/REVIEW.md under "Run 3 decisions", one subsection per leg. At most two agents at a time.

Start: read the ticket index, git worktree list and the se-0xx branches. I push after each
leg: confirm main equals origin/main and that CI for the HEAD is green. If CI is red, fix
the cause first; if main is ahead, continue from local main and say so. Resume any ticket
marked In progress before starting a new one. Start a ticket only when its dependencies are
Done, and never run together two tickets that share a module (EXECUTION.md, Shared modules:
031 → 065 → 062, 023 → 045 → 061, 024 → 026, 033 → 046).

Usage gate: read the plan usage before each start.
- Start one ticket only if the 5-hour limit is at or below 55% used; two in parallel only
  at or below 40%.
- Start a review or a review fix only at or below 80%.
- Start nothing new if the weekly limit is above 90%.
Set a ticket to In progress when its agent starts. One read-only review per ticket before
Done. The orchestrator takes the measurements of SE-024, SE-026, SE-031, SE-042 and SE-044
alone, after the ticket is merged and with no agent running.

Stop when the gate refuses the next start, or at checkpoint D. Do not schedule anything.
On stop: main clean, no process left running, worktrees of Done tickets removed. Report:
tickets Done in this leg; any ticket In progress and its exact state; a warning with the
5-hour and weekly percent used and the reset time in local time; the commits waiting for
my push.
```

Run 4 is not carried out in legs: it is one unattended cloud session ([Run 4 in the cloud](#run-4-in-the-cloud)).

## Run 4 in the cloud

Owner decision of 2026-10-20: run 4 (SE-070 → SE-071 ∥ SE-072 → SE-073) runs as one overnight
cloud session, bounded by credit (£224 left) instead of the 5-hour usage gate. Differences from
the local legs, all reflected in the prompt:

- Linux container, headed Chrome under xvfb with SwiftShader, as GitHub CI: Windows-only
  behaviour does not apply, and no Intel UHD or RTX 4060 exists. SE-070's acceptance "every
  budget recorded on reference hardware" cannot be met there; the cloud records are labelled
  `cloud-swiftshader` and the reference-hardware measurement stays with the owner.
- The session may push **only** the branch `run-4`, never `main`. The owner reviews the branch,
  runs the reference-hardware measurements and merges.
- No memory notes exist in the container: the lessons of runs 1–3 are inside the prompt.
- No tag, no deployment, no change of a gate state to Passed that needs the owner (G3, E).

Start the cloud session on `main` at its current HEAD (pushed, CI state known), with a
network policy that allows npm, GitHub and the Playwright browser download.

```text
ultracode: execute run 4 of docs/tickets/EXECUTION.md (SE-070, SE-071, SE-072, SE-073) as one
unattended session in a Linux cloud container. Nobody answers questions tonight: where AGENTS.md
says "stop and report", decide, record the decision, continue (autonomy as in docs/REVIEW.md
"Run 1 decisions (W2–W4)", "Run 2 decisions", "Run 3 decisions"). Ask only if you cannot go on.

## Hard limits
- Branch: create `run-4` from `main`. Push only `run-4` (`git push -u origin run-4`), after
  every ticket's merge and at the end. Never push, merge into or rewrite `main`. No pull request.
- No release tag, no deployment, no workflow run that deploys (SE-073: written owner approval
  needed). Do not set gate G3 or checkpoint E to Passed; do not edit "Descoped tickets".
- package.json: only SE-072 (PWA plugin) and SE-073 (version 1.0.0, as that ticket states;
  record it as a decision). Nothing else; never weaken, skip or delete a test; never record a
  number that was not measured; never present a SwiftShader number as reference hardware.
- Models: Opus for every agent (`model: "opus"`), never Fable. At most two agents at a time.
- Credit guard: £224 in total for the whole night. One implementing agent
  per ticket, one read-only review per ticket, one fix round (a second only for a CONFIRMED
  correctness bug), at most 3 CI-fix pushes in total. If a usage or spend tool is available,
  read it before each start: start nothing new above £150 spent, and below £30 left stop and
  report. If none is available, stop after SE-072 is Done unless SE-073 is clearly cheap.

## Setup (once)
npm ci; `npx playwright install --with-deps chromium`; `sudo apt-get install -y libvulkan1
mesa-vulkan-drivers xvfb xauth` if missing. E2E exactly as .github/workflows/ci.yml:
`E2E_HEADLESS=0 xvfb-run -a -s "-screen 0 4096x2304x24" npx playwright test <args>`, with
`CI=1`. Locally in the container the Done gate is the full suite in the CI split (four
`--project=parallel --no-deps --shard=i/4` runs, then `--project=alone --no-deps`), one worker
each, run sequentially; run `npm run check` BEFORE the E2E runs (a throttled machine times out
unit tests). If `gh` is authenticated, read CI of the pushed `run-4` with `gh run list --branch
run-4` and fix red runs before the next ticket; otherwise say CI was not readable.

## Order
1. Read: this file, docs/tickets/README.md (index, gates), docs/tickets/M7-hardening-and-
   release.md, SPEC §6.6, §11, docs/REVIEW.md "Run 3 decisions", docs/perf/README.md. Confirm
   every ticket SE-001..SE-066 other than M7 is Done; if one is not, record it and continue
   only with what its absence does not block.
2. SE-070 alone (L). Set In progress when its agent starts. Golden path 10 consecutive runs;
   soak; baselines; the `tests/perf/` page for every §6.6 scenario. Take the measurements
   yourself, alone, no agent running, into `docs/perf/` as `se-070-*-cloud-swiftshader.*`;
   SPEC §6.6 "reference hardware" items stay open: list them in REVIEW.md for the owner. File
   an issue-style entry (REVIEW.md) for any budget missed on SwiftShader, marked "not reference".
3. SE-071 and SE-072 in parallel after SE-070 is Done (disjoint files; SE-072 owns
   vite.config.ts, the service worker, manifest, main entry; SE-071 must not edit them: its
   findings there go to REVIEW.md). SE-072's manual-install record in docs/audit/pwa.md cannot
   be done in a container: write what the E2E proves and mark the manual install "owner to do".
4. SE-073 after both are Done, to the point of the release candidate: README, GUIDE, FORMAT
   frozen, version 1.0.0, changelog, CI jobs (README commands verbatim, link check), engine gap
   report, deploy workflow written but NOT triggered and with no tag. Acceptance items that
   need the owner (tag, deployment, written approval, G3) are listed as open.
5. Stop: checkpoint E.

## Per ticket
Merge by rebase onto `run-4` + fast-forward, one commit per ticket (`SE-070 ...`), then a
"Mark SE-0xx Done" commit. Before Done: `npm run check`, then the full E2E in the CI split.
One read-only review (told not to run E2E or check) against the ticket's acceptance list,
then one fix round by a fresh agent briefed on the diff, then one more full run if the fix
touches shared startup or layout code. Record decisions in docs/REVIEW.md under "Run 4
decisions", one subsection per ticket (finding table as in "Run 3 decisions").

## Brief every implementing and fixing agent with
- Worktree under .claude/worktrees; branch `se-0xx`; worktrees start at origin/main, so
  `git merge --ff-only run-4` first. `npm ci` in it. Own files + the ticket's tests only.
- Radix: E2E waits for its deferred work (focus after open, between arrow keys, before an
  outside click, radios check only while the key is down). Grep E2E for `press` +
  `toBeHidden/toBeVisible` + another key with no focus wait.
- A test that counts animation frames is tagged `@alone`, waits for each submitted frame
  before causing the next, and is checked with a 3× CDP CPU throttle (the 60 Hz runner).
  A test that resizes then maps pointer positions waits for two equal size reads first.
- Linux Chrome sends `contextmenu` at the press; branch on `process.platform` for any
  right-press-then-move step. Local Windows runs do not exist in this session.
- Assert what the ticket owns; derive lists (palette, menus, registry ids) from the registry;
  leave later tickets their part. A test reading a registry-sized list breaks when a command
  is added. When filling a placeholder, grep `tests/` for the old text and update every hit.
- Benchmarks: report only through tests/perf/record.ts; check `framesSubmitted` is plausible
  and the harness does no per-pixel work of its own before believing a number; clip overlay
  geometry to the canvas.
- A review that wants a test to assert less is refused unless the old assertion pinned a
  placeholder (AGENTS.md exception).
- Kill the agent's leftover vite/playwright/chrome processes after every stop; check for them
  before any full run or measurement. Never merge while a full run serves the checkout.

## Stop report (REVIEW.md "Run 4 decisions" end + final message)
Tickets Done; any ticket In progress and its exact state; every acceptance item not met or
only met on SwiftShader (with the reference-hardware measurement the owner must take); decisions
made in the owner's place; CI state of the pushed `run-4` (or "not readable"); credit used if
known; the exact commands for the owner: review `git log main..run-4`, merge, push, then
measure on reference hardware. State plainly that nothing was tagged, deployed or merged.
```

After the run: the owner reviews `run-4`, takes the reference-hardware measurements of SE-070
into `docs/perf/`, does the manual PWA install, and decides G3 and checkpoint E before the tag.
