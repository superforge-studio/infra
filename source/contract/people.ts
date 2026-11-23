import { z } from "zod"

/**
 * The app's own ID for one of its people: what Infra names them by, on a
 * comment and on Claude's connections, and what Claude's tokens act as
 * (`sub`). It never changes and is never given to someone else, so it's
 * never an email, a phone number or a nickname, which all can. Infra keeps
 * it as an opaque string; the templates send their users' row IDs.
 */
export const user_id = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((id) => !id.includes("@"), {
        message: "An ID that never changes, never an email"
    })
