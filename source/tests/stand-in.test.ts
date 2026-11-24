import { afterEach, expect, test, vi } from "vitest"
import { MINUTE } from "../primitives.js"
import { standInInfra } from "../stand-in.js"

// The stand-in treats a code and a link as Infra's test mode does, so what
// the tests and a dev server without a test key see is what a test key
// gets from the real one

const EMAIL = "ada@example.com"
const LINK_TO = "http://localhost:3000/login"

afterEach(() => {
    vi.useRealTimers()
})

// A login started on a new stand-in: its code, and its link's token
async function started(link_to: string | null = LINK_TO) {
    const infra = standInInfra()
    const sent = await infra.startLogin({
        channel: "email",
        address: EMAIL,
        ip: "::1",
        link_to: link_to ?? undefined
    })
    if (!sent.ok || sent.data.test === null) {
        throw new Error("The stand-in didn't start a login")
    }
    const { code, link } = sent.data.test
    return { infra, sent: sent.data, code, token: link?.split("#")[1] }
}

test("starting answers the code, and a link to the page the app names", async () => {
    const { sent, code } = await started()
    expect(sent.address).toBe(EMAIL)
    expect(sent.with_link).toBe(true)
    expect(code).toMatch(/^\d{6}$/)
    expect(sent.test?.link).toMatch(
        /^http:\/\/localhost:3000\/login#[\w-]{43}$/
    )
})

test("a link goes only to this computer and the project's domains, over https", async () => {
    const infra = standInInfra({ domains: ["example.com"] })
    const link = async (link_to: string) => {
        const sent = await infra.startLogin({
            channel: "email",
            address: EMAIL,
            ip: "::1",
            link_to
        })
        if (!sent.ok) {
            throw new Error("The stand-in didn't start a login")
        }
        return {
            with_link: sent.data.with_link,
            page: sent.data.test?.link?.split("#")[0] ?? null
        }
    }
    expect(await link("http://example.com:8080/login?next=/a")).toEqual({
        with_link: true,
        page: "https://example.com/login?next=/a"
    })
    expect(await link("http://[::1]:3000/login")).toEqual({
        with_link: true,
        page: "http://[::1]:3000/login"
    })
    expect(await link("https://other.com/login")).toEqual({
        with_link: false,
        page: null
    })
})

test("without link_to, there's a code but no link", async () => {
    const { sent } = await started(null)
    expect(sent.with_link).toBe(false)
    expect(sent.test?.link).toBeNull()
})

test("the code logs in once", async () => {
    const { infra, code } = await started()
    expect(
        await infra.verifyLogin({ channel: "email", address: EMAIL, code })
    ).toEqual({
        ok: true,
        data: { channel: "email", address: EMAIL }
    })
    expect(
        await infra.verifyLogin({ channel: "email", address: EMAIL, code })
    ).toEqual({
        ok: false,
        error: {
            reason: "no-code",
            message: expect.stringContaining("No code is waiting")
        }
    })
})

test("the link logs in once, and spends the code with it", async () => {
    const { infra, code, token = "" } = await started()
    expect(await infra.verifyLogin({ token })).toEqual({
        ok: true,
        data: { channel: "email", address: EMAIL }
    })
    expect(await infra.verifyLogin({ token })).toEqual({
        ok: false,
        error: {
            reason: "no-link",
            message: expect.stringContaining("That link has been used")
        }
    })
    expect(
        (await infra.verifyLogin({ channel: "email", address: EMAIL, code })).ok
    ).toBe(false)
})

test("five wrong guesses stop the code, the right one after them too", async () => {
    const { infra, code } = await started()
    const wrong = code === "000000" ? "111111" : "000000"
    for (const attempts_left of [4, 3, 2, 1]) {
        expect(
            await infra.verifyLogin({
                channel: "email",
                address: EMAIL,
                code: wrong
            })
        ).toEqual({
            ok: false,
            error: {
                reason: "wrong-code",
                attempts_left,
                message: expect.stringContaining("isn't the code")
            }
        })
    }
    expect(
        await infra.verifyLogin({
            channel: "email",
            address: EMAIL,
            code: wrong
        })
    ).toEqual({
        ok: false,
        error: {
            reason: "no-code",
            message: expect.stringContaining("No code is waiting")
        }
    })
    expect(
        await infra.verifyLogin({ channel: "email", address: EMAIL, code })
    ).toEqual({
        ok: false,
        error: {
            reason: "no-code",
            message: expect.stringContaining("No code is waiting")
        }
    })
})

test("a new email replaces the last, whose code and link stop working", async () => {
    const { infra, code, token = "" } = await started()
    const again = await infra.startLogin({
        channel: "email",
        address: EMAIL,
        ip: "::1",
        link_to: LINK_TO
    })
    expect(again.ok).toBe(true)
    expect(await infra.verifyLogin({ token })).toEqual({
        ok: false,
        error: {
            reason: "no-link",
            message: expect.stringContaining("That link has been used")
        }
    })
    const old = await infra.verifyLogin({
        channel: "email",
        address: EMAIL,
        code
    })
    // The old code is wrong for the new one, unless they happen to match
    if (again.ok && again.data.test?.code !== code) {
        expect(old).toEqual({
            ok: false,
            error: {
                reason: "wrong-code",
                attempts_left: 4,
                message: expect.stringContaining("4 more times")
            }
        })
    }
})

test("the code and the link stop after 15 minutes", async () => {
    vi.useFakeTimers()
    const { infra, code, token = "" } = await started()
    vi.advanceTimersByTime(15 * MINUTE)
    expect(
        await infra.verifyLogin({ channel: "email", address: EMAIL, code })
    ).toEqual({
        ok: false,
        error: {
            reason: "no-code",
            message: expect.stringContaining("No code is waiting")
        }
    })
    expect(await infra.verifyLogin({ token })).toEqual({
        ok: false,
        error: {
            reason: "no-link",
            message: expect.stringContaining("That link has been used")
        }
    })
})
