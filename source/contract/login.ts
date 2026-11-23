import { z } from "zod"
import { refusal } from "./errors.js"

// Logging in an app's people, with no password: Infra sends a code, and a
// link when the app says where it goes, and says whose address it was when
// the person brings either back. The app keeps its own users and sessions.
// Infra's README, "Login", has the calls.

/**
 * How a login message reaches someone. Only email today; a text is a new
 * channel, not a new call.
 */
export const LOGIN_CHANNELS = ["email"] as const
export const login_channel = z.enum(LOGIN_CHANNELS)
export type LoginChannel = z.infer<typeof login_channel>

/** An email address as Infra keeps it: trimmed, lowercased and checked */
export const email_address = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254))

/** A login's six-digit code, forgiving the spaces a pasted code can carry */
export const login_code = z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/))

/**
 * A login link's token, from the link's fragment (`/login#<token>`): 32
 * random bytes in base64url, which identify the login by themselves
 */
export const login_token = z.string().regex(/^[\w-]{43}$/)

/** The person's IP address, which Infra's limits count by network */
export const visitor_ip = z.union([z.ipv4(), z.ipv6()])

/**
 * The page a login link opens, like `https://vmdsystem.com/login`: Infra
 * adds `#<token>`, and links only to the project's domains and localhost
 */
export const link_to = z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .refine((value) => !value.includes("#"), {
        message: "Without a fragment: Infra adds the token after #"
    })

/** Who a login is for: the channel, and their address on it */
const login_address = z.object({
    channel: z.literal("email"),
    address: email_address
})

/** `POST /v1/login/start`: sends a code, and a link with `link_to` */
export const login_start = login_address.extend({
    ip: visitor_ip,
    link_to: link_to.optional()
})
export type LoginStart = z.input<typeof login_start>

/** What `login/start` answers once the message went out */
export const started_login = z.object({
    channel: login_channel,
    // The address as Infra keeps it, which verifying the code takes
    address: z.string(),
    // Whether the message holds a link as well as the code
    with_link: z.boolean(),
    // When the code and the link stop working
    expires_at: z.iso.datetime().transform((value) => new Date(value)),
    // With a test key, which sends nothing: what the message would have
    // held, for a dev server to show on the page. Null with a secret key.
    test: z.object({ code: z.string(), link: z.string().nullable() }).nullable()
})
export type StartedLogin = z.output<typeof started_login>

/** Why `login/start` sent nothing */
export const start_refused = z.union([
    // Over one of Infra's limits: this address (one a minute, five an
    // hour), the person's network, or the project's
    refusal("rate-limited", {
        limit: z.enum(["address", "network", "project"]),
        retry_after: z.number()
    }),
    // The message didn't go out, and nothing was counted
    refusal("not-sent")
])
export type StartRefused = z.output<typeof start_refused>

/**
 * `POST /v1/login/verify`: the code, with the address it went to, or the
 * link's token alone
 */
export const login_verify = z.union([
    login_address.extend({ code: login_code }),
    z.object({ token: login_token })
])
export type LoginProof = z.input<typeof login_verify>

/** Whose address the code or the link was */
export const verified_login = z.object({
    channel: login_channel,
    address: z.string()
})
export type VerifiedLogin = z.output<typeof verified_login>

/** Why `login/verify` didn't log them in */
export const verify_refused = z.union([
    refusal("wrong-code", { attempts_left: z.number() }),
    refusal("no-code"),
    refusal("no-link")
])
export type VerifyRefused = z.output<typeof verify_refused>
