// Ids of the reference layer commands (SE-045). The interface takes them from here, so it never
// loads a `*.commands.ts` module before the registry does (appCommands.ts).

export const REFERENCE_COMMANDS = {
    newReference: "layer.newReference",
    resetFit: "layer.resetReferenceFit",
    placement: "layer.referencePlacement",
} as const;
