import { z } from "zod"

// Projects and their keys: an app is a project on Infra, and its server
// calls Infra with one of the project's keys, sent as `Authorization:
// Bearer <key>`.

/** A project's public ID's prefix: `sf_project_` and 20 letters and digits */
export const PROJECT_ID_PREFIX = "sf_project_"

/** A key's mode: `live` sends for real, `test` answers what it would have */
export const KEY_MODES = ["live", "test"] as const
export const key_mode = z.enum(KEY_MODES)
export type KeyMode = z.infer<typeof key_mode>

/**
 * Each mode's key's prefix, then 32 to 128 letters, digits and
 * underscores (`KEY_BODY`). The prefix lets a
 * leak scanner spot one, and tells a test key from a secret one at a
 * glance.
 */
export const KEY_PREFIXES: Record<KeyMode, string> = {
    live: "sf_secret_",
    test: "sf_test_"
}

/**
 * What follows a key's prefix. Infra makes 32 letters and digits today; a
 * longer key, or one with a checksum after an underscore, still fits, so
 * Infra can change how it makes them without every app refusing the new
 * ones.
 */
export const KEY_BODY = "[0-9A-Za-z_]{32,128}"

/**
 * The hostnames that are this computer: a dev server's, which a test key
 * logs Claude in at and a login link always goes to, over plain http.
 * Names under `localhost` (`app.localhost`) are too (`isLoopbackHost`).
 */
export const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"] as const

/** Whether `hostname`, as a URL's `hostname` has it, is this computer */
export function isLoopbackHost(hostname: string) {
    const name = hostname.toLowerCase()
    return (
        (LOOPBACK_HOSTNAMES as readonly string[]).includes(name) ||
        name.endsWith(".localhost")
    )
}

/**
 * `GET /v1/project`: which project the key is for, its mode, and its
 * domains, the only hosts besides localhost a login link goes to and
 * Claude logs in at
 */
export const infra_project = z.object({
    project: z.object({
        id: z.string(),
        name: z.string(),
        domains: z.array(z.string())
    }),
    mode: key_mode
})
export type InfraProject = z.output<typeof infra_project>

/**
 * The header every call carries, saying which release of @superforge/infra
 * made it (`@superforge/infra/<version>`), which Infra logs and keeps per key
 */
export const CLIENT_HEADER = "Infra-Client"
