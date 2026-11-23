import { z } from "zod"
import { invalid_refusal, too_large_refusal } from "./errors.js"
import { user_id } from "./people.js"

// What an app's people say about it, from the toolbar on its pages: the app's
// server sends each comment to `POST /v1/board/comments` with who filed it, and
// Infra keeps it and files it on the app's board. Infra's README,
// "Comments", has the call.

/** The most a comment says, in characters */
export const LONGEST_COMMENT = 5000

/** How big one comment's body can be, in bytes */
export const COMMENT_BODY_LIMIT = 32 * 1024

// A place or a length on the page, in whole CSS pixels: a page can be
// scrolled far, and an element can sit above its top
const coordinate = z.number().int().min(-1_000_000).max(10_000_000)
const length = z.number().int().min(0).max(10_000_000)

/**
 * `POST /v1/board/comments`: what was written, the page's path and title, the
 * element it's about (a CSS selector from the page's body, its tag, the
 * text it shows or null, its `class`, and its box on the page) or null for
 * the page as a whole, the window's size, who filed it (the app's ID for
 * them, never their email, and the name it shows), and their browser's
 * User-Agent, for what they were on, which Infra doesn't keep
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
    user_id,
    user_name: z.string().trim().min(1).max(80),
    user_agent: z.string().max(1024).nullable()
})
export type FiledComment = z.input<typeof filed_comment>

/** What `POST /v1/board/comments` answers: the comment's ID, and when */
export const kept_comment = z
    .object({
        comment: z.object({
            id: z.string(),
            created_at: z.iso.datetime().transform((value) => new Date(value))
        })
    })
    .transform(({ comment }) => comment)
export type KeptComment = z.output<typeof kept_comment>

/**
 * Why Infra didn't keep a comment. Either is a bug in what the app sent, so
 * sending it again won't help.
 */
export const comment_refused = z.union([invalid_refusal, too_large_refusal])
export type CommentRefused = z.output<typeof comment_refused>
