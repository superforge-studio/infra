import { readFileSync } from "node:fs"
import { expect, test, vi } from "vitest"
import { infraClient } from "../client.js"
import { CLIENT, CLIENT_HEADER, PACKAGE_VERSION } from "../version.js"

// Every call tells Infra which version of the package made it, so Infra
// knows which version each app is on

const KEY = "sf_test_0123456789abcdefghijklmnopqrstuv"

test("the version every call sends is package.json's", () => {
    const package_json: unknown = JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    )
    expect(package_json).toMatchObject({
        name: "@superforge/infra",
        version: PACKAGE_VERSION
    })
    expect(CLIENT).toBe(`@superforge/infra/${PACKAGE_VERSION}`)
})

test("every call says which version made it, Claude's passed through too", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const sent: (string | null)[] = []
    const infra = infraClient({
        key: KEY,
        url: "https://infra.test/v1",
        send: async (_input, init) => {
            sent.push(new Headers(init?.headers).get(CLIENT_HEADER))
            return Response.json(
                { error: "no-code", message: "Start again." },
                {
                    status: 400
                }
            )
        }
    })
    await infra.verifyLogin({ email: "ada@example.com", code: "123456" })
    await infra.agentConnections("ada@example.com")
    await infra.passOAuth(
        new Request("https://vmdsystem.com/oauth/token", { method: "POST" }),
        "/token",
        "https://vmdsystem.com"
    )
    expect(sent).toEqual([CLIENT, CLIENT, CLIENT])
    expect(CLIENT_HEADER).toBe("Infra-Client")
})
