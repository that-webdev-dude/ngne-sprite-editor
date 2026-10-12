# NGNE repository instructions

## Documents

| File                          | Role                                             |
| ----------------------------- | ------------------------------------------------ |
| `docs/SPEC.md`                | Behaviour, architecture, formats                 |
| `docs/DESIGN.md`              | Interface; governs over `docs/design/mockup.html` |
| `docs/tickets/README.md`      | Ticket index, gates, start conditions            |
| `docs/tickets/M*.md`          | Tickets: scope and acceptance                    |
| `docs/tickets/EXECUTION.md`   | Wave order and rules for parallel agents         |
| `docs/REVIEW.md`              | Review record and owner acknowledgements         |

## Working on a ticket

- Read the ticket, every SPEC and DESIGN section it lists, and the definition of done in
  SPEC §11 before writing code.
- Start only when every "Depends on" ticket is Done and the "Blocked until" condition holds.
- Implement the ticket's scope and nothing else. "Out of scope" lines are binding.
- If the ticket and the SPEC disagree, or an acceptance item cannot be met, stop and report it.
  Do not choose one, and do not change the documents to fit the code.
- Edit `docs/SPEC.md`, `docs/DESIGN.md`, `docs/REVIEW.md` or the ticket files only where the
  ticket's scope or acceptance names that edit (for example SE-002, SE-007, SE-017, SE-053).
- Runtime dependencies are exactly those of SPEC §4. `package.json` changes only in SE-001,
  SE-063 and SE-072; a ticket that needs anything else stops and reports.
- Layer boundaries (SPEC §5): `src/core` imports no DOM global, React or `@ngne/core`; only
  `src/engine` imports `@ngne/core`; `src/ui` changes documents only through registered
  commands.
- Done means every acceptance item is backed by a named test or a recorded measurement, and
  `npm run check` plus the ticket's E2E files pass. Never weaken, skip or delete a test to get
  there.
- One exception: an earlier ticket's assertion about a placeholder (a region that is still
  empty, placeholder text) may be updated by the ticket whose scope fills that placeholder.
  Change only that assertion, keep it as strict as before, and list the before and after
  lines in the report.

## Parallel work

Several agents may work at once, each on one ticket in its own worktree and branch `se-0xx`.

- Change only the modules the ticket names, new files for the ticket's feature, and the
  ticket's tests (`se-0xx-*.test.ts`, `se-0xx-*.spec.ts`).
- Registries take a feature without an edit to a shared file. This applies to the command,
  keymap and menu registry (SE-007), dock panels (SE-006), overlay draw layers (SE-013) and
  tools (SE-014): each feature registers from its own module and the registry discovers it.
  Those four tickets build their registry that way; later tickets only add a module.
- Do not record timing results on reference hardware; the orchestrator does that alone after
  the wave is merged (EXECUTION.md, Measurements). Write the benchmark and leave the number
  out.
- Do not change a ticket's Status and do not merge; the orchestrator does both.
- E2E runs use the port given by the environment.

## Report at the end of a ticket

- Files added and changed.
- Each acceptance item: met (test name or measurement file) or not met (reason).
- Anything implemented differently from the ticket or the SPEC, and why.
- Measurements left for the orchestrator.

## Git commits

- Prefer one-line commit messages without co-authors.
- One commit per ticket, starting with its ID: `SE-015 Pencil and eraser`.
