import { Hono } from "hono"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { beforeEach, expect, test, vi } from "vitest"
import { requestOrigin } from "../agents.js"
import { infraClient } from "../client.js"
import { isLoopbackHost, LOOPBACK_HOSTNAMES } from "../contract/index.js"

// What the client refuses before it calls, the token check through the real
// client, and the answers it reads however Infra words them

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"
const ORIGIN = "https://example.com"
const RESOURCE = `${ORIGIN}/admin/mcp`
const PROJECT = "sf_project_1"

beforeEach(() => {
    for (const level of ["info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation(() => {})
    }
})

test.each([
    ["http://localhost:3000/x", "http://localhost:3000"],
    ["http://app.localhost:3000/x", "http://app.localhost:3000"],
    ["http://127.0.0.1:5173/", "http://127.0.0.1:5173"],
    ["http://[::1]:3000/admin/mcp", "http://[::1]:3000"],
    // Behind Railway's proxy a request's own address says http
    ["http://example.com/admin/mcp", "https://example.com"],
    ["https://www.example.com:8443/", "https://www.example.com:8443"],
    ["http://localhost.example.com/", "https://localhost.example.com"]
])("requestOrigin(%s) is %s", (url, origin) => {
    expect(requestOrigin(url)).toBe(origin)
})

test("one list of loopback names, which the contract has", () => {
    expect(LOOPBACK_HOSTNAMES).toEqual(["localhost", "127.0.0.1", "[::1]"])
    expect(isLoopbackHost("LOCALHOST")).toBe(true)
    expect(isLoopbackHost("a.b.localhost")).toBe(true)
    expect(isLoopbackHost("127.0.0.2")).toBe(false)
    expect(isLoopbackHost("example.com")).toBe(false)
})

// Infra, answering every call with `answer`, and its key set at
// `/.well-known/jwks.json` (`keys`, or `keys_status` without them)
function fakeInfra({
    answer = { status: 200, body: {} as unknown },
    keys = [] as object[],
    keys_status = 200,
    mode = "test"
}: {
    answer?: { status: number; body: unknown }
    keys?: object[]
    keys_status?: number
    mode?: "test" | "live"
} = {}) {
    const paths: string[] = []
    const fake = new Hono()
        .get("/.well-known/jwks.json", (context) =>
            context.json({ keys }, keys_status as 200)
        )
        .get("/v1/project", (context) =>
            context.json({
                project: { id: PROJECT, name: "Example", domains: [] },
                mode
            })
        )
        .all("*", (context) => {
            paths.push(new URL(context.req.url).pathname)
            return Response.json(answer.body, { status: answer.status })
        })
    const send: typeof fetch = async (input, init) =>
        fake.request(
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url,
            init
        )
    return {
        infra: infraClient({ key: KEY, url: "https://infra.test/v1", send }),
        paths
    }
}

// A key pair as Infra keeps one, and a token signed with it
async function signer() {
    const pair = await generateKeyPair("ES256")
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k-1" }
    function sign(
        overrides: {
            issuer?: string
            audience?: string
            project?: string
            mode?: string
            typ?: string
            expires_at?: number | null
        } = {}
    ) {
        const jwt = new SignJWT({
            scope: "read act",
            project: overrides.project ?? PROJECT,
            mode: overrides.mode ?? "test",
            connection: "c-1"
        })
            .setProtectedHeader({
                alg: "ES256",
                kid: "k-1",
                typ: overrides.typ ?? "at+jwt"
            })
            .setIssuer(overrides.issuer ?? ORIGIN)
            .setAudience(overrides.audience ?? RESOURCE)
            .setSubject("u-1")
            .setIssuedAt()
        if (overrides.expires_at !== null) {
            jwt.setExpirationTime(
                overrides.expires_at ?? Math.floor(Date.now() / 1000) + 600
            )
        }
        return jwt.sign(pair.privateKey)
    }
    return { jwk, sign }
}

const EXPECTED = { origin: ORIGIN, resource: RESOURCE }

test("the real client takes a token Infra signed for this app", async () => {
    const { jwk, sign } = await signer()
    const { infra } = fakeInfra({ keys: [jwk] })
    expect(await infra.checkAgentToken(await sign(), EXPECTED)).toEqual({
        ok: true,
        data: { user_id: "u-1", scopes: ["read", "act"], connection_id: "c-1" }
    })
    // A clock a few seconds off still takes it
    const just_out = Math.floor(Date.now() / 1000) - 3
    expect(
        (
            await infra.checkAgentToken(
                await sign({ expires_at: just_out }),
                EXPECTED
            )
        ).ok
    ).toBe(true)
})

test("the real client refuses a token, saying why", async () => {
    const { jwk, sign } = await signer()
    const other = await signer()
    const { infra } = fakeInfra({ keys: [jwk] })
    const refused = async (token: string) => {
        const checked = await infra.checkAgentToken(token, EXPECTED)
        return checked.ok ? null : checked.error
    }
    const past = Math.floor(Date.now() / 1000) - 60
    expect(await refused(await sign({ expires_at: past }))).toEqual({
        reason: "invalid-token",
        message: expect.stringContaining("run out")
    })
    expect(await refused(await sign({ issuer: "https://other.com" }))).toEqual({
        reason: "invalid-token",
        message: expect.stringContaining("another app")
    })
    expect(await refused(await sign({ audience: `${ORIGIN}/mcp` }))).toEqual({
        reason: "invalid-token",
        message: expect.stringContaining("another address")
    })
    for (const token of [
        await sign({ project: "sf_project_2" }),
        await sign({ mode: "live" })
    ]) {
        expect(await refused(token)).toEqual({
            reason: "invalid-token",
            message: expect.stringContaining("another project or key mode")
        })
    }
    for (const token of [
        await sign({ typ: "JWT" }),
        await sign({ expires_at: null }),
        // Another key, under the kid Infra's has
        await other.sign()
    ]) {
        expect((await refused(token))?.reason).toBe("invalid-token")
    }
})

test("Infra's keys out of reach is unavailable, not a bad token", async () => {
    const { sign } = await signer()
    const { infra } = fakeInfra({ keys_status: 503 })
    const checked = await infra.checkAgentToken(await sign(), EXPECTED)
    expect(checked).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: expect.stringContaining("public keys couldn't be fetched")
        }
    })
})

test("an ID that can't be Infra's is refused before any call, and one that can is encoded", async () => {
    const { infra, paths } = fakeInfra({
        answer: { status: 200, body: { ended: 3 } }
    })
    for (const id of [
        "x/../../connections?user_id=u-2",
        "",
        "a b",
        "a".repeat(129)
    ]) {
        expect(await infra.endAgentConnection(id)).toEqual({
            ok: false,
            error: { reason: "not-found", message: expect.any(String) }
        })
        expect((await infra.agentRequest(id)).ok).toBe(false)
        expect((await infra.denyAgent(id)).ok).toBe(false)
        expect(
            (await infra.allowAgent(id, { user_id: "u-1", scopes: ["read"] }))
                .ok
        ).toBe(false)
    }
    expect(paths).toEqual([])
    expect(await infra.endAgentConnection("c_1-A")).toEqual({
        ok: true,
        data: null
    })
    expect(paths).toEqual(["/v1/agents/connections/c_1-A"])
})

test("a success is any 2xx, with an offset or an extra field", async () => {
    const { infra } = fakeInfra({
        answer: {
            status: 201,
            body: {
                request: {
                    id: "r-1",
                    client_name: "Claude",
                    scopes: ["read"],
                    resource: RESOURCE,
                    expires_at: "2026-11-24T10:00:00+01:00",
                    added_later: true
                }
            }
        }
    })
    expect(await infra.agentRequest("r-1")).toEqual({
        ok: true,
        data: {
            id: "r-1",
            client_name: "Claude",
            scopes: ["read"],
            resource: RESOURCE,
            expires_at: new Date("2026-11-24T09:00:00.000Z")
        }
    })
})

test("a way back to Claude that isn't http or https isn't read", async () => {
    const { infra } = fakeInfra({
        answer: { status: 200, body: { redirect_to: "javascript:alert(1)" } }
    })
    expect(await infra.denyAgent("r-1")).toEqual({
        ok: false,
        error: { reason: "unavailable", message: expect.any(String) }
    })
})

test("a call Infra doesn't answer in time is unavailable, with why", async () => {
    const infra = infraClient({
        key: KEY,
        url: "https://infra.test/v1",
        send: async () => {
            throw new DOMException("The operation timed out.", "TimeoutError")
        }
    })
    expect(await infra.agentConnections("u-1")).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: expect.stringContaining("didn't answer")
        }
    })
})

test("a body over 16 KB to Claude's OAuth calls is refused, never sent on", async () => {
    const { infra, paths } = fakeInfra({
        answer: { status: 200, body: { access_token: "x" } }
    })
    const big = "a".repeat(16 * 1024 + 1)
    const said = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/token`, { method: "POST", body: big }),
        "token",
        ORIGIN
    )
    expect(said.status).toBe(413)
    expect(await said.json()).toMatchObject({ error: "invalid_request" })

    // One that doesn't say its length is stopped while it's read
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (let chunk = 0; chunk < 20; chunk += 1) {
                controller.enqueue(new Uint8Array(1024))
            }
            controller.close()
        }
    })
    const streamed = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/register`, {
            method: "POST",
            body: stream,
            duplex: "half"
        } as RequestInit),
        "register",
        ORIGIN
    )
    expect(streamed.status).toBe(413)
    expect(paths).toEqual([])

    const small = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/token`, {
            method: "POST",
            body: "grant_type=refresh_token&refresh_token=x"
        }),
        "token",
        ORIGIN
    )
    expect(small.status).toBe(200)
    expect(paths).toEqual(["/v1/agents/oauth/token"])
})
