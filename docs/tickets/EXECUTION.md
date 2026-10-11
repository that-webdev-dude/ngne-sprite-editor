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
| W9   | 017M · 034M · 060M                                   | 3     |
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
merge two runs into one.

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
| D  | Run 3 | Hand test of timeline, selection, save/open, import, export and preview. Ticket index: every W10–W13 ticket Done or its unmet acceptance items listed |
| E  | Run 4 | SE-071 audit and SE-072 install record. The release tag and the deployment need written owner approval (SE-073 acceptance); the run stops before both |

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

Runs 1–4 (replace N):

```text
ultracode: execute run N of docs/tickets/EXECUTION.md. One agent per ticket, each in its own
worktree, following AGENTS.md and the orchestration, shared-module and measurement rules of
that file. Stop at the run's checkpoint and report per ticket: Done or the unmet acceptance
items.
```
