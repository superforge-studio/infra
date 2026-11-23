import {
    createLocalJWKSet,
    exportJWK,
    generateKeyPair,
    type JWTVerifyGetKey,
    SignJWT
} from "jose"
import { z } from "zod"
import { checkToken, unavailableOAuth } from "./agents.js"
import {
    type AgentScope,
    COMMENT_BODY_LIMIT,
    filed_comment,
    login_start,
    login_verify
} from "./contract/index.js"
import type { Infra } from "./infra.js"
import { MINUTE, randomToken } from "./primitives.js"

// How Infra treats a code: it works for 15 minutes and five tries, and a
// new one for the same address replaces it, link and all
const LIFETIME = 15 * MINUTE
const ATTEMPTS = 5

/** A login the stand-in sent, waiting to be verified, by its address */
export type WaitingLogin = {
    address: string
    code: string
    token: string
    attempts: number
    expires_at: number
}

/**
 * Infra's test mode, in memory: what a test key gets from the real one,
 * with no key and no network. Starting a login sends nothing and answers
 * the code and the link, and verifying checks them as Infra does: each
 * works once, for 15 minutes, a code for five tries, and using either
 * spends both. No limits apply, as none do to a test key. A request is
 * checked with Infra's own contract, as Infra checks it, and a comment is
 * answered an ID, though nothing keeps it. Its project has the `domains`
 * it's given, an app's website's. An app's tests always use it, so they
 * never reach Infra, and so does a dev server with no test key
 * (choose.ts). A build never does: anyone could log in as anyone, since
 * the page shows the code. Its refusals say what Infra's say.
 *
 * `waiting` is where it keeps what it sent, by address: its own, or one
 * that outlives a dev server's reloads. With `logs`, as a dev server has
 * it, each comment is logged, since nothing keeps it.
 */
export function standInInfra({
    waiting = new Map(),
    logs = false,
    domains = []
}: {
    waiting?: Map<string, WaitingLogin>
    logs?: boolean
    domains?: string[]
} = {}): Infra {
    return {
        async project() {
            return {
                ok: true,
                data: {
                    project: {
                        id: STAND_IN_PROJECT,
                        name: "Infra's stand-in",
                        domains
                    },
                    mode: "test"
                }
            }
        },

        async startLogin(request) {
            const parsed = login_start.safeParse(request)
            if (!parsed.success) {
                return misfit(parsed.error)
            }
            const { channel, address, link_to } = parsed.data
            const sent: WaitingLogin = {
                address,
                code: randomCode(),
                token: randomToken(),
                attempts: 0,
                expires_at: Date.now() + LIFETIME
            }
            waiting.set(address, sent)
            return {
                ok: true,
                data: {
                    channel,
                    address,
                    with_link: link_to !== undefined,
                    expires_at: new Date(sent.expires_at),
                    test: {
                        code: sent.code,
                        link:
                            link_to === undefined
                                ? null
                                : `${link_to}#${sent.token}`
                    }
                }
            }
        },

        async verifyLogin(given) {
            const parsed = login_verify.safeParse(given)
            if (!parsed.success) {
                return misfit(parsed.error)
            }
            const proof = parsed.data
            if ("token" in proof) {
                const sent = [...waiting.values()].find(
                    (each) => each.token === proof.token
                )
                if (sent === undefined || sent.expires_at <= Date.now()) {
                    return { ok: false, error: NO_LINK }
                } else {
                    waiting.delete(sent.address)
                    return {
                        ok: true,
                        data: { channel: "email", address: sent.address }
                    }
                }
            }

            const sent = waiting.get(proof.address)
            if (
                sent === undefined ||
                sent.expires_at <= Date.now() ||
                sent.attempts >= ATTEMPTS
            ) {
                return { ok: false, error: NO_CODE }
            }
            // Each guess counts, the right one too, as Infra counts them
            sent.attempts += 1
            if (sent.code === proof.code) {
                waiting.delete(sent.address)
                return {
                    ok: true,
                    data: { channel: proof.channel, address: sent.address }
                }
            } else if (sent.attempts < ATTEMPTS) {
                const left = ATTEMPTS - sent.attempts
                return {
                    ok: false,
                    error: {
                        reason: "wrong-code",
                        attempts_left: left,
                        message: `That isn't the code Infra sent this address. It can be tried ${left === 1 ? "once more" : `${left} more times`}.`
                    }
                }
            } else {
                return { ok: false, error: NO_CODE }
            }
        },

        async fileComment(comment) {
            const body = JSON.stringify(comment)
            if (
                new TextEncoder().encode(body).byteLength > COMMENT_BODY_LIMIT
            ) {
                return {
                    ok: false,
                    error: {
                        reason: "too-large",
                        limit: COMMENT_BODY_LIMIT,
                        message: `This call's body is over ${COMMENT_BODY_LIMIT} bytes, the most Infra takes for it.`
                    }
                }
            }
            const checked = filed_comment.safeParse(comment)
            if (!checked.success) {
                // What didn't fit, as Infra says it
                const issues = checked.error.issues.map((issue) => ({
                    path: issue.path.map(String).join("."),
                    message: issue.message
                }))
                return {
                    ok: false,
                    error: {
                        reason: "invalid",
                        issues,
                        message: `${issues.map((issue) => issue.path).join(", ")} didn't fit what this call takes.`
                    }
                }
            }
            if (logs) {
                console.info(
                    "Infra's stand-in: a comment, which Infra would keep, and which nothing keeps here",
                    checked.data
                )
            }
            return {
                ok: true,
                data: { id: crypto.randomUUID(), created_at: new Date() }
            }
        },

        // Claude's login needs Infra: the stand-in logs nobody in, and
        // only checks the tokens a test mints with `standInAgentToken`
        async passOAuth() {
            if (logs) {
                console.info(
                    "Infra's stand-in can't log Claude in. Set INFRA_TEST_KEY to connect Claude to a dev server."
                )
            }
            return unavailableOAuth(
                "This dev server has no Infra test key, so Claude can't log in to it. Ask Claude for one (the Superforge MCP's create_test_key) for INFRA_TEST_KEY in the checkout's .env."
            )
        },
        async agentRequest() {
            return { ok: false, error: NO_REQUEST }
        },
        async allowAgent() {
            return { ok: false, error: NO_REQUEST }
        },
        async denyAgent() {
            return { ok: false, error: NO_REQUEST }
        },
        async agentConnections() {
            return { ok: true, data: [] }
        },
        async endAgentConnection() {
            return {
                ok: false,
                error: {
                    reason: "not-found",
                    message:
                        "Claude has no connection here with this ID: the stand-in connects no one."
                }
            }
        },
        async endAgentConnections() {
            return { ok: true, data: 0 }
        },
        async checkAgentToken(token, expected) {
            const { public_keys } = await standInKeys()
            return await checkToken(public_keys, token, {
                ...expected,
                project: STAND_IN_PROJECT,
                mode: "test"
            })
        }
    }
}

// A request that doesn't fit Infra's contract: Infra answers it 400
// `invalid`, which the client reads as unavailable, since it's a bug in
// the app, with the fields that didn't fit
function misfit(error: z.ZodError) {
    const fields = error.issues.map((issue) => issue.path.map(String).join("."))
    return {
        ok: false as const,
        error: {
            reason: "unavailable" as const,
            message: `${fields.join(", ")} didn't fit what this call takes: a bug in the app.`
        }
    }
}

// What the stand-in refuses with, in Infra's words
const NO_CODE = {
    reason: "no-code" as const,
    message: `No code is waiting for this address: none was sent, it ran out after ${LIFETIME / MINUTE} minutes, it was used, or it was tried ${ATTEMPTS} times. Start a new login.`
}
const NO_LINK = {
    reason: "no-link" as const,
    message: `That link has been used, ran out after ${LIFETIME / MINUTE} minutes, or isn't this project's. Start a new login.`
}
const NO_REQUEST = {
    reason: "not-found" as const,
    message:
        "No request of Claude's is waiting here: the stand-in logs no one in. Set INFRA_TEST_KEY to connect Claude to a dev server."
}

// The project the stand-in's tokens are for
const STAND_IN_PROJECT = "sf_project_stand_in"

let keys: Promise<{ signing: CryptoKey; public_keys: JWTVerifyGetKey }>

// A key pair of the stand-in's own, made the first time it's needed
function standInKeys() {
    keys ??= generateKeyPair("ES256").then(async (pair) => ({
        signing: pair.privateKey,
        public_keys: createLocalJWKSet({
            keys: [{ ...(await exportJWK(pair.publicKey)), kid: "stand-in" }]
        })
    }))
    return keys
}

/**
 * A token as Infra signs one, for a test to call the app as Claude does:
 * acting as `user_id`, with `scopes`, for the app at `origin` (the tests'
 * own is `http://localhost`) and the address `resource`, its MCP's, which
 * the stand-in's `checkAgentToken` takes
 */
export async function standInAgentToken({
    user_id,
    resource,
    scopes = ["read", "act"],
    origin = "http://localhost",
    expires_in = "10m"
}: {
    user_id: string
    resource: string
    scopes?: AgentScope[]
    origin?: string
    expires_in?: string
}) {
    const { signing } = await standInKeys()
    return await new SignJWT({
        scope: scopes.join(" "),
        project: STAND_IN_PROJECT,
        mode: "test",
        connection: crypto.randomUUID()
    })
        .setProtectedHeader({ alg: "ES256", kid: "stand-in", typ: "at+jwt" })
        .setIssuer(origin)
        .setAudience(z.url().parse(resource))
        .setSubject(user_id)
        .setIssuedAt()
        .setExpirationTime(expires_in)
        .sign(signing)
}

/**
 * Six random digits. A draw past the last whole million is drawn again, so
 * the modulo doesn't make low codes likelier.
 */
function randomCode() {
    for (;;) {
        // One number, which a one-number array always holds
        const [draw = 0] = crypto.getRandomValues(new Uint32Array(1))
        if (draw < 4_294_000_000) {
            return String(draw % 1_000_000).padStart(6, "0")
        }
    }
}
