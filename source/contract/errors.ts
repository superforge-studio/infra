import { z } from "zod"

// How Infra says no. Every refusal is JSON in one shape, the same as a
// Superforge template's own API answers, `{ error: { reason, message, … } }`,
// so an app passes Infra's `error` on as its own result's, unchanged:
//
// - `reason`: for code to branch on, one of `INFRA_ERRORS`, which never
//   changes once a call answers it
// - `message`: what went wrong and what fixes it, in plain words, for whoever
//   runs the app and their agent; never parsed, and reworded any time
// - `issues`: for `invalid`, what didn't fit, field by field
// - anything else a call says it adds, like a 429's `retry_after`
//
// The OAuth calls Claude makes are the one exception: they answer OAuth's
// own `{ error, error_description }` (RFC 6749 5.2), which Claude reads.

/** Every reason Infra refuses a call with, and what it means */
export const INFRA_ERRORS = {
    "no-key":
        "The call came without a key Infra can read: none, or not a key's shape",
    "unknown-key": "No project has this key",
    "revoked-key":
        "The key was revoked: whatever sends it still has the old one",
    invalid:
        "The call's body, query or path isn't what it takes; `issues` says what",
    "too-large": "The call's body is over its limit; `limit` is how many bytes",
    "not-found": "No such call, or nothing at the address it names",
    unexpected: "Infra broke answering it: a bug on Superforge's side",
    "rate-limited":
        "Too many login messages for now; `limit` says which and `retry_after` when",
    "not-sent":
        "The login message didn't go out; asking again can work at once",
    "wrong-code": "Not the code; `attempts_left` says how many tries are left",
    "no-code": "No code is waiting: never sent, expired, used, or out of tries",
    "no-link": "The link is spent, expired, or never was this project's",
    "not-asked": "Claude didn't ask for any of the scopes allowed",
    "unknown-client":
        "Who's asking to connect isn't Claude, by its return address",
    "unknown-origin": "The app's origin isn't one its key may log Claude in at"
} as const

/** A reason Infra refuses a call with */
export type InfraErrorReason = keyof typeof INFRA_ERRORS

/** What didn't fit, for `invalid`: a dotted path, and why */
export const infra_issue = z.object({ path: z.string(), message: z.string() })
export type InfraIssue = z.infer<typeof infra_issue>

/** Any refusal of Infra's, read for its reason and its words */
export const infra_failure = z.object({
    error: z.looseObject({ reason: z.string(), message: z.string() })
})

/**
 * One kind of refusal, as a call answers it: its `reason`, its `message`,
 * and the fields it adds, read as the `error` alone
 */
export function refusal<
    Reason extends InfraErrorReason,
    Details extends z.ZodRawShape = Record<never, never>
>(reason: Reason, details?: Details) {
    return z
        .object({
            error: z.object({
                reason: z.literal(reason),
                message: z.string(),
                ...details
            })
        })
        .transform((body) => body.error)
}

/** `invalid`, with what didn't fit */
export const invalid_refusal = refusal("invalid", {
    issues: z.array(infra_issue)
})

/** `too-large`, with the most bytes the call takes */
export const too_large_refusal = refusal("too-large", { limit: z.number() })

/** `not-found` */
export const not_found_refusal = refusal("not-found")
