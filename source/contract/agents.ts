import { z } from "zod"
import { invalid_refusal, not_found_refusal, refusal } from "./errors.js"
import { user_id } from "./people.js"
import { key_mode } from "./project.js"

// Claude logging in to an app's own MCP, through Infra, under
// `/v1/agents`: Infra is the OAuth server every app shares, so the app
// never builds one. Claude only ever talks to the app; the app's server
// passes its OAuth calls on to `/v1/agents/oauth/*`, its Allow page and
// account page call the rest, and it checks the tokens Infra signs with
// Infra's public keys, without calling Infra. Infra's README, "Claude",
// has the flow.

/** What someone on the app's team lets Claude do through its MCP */
export const AGENT_SCOPES = ["read", "act"] as const
export const agent_scope = z.enum(AGENT_SCOPES)
export type AgentScope = z.infer<typeof agent_scope>

/**
 * The header the app's server sends Claude's OAuth calls on with: where
 * Claude reached the app, `https://vmdsystem.com`, its tokens' issuer.
 * Only a header can carry it, since the call's body and query are Claude's.
 */
export const APP_ORIGIN_HEADER = "App-Origin"

/**
 * Where the app answers Claude's login, which its OAuth metadata names and
 * its authorize call sends the browser to: its OAuth calls (`/oauth`, then
 * `/authorize`, `/token`, `/register` and `/revoke`), and its Allow page
 * (`/connect`, then the request's ID). An app with others gives its own to
 * `chooseInfra`; Infra keeps none.
 */
export type AppPaths = { oauth: string; allow: string }
export const APP_PATHS: AppPaths = { oauth: "/oauth", allow: "/connect" }

/** The OAuth calls Claude makes, which the app passes on */
export const OAUTH_CALLS = ["authorize", "token", "register", "revoke"] as const
export type OAuthCall = (typeof OAUTH_CALLS)[number]

/**
 * What `GET /v1/agents/oauth/authorize` answers the app: the request Claude
 * made, for the browser to go to the app's Allow page with, or where it
 * goes back to Claude with an error
 */
export const agent_authorized = z.union([
    z.object({ request: z.object({ id: z.uuid() }) }),
    z.object({ redirect_to: z.url() })
])

/** Why authorize sends nothing back to Claude: answered as plain words */
export const authorize_refused = z.union([
    refusal("unknown-client"),
    refusal("unknown-origin"),
    invalid_refusal
])

/** `GET /v1/agents/requests/:request_id`: what the Allow page shows */
export const agent_request = z.object({
    request: z.object({
        id: z.string(),
        client_name: z.string(),
        scopes: z.array(agent_scope),
        // The address Claude asked to use, which its tokens are good for:
        // the app's MCP
        resource: z.string(),
        expires_at: z.iso.datetime().transform((value) => new Date(value))
    })
})
export type AgentRequest = z.output<typeof agent_request>["request"]

/** `POST /v1/agents/requests/:request_id/allow`: who allowed what */
export const agent_allow = z.object({
    user_id,
    scopes: z.array(agent_scope).min(1)
})
export type AgentAllow = z.input<typeof agent_allow>

/** What allowing or denying answers: where the browser goes back to Claude */
export const agent_redirect = z.object({ redirect_to: z.url() })

/** `GET` and `DELETE /v1/agents/connections?user_id=…`: whose */
export const connections_query = z.object({ user_id })

/** One of Claude's connections, as the app's Connected list shows it */
export const agent_connection = z.object({
    id: z.string(),
    user_id: z.string(),
    client_name: z.string(),
    scopes: z.array(agent_scope),
    resource: z.string(),
    // When Claude last refreshed it, to within about ten minutes
    last_used_at: z.iso.datetime().transform((value) => new Date(value)),
    created_at: z.iso.datetime().transform((value) => new Date(value))
})
export type AgentConnection = z.output<typeof agent_connection>

/** `GET /v1/agents/connections?user_id=…`: theirs, oldest first */
export const agent_connections = z.object({
    connections: z.array(agent_connection)
})

/** What ending connections answers: how many it ended */
export const agent_ended = z.object({ ended: z.number().int() })

/** Why Infra refused a call about a request or a connection */
export const agent_refused = z.union([not_found_refusal, refusal("not-asked")])
export type AgentRefused = z.output<typeof agent_refused>

/**
 * What an access token Infra signs says, beyond its issuer (the app's
 * origin), audience (the address it's for), and expiry: whom Claude acts as
 * (`sub`, the app's user ID), what they allowed (`scope`, space-separated),
 * the project and mode, and the connection it's from
 */
export const agent_claims = z.object({
    sub: z.string(),
    scope: z.string(),
    project: z.string(),
    mode: key_mode,
    connection: z.string()
})
