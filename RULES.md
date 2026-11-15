# Rules

Binding for every contributor. Behaviour and architecture: [docs/SPEC.md](docs/SPEC.md).

## Code

1. Layer boundaries: `src/core` imports no DOM global, React or `@ngne/core`; only
   `src/engine` imports `@ngne/core`; `src/ui` changes documents only through registered
   commands ([docs/SPEC.md](docs/SPEC.md) §5).
2. Runtime dependencies are exactly those of [docs/SPEC.md](docs/SPEC.md) §4, pinned exactly.
   Anything else needs an owner decision.
3. A feature registers through its registry without editing shared files: commands and menus
   (`*.commands.ts`), dialogs (`*.dialog.tsx`), dock panels, overlay layers, tools.
4. Code taken from another project keeps its notice and a row in
   [docs/PROVENANCE.md](docs/PROVENANCE.md). Code under a copyleft licence, under a
   restrictive licence (proprietary, source-available, such as Aseprite's application code) or
   under no known licence is never copied, ported or translated: its program's behaviour is
   reproduced from manuals, file formats and observed use.

## Quality

5. Done = every acceptance item backed by a named test, and `npm run check` plus the E2E specs
   of the touched area pass. Never weaken, skip or delete a test to get there.
6. Performance numbers that decide anything come from the reference hardware of
   [docs/SPEC.md](docs/SPEC.md) §3. Software-rendered and CI numbers are report-only.
7. Code and docs agree: a change to documented behaviour, interface or file format updates
   those docs and adds a [CHANGELOG.md](CHANGELOG.md) entry in the same change.
