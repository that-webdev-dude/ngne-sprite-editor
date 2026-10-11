/**
 * Thrown when pixel memory for a command or a transaction cannot be allocated. The session
 * is as it was before the call (SPEC §5.2).
 */
export class AllocationError extends Error {
    override readonly name = "AllocationError";
    /** Size of the allocation that failed, in bytes. */
    readonly bytes: number;

    constructor(bytes: number, cause?: unknown) {
        super(
            `Could not allocate ${bytes} bytes of pixel memory.`,
            cause === undefined ? undefined : { cause },
        );
        this.bytes = bytes;
    }
}

/**
 * Thrown when a transaction cannot begin on its target, when a closed transaction is used,
 * and when the history is used while a transaction is open.
 */
export class TransactionError extends Error {
    override readonly name = "TransactionError";
}
