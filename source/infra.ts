import type {
    AgentAllow,
    AgentConnection,
    AgentRefused,
    AgentRequest,
    CommentRefused,
    FiledComment,
    InfraProject,
    KeptComment,
    LinkRefused,
    LoginLink,
    LoginProof,
    LoginStart,
    MadeLoginLink,
    OAuthCall,
    StartedLogin,
    StartRefused,
    VerifiedLogin,
    VerifyRefused
} from "./contract/all.js"
import type { AsyncOperationResult } from "./results.js"

// Superforge Infra, the backend services an app runs on, as an app's
// server calls it: login, where Infra sends a person a code and a link and
// says whether what they brought back is right; comments, what the app's
// people said about it from its toolbar; Claude's login to the app's MCP;
// and which project the app's key is for. The app keeps its own users,
// sessions and analytics. Infra's API reference (the Superforge MCP's `read_infra_docs`) has the
// calls; an app reaches
// them through one of these, the real Infra (client.ts) or the stand-in
// (stand-in.ts), as `chooseInfra` picks (choose.ts). Every refusal is
// Infra's own `error`, `{ reason, message, … }`, as its contract has it
// (contract/), or one of the package's own (`CLIENT_ERRORS`):
// `unavailable`, or `invalid-token` for a token Claude brought.

/** What an app asks of Infra, whichever answers: the real one or the stand-in */
export type Infra = {
    /**
     * Which project the key is for, its mode, and its domains, the only
     * hosts besides localhost its login links go to and Claude logs in at
     */
    project(): AsyncOperationResult<InfraProject, InfraUnavailable>
    /**
     * Sends someone a six-digit code, on `channel` to `address`, and a link
     * to `link_to` when it's on one of the project's domains or localhost.
     * `ip` is theirs, which Infra's limits count.
     */
    startLogin(
        request: LoginStart
    ): AsyncOperationResult<StartedLogin, StartRefused | InfraUnavailable>
    /**
     * Makes a login whose link the app sends in a message of its own, like
     * a welcome email, rather than Infra sending one: a link to `link_to`,
     * which must be on one of the project's domains or localhost, that
     * logs in once, for 24 hours. It's counted and limited as a login
     * Infra sends is. `ip` is the person's, which Infra's limits count.
     */
    makeLoginLink(
        request: LoginLink
    ): AsyncOperationResult<MadeLoginLink, LinkRefused | InfraUnavailable>
    /**
     * Whose address `proof` is: the code typed with the address it went to,
     * or the link's token alone. Either works once, and spends the other.
     */
    verifyLogin(
        proof: LoginProof
    ): AsyncOperationResult<VerifiedLogin, VerifyRefused | InfraUnavailable>
    /**
     * Sends Infra a comment someone on the app's team filed from its
     * toolbar, with who they are. Infra keeps it, a test key's too, and
     * answers its ID. It's never retried: a comment sent twice is kept
     * twice.
     */
    fileComment(
        comment: FiledComment
    ): AsyncOperationResult<KeptComment, CommentRefused | InfraUnavailable>

    // Claude logging in to the app's MCP, Infra being the OAuth server
    // (agents.ts, and Infra's README, "Claude")

    /**
     * Answers one of Claude's OAuth calls to the app, Claude's or the
     * browser's `request` unread: the server's metadata, built here, and
     * the rest on Infra, with the app's key and `origin`. Authorize sends
     * the browser to the app's Allow page, or back to Claude.
     */
    passOAuth(
        request: Request,
        call: OAuthCall | "metadata",
        origin: string
    ): Promise<Response>
    /** What the Allow page shows of a request Claude made */
    agentRequest(
        request_id: string
    ): AsyncOperationResult<AgentRequest, AgentRefused | InfraUnavailable>
    /**
     * Someone on the team, by the app's ID for them, allowed Claude's
     * request: where their browser goes back to Claude, with the one-time
     * code
     */
    allowAgent(
        request_id: string,
        allowed: AgentAllow
    ): AsyncOperationResult<
        { redirect_to: string },
        AgentRefused | InfraUnavailable
    >
    /** Someone declined it: where their browser goes back to Claude */
    denyAgent(
        request_id: string
    ): AsyncOperationResult<
        { redirect_to: string },
        AgentRefused | InfraUnavailable
    >
    /** Someone's connections, by the app's ID for them, oldest first */
    agentConnections(
        user_id: string
    ): AsyncOperationResult<AgentConnection[], InfraUnavailable>
    /** Ends one connection: Claude can't refresh it */
    endAgentConnection(
        connection_id: string
    ): AsyncOperationResult<null, AgentRefused | InfraUnavailable>
    /** Ends all of someone's, as taking them off the team does */
    endAgentConnections(
        user_id: string
    ): AsyncOperationResult<number, InfraUnavailable>
    /**
     * Whom a token Claude brings acts as, and what it may do, when Infra
     * signed it for this app at `origin`, for `resource`, the address of
     * the app's MCP it was brought to, checked with Infra's public keys
     */
    checkAgentToken(
        token: string,
        expected: { origin: string; resource: string }
    ): AsyncOperationResult<AgentToken, AgentTokenRefused | InfraUnavailable>
}

/**
 * A token Claude brought that the app mustn't take, and why in words:
 * it ran out, it's for another address or app, or Infra didn't sign it.
 * The app answers it 401, so Claude logs in again.
 */
export type AgentTokenRefused = { reason: "invalid-token"; message: string }

/** What the app learns from a token Claude brings, once it's checked */
export type AgentToken = {
    /** Whom Claude acts as: the app's ID for them, checked against its team */
    user_id: string
    /** What they let Claude do */
    scopes: AgentAllow["scopes"]
    /** Which of their connections it is, to end it */
    connection_id: string
}

/**
 * Infra couldn't be asked, and why, in plain words: no key in a build, a
 * key it refused, an Infra that didn't answer, or an answer that doesn't
 * fit the contract. `message` is Infra's own when it gave one, and says
 * what fixes it when something does. It's logged where it happens; an app
 * shows it to its own team, never to a visitor, who only learns that login
 * isn't working.
 */
export type InfraUnavailable = { reason: "unavailable"; message: string }
