import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseEnv } from "node:util"
import { z } from "zod"
import { unavailableOAuth } from "./agents.js"
import { INFRA_URL, infraClient } from "./client.js"
import {
    APP_PATHS,
    type AppPaths,
    KEY_BODY,
    KEY_PREFIXES
} from "./contract/all.js"
import type { Infra, InfraUnavailable } from "./infra.js"
import { standInWith, type WaitingLogin } from "./stand-in.js"

// Which Infra the server calls, by what it runs as and the keys it has:
//
// | Runs as    | Has                          | Calls                         |
// | ---------- | ---------------------------- | ----------------------------- |
// | a build    | INFRA_SECRET_KEY, sf_secret_ | Infra, which sends the emails |
// | a build    | anything else                | nothing: login is down        |
// | dev server | INFRA_TEST_KEY, sf_test_     | Infra, in test mode           |
// | dev server | none                         | the stand-in (stand-in.ts)    |
//
// A build never falls back to the stand-in, which shows the code on the
// page, nor takes a test key, which sends no email; a dev server never
// takes a secret key, so it can't email real people. An app's tests use
// the stand-in themselves. When there's nothing to call, every call
// answers unavailable with why, which an app shows its team.
//
// A dev server that has a secret key, or runs on Railway, calls nothing
// either: it's a deployed server built as a dev one (NODE_ENV=development
// on its service), and the stand-in would show anyone the code to log in
// as anyone.

// A key's shape: its prefix, then what Infra makes (KEY_BODY)
const SECRET_KEY = new RegExp(`^${KEY_PREFIXES.live}${KEY_BODY}$`)
const TEST_KEY = new RegExp(`^${KEY_PREFIXES.test}${KEY_BODY}$`)

// What Railway sets on a deployment alone, never in a checkout (`railway
// run` brings a service's variables, not this)
const DEPLOYED_MARKERS = ["RAILWAY_DEPLOYMENT_ID"]

// What the server reads to reach Infra, by the variables' names: the
// secret key Railway holds, and a checkout's test key. A dev server reads
// them from the checkout's `.env` too (`checkoutVariables`), under whatever
// the shell sets, and only a dev server reads `INFRA_URL`, which points it
// at another Infra while Infra itself is worked on, like a superforge
// checkout's own: a build always calls Infra's own address, so no variable
// can send its secret key, and every login, anywhere else. One set empty,
// as `.env.example` has them, is unset.
const unset_when_empty = (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value
const infra_environment = z.object({
    INFRA_SECRET_KEY: z.preprocess(
        unset_when_empty,
        z.string().trim().optional()
    ),
    INFRA_TEST_KEY: z.preprocess(
        unset_when_empty,
        z.string().trim().optional()
    ),
    INFRA_URL: z.preprocess(unset_when_empty, z.url().optional())
})

/** Which Infra a server calls, as `chooseInfra` chose it. */
export type InfraChoice = {
    infra: Infra
    using: "secret key" | "test key" | "stand-in" | "nothing"
}

/** The Infra a server calls, by how it runs and what it's been given. */
export function chooseInfra({
    development,
    environment,
    checkout,
    domains = [],
    paths = APP_PATHS
}: {
    // Whether this is a dev server rather than a build
    development: boolean
    // The process's environment, to read the variables above from
    environment: Record<string, string | undefined>
    // The checkout a dev server runs in, whose `.env` holds its test key
    checkout: string
    // The website's hosts, which the stand-in's project has as its domains
    domains?: string[]
    // Where the app answers Claude's login, when not `APP_PATHS`
    paths?: AppPaths
}): InfraChoice {
    // A build reads only the keys, whatever INFRA_URL says
    const parsed = infra_environment.safeParse(
        development
            ? { ...checkoutVariables(checkout), ...environment }
            : { ...environment, INFRA_URL: undefined }
    )
    if (!parsed.success) {
        const names = parsed.error.issues.map((issue) => issue.path.join("."))
        console.error("Infra can't be reached: these aren't set right", {
            names
        })
        return {
            infra: unavailableInfra(
                `Infra can't be reached: ${names.join(", ")} ${names.length === 1 ? "isn't" : "aren't"} set right${development ? " in the checkout's .env" : " on the app's service in Railway"}.`
            ),
            using: "nothing"
        }
    }
    const { INFRA_SECRET_KEY } = parsed.data

    if (!development) {
        if (
            INFRA_SECRET_KEY !== undefined &&
            SECRET_KEY.test(INFRA_SECRET_KEY)
        ) {
            console.info("Infra: calling it with the secret key")
            return {
                infra: infraClient({ key: INFRA_SECRET_KEY, paths }),
                using: "secret key"
            }
        } else {
            const message = noSecretKey(INFRA_SECRET_KEY)
            console.error("Login is down", { message })
            return { infra: unavailableInfra(message), using: "nothing" }
        }
    }

    const deployed = DEPLOYED_MARKERS.find(
        (name) => (environment[name] ?? "").trim() !== ""
    )
    if (INFRA_SECRET_KEY !== undefined || deployed !== undefined) {
        const message = `No one can log in: this server runs as a dev server, though ${deployed === undefined ? "it has INFRA_SECRET_KEY" : `it's deployed (${deployed} is set)`}, so it won't use the stand-in, which shows anyone the code. A deployed app is built for production: take NODE_ENV=development off the app's service in Railway. On this computer, take INFRA_SECRET_KEY out of the checkout's .env and the shell, and use INFRA_TEST_KEY.`
        console.error("Login is down", { message })
        return { infra: unavailableInfra(message), using: "nothing" }
    }

    // Without a slash at the end, since each call's path starts with one
    const url = (parsed.data.INFRA_URL ?? INFRA_URL).replace(/\/+$/, "")
    const test_key = parsed.data.INFRA_TEST_KEY
    if (test_key !== undefined && TEST_KEY.test(test_key)) {
        console.info("Infra: calling it with a test key", { url })
        return {
            infra: infraClient({ key: test_key, url, paths }),
            using: "test key"
        }
    } else {
        if (test_key !== undefined) {
            console.error(
                "INFRA_TEST_KEY isn't a test key (sf_test_…), so a dev server won't use it: using the stand-in"
            )
        } else {
            console.info(
                "Infra: no test key, so login uses the stand-in, which emails nothing"
            )
        }
        return {
            infra: standInWith({
                waiting: devServerLogins(),
                logs: true,
                domains
            }),
            using: "stand-in"
        }
    }
}

/**
 * The variables in this checkout's `.env`, or, in a git worktree with no
 * `.env` of its own, in its main checkout's: so a computer's test key is
 * set once, in the main checkout, and every worktree of it has it.
 */
function checkoutVariables(checkout: string) {
    const own = envFile(join(checkout, ".env"))
    if (own !== undefined) {
        return own
    }
    const main = mainCheckout(checkout)
    if (main === null) {
        return {}
    } else {
        return envFile(join(main, ".env")) ?? {}
    }
}

// What a `.env` file sets, or undefined when there's no such file
function envFile(path: string): Record<string, string | undefined> | undefined {
    if (!existsSync(path)) {
        return undefined
    }
    try {
        return parseEnv(readFileSync(path, "utf8"))
    } catch (error) {
        console.warn("A .env file couldn't be read", { path, error })
        return undefined
    }
}

// The main checkout of a git worktree, or null for a checkout that isn't
// one. A worktree's `.git` is a file naming its folder in the main
// checkout's `.git` (`gitdir: …/.git/worktrees/<name>`), whose `commondir`
// names that `.git`.
function mainCheckout(checkout: string) {
    const dot_git = join(checkout, ".git")
    try {
        if (!existsSync(dot_git) || statSync(dot_git).isDirectory()) {
            return null
        }
        const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot_git, "utf8"))
        if (pointer?.[1] === undefined) {
            return null
        }
        const worktree_git = resolve(checkout, pointer[1].trim())
        const common = readFileSync(join(worktree_git, "commondir"), "utf8")
        return dirname(resolve(worktree_git, common.trim()))
    } catch (error) {
        console.warn("A worktree's main checkout couldn't be found", {
            checkout,
            error
        })
        return null
    }
}

// A dev server's stand-in logins, kept for the process rather than the
// module, since Vite's dev server can evaluate a module again, and a code
// sent before an edit should still log in after it. Kept on `globalThis`,
// under a key of the package's own.
const LOGINS = Symbol.for("@superforge/infra stand-in logins")

function devServerLogins(): Map<string, WaitingLogin> {
    const kept: unknown = Reflect.get(globalThis, LOGINS)
    if (kept instanceof Map) {
        return kept
    } else {
        const logins = new Map<string, WaitingLogin>()
        Reflect.set(globalThis, LOGINS, logins)
        return logins
    }
}

// Why a build has no secret key to call Infra with, and what fixes it
function noSecretKey(set: string | undefined) {
    const fix =
        "Make a secret key on superforge.studio, in the project's Settings, and paste it into INFRA_SECRET_KEY on the app's service in Railway."
    if (set === undefined) {
        return `No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway. ${fix}`
    } else if (TEST_KEY.test(set)) {
        return `No one can log in: INFRA_SECRET_KEY holds a test key (sf_test_…), which never emails anyone, so a deployed app can't use it. ${fix}`
    } else {
        return `No one can log in: INFRA_SECRET_KEY isn't a secret key (sf_secret_ and 32 or more letters and digits), so something may be missing from it or added to it. ${fix}`
    }
}

// Infra when it can't be reached at all: every call answers unavailable,
// with why, and choosing it logged it
function unavailableInfra(message: string): Infra {
    const unavailable: { ok: false; error: InfraUnavailable } = {
        ok: false,
        error: { reason: "unavailable", message }
    }
    return {
        async project() {
            return unavailable
        },
        async startLogin() {
            return unavailable
        },
        async makeLoginLink() {
            return unavailable
        },
        async verifyLogin() {
            return unavailable
        },
        async fileComment() {
            return unavailable
        },
        async passOAuth() {
            return unavailableOAuth(message)
        },
        async agentRequest() {
            return unavailable
        },
        async allowAgent() {
            return unavailable
        },
        async denyAgent() {
            return unavailable
        },
        async agentConnections() {
            return unavailable
        },
        async endAgentConnection() {
            return unavailable
        },
        async endAgentConnections() {
            return unavailable
        },
        async checkAgentToken() {
            return unavailable
        }
    }
}
