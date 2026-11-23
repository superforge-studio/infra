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
 * Each mode's key's prefix, then 32 letters and digits. The prefix lets a
 * leak scanner spot one, and tells a test key from a secret one at a
 * glance.
 */
export const KEY_PREFIXES: Record<KeyMode, string> = {
    live: "sf_secret_",
    test: "sf_test_"
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
 * made it (`@superforge/infra/0.3.0`), which Infra logs and keeps per key
 */
export const CLIENT_HEADER = "Infra-Client"
