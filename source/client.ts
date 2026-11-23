import type { z } from "zod"
import {
    agent_connections,
    agent_ended,
    agent_redirect,
    agent_refused,
    agent_request,
    checkToken,
    infraKeys,
    passThrough
} from "./agents.js"
import {
    any_refusal,
    comment_refused,
    infra_project,
    kept_comment,
    start_refused,
    started_login,
    verified_login,
    verify_refused
} from "./answers.js"
import type { AgentRefused, Infra, InfraUnavailable } from "./infra.js"
import { SECOND } from "./primitives.js"
import type { AsyncOperationResult } from "./results.js"
import { CLIENT, CLIENT_HEADER } from "./version.js"

/**
 * Infra's API, which a project's keys call. A server can be pointed at
 * another Infra with `INFRA_URL` (choose.ts).
 */
export const INFRA_URL = "https://infra.superforge.studio/v1"

// How long a call waits for Infra's answer. Starting a login waits on
// Infra sending the email, which takes a second or two.
const TIMEOUT = 15 * SECOND

// One call's answer: its status and its JSON
type Answer = { status: number; json: unknown }

/**
 * Infra, called over HTTP with a project's key: a secret key in a build, a
 * test key in a dev server. No call is retried, since none is safe to send
 * twice (a second start sends a second email, a second verify finds the
 * code spent, and a comment sent again is kept twice); the visitor asks
 * again instead. `send` is `fetch`, or a test's own.
 *
 * Every call says which version of the package made it (`Infra-Client`,
 * version.ts). Every answer is logged with its call and status, and a
 * refusal with its `error` and Infra's `message`, which says what went
 * wrong and what fixes it (Infra's README, "Errors"), so an app's logs say
 * why a call failed.
 */
export function infraClient({
    key,
    url = INFRA_URL,
    send = fetch
}: {
    key: string
    url?: string
    send?: typeof fetch
}): Infra {
    // One call: its status and its JSON, or why there's none, which is
    // logged
    async function ask(
        method: "GET" | "POST" | "DELETE",
        call: string,
        body?: unknown
    ): AsyncOperationResult<Answer, InfraUnavailable> {
        const response = await send(`${url}${call}`, {
            method,
            headers:
                body === undefined
                    ? {
                          Authorization: `Bearer ${key}`,
                          [CLIENT_HEADER]: CLIENT
                      }
                    : {
                          Authorization: `Bearer ${key}`,
                          [CLIENT_HEADER]: CLIENT,
                          "Content-Type": "application/json"
                      },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT)
        }).catch((error: unknown) => {
            console.error("Infra didn't answer", { call, url, error })
            return null
        })
        if (response === null) {
            return unavailable(
                `Infra didn't answer ${call} at ${url}. It may be down, or INFRA_URL may point somewhere it isn't; trying again in a few minutes may work.`
            )
        }
        const json: unknown = await response.json().catch((error: unknown) => {
            console.error("Infra answered without JSON", {
                call,
                status: response.status,
                error
            })
            return undefined
        })
        if (json === undefined) {
            return unavailable(
                `Infra answered ${call} with ${response.status} and no JSON, which usually means it's down or INFRA_URL points somewhere that isn't Infra.`
            )
        }

        const refusal = any_refusal.safeParse(json)
        if (response.status >= 400 && refusal.success) {
            console.info("Infra refused a call", {
                call,
                status: response.status,
                error: refusal.data.error,
                message: refusal.data.message
            })
        } else {
            console.info("Infra answered", { call, status: response.status })
        }
        return { ok: true, data: { status: response.status, json } }
    }
    const post = (call: string, body: unknown) => ask("POST", call, body)

    // An answer read with `schema` when it's `status`, else as `refused`,
    // else as one the client doesn't know
    async function answered<Data, Refused = never>(
        asked:
            | { ok: true; data: Answer }
            | { ok: false; error: InfraUnavailable },
        call: string,
        expected: { status: number; schema: z.ZodType<Data> },
        refused?: z.ZodType<Refused>
    ): AsyncOperationResult<Data, Refused | InfraUnavailable> {
        if (!asked.ok) {
            return asked
        }
        const answer = asked.data
        if (answer.status === expected.status) {
            const parsed = expected.schema.safeParse(answer.json)
            return parsed.success
                ? { ok: true, data: parsed.data }
                : unreadable(call, answer)
        } else if (refused !== undefined) {
            const parsed = refused.safeParse(answer.json)
            return parsed.success
                ? { ok: false, error: parsed.data }
                : unexpected(call, answer)
        } else {
            return unexpected(call, answer)
        }
    }

    // Claude's login (agents.ts): Infra's public keys, fetched once and
    // again for a key they don't have, and which project and mode the key
    // is, which every token must be for, asked once
    const keys = infraKeys(url)
    let project: ReturnType<typeof projectOf> | undefined
    async function projectOf() {
        const call = "/project"
        return answered(await ask("GET", call), call, {
            status: 200,
            schema: infra_project
        })
    }

    // A call about Claude's requests and connections: its answer, or why
    // Infra refused it, or that it couldn't be asked
    async function agents<Data>(
        method: "GET" | "POST" | "DELETE",
        call: string,
        schema: z.ZodType<Data>,
        body?: unknown
    ): AsyncOperationResult<Data, AgentRefused | InfraUnavailable> {
        return answered(
            await ask(method, call, body),
            call,
            { status: 200, schema },
            agent_refused
        )
    }

    return {
        project() {
            return projectOf()
        },

        async startLogin({ email, ip, origin }) {
            const call = "/login/start"
            return answered(
                await post(
                    call,
                    origin === null ? { email, ip } : { email, ip, origin }
                ),
                call,
                { status: 200, schema: started_login },
                start_refused
            )
        },

        async verifyLogin(proof) {
            const call = "/login/verify"
            return answered(
                await post(call, proof),
                call,
                { status: 200, schema: verified_login },
                verify_refused
            )
        },

        async fileComment(comment) {
            const call = "/comments"
            const filed = await answered(
                await post(call, comment),
                call,
                { status: 201, schema: kept_comment },
                comment_refused
            )
            if (!filed.ok && filed.error.reason !== "unavailable") {
                // What the app sent is wrong, which only a change to it
                // fixes
                console.error("Infra refused a comment", {
                    call,
                    refused: filed.error
                })
            }
            return filed
        },

        passOAuth(request, path, origin) {
            return passThrough({ url, key, send, request, path, origin })
        },

        async agentRequest(request_id) {
            const asked = await agents(
                "GET",
                `/agents/requests/${request_id}`,
                agent_request
            )
            return asked.ok ? { ok: true, data: asked.data.request } : asked
        },

        allowAgent(request_id, allowed) {
            return agents(
                "POST",
                `/agents/requests/${request_id}/allow`,
                agent_redirect,
                allowed
            )
        },

        denyAgent(request_id) {
            return agents(
                "POST",
                `/agents/requests/${request_id}/deny`,
                agent_redirect,
                {}
            )
        },

        async agentConnections(email) {
            const query = new URLSearchParams({ email })
            const listed = await agents(
                "GET",
                `/agents/connections?${query}`,
                agent_connections
            )
            if (listed.ok) {
                return { ok: true, data: listed.data.connections }
            } else {
                return { ok: false, error: asUnavailable(listed.error) }
            }
        },

        async endAgentConnection(connection_id) {
            const ended = await agents(
                "DELETE",
                `/agents/connections/${connection_id}`,
                agent_ended
            )
            return ended.ok ? { ok: true, data: null } : ended
        },

        async endAgentConnections(email) {
            const query = new URLSearchParams({ email })
            const ended = await agents(
                "DELETE",
                `/agents/connections?${query}`,
                agent_ended
            )
            if (ended.ok) {
                return { ok: true, data: ended.data.ended }
            } else {
                return { ok: false, error: asUnavailable(ended.error) }
            }
        },

        async checkAgentToken(token, origin) {
            project ??= projectOf()
            const known = await project
            if (!known.ok) {
                project = undefined
                console.error("Infra didn't say which project the key is", {
                    message: known.error.message
                })
                return known
            } else {
                return await checkToken(keys, token, {
                    origin,
                    project: known.data.project.id,
                    mode: known.data.mode
                })
            }
        }
    }
}

// Infra couldn't be asked, and why
function unavailable(message: string): {
    ok: false
    error: InfraUnavailable
} {
    return { ok: false, error: { reason: "unavailable", message } }
}

// A refusal a call that only lists or ends things can't otherwise answer,
// read as unavailable with Infra's own words
function asUnavailable(
    refused: AgentRefused | InfraUnavailable
): InfraUnavailable {
    if ("reason" in refused) {
        return refused
    } else {
        return { reason: "unavailable", message: refused.message }
    }
}

// An answer the client doesn't expect: a key Infra refused (401, which an
// owner fixes in Railway), a body this app sent wrong (400 `invalid`, a
// bug), or an error Infra added after this version of the package. Logged
// with what it said, and unavailable, with Infra's own words for why when
// it gave them, which an app shows its team.
function unexpected(call: string, answer: Answer) {
    const refusal = any_refusal.safeParse(answer.json)
    const error = refusal.success ? refusal.data.error : null
    const said = refusal.success ? refusal.data.message : undefined
    console.error("Infra answered what the client doesn't expect", {
        call,
        status: answer.status,
        answer: answer.json
    })
    if (said !== undefined) {
        return unavailable(said)
    } else if (answer.status === 401) {
        return unavailable(
            `Infra refused this app's key${error === null ? "" : ` (${error})`}. Make a secret key on superforge.studio, in the project's Settings, and paste it into INFRA_SECRET_KEY on the app's service in Railway.`
        )
    } else {
        return unavailable(
            `Infra answered ${call} with ${answer.status}${error === null ? "" : ` ${error}`}, which this version of @superforge/infra doesn't know. Ask Claude to update @superforge/infra in the app.`
        )
    }
}

// A success the client can't read: Infra changed what a call answers since
// this version of the package
function unreadable(call: string, answer: Answer) {
    console.error("Infra answered in a shape the client can't read", {
        call,
        status: answer.status,
        answer: answer.json
    })
    return unavailable(
        `Infra answered ${call} in a shape this version of @superforge/infra can't read. Ask Claude to update @superforge/infra in the app.`
    )
}
