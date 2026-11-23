import { z } from "zod"

// What Infra answers, parsed by the client (client.ts) so an app gets typed
// values, each refusal read into an app's own shape: its `error` as
// `reason`. Every refusal carries Infra's `message`, what went wrong and
// what fixes it in plain words, for whoever runs the app and their agent
// (Infra's README, "Errors"), or the client's own words when an Infra from
// before it said one answers. The types in infra.ts come from these, and
// the stand-in answers the same.

// Infra's words for a refusal, or these when it gave none
const said = (fallback: string) => z.string().catch(fallback)

/**
 * Which project the key is for, its mode, and its domains, the only hosts
 * besides localhost its login emails link to. An Infra from before it
 * answered the domains answers none here, `null`, which an app shows as
 * not known.
 */
export const infra_project = z.object({
    project: z.object({
        id: z.string(),
        name: z.string(),
        domains: z.array(z.string()).nullable().default(null)
    }),
    mode: z.enum(["live", "test"])
})

/** A login email that went out. */
export const started_login = z.object({
    // The address as Infra keeps it, which verifying the code takes
    email: z.string(),
    // Whether the email holds a link as well as the code
    with_link: z.boolean(),
    // When the code and the link stop working
    expires_at: z.iso.datetime().transform((value) => new Date(value)),
    // With a test key, which sends nothing: what the email would have held,
    // for a dev server to show on the page. Null with a secret key.
    test: z.object({ code: z.string(), link: z.string().nullable() }).nullable()
})

/** Why Infra didn't send a login email. */
export const start_refused = z.union([
    // This address was sent one less than a minute ago
    z
        .object({
            error: z.literal("too-soon"),
            retry_after: z.number(),
            message: said(
                "A login email went to this address less than a minute ago."
            )
        })
        .transform(({ retry_after, message }) => ({
            reason: "too-soon" as const,
            retry_after,
            message
        })),
    // Over one of Infra's limits, an hour each: `email`, `ip` or `project`.
    // Kept as a string, so a limit Infra adds later still reads.
    z
        .object({
            error: z.literal("too-many"),
            limit: z.string(),
            retry_after: z.number(),
            message: said(
                "Infra has sent as many login emails as it sends in an hour."
            )
        })
        .transform(({ limit, retry_after, message }) => ({
            reason: "too-many" as const,
            limit,
            retry_after,
            message
        })),
    // The email didn't go out, and nothing was counted, so asking again can
    // work at once
    z
        .object({
            error: z.literal("not-sent"),
            message: said("The login email didn't go out.")
        })
        .transform(({ message }) => ({ reason: "not-sent" as const, message }))
])

/** Whose email the code or the link was. */
export const verified_login = z.object({ email: z.string() })

/** Why what the visitor brought back didn't log them in. */
export const verify_refused = z.union([
    // Not the code, which still works for this many more tries
    z
        .object({
            error: z.literal("wrong-code"),
            attempts_left: z.number(),
            message: said("That isn't the code Infra emailed this address.")
        })
        .transform(({ attempts_left, message }) => ({
            reason: "wrong-code" as const,
            attempts_left,
            message
        })),
    // Nothing left to try: never sent, expired, already used, or out of
    // tries
    z
        .object({
            error: z.literal("no-code"),
            message: said("No code is waiting for this address.")
        })
        .transform(({ message }) => ({ reason: "no-code" as const, message })),
    // The link is spent, expired, or never was this project's
    z
        .object({
            error: z.literal("no-link"),
            message: said("That link has been used or has run out.")
        })
        .transform(({ message }) => ({ reason: "no-link" as const, message }))
])

/** A comment Infra kept: its ID, and when. */
export const kept_comment = z
    .object({
        comment: z.object({
            id: z.string(),
            created_at: z.iso.datetime().transform((value) => new Date(value))
        })
    })
    .transform(({ comment }) => comment)

/**
 * Why Infra didn't keep a comment. Either is a bug in what the app sent,
 * so sending it again won't help.
 */
export const comment_refused = z.union([
    // Not the call's shape: `fields` names what failed, like `element.tag`
    z
        .object({
            error: z.literal("invalid"),
            fields: z.array(z.string()),
            message: said("The comment didn't fit what Infra takes.")
        })
        .transform(({ fields, message }) => ({
            reason: "invalid" as const,
            fields,
            message
        })),
    // Over the most a call's body can be, in bytes
    z
        .object({
            error: z.literal("too-large"),
            limit: z.number(),
            message: said("The comment is bigger than Infra takes.")
        })
        .transform(({ limit, message }) => ({
            reason: "too-large" as const,
            limit,
            message
        }))
])

/**
 * Any refusal of Infra's, read only for its words: what the client logs,
 * and what it tells an app about an error it doesn't know
 */
export const any_refusal = z.object({
    error: z.string(),
    message: z.string().optional()
})
