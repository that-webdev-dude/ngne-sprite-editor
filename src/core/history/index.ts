// Commands, transactions and the undo history of SPEC §5.2. A session changes only through
// its `History`: `execute(command)` for a command, `begin(target)` for a tool stroke.

export type { PixelAllocator } from "./allocate";
export { compositeCommand } from "./command";
export type { Command } from "./command";
export { AllocationError, TransactionError } from "./errors";
export { DEFAULT_HISTORY_BUDGET_BYTES, History } from "./history";
export type { HistoryChange, HistoryListener, HistoryOptions } from "./history";
export { pixelPatchCommand } from "./pixelPatch";
export type { PixelPatch } from "./pixelPatch";
export type { Transaction, TransactionOptions } from "./transaction";
