// What a call that can fail in an expected way answers: what it got, or
// why not. The templates declare the same two types globally
// (`source/globals.d.ts`); these are the package's own, exported, and the
// same shape, so TypeScript takes either for the other and an app never
// converts between them.

/**
 * A result: `ok` with its `data`, or not, with its `error`. `throw` stays
 * for the genuinely unexpected, so a caller holding one of these knows the
 * failure is one it's meant to handle.
 */
export type OperationResult<Data, Err> =
    | { ok: true; data: Data }
    | { ok: false; error: Err }

/** What an async call that can fail in an expected way answers */
export type AsyncOperationResult<Data, Err> = Promise<
    OperationResult<Data, Err>
>
