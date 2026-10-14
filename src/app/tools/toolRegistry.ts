// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { createToolRegistry, registerToolModules } from "./registry";
import type { ToolRegistry } from "./registry";
import type { ToolModule } from "./types";

/**
 * The tool registry of the app (SE-014). It holds what every module named `*.tools.ts` or
 * `*.tools.tsx` under `src` exports as `tools` (and `plannedTools`); the glob import finds
 * those modules, so a feature adds a tool — its rail button, key, options and behaviour —
 * without an edit to a shared file (AGENTS.md, Parallel work):
 *
 *     // src/app/tools/pencil/pencil.tools.ts
 *     export const tools: ToolSpec[] = [
 *         { id: "pencil", label: "Pencil", paints: true, options: [...], onDown, onMove },
 *     ];
 *
 * The id "pencil" takes the rail slot planned for it (`planned.tools.ts`), with its key and
 * icon. `tools.commands.ts` binds every registered tool's key and hold key. A tool module is
 * evaluated while this one loads: it may import the types, but must not use the registry
 * before a stroke.
 */
export const toolRegistry: ToolRegistry = createToolRegistry();

const modules = import.meta.glob<ToolModule>("../../**/*.tools.{ts,tsx}", { eager: true });

/** The discovered tool modules, by their path from this file. */
export const toolModulePaths: readonly string[] = Object.keys(modules).sort();

registerToolModules(toolRegistry, modules);
