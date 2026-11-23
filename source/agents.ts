import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose"
import {
    AGENT_SCOPES,
    APP_ORIGIN_HEADER,
    type AppPaths,
    agent_authorized,
    agent_claims,
    authorize_refused,
    CLIENT_HEADER,
    infra_failure,
    type KeyMode,
    type OAuthCall
} from "./contract/index.js"
import type { AgentToken } from "./infra.js"
import { SECOND } from "./primitives.js"
import type { AsyncOperationResult } from "./results.js"
import { CLIENT } from "./version.js"

// Claude logging in to an app's own MCP, through Infra: Infra is the OAuth
// server, and the app only checks the tokens it signs, with Infra's public
// keys, never asking Infra (Infra's README, "Claude"). This is what of it
// the client does: where the app was reached, the server's metadata, the
// OAuth calls Claude makes, passed on to Infra, and checking a token.

/**
 * Where a request reached the app: `https://vmdsystem.com`, or plain http
 * on this computer, as a dev server is. Behind Railway's proxy a request's
 * own address says http though the browser's said https, so only the host
 * counts. Every token Claude holds is bound to it, as its issuer.
 */
export function requestOrigin(request_url: string) {
    const { host, hostname } = new URL(request_url)
    const local =
        ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
        hostname.endsWith(".localhost")
    return local ? `http://${host}` : `https://${host}`
}

/**
 * The OAuth server's metadata (RFC 8414), which Claude reads at the app's
 * `/.well-known/oauth-authorization-server`: the app is the issuer, its
 * own addresses the server's, and Infra's public keys the ones its tokens
 * are signed with. It's the same for every app but for those, so the
 * client builds it, with no call to Infra.
 */
export function oauthMetadata({
    origin,
    paths,
    infra_url
}: {
    origin: string
    paths: AppPaths
    infra_url: string
}) {
    const oauth = `${origin}${paths.oauth}`
    return {
        issuer: origin,
        authorization_endpoint: `${oauth}/authorize`,
        token_endpoint: `${oauth}/token`,
        registration_endpoint: `${oauth}/register`,
        revocation_endpoint: `${oauth}/revoke`,
        jwks_uri: new URL("/.well-known/jwks.json", new URL(infra_url).origin)
            .href,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [...AGENT_SCOPES],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true
    }
}

// What a call passed on may carry, of the request Claude or the browser
// sent: what the body is, and what Claude accepts back
const PASSED_HEADERS = ["accept", "content-type"]

/**
 * Answers one of Claude's OAuth calls to the app (`call`), its request
 * unread:
 *
 * - `metadata`: built here (`oauthMetadata`)
 * - `authorize`: Infra saves the request, then the browser goes to the
 *   app's Allow page, `<paths.allow>/<request id>`, or back to Claude with
 *   an error. One whose return address isn't Claude's is answered 400 in
 *   plain words, never redirected, so the app is never an open redirect.
 * - `token`, `register`, `revoke`: Infra's answer, as it is (RFC 6749's)
 */
export async function passOAuth({
    url,
    key,
    send,
    paths,
    request,
    call,
    origin
}: {
    url: string
    key: string
    send: typeof fetch
    paths: AppPaths
    request: Request
    call: OAuthCall | "metadata"
    origin: string
}): Promise<Response> {
    if (call === "metadata") {
        return Response.json(oauthMetadata({ origin, paths, infra_url: url }), {
            headers: { "Cache-Control": "no-store" }
        })
    }
    const { search } = new URL(request.url)
    const headers = new Headers({
        Authorization: `Bearer ${key}`,
        [APP_ORIGIN_HEADER]: origin,
        [CLIENT_HEADER]: CLIENT
    })
    for (const name of PASSED_HEADERS) {
        const value = request.headers.get(name)
        if (value !== null) {
            headers.set(name, value)
        }
    }
    const body =
        request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.text()
    const path = `/agents/oauth/${call}`
    let answer: Response
    try {
        answer = await send(`${url}${path}${search}`, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(15 * SECOND)
        })
    } catch (error) {
        console.error("Infra didn't answer", { call: path, error })
        return unavailableOAuth(
            "Infra didn't answer this app's call, so Claude can't log in. It may be down; trying again in a few minutes may work."
        )
    }
    console.info("Infra answered", { call: path, status: answer.status })
    if (call === "authorize") {
        return await authorized(answer, origin, paths)
    }
    const passed = new Headers({ "Cache-Control": "no-store" })
    const type = answer.headers.get("content-type")
    if (type !== null) {
        passed.set("content-type", type)
    }
    return new Response(await answer.arrayBuffer(), {
        status: answer.status,
        headers: passed
    })
}

// Where the browser goes from Claude's authorize request, by what Infra
// answered: the app's Allow page, back to Claude, or nowhere, with why
async function authorized(answer: Response, origin: string, paths: AppPaths) {
    const json: unknown = await answer.json().catch((error: unknown) => {
        console.error("Infra's authorize answer isn't JSON", {
            status: answer.status,
            error
        })
        return null
    })
    const made = agent_authorized.safeParse(json)
    if (answer.status === 200 && made.success) {
        const to =
            "request" in made.data
                ? `${origin}${paths.allow}/${made.data.request.id}`
                : made.data.redirect_to
        return new Response(null, {
            status: 302,
            headers: { Location: to, "Cache-Control": "no-store" }
        })
    }
    const refused = authorize_refused.safeParse(json)
    if (refused.success) {
        console.warn("Claude's authorize request refused", {
            reason: refused.data.reason
        })
        return new Response(refused.data.message, {
            status: 400,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store"
            }
        })
    }
    const failed = infra_failure.safeParse(json)
    console.error("Infra's authorize answer doesn't fit", {
        status: answer.status,
        answer: json
    })
    return unavailableOAuth(
        failed.success
            ? failed.data.error.message
            : `Infra answered Claude's authorize request with ${answer.status}, in a shape this version of @superforge/infra can't read.`
    )
}

/**
 * What one of Claude's OAuth calls answers when Infra can't be asked, as
 * RFC 6749 has it, so Claude says why login isn't working rather than
 * looping: why, as `error_description`, which Claude shows
 */
export function unavailableOAuth(message: string) {
    return Response.json(
        { error: "temporarily_unavailable", error_description: message },
        { status: 503, headers: { "Cache-Control": "no-store" } }
    )
}

/** Where a token's signature is checked: Infra's published public keys */
export function infraKeys(url: string): JWTVerifyGetKey {
    return createRemoteJWKSet(
        new URL("/.well-known/jwks.json", new URL(url).origin),
        { timeoutDuration: 10 * SECOND, cooldownDuration: 30 * SECOND }
    )
}

/**
 * Checks a token Claude brings, as Infra's README says to: Infra signed
 * it, for this app's `origin`, for `resource`, the address it was brought
 * to, for this project in the key's mode, and it hasn't run out
 */
export async function checkToken(
    keys: JWTVerifyGetKey,
    token: string,
    expected: {
        origin: string
        resource: string
        project: string
        mode: KeyMode
    }
): AsyncOperationResult<AgentToken, "invalid-token"> {
    try {
        const { payload } = await jwtVerify(token, keys, {
            issuer: expected.origin,
            audience: expected.resource,
            algorithms: ["ES256"]
        })
        const claims = agent_claims.safeParse(payload)
        if (
            !claims.success ||
            claims.data.project !== expected.project ||
            claims.data.mode !== expected.mode
        ) {
            console.warn("Agent token not for this app", {
                origin: expected.origin
            })
            return { ok: false, error: "invalid-token" }
        } else {
            const said = claims.data.scope.split(" ")
            return {
                ok: true,
                data: {
                    user_id: claims.data.sub,
                    scopes: AGENT_SCOPES.filter((scope) =>
                        said.includes(scope)
                    ),
                    connection_id: claims.data.connection
                }
            }
        }
    } catch (error) {
        console.info("Agent token refused", { origin: expected.origin, error })
        return { ok: false, error: "invalid-token" }
    }
}
