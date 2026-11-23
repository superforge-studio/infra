import { Hono } from "hono"
import { expect, test, vi } from "vitest"
import { infraClient } from "../client.js"
import type { FiledComment } from "../contract/index.js"

// The client against a fake of Infra's API, answering what Infra's README
// says each call answers, so no test reaches the real one

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"
const ADDRESS = "https://infra.test/v1"

// Infra, answering `answer` to every call, and what each call sent it
function fakeInfra(answer: { status: number; body: unknown }) {
    const received: {
        method: string
        path: string
        key: string | null
        client: string | null
        body: unknown
    }[] = []
    const fake = new Hono().all("*", async (context) => {
        const text = await context.req.text()
        received.push({
            method: context.req.method,
            path: `${context.req.path}${new URL(context.req.url).search}`,
            key: context.req.header("Authorization") ?? null,
            client: context.req.header("Infra-Client") ?? null,
            body: text === "" ? null : JSON.parse(text)
        })
        return Response.json(answer.body, { status: answer.status })
    })
    const send: typeof fetch = async (input, init) =>
        fake.request(typeof input === "string" ? input : input.toString(), init)
    return { infra: infraClient({ key: KEY, url: ADDRESS, send }), received }
}

const START = {
    channel: "email" as const,
    address: "ada@example.com",
    ip: "203.0.113.7"
}

test("starting a login sends the key, the package's version, and who it's for", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 200,
        body: {
            channel: "email",
            address: "ada@example.com",
            with_link: true,
            expires_at: "2026-11-15T18:15:00.000Z",
            test: { code: "123456", link: "http://localhost:3000/login#x" }
        }
    })
    const started = await infra.startLogin({
        ...START,
        link_to: "http://localhost:3000/login"
    })
    expect(started).toEqual({
        ok: true,
        data: {
            channel: "email",
            address: "ada@example.com",
            with_link: true,
            expires_at: new Date("2026-11-15T18:15:00.000Z"),
            test: { code: "123456", link: "http://localhost:3000/login#x" }
        }
    })
    expect(received).toEqual([
        {
            method: "POST",
            path: "/v1/login/start",
            key: `Bearer ${KEY}`,
            client: "@superforge/infra/0.3.0",
            body: { ...START, link_to: "http://localhost:3000/login" }
        }
    ])
})

test("Infra's refusals come back as its own error, as they are", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const refusals = [
        {
            status: 429,
            error: {
                reason: "rate-limited",
                limit: "address",
                retry_after: 42,
                message: "Ask again in 42 seconds."
            }
        },
        {
            status: 502,
            error: { reason: "not-sent", message: "Resend refused it." }
        }
    ]
    for (const { status, error } of refusals) {
        const { infra } = fakeInfra({ status, body: { error } })
        expect(await infra.startLogin(START)).toEqual({ ok: false, error })
    }
})

test("verifying sends the code with its address, or the token, and answers whose it was", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 200,
        body: { channel: "email", address: "ada@example.com" }
    })
    const token = "a".repeat(43)
    const proof = {
        channel: "email" as const,
        address: "ada@example.com",
        code: "123456"
    }
    const whose = {
        ok: true,
        data: { channel: "email", address: "ada@example.com" }
    }
    expect(await infra.verifyLogin(proof)).toEqual(whose)
    expect(await infra.verifyLogin({ token })).toEqual(whose)
    expect(received.map((each) => each.body)).toEqual([proof, { token }])
})

test("a code Infra refuses says why", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    for (const error of [
        { reason: "wrong-code", attempts_left: 3, message: "Not it." },
        { reason: "no-code", message: "Start again." },
        { reason: "no-link", message: "Start again." }
    ]) {
        const { infra } = fakeInfra({ status: 400, body: { error } })
        expect(await infra.verifyLogin({ token: "a".repeat(43) })).toEqual({
            ok: false,
            error
        })
    }
})

test("a refusal the app can't act on is unavailable, in Infra's words, and logged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const revoked = {
        error: {
            reason: "revoked-key",
            message: "This secret key was revoked on 2026-11-20."
        }
    }
    const { infra } = fakeInfra({ status: 401, body: revoked })
    expect(await infra.startLogin(START)).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: "This secret key was revoked on 2026-11-20."
        }
    })
    expect(logged).toHaveBeenCalledWith(
        "Infra refused a call the app can't act on",
        expect.objectContaining({ status: 401, answer: revoked })
    )
})

test("every refusal is logged with its reason and Infra's words", async () => {
    const logged = vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra } = fakeInfra({
        status: 400,
        body: { error: { reason: "no-code", message: "Start again." } }
    })
    await infra.verifyLogin({ token: "a".repeat(43) })
    expect(logged).toHaveBeenCalledWith("Infra refused a call", {
        call: "/login/verify",
        status: 400,
        reason: "no-code",
        message: "Start again."
    })
})

test("an answer outside the contract is unavailable, and logged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const { infra } = fakeInfra({ status: 200, body: { address: 42 } })
    expect(await infra.verifyLogin({ token: "a".repeat(43) })).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message:
                "Infra answered /login/verify in a shape this version of @superforge/infra can't read. Ask Claude to update @superforge/infra in the app."
        }
    })
    expect(logged).toHaveBeenCalledWith(
        "Infra answered in a shape the client can't read",
        expect.objectContaining({ status: 200 })
    )
})

test("an Infra that doesn't answer, or answers without JSON, is unavailable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const down = infraClient({
        key: KEY,
        url: ADDRESS,
        send: async () => {
            throw new TypeError("fetch failed")
        }
    })
    expect(await down.startLogin(START)).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: expect.stringContaining(
                "Infra didn't answer /login/start at https://infra.test/v1."
            )
        }
    })
    expect(logged).toHaveBeenCalledWith(
        "Infra didn't answer",
        expect.objectContaining({ call: "/login/start" })
    )

    const proxy_page = infraClient({
        key: KEY,
        url: ADDRESS,
        send: async () =>
            new Response("<html>Bad gateway</html>", { status: 502 })
    })
    expect(await proxy_page.verifyLogin({ token: "a".repeat(43) })).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: expect.stringContaining(
                "Infra answered /login/verify with 502 and no JSON"
            )
        }
    })
})

const COMMENT: FiledComment = {
    body: "This button sits too close to the edge on a phone",
    path: "/pricing",
    title: "Pricing",
    element: {
        selector: "body > div > main > a",
        tag: "a",
        text: "Book a call",
        classes: "inline-flex",
        box: { x: 120, y: 1640, width: 180, height: 44 }
    },
    viewport: { width: 1440, height: 900 },
    user_id: "5f0c1a2b-3d4e-4f60-8a9b-0c1d2e3f4a5b",
    user_name: "Jess",
    user_agent: "Mozilla/5.0"
}

test("a comment goes to /v1/board/comments with who filed it, and answers its ID", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 201,
        body: {
            comment: { id: "c-1", created_at: "2026-11-18T18:15:00.000Z" }
        }
    })
    expect(await infra.fileComment(COMMENT)).toEqual({
        ok: true,
        data: { id: "c-1", created_at: new Date("2026-11-18T18:15:00.000Z") }
    })
    expect(received).toEqual([
        expect.objectContaining({ path: "/v1/board/comments", body: COMMENT })
    ])
})

test("a comment Infra refuses says what didn't fit, and is logged as the app's mistake", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = {
        reason: "invalid",
        issues: [{ path: "element.tag", message: "Invalid string" }],
        message: "element.tag didn't fit what this call takes."
    }
    const { infra } = fakeInfra({ status: 400, body: { error } })
    expect(await infra.fileComment(COMMENT)).toEqual({ ok: false, error })
    expect(logged).toHaveBeenCalledWith("Infra refused a comment", {
        call: "/board/comments",
        refused: error
    })
})

test("the key's project, with its domains", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const project = {
        id: "sf_project_1",
        name: "VMD System",
        domains: ["vmdsystem.com"]
    }
    const { infra, received } = fakeInfra({
        status: 200,
        body: { project, mode: "live" }
    })
    expect(await infra.project()).toEqual({
        ok: true,
        data: { project, mode: "live" }
    })
    expect(received[0]).toMatchObject({ method: "GET", path: "/v1/project" })
})

test("Claude's requests and connections go by the app's user ID", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const connection = {
        id: "c-1",
        user_id: "u-1",
        client_name: "Claude",
        scopes: ["read"],
        resource: "https://vmdsystem.com/admin/mcp",
        last_used_at: "2026-11-21T08:00:00.000Z",
        created_at: "2026-11-20T15:00:00.000Z"
    }
    const { infra, received } = fakeInfra({
        status: 200,
        body: { connections: [connection] }
    })
    expect(await infra.agentConnections("u-1")).toEqual({
        ok: true,
        data: [
            {
                ...connection,
                last_used_at: new Date(connection.last_used_at),
                created_at: new Date(connection.created_at)
            }
        ]
    })
    expect(received[0]).toMatchObject({
        method: "GET",
        path: "/v1/agents/connections?user_id=u-1"
    })

    const allowed = fakeInfra({
        status: 200,
        body: { redirect_to: "https://claude.ai/api/mcp/auth_callback?code=x" }
    })
    await allowed.infra.allowAgent("r-1", { user_id: "u-1", scopes: ["read"] })
    expect(allowed.received[0]).toMatchObject({
        path: "/v1/agents/requests/r-1/allow",
        body: { user_id: "u-1", scopes: ["read"] }
    })

    const missing = fakeInfra({
        status: 404,
        body: { error: { reason: "not-found", message: "No such request." } }
    })
    expect(await missing.infra.agentRequest("r-2")).toEqual({
        ok: false,
        error: { reason: "not-found", message: "No such request." }
    })
})
