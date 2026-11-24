import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, expect, test, vi } from "vitest"
import { chooseInfra } from "../choose.js"

// Which Infra a server calls, by what it runs as and the keys it has: a
// build only ever with a secret key, a dev server only ever with a test key
// or the stand-in

const SECRET_KEY = `sf_secret_${"A1".repeat(16)}`
const TEST_KEY = `sf_test_${"b2".repeat(16)}`

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})

// A folder for a checkout of the test's own, with no `.env`
function emptyCheckout() {
    return mkdtempSync(join(tmpdir(), "app-infra-"))
}

function choose(
    development: boolean,
    environment: Record<string, string>,
    checkout = emptyCheckout()
) {
    return chooseInfra({ development, environment, checkout }).using
}

test("a build calls Infra with its secret key", () => {
    expect(choose(false, { INFRA_SECRET_KEY: SECRET_KEY })).toBe("secret key")
})

test("a build without a secret key calls nothing, rather than the stand-in", () => {
    expect(choose(false, {})).toBe("nothing")
    expect(choose(false, { INFRA_SECRET_KEY: TEST_KEY })).toBe("nothing")
    expect(choose(false, { INFRA_TEST_KEY: TEST_KEY })).toBe("nothing")
    expect(choose(false, { INFRA_SECRET_KEY: "sf_secret_short" })).toBe(
        "nothing"
    )
})

test("a dev server calls Infra with a test key, and never a secret one", () => {
    expect(choose(true, { INFRA_TEST_KEY: TEST_KEY })).toBe("test key")
    expect(choose(true, { INFRA_TEST_KEY: SECRET_KEY })).toBe("stand-in")
    expect(choose(true, {})).toBe("stand-in")
})

test("a dev server with a secret key, or deployed, calls nothing, not the stand-in", async () => {
    expect(choose(true, { INFRA_SECRET_KEY: SECRET_KEY })).toBe("nothing")
    expect(
        choose(true, { INFRA_SECRET_KEY: SECRET_KEY, INFRA_TEST_KEY: TEST_KEY })
    ).toBe("nothing")
    expect(choose(true, { RAILWAY_DEPLOYMENT_ID: "d-1" })).toBe("nothing")
    const { infra } = chooseInfra({
        development: true,
        environment: { RAILWAY_DEPLOYMENT_ID: "d-1" },
        checkout: emptyCheckout()
    })
    const started = await infra.startLogin({
        channel: "email",
        address: "ada@example.com",
        ip: "203.0.113.7"
    })
    expect(!started.ok && started.error.message).toContain(
        "take NODE_ENV=development off"
    )
})

test("a key may be longer than 32, and carry an underscore", () => {
    const longer = `sf_secret_${"A1".repeat(20)}_x9`
    expect(choose(false, { INFRA_SECRET_KEY: longer })).toBe("secret key")
    expect(choose(true, { INFRA_TEST_KEY: `sf_test_${"b2".repeat(40)}` })).toBe(
        "test key"
    )
    expect(
        choose(false, { INFRA_SECRET_KEY: `sf_secret_${"a".repeat(31)}` })
    ).toBe("nothing")
    expect(choose(false, { INFRA_SECRET_KEY: `${SECRET_KEY}-` })).toBe(
        "nothing"
    )
})

test("a dev server reads its test key from the checkout's .env", () => {
    const checkout = emptyCheckout()
    writeFileSync(join(checkout, ".env"), `INFRA_TEST_KEY=${TEST_KEY}\n`)
    expect(choose(true, {}, checkout)).toBe("test key")
})

test("a worktree with no .env of its own reads its main checkout's", () => {
    // A main checkout with a .env, and a worktree of it, as git lays them
    // out: the worktree's .git a file naming its folder in the main's .git
    const main = emptyCheckout()
    writeFileSync(join(main, ".env"), `INFRA_TEST_KEY="${TEST_KEY}"\n`)
    const worktree_git = join(main, ".git", "worktrees", "feature")
    mkdirSync(worktree_git, { recursive: true })
    writeFileSync(join(worktree_git, "commondir"), "../..\n")
    const worktree = join(main, ".claude", "worktrees", "feature")
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktree_git}\n`)

    expect(choose(true, {}, worktree)).toBe("test key")
})

test("a variable set empty, as .env.example has them, is unset", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(choose(true, { INFRA_TEST_KEY: "", INFRA_URL: "" })).toBe("stand-in")
    expect(logged).not.toHaveBeenCalled()
})

test("a build never reads INFRA_URL, so no variable sends its key elsewhere", () => {
    expect(
        choose(false, { INFRA_SECRET_KEY: SECRET_KEY, INFRA_URL: "not a url" })
    ).toBe("secret key")
    expect(
        choose(true, { INFRA_TEST_KEY: TEST_KEY, INFRA_URL: "not a url" })
    ).toBe("nothing")
})

test("a build with nothing to call says why at every call, and what fixes it", async () => {
    // Why login can't work, as the team is told it
    async function why(environment: Record<string, string>) {
        const { infra } = chooseInfra({
            development: false,
            environment,
            checkout: emptyCheckout()
        })
        const started = await infra.startLogin({
            channel: "email",
            address: "ada@example.com",
            ip: "::1"
        })
        return started.ok ? null : started.error.message
    }
    expect(await why({})).toBe(
        "No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway. Make a secret key on superforge.studio, in the project's Settings, and paste it into INFRA_SECRET_KEY on the app's service in Railway."
    )
    expect(await why({ INFRA_SECRET_KEY: TEST_KEY })).toContain(
        "holds a test key (sf_test_…), which never emails anyone"
    )
    expect(await why({ INFRA_SECRET_KEY: "sf_secret_short" })).toContain(
        "isn't a secret key (sf_secret_ and 32 or more letters and digits)"
    )

    // Claude's OAuth calls say it too, as OAuth's error_description
    const { infra } = chooseInfra({
        development: false,
        environment: {},
        checkout: emptyCheckout()
    })
    const passed = await infra.passOAuth(
        new Request("https://example.com/oauth/token", { method: "POST" }),
        "token",
        "https://example.com"
    )
    expect(passed.status).toBe(503)
    expect((await passed.json()).error_description).toContain(
        "INFRA_SECRET_KEY isn't set"
    )
})

test("the stand-in a dev server gets has the website's domains", async () => {
    const { infra } = chooseInfra({
        development: true,
        environment: {},
        checkout: emptyCheckout(),
        domains: ["example.com"]
    })
    const project = await infra.project()
    expect(project.ok && project.data.project.domains).toEqual(["example.com"])
})
