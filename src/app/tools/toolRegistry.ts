// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { createToolRegistry, registerToolModules } from "@ngne/editor-ui/shell";
import type { ToolRegistry } from "@ngne/editor-ui/shell";
import type { ToolModule, ToolSpec } from "./types";

/**
 * The tool catalogue of the app (SE-014), built with the package's registry factory from the
 * same modules as the editor UI instance's `tools` (src/app/editorUi.ts), which is created
 * only after the command modules have loaded: `tools.commands.ts` derives a command from each
 * tool while it loads, and the active-tool store reads the tools from the start. It holds what
 * every module named `*.tools.ts` or `*.tools.tsx` under `src` exports as `tools` (and
 * `plannedTools`); the glob import finds those modules, so a feature adds a tool — its rail
 * button, key, options and behaviour — without an edit to a shared file:
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
export const toolRegistry: ToolRegistry<ToolSpec> = createToolRegistry<ToolSpec>();

const modules = import.meta.glob<ToolModule>("../../**/*.tools.{ts,tsx}", { eager: true });

/** The discovered tool modules, by their path from this file. */
export const toolModulePaths: readonly string[] = Object.keys(modules).sort();

registerToolModules(toolRegistry, modules);
