import type { z } from "zod"
import { checkToken, infraKeys, passOAuth } from "./agents.js"
import {
    AGENT_ID,
    APP_PATHS,
    type AppPaths,
    agent_connections,
    agent_ended,
    agent_redirect,
    agent_refused,
    agent_request,
    CLIENT_HEADER,
    comment_refused,
    infra_failure,
    infra_project,
    kept_comment,
    start_refused,
    started_login,
    verified_login,
    verify_refused
} from "./contract/all.js"
import type { Infra, InfraUnavailable } from "./infra.js"
import { CALL_TIMEOUT } from "./primitives.js"
import type { AsyncOperationResult } from "./results.js"
import { CLIENT } from "./version.js"

/** Infra's API, which a project's keys call */
export const INFRA_URL = "https://infra.superforge.studio/v1"

// One call's answer: its status and its JSON
type Answer = { status: number; json: unknown }

/**
 * Infra, called over HTTP with a project's key: a secret key in a build, a
 * test key in a dev server. No call is retried, since none is safe to send
 * twice (a second start sends a second email, a second verify finds the
 * code spent, and a comment sent again is kept twice); the person asks
 * again instead. `url` is Infra's own, but for Infra's tests and a dev
 * server working on Infra; `send` is `fetch`, or a test's own; `paths` is
 * where the app answers Claude's login, when not `APP_PATHS`.
 *
 * Every call says which release of the package made it (`Infra-Client`).
 * Every answer is logged with its call and status, and a refusal with its
 * reason and Infra's message, so an app's logs say why a call failed.
 */
export function infraClient({
    key,
    url = INFRA_URL,
    send = fetch,
    paths = APP_PATHS
}: {
    key: string
    url?: string
    send?: typeof fetch
    paths?: AppPaths
}): Infra {
    // One call: its status and its JSON, or why there's none, which is
    // logged
    async function ask(
        method: "GET" | "POST" | "DELETE",
        call: string,
        body?: unknown
    ): AsyncOperationResult<Answer, InfraUnavailable> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${key}`,
            [CLIENT_HEADER]: CLIENT
        }
        if (body !== undefined) {
            headers["Content-Type"] = "application/json"
        }
        const response = await send(`${url}${call}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(CALL_TIMEOUT)
        }).catch((error: unknown) => {
            console.error("Infra didn't answer", { call, url, error })
            return null
        })
        if (response === null) {
            return unavailable(
                `Infra didn't answer ${call} at ${url}. It may be down; trying again in a few minutes may work.`
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
                `Infra answered ${call} with ${response.status} and no JSON, which usually means it's down. Trying again in a few minutes may work.`
            )
        }

        const failure = infra_failure.safeParse(json)
        if (response.status >= 400 && failure.success) {
            console.info("Infra refused a call", {
                call,
                status: response.status,
                reason: failure.data.error.reason,
                message: failure.data.error.message
            })
        } else {
            console.info("Infra answered", { call, status: response.status })
        }
        return { ok: true, data: { status: response.status, json } }
    }

    // An answer read with `schema` when it's a success (any 2xx, so Infra
    // can say 200 or 201 as it likes), else as one of the call's `refused`,
    // else as one the client can't act on: unavailable, in Infra's own words
    async function answered<Data, Refused = never>(
        asked: AsyncOperationResult<Answer, InfraUnavailable>,
        call: string,
        expected: { schema: z.ZodType<Data> },
        refused?: z.ZodType<Refused>
    ): AsyncOperationResult<Data, Refused | InfraUnavailable> {
        const answer = await asked
        if (!answer.ok) {
            return answer
        }
        const { status, json } = answer.data
        if (status >= 200 && status < 300) {
            const parsed = expected.schema.safeParse(json)
            return parsed.success
                ? { ok: true, data: parsed.data }
                : unreadable(call, answer.data)
        }
        const parsed = refused?.safeParse(json)
        if (parsed?.success) {
            return { ok: false, error: parsed.data }
        } else {
            return unexpected(call, answer.data)
        }
    }

    // Claude's login (agents.ts): Infra's public keys, fetched once and
    // again for a key they don't have, and which project and mode the key
    // is, which every token must be for, asked once
    const keys = infraKeys(url, send)
    let project: ReturnType<Infra["project"]> | undefined
    function projectOf() {
        const call = "/project"
        return answered(ask("GET", call), call, {
            schema: infra_project
        })
    }

    return {
        project() {
            return projectOf()
        },

        startLogin(request) {
            const call = "/login/start"
            return answered(
                ask("POST", call, request),
                call,
                { schema: started_login },
                start_refused
            )
        },

        verifyLogin(proof) {
            const call = "/login/verify"
            return answered(
                ask("POST", call, proof),
                call,
                { schema: verified_login },
                verify_refused
            )
        },

        async fileComment(comment) {
            const call = "/board/comments"
            const filed = await answered(
                ask("POST", call, comment),
                call,
                { schema: kept_comment },
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

        passOAuth(request, call, origin) {
            return passOAuth({ url, key, send, paths, request, call, origin })
        },

        async agentRequest(request_id) {
            if (!AGENT_ID.test(request_id)) {
                return notAnId("request", request_id)
            }
            const call = `/agents/requests/${encodeURIComponent(request_id)}`
            const asked = await answered(
                ask("GET", call),
                call,
                { schema: agent_request },
                agent_refused
            )
            return asked.ok ? { ok: true, data: asked.data.request } : asked
        },

        async allowAgent(request_id, allowed) {
            if (!AGENT_ID.test(request_id)) {
                return notAnId("request", request_id)
            }
            const call = `/agents/requests/${encodeURIComponent(request_id)}/allow`
            return answered(
                ask("POST", call, allowed),
                call,
                { schema: agent_redirect },
                agent_refused
            )
        },

        async denyAgent(request_id) {
            if (!AGENT_ID.test(request_id)) {
                return notAnId("request", request_id)
            }
            const call = `/agents/requests/${encodeURIComponent(request_id)}/deny`
            return answered(
                ask("POST", call, {}),
                call,
                { schema: agent_redirect },
                agent_refused
            )
        },

        async agentConnections(user_id) {
            const call = `/agents/connections?${new URLSearchParams({ user_id })}`
            const listed = await answered(ask("GET", call), call, {
                schema: agent_connections
            })
            return listed.ok
                ? { ok: true, data: listed.data.connections }
                : listed
        },

        async endAgentConnection(connection_id) {
            if (!AGENT_ID.test(connection_id)) {
                return notAnId("connection", connection_id)
            }
            const call = `/agents/connections/${encodeURIComponent(connection_id)}`
            const ended = await answered(
                ask("DELETE", call),
                call,
                { schema: agent_ended },
                agent_refused
            )
            return ended.ok ? { ok: true, data: null } : ended
        },

        async endAgentConnections(user_id) {
            const call = `/agents/connections?${new URLSearchParams({ user_id })}`
            const ended = await answered(ask("DELETE", call), call, {
                schema: agent_ended
            })
            return ended.ok ? { ok: true, data: ended.data.ended } : ended
        },

        async checkAgentToken(token, expected) {
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
                    ...expected,
                    project: known.data.project.id,
                    mode: known.data.mode
                })
            }
        }
    }
}

// An ID that can't be one of Infra's, refused before any call, so a route
// that passes on what it was sent can't make the path reach another of
// Infra's addresses: what Infra would answer, since it has none such
function notAnId(kind: "request" | "connection", id: string) {
    console.warn("Not an ID Infra makes", { kind, length: id.length })
    return {
        ok: false as const,
        error: {
            reason: "not-found" as const,
            message: `There's no ${kind} with this ID: Infra's IDs are letters, digits, _ and -, at most 128 of them.`
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

// A refusal the app has no branch for: a key Infra refused (401, which an
// owner fixes in Railway) or a body this app sent wrong (400 `invalid`, a
// bug). Logged, and unavailable, in Infra's own words, which an app shows
// its team.
function unexpected(call: string, answer: Answer) {
    console.error("Infra refused a call the app can't act on", {
        call,
        status: answer.status,
        answer: answer.json
    })
    const failure = infra_failure.safeParse(answer.json)
    return unavailable(
        failure.success
            ? failure.data.error.message
            : `Infra answered ${call} with ${answer.status}, in a shape this version of @superforge/infra can't read. Ask Claude to update @superforge/infra in the app.`
    )
}

// A success the client can't read: Infra answers a shape this release of
// the package doesn't know
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
