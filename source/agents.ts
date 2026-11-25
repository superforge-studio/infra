import {
    createRemoteJWKSet,
    customFetch,
    errors,
    type JWTVerifyGetKey,
    jwtVerify
} from "jose"
import {
    AGENT_SCOPES,
    APP_ORIGIN_HEADER,
    type AppPaths,
    agent_authorized,
    agent_claims,
    authorize_refused,
    CLIENT_HEADER,
    infra_failure,
    isLoopbackHost,
    type KeyMode,
    type OAuthCall
} from "./contract/all.js"
import type {
    AgentToken,
    AgentTokenRefused,
    InfraUnavailable
} from "./infra.js"
import { CALL_TIMEOUT, SECOND } from "./primitives.js"
import type { AsyncOperationResult } from "./results.js"
import { CLIENT } from "./version.js"

// Claude logging in to an app's own MCP, through Infra: Infra is the OAuth
// server, and the app only checks the tokens it signs, with Infra's public
// keys, never asking Infra (Infra's README, "Claude"). This is what of it
// the client does: where the app was reached, the server's metadata, the
// OAuth calls Claude makes, passed on to Infra, and checking a token.

/**
 * Where a request reached the app: `https://example.com`, or plain http
 * on this computer (`LOOPBACK_HOSTNAMES`), as a dev server is. Behind Railway's proxy a request's
 * own address says http though the browser's said https, so only the host
 * counts. Every token Claude holds is bound to it, as its issuer.
 */
export function requestOrigin(request_url: string) {
    const { host, hostname } = new URL(request_url)
    return isLoopbackHost(hostname) ? `http://${host}` : `https://${host}`
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
 * The most bytes a body Claude sends to the token, register and revoke
 * calls may be: each is a few hundred, and they're the app's only calls
 * that take a body from anyone, unauthenticated, and send it on to Infra
 */
export const OAUTH_BODY_LIMIT = 16 * 1024

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
    let body: string | undefined
    if (request.method !== "GET" && request.method !== "HEAD") {
        const read = await limitedText(request, OAUTH_BODY_LIMIT)
        if (read === null) {
            console.warn("Claude's OAuth call is over its limit", { call })
            return Response.json(
                {
                    error: "invalid_request",
                    error_description: `This call's body is over ${OAUTH_BODY_LIMIT} bytes, the most it takes.`
                },
                { status: 413, headers: { "Cache-Control": "no-store" } }
            )
        }
        body = read
    }
    const path = `/agents/oauth/${call}`
    let answer: Response
    try {
        answer = await send(`${url}${path}${search}`, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(CALL_TIMEOUT)
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
    if (answer.status >= 200 && answer.status < 300 && made.success) {
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
 * A request's body as text, or null once it's over `limit` bytes: by its
 * `Content-Length` when it says one, then while it's read, so a body that
 * lies about its length is stopped too, and never held whole
 */
async function limitedText(request: Request, limit: number) {
    const length = Number(request.headers.get("content-length") ?? "0")
    if (length > limit) {
        return null
    }
    if (request.body === null) {
        return ""
    }
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }
        size += value.byteLength
        if (size > limit) {
            await reader.cancel()
            return null
        }
        chunks.push(value)
    }
    const whole = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
        whole.set(chunk, at)
        at += chunk.byteLength
    }
    return new TextDecoder().decode(whole)
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

/**
 * Where a token's signature is checked: Infra's published public keys,
 * fetched with `send`, saying which release asks, as every call does
 */
export function infraKeys(
    url: string,
    send: typeof fetch = fetch
): JWTVerifyGetKey {
    return createRemoteJWKSet(
        new URL("/.well-known/jwks.json", new URL(url).origin),
        {
            headers: { [CLIENT_HEADER]: CLIENT },
            timeoutDuration: 10 * SECOND,
            cooldownDuration: 30 * SECOND,
            [customFetch]: send
        }
    )
}

// How much a token's times may be off, for an app server whose clock is a
// few seconds from Infra's
const CLOCK_TOLERANCE_SECONDS = 5

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
): AsyncOperationResult<AgentToken, AgentTokenRefused | InfraUnavailable> {
    try {
        const { payload } = await jwtVerify(token, keys, {
            issuer: expected.origin,
            audience: expected.resource,
            algorithms: ["ES256"],
            typ: "at+jwt",
            requiredClaims: ["exp"],
            clockTolerance: CLOCK_TOLERANCE_SECONDS
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
            return invalidToken(
                "Claude's token is for another project or key mode than this app's key, so it can't be used here. Claude logs in again."
            )
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
        if (keySetFailed(error)) {
            console.error("Infra's public keys couldn't be fetched", {
                origin: expected.origin,
                error
            })
            return {
                ok: false,
                error: {
                    reason: "unavailable",
                    message:
                        "Infra's public keys couldn't be fetched, so Claude's token can't be checked. Infra may be down; trying again in a few minutes may work."
                }
            }
        }
        console.info("Agent token refused", { origin: expected.origin, error })
        return invalidToken(whyRefused(error))
    }
}

function invalidToken(message: string): {
    ok: false
    error: AgentTokenRefused
} {
    return { ok: false, error: { reason: "invalid-token", message } }
}

// Whether checking a token failed on fetching Infra's keys, rather than on
// the token: a timeout, no answer, an answer that isn't 200, or one that
// isn't a key set. Infra being down then isn't the token's fault.
function keySetFailed(error: unknown) {
    return (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof errors.JOSEError &&
            error.code === "ERR_JOSE_GENERIC" &&
            (error.message.startsWith("Expected 200 OK") ||
                error.message.startsWith(
                    "Failed to parse the JSON Web Key Set"
                )))
    )
}

// Why a token was refused, in words, by what jose found
function whyRefused(error: unknown) {
    if (error instanceof errors.JWTExpired) {
        return "Claude's token has run out. Claude refreshes it, or logs in again."
    } else if (error instanceof errors.JWTClaimValidationFailed) {
        if (error.claim === "aud") {
            return "Claude's token is for another address than the one it was brought to."
        } else if (error.claim === "iss") {
            return "Claude's token was made for another app, or for this app at another address."
        } else {
            return `Claude's token's ${error.claim} claim isn't what Infra signs.`
        }
    } else {
        return "Claude's token isn't one Infra signed. Claude logs in again."
    }
}
