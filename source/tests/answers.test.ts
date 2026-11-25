import { Hono } from "hono"
import { beforeEach, expect, test, vi } from "vitest"
import { infraClient } from "../client.js"
import type { Infra } from "../infra.js"

// Infra adds to what it answers: a field, or a value in a list that grows,
// like a limit's name or a scope. A release already installed reads each
// answer with those as it reads today's, so Infra can add one without
// breaking an app that hasn't updated: a field it doesn't know is dropped,
// a limit is any name, and a scope it doesn't know is left out.

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"
const RESOURCE = "https://example.com/admin/mcp"
const AT = "2026-11-24T09:00:00.000Z"
// A field Infra adds later, of any shape
const LATER = { added_later: { any: ["shape"] } }

beforeEach(() => {
    for (const level of ["info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation(() => {})
    }
})

// The real client, against an Infra answering `body` with `status`
function answering(status: number, body: unknown) {
    const fake = new Hono().all("*", () => Response.json(body, { status }))
    return infraClient({
        key: KEY,
        url: "https://infra.test/v1",
        send: async (input, init) =>
            fake.request(
                typeof input === "string" ? input : input.toString(),
                init
            )
    })
}

const CASES: {
    name: string
    status: number
    body: unknown
    call: (infra: Infra) => Promise<unknown>
    answer: unknown
}[] = [
    {
        name: "the key's project",
        status: 200,
        body: {
            project: {
                id: "sf_project_1",
                name: "Example",
                domains: [],
                ...LATER
            },
            mode: "live",
            ...LATER
        },
        call: (infra) => infra.project(),
        answer: {
            ok: true,
            data: {
                project: { id: "sf_project_1", name: "Example", domains: [] },
                mode: "live"
            }
        }
    },
    {
        name: "a login started",
        status: 200,
        body: {
            channel: "email",
            address: "ada@example.com",
            with_link: false,
            expires_at: AT,
            test: null,
            ...LATER
        },
        call: (infra) =>
            infra.startLogin({
                channel: "email",
                address: "ada@example.com",
                ip: "203.0.113.7"
            }),
        answer: {
            ok: true,
            data: {
                channel: "email",
                address: "ada@example.com",
                with_link: false,
                expires_at: new Date(AT),
                test: null
            }
        }
    },
    {
        name: "a limit the release doesn't know",
        status: 429,
        body: {
            error: {
                reason: "rate-limited",
                message: "Too many for this owner. Ask again in 42 seconds.",
                limit: "owner",
                retry_after: 42,
                ...LATER
            }
        },
        call: (infra) =>
            infra.startLogin({
                channel: "email",
                address: "ada@example.com",
                ip: "203.0.113.7"
            }),
        answer: {
            ok: false,
            error: {
                reason: "rate-limited",
                message: "Too many for this owner. Ask again in 42 seconds.",
                limit: "owner",
                retry_after: 42
            }
        }
    },
    {
        name: "a login message that didn't go out",
        status: 502,
        body: { error: { reason: "not-sent", message: "Not sent.", ...LATER } },
        call: (infra) =>
            infra.startLogin({
                channel: "email",
                address: "ada@example.com",
                ip: "203.0.113.7"
            }),
        answer: {
            ok: false,
            error: { reason: "not-sent", message: "Not sent." }
        }
    },
    {
        name: "a login verified",
        status: 200,
        body: { channel: "email", address: "ada@example.com", ...LATER },
        call: (infra) => infra.verifyLogin({ token: "a".repeat(43) }),
        answer: {
            ok: true,
            data: { channel: "email", address: "ada@example.com" }
        }
    },
    {
        name: "a wrong code",
        status: 400,
        body: {
            error: {
                reason: "wrong-code",
                message: "Not it.",
                attempts_left: 2,
                ...LATER
            }
        },
        call: (infra) => infra.verifyLogin({ token: "a".repeat(43) }),
        answer: {
            ok: false,
            error: {
                reason: "wrong-code",
                message: "Not it.",
                attempts_left: 2
            }
        }
    },
    {
        name: "a comment kept",
        status: 201,
        body: { comment: { id: "c-1", created_at: AT, ...LATER }, ...LATER },
        call: (infra) =>
            infra.fileComment({
                body: "Too close to the edge",
                path: "/",
                title: null,
                element: null,
                viewport: null,
                user_id: "u-1",
                user_name: "Ada",
                user_agent: null
            }),
        answer: { ok: true, data: { id: "c-1", created_at: new Date(AT) } }
    },
    {
        name: "a comment that didn't fit",
        status: 400,
        body: {
            error: {
                reason: "invalid",
                message: "body didn't fit.",
                issues: [{ path: "body", message: "Too long", ...LATER }],
                ...LATER
            }
        },
        call: (infra) =>
            infra.fileComment({
                body: "Too close to the edge",
                path: "/",
                title: null,
                element: null,
                viewport: null,
                user_id: "u-1",
                user_name: "Ada",
                user_agent: null
            }),
        answer: {
            ok: false,
            error: {
                reason: "invalid",
                message: "body didn't fit.",
                issues: [{ path: "body", message: "Too long" }]
            }
        }
    },
    {
        name: "a request with a scope the release doesn't know",
        status: 200,
        body: {
            request: {
                id: "r-1",
                client_name: "Claude",
                scopes: ["read", "admin", "act"],
                resource: RESOURCE,
                expires_at: AT,
                ...LATER
            },
            ...LATER
        },
        call: (infra) => infra.agentRequest("r-1"),
        answer: {
            ok: true,
            data: {
                id: "r-1",
                client_name: "Claude",
                scopes: ["read", "act"],
                resource: RESOURCE,
                expires_at: new Date(AT)
            }
        }
    },
    {
        name: "a request that isn't there",
        status: 404,
        body: { error: { reason: "not-found", message: "None.", ...LATER } },
        call: (infra) => infra.agentRequest("r-1"),
        answer: { ok: false, error: { reason: "not-found", message: "None." } }
    },
    {
        name: "a request allowed",
        status: 200,
        body: { redirect_to: "https://claude.ai/callback?code=x", ...LATER },
        call: (infra) =>
            infra.allowAgent("r-1", { user_id: "u-1", scopes: ["read"] }),
        answer: {
            ok: true,
            data: { redirect_to: "https://claude.ai/callback?code=x" }
        }
    },
    {
        name: "a request that asked for none of what was allowed",
        status: 400,
        body: { error: { reason: "not-asked", message: "No.", ...LATER } },
        call: (infra) =>
            infra.allowAgent("r-1", { user_id: "u-1", scopes: ["read"] }),
        answer: { ok: false, error: { reason: "not-asked", message: "No." } }
    },
    {
        name: "connections with a scope the release doesn't know",
        status: 200,
        body: {
            connections: [
                {
                    id: "c-1",
                    user_id: "u-1",
                    client_name: "Claude",
                    scopes: ["admin", "read"],
                    resource: RESOURCE,
                    last_used_at: AT,
                    created_at: AT,
                    ...LATER
                }
            ],
            ...LATER
        },
        call: (infra) => infra.agentConnections("u-1"),
        answer: {
            ok: true,
            data: [
                {
                    id: "c-1",
                    user_id: "u-1",
                    client_name: "Claude",
                    scopes: ["read"],
                    resource: RESOURCE,
                    last_used_at: new Date(AT),
                    created_at: new Date(AT)
                }
            ]
        }
    },
    {
        name: "a connection ended",
        status: 200,
        body: { ended: 1, ...LATER },
        call: (infra) => infra.endAgentConnection("c-1"),
        answer: { ok: true, data: null }
    },
    {
        name: "someone's connections ended",
        status: 200,
        body: { ended: 2, ...LATER },
        call: (infra) => infra.endAgentConnections("u-1"),
        answer: { ok: true, data: 2 }
    }
]

test.each(CASES)("$name reads with what Infra adds later", async (each) => {
    expect(await each.call(answering(each.status, each.body))).toEqual(
        each.answer
    )
})
