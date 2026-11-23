import { Hono } from "hono"
import { expect, test, vi } from "vitest"
import { infraClient } from "../client.js"
import type { FiledComment } from "../infra.js"

// The client against a fake of Infra's API, answering what Infra's README
// says each call answers, so no test reaches the real one

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"
const ADDRESS = "https://infra.test/v1"

// Infra, answering `answer` to every call, and what each call sent it
function fakeInfra(answer: { status: number; body: unknown }) {
    const received: { path: string; key: string | null; body: unknown }[] = []
    const fake = new Hono().post("*", async (context) => {
        received.push({
            path: context.req.path,
            key: context.req.header("Authorization") ?? null,
            body: await context.req.json()
        })
        return new Response(JSON.stringify(answer.body), {
            status: answer.status,
            headers: { "Content-Type": "application/json" }
        })
    })
    const send: typeof fetch = async (input, init) =>
        fake.request(typeof input === "string" ? input : input.toString(), init)
    return { infra: infraClient({ key: KEY, url: ADDRESS, send }), received }
}

test("starting a login sends the key, the visitor and the app's origin", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 200,
        body: {
            email: "ada@example.com",
            with_link: true,
            expires_at: "2026-11-15T18:15:00.000Z",
            test: { code: "123456", link: "http://localhost:3000/login#x" }
        }
    })
    const started = await infra.startLogin({
        email: "ada@example.com",
        ip: "203.0.113.7",
        origin: "http://localhost:3000"
    })
    expect(started).toEqual({
        ok: true,
        data: {
            email: "ada@example.com",
            with_link: true,
            expires_at: new Date("2026-11-15T18:15:00.000Z"),
            test: { code: "123456", link: "http://localhost:3000/login#x" }
        }
    })
    expect(received).toEqual([
        {
            path: "/v1/login/start",
            key: `Bearer ${KEY}`,
            body: {
                email: "ada@example.com",
                ip: "203.0.113.7",
                origin: "http://localhost:3000"
            }
        }
    ])
})

test("with no origin, none is sent", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 200,
        body: {
            email: "ada@example.com",
            with_link: false,
            expires_at: "2026-11-15T18:15:00.000Z",
            test: null
        }
    })
    await infra.startLogin({
        email: "ada@example.com",
        ip: "::1",
        origin: null
    })
    expect(received[0]?.body).toEqual({ email: "ada@example.com", ip: "::1" })
})

test("Infra's limits come back as the app's refusals", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const cases = [
        {
            answer: {
                status: 429,
                body: {
                    error: "too-soon",
                    message: "Ask again in 42 seconds.",
                    retry_after: 42
                }
            },
            refused: {
                reason: "too-soon",
                message: "Ask again in 42 seconds.",
                retry_after: 42
            }
        },
        {
            answer: {
                status: 429,
                body: { error: "too-many", limit: "ip", retry_after: 1800 }
            },
            // An Infra from before every error said why gets the client's
            // own words
            refused: {
                reason: "too-many",
                limit: "ip",
                retry_after: 1800,
                message:
                    "Infra has sent as many login emails as it sends in an hour."
            }
        },
        {
            answer: {
                status: 502,
                body: {
                    error: "not-sent",
                    message: "Resend refused it."
                }
            },
            refused: { reason: "not-sent", message: "Resend refused it." }
        }
    ]
    for (const { answer, refused } of cases) {
        const { infra } = fakeInfra(answer)
        expect(
            await infra.startLogin({
                email: "ada@example.com",
                ip: "::1",
                origin: null
            })
        ).toEqual({ ok: false, error: refused })
    }
})

test("verifying sends the code or the token, and answers the email", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra, received } = fakeInfra({
        status: 200,
        body: { email: "ada@example.com" }
    })
    const token = "a".repeat(43)
    expect(
        await infra.verifyLogin({ email: "ada@example.com", code: "123456" })
    ).toEqual({ ok: true, data: { email: "ada@example.com" } })
    expect(await infra.verifyLogin({ token })).toEqual({
        ok: true,
        data: { email: "ada@example.com" }
    })
    expect(received.map((each) => each.body)).toEqual([
        { email: "ada@example.com", code: "123456" },
        { token }
    ])
})

test("a code Infra refuses says why", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const cases = [
        {
            body: { error: "wrong-code", attempts_left: 3, message: "Not it." },
            refused: {
                reason: "wrong-code",
                attempts_left: 3,
                message: "Not it."
            }
        },
        {
            body: { error: "no-code", message: "Start again." },
            refused: { reason: "no-code", message: "Start again." }
        },
        {
            body: { error: "no-link" },
            refused: {
                reason: "no-link",
                message: "That link has been used or has run out."
            }
        }
    ]
    for (const { body, refused } of cases) {
        const { infra } = fakeInfra({ status: 400, body })
        expect(
            await infra.verifyLogin({
                email: "ada@example.com",
                code: "123456"
            })
        ).toEqual({ ok: false, error: refused })
    }
})

test("a key Infra refuses is unavailable, with Infra's words for why, and logged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const revoked = {
        error: "revoked-key",
        message: "This secret key was revoked on 2026-11-20."
    }
    const { infra } = fakeInfra({ status: 401, body: revoked })
    expect(
        await infra.startLogin({
            email: "ada@example.com",
            ip: "::1",
            origin: null
        })
    ).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: "This secret key was revoked on 2026-11-20."
        }
    })
    expect(logged).toHaveBeenCalledWith(
        "Infra answered what the client doesn't expect",
        expect.objectContaining({ status: 401, answer: revoked })
    )

    // From an Infra that gave no words, the client says where the key goes
    const { infra: older } = fakeInfra({
        status: 401,
        body: { error: "revoked-key" }
    })
    const refused = await older.verifyLogin({ token: "a".repeat(43) })
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error.message).toContain(
        "INFRA_SECRET_KEY on the app's service in Railway"
    )
})

test("an error this version doesn't know comes with Infra's words, like a call it retired", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { infra } = fakeInfra({
        status: 410,
        body: {
            error: "retired",
            message: "Infra's login moved: ask Claude to update the app."
        }
    })
    expect(
        await infra.startLogin({
            email: "ada@example.com",
            ip: "::1",
            origin: null
        })
    ).toEqual({
        ok: false,
        error: {
            reason: "unavailable",
            message: "Infra's login moved: ask Claude to update the app."
        }
    })

    // Without words, it says the package may be behind Infra
    const { infra: silent } = fakeInfra({
        status: 418,
        body: { error: "teapot" }
    })
    const refused = await silent.verifyLogin({ token: "a".repeat(43) })
    expect(!refused.ok && refused.error.message).toBe(
        "Infra answered /login/verify with 418 teapot, which this version of @superforge/infra doesn't know. Ask Claude to update @superforge/infra in the app."
    )
})

test("every refusal is logged with Infra's words", async () => {
    const logged = vi.spyOn(console, "info").mockImplementation(() => {})
    const { infra } = fakeInfra({
        status: 400,
        body: { error: "no-code", message: "Start again." }
    })
    await infra.verifyLogin({ email: "ada@example.com", code: "123456" })
    expect(logged).toHaveBeenCalledWith("Infra refused a call", {
        call: "/login/verify",
        status: 400,
        error: "no-code",
        message: "Start again."
    })
})

test("an answer that isn't Infra's shape is unavailable, and logged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const { infra } = fakeInfra({ status: 200, body: { email: 42 } })
    expect(
        await infra.verifyLogin({ email: "ada@example.com", code: "123456" })
    ).toEqual({
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
    expect(
        await down.startLogin({
            email: "ada@example.com",
            ip: "::1",
            origin: null
        })
    ).toEqual({
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
    expect(logged).toHaveBeenCalledWith(
        "Infra answered without JSON",
        expect.objectContaining({ status: 502 })
    )
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
    user: "5f0c1a2b-3d4e-4f60-8a9b-0c1d2e3f4a5b",
    user_agent: "Mozilla/5.0"
}

test("a comment goes to /v1/comments with the key, and answers its ID", async () => {
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
        { path: "/v1/comments", key: `Bearer ${KEY}`, body: COMMENT }
    ])
})

test("a comment Infra refuses says why, and is logged as the app's mistake", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const { infra } = fakeInfra({
        status: 400,
        body: {
            error: "invalid",
            fields: ["element.tag"],
            message: "element.tag didn't fit what this call takes."
        }
    })
    const refused = {
        reason: "invalid",
        fields: ["element.tag"],
        message: "element.tag didn't fit what this call takes."
    }
    expect(await infra.fileComment(COMMENT)).toEqual({
        ok: false,
        error: refused
    })
    expect(logged).toHaveBeenCalledWith("Infra refused a comment", {
        call: "/comments",
        refused
    })
})

test("a comment to an Infra that's down, or answers 200, is unavailable", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const answer of [
        { status: 503, body: { error: "unavailable" } },
        { status: 200, body: { kept: 1 } },
        { status: 401, body: { error: "revoked-key" } }
    ]) {
        const { infra } = fakeInfra(answer)
        expect(await infra.fileComment(COMMENT)).toEqual({
            ok: false,
            error: { reason: "unavailable", message: expect.any(String) }
        })
    }
})

test("the key's project, and none of its domains from an Infra from before it answered them", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const answer = (project: object) => {
        const fake = new Hono().get("*", () =>
            Response.json({ project, mode: "live" })
        )
        return infraClient({
            key: KEY,
            url: ADDRESS,
            send: async (input, init) =>
                fake.request(
                    typeof input === "string" ? input : input.toString(),
                    init
                )
        })
    }
    expect(
        await answer({
            id: "sf_project_1",
            name: "VMD System",
            domains: ["vmdsystem.com"]
        }).project()
    ).toEqual({
        ok: true,
        data: {
            project: {
                id: "sf_project_1",
                name: "VMD System",
                domains: ["vmdsystem.com"]
            },
            mode: "live"
        }
    })
    const older = await answer({
        id: "sf_project_1",
        name: "VMD System"
    }).project()
    expect(older.ok && older.data.project.domains).toBeNull()
})
