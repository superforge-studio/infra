import { z } from "zod"

// What an app's server sends Infra for its toolbar, through `fileComment`
// (infra.ts): a comment someone logged in wrote about an element of a page,
// which the toolbar posted to the app's own /api/comments, with who they
// are. It's what Infra checks (Infra's README, "Comments"), and the
// stand-in checks it the same (stand-in.ts). An app's toolbar checks the
// comment itself with its own schema first, for its form to say what's
// wrong at once.

/** The most a comment says, in characters, as Infra takes it */
export const LONGEST_COMMENT = 5000

/** How big one comment's body can be, in bytes, as Infra takes it */
export const COMMENT_BODY_LIMIT = 32 * 1024

// A place or a length on the page, in whole CSS pixels: a page can be
// scrolled far, and an element can sit above its top
const coordinate = z.number().int().min(-1_000_000).max(10_000_000)
const length = z.number().int().min(0).max(10_000_000)

/**
 * One call's body: what was written, the page's path and title, the
 * element it's about (a CSS selector from the page's body, its tag, the
 * text it shows or null, its `class`, and its box on the page), or null for
 * the page as a whole, the window's size, the app's own ID for whoever
 * filed it, never their email, and their browser's User-Agent, for what
 * they were on, which Infra doesn't keep
 */
export const filed_comment = z.object({
    body: z.string().trim().min(1).max(LONGEST_COMMENT),
    path: z
        .string()
        .max(2048)
        .regex(/^\/[^?#]*$/),
    title: z.string().trim().max(200).nullable(),
    element: z
        .object({
            selector: z.string().trim().min(1).max(1000),
            tag: z
                .string()
                .max(64)
                .regex(/^[a-z][a-z0-9-]*$/),
            text: z.string().max(1000).nullable(),
            classes: z.string().max(1000).nullable(),
            box: z.object({
                x: coordinate,
                y: coordinate,
                width: length,
                height: length
            })
        })
        .nullable(),
    viewport: z.object({ width: length, height: length }).nullable(),
    user: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .refine((id) => !id.includes("@"), { message: "An email, not an ID" })
        .nullable(),
    user_agent: z.string().max(1024).nullable()
})
export type FiledComment = z.infer<typeof filed_comment>
