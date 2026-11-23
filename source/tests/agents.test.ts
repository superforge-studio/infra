import { Hono } from "hono"
import { expect, test, vi } from "vitest"
import { infraClient } from "../client.js"
import { standInAgentToken, standInInfra } from "../stand-in.js"

// Claude's login as the client answers it: the metadata it builds, the
// authorize request it sends on to the app's Allow page, the calls it
// passes on as they are, and the tokens it checks

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"
const ORIGIN = "https://vmdsystem.com"

// The client, with Infra answering `answer` to every call
function withInfra(answer: { status: number; body: unknown }) {
    const received: { path: string; origin: string | null }[] = []
    const fake = new Hono().all("*", (context) => {
        received.push({
            path: `${context.req.path}${new URL(context.req.url).search}`,
            origin: context.req.header("App-Origin") ?? null
        })
        return Response.json(answer.body, { status: answer.status })
    })
    const infra = infraClient({
        key: KEY,
        url: "https://infra.test/v1",
        send: async (input, init) =>
            fake.request(
                typeof input === "string" ? input : input.toString(),
                init
            ),
        paths: { oauth: "/oauth", allow: "/team/allow" }
    })
    return { infra, received }
}

test("the server's metadata names the app's own addresses, with no call to Infra", async () => {
    const { infra, received } = withInfra({ status: 500, body: {} })
    const answer = await infra.passOAuth(
        new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
        "metadata",
        ORIGIN
    )
    expect(await answer.json()).toMatchObject({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/oauth/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        jwks_uri: "https://infra.test/.well-known/jwks.json",
        scopes_supported: ["read", "act"]
    })
    expect(received).toEqual([])
})

test("authorize sends the browser to the app's Allow page, wherever the app keeps it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const id = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
    const { infra, received } = withInfra({
        status: 200,
        body: { request: { id } }
    })
    const answer = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/authorize?client_id=x&state=s`),
        "authorize",
        ORIGIN
    )
    expect(answer.status).toBe(302)
    expect(answer.headers.get("Location")).toBe(`${ORIGIN}/team/allow/${id}`)
    expect(received).toEqual([
        {
            path: "/v1/agents/oauth/authorize?client_id=x&state=s",
            origin: ORIGIN
        }
    ])
})

test("authorize sends a problem back to Claude, and a stranger nowhere", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const back = "https://claude.ai/api/mcp/auth_callback?error=invalid_scope"
    const { infra } = withInfra({ status: 200, body: { redirect_to: back } })
    const to_claude = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/authorize`),
        "authorize",
        ORIGIN
    )
    expect(to_claude.headers.get("Location")).toBe(back)

    const { infra: refusing } = withInfra({
        status: 400,
        body: {
            error: {
                reason: "unknown-client",
                message: "Only Claude can connect here"
            }
        }
    })
    const stranger = await refusing.passOAuth(
        new Request(`${ORIGIN}/oauth/authorize`),
        "authorize",
        ORIGIN
    )
    expect(stranger.status).toBe(400)
    expect(stranger.headers.get("Location")).toBeNull()
    expect(await stranger.text()).toBe("Only Claude can connect here")
})

test("the token call goes to Infra's /v1/agents/oauth/token, answered as it is", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = withInfra({
        status: 400,
        body: { error: "invalid_grant", error_description: "Log in again" }
    })
    const answer = await infra.passOAuth(
        new Request(`${ORIGIN}/oauth/token`, {
            method: "POST",
            body: "grant_type=refresh_token&refresh_token=x",
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }),
        "token",
        ORIGIN
    )
    expect(answer.status).toBe(400)
    expect(await answer.json()).toEqual({
        error: "invalid_grant",
        error_description: "Log in again"
    })
    expect(received[0]?.path).toBe("/v1/agents/oauth/token")
})

test("a token is good only for the address it was made for", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const infra = standInInfra()
    const resource = "http://localhost/admin/mcp"
    const token = await standInAgentToken({
        user_id: "u-1",
        resource,
        scopes: ["read"]
    })
    const checked = await infra.checkAgentToken(token, {
        origin: "http://localhost",
        resource
    })
    expect(checked).toEqual({
        ok: true,
        data: {
            user_id: "u-1",
            scopes: ["read"],
            connection_id: expect.any(String)
        }
    })
    expect(
        await infra.checkAgentToken(token, {
            origin: "http://localhost",
            resource: "http://localhost/mcp"
        })
    ).toEqual({ ok: false, error: "invalid-token" })
})
