import type { z } from "zod"
import type {
    AgentConnection,
    AgentToken,
    agent_refused,
    agent_request
} from "./agents.js"
import type {
    comment_refused,
    infra_project,
    kept_comment,
    start_refused,
    started_login,
    verified_login,
    verify_refused
} from "./answers.js"
import type { FiledComment } from "./comments.js"
import type { AgentScope } from "./primitives.js"
import type { AsyncOperationResult } from "./results.js"

// Superforge Infra, the backend services an app runs on, as an app's
// server calls it: login, where Infra emails a visitor a code and a link,
// and says whether what they brought back is right; comments, what the
// app's people said about it from its toolbar; Claude's login to the app's
// MCP; and which project the app's key is for. The app keeps its own users
// and sessions, and its own analytics. Infra's README has the calls; an
// app reaches them through one of these, the real Infra (client.ts) or the
// stand-in (stand-in.ts), as `chooseInfra` picks (choose.ts).

/** A code typed with the address it went to, or a link's token */
export type LoginProof = { email: string; code: string } | { token: string }

/** What an app asks of Infra, whichever answers: the real one or the stand-in */
export type Infra = {
    /**
     * Which project the key is for, its mode, and the domains its login
     * emails link to (`domains`, null from an Infra that doesn't say),
     * which Settings shows beside the app's own (an app's Settings).
     */
    project(): AsyncOperationResult<InfraProject, InfraUnavailable>
    /**
     * Emails `email` a six-digit code, and a link back to the app's
     * `/login` when `origin` is one of the project's domains or
     * localhost. `ip` is the visitor's, which Infra's limits count.
     */
    startLogin(request: {
        email: string
        ip: string
        origin: string | null
    }): AsyncOperationResult<StartedLogin, StartRefused | InfraUnavailable>
    /**
     * Whose email `proof` is: the code typed with the address it went to,
     * or the link's token. Either works once.
     */
    verifyLogin(
        proof: LoginProof
    ): AsyncOperationResult<
        z.output<typeof verified_login>,
        VerifyRefused | InfraUnavailable
    >
    /**
     * Sends Infra a comment someone logged in wrote about an element of a
     * page, which the toolbar posted to the app's own /api/comments, with
     * who they are (comments.ts). Infra keeps it, a test key's too, and
     * answers its ID. It's never retried: a comment sent twice is kept
     * twice.
     */
    fileComment(
        comment: FiledComment
    ): AsyncOperationResult<KeptComment, CommentRefused | InfraUnavailable>

    // Claude logging in to the app's MCP, Infra being the OAuth server
    // (agents.ts, and Infra's README, "Claude")

    /**
     * Passes one of Claude's OAuth calls through to Infra (`path`, after
     * `/oauth`: `/authorize`, `/token`, `/metadata`…), with the app's
     * key and `origin`, and answers what Infra answers, as it is
     */
    passOAuth(request: Request, path: string, origin: string): Promise<Response>
    /** What the Allow page shows of a request Claude made */
    agentRequest(
        request_id: string
    ): AsyncOperationResult<AgentRequest, AgentRefused | InfraUnavailable>
    /**
     * Someone on the team, by their email, allowed Claude's request: where
     * their browser goes back to Claude, with the one-time code
     */
    allowAgent(
        request_id: string,
        allowed: { email: string; scopes: AgentScope[] }
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
    /** Someone's connections, oldest first, for their Connected list */
    agentConnections(
        email: string
    ): AsyncOperationResult<AgentConnection[], InfraUnavailable>
    /** Ends one connection: Claude can't refresh it */
    endAgentConnection(
        connection_id: string
    ): AsyncOperationResult<null, AgentRefused | InfraUnavailable>
    /** Ends all of someone's, as taking them off the team does */
    endAgentConnections(
        email: string
    ): AsyncOperationResult<number, InfraUnavailable>
    /**
     * Whom a token Claude brings acts as, and what it may do, when Infra
     * signed it for this app at `origin`, checked with Infra's public keys
     */
    checkAgentToken(
        token: string,
        origin: string
    ): AsyncOperationResult<AgentToken, "invalid-token" | InfraUnavailable>
}

// What Infra answers, as the app sees it (answers.ts has each field)
export type InfraProject = z.output<typeof infra_project>
export type StartedLogin = z.output<typeof started_login>
export type StartRefused = z.output<typeof start_refused>
export type VerifyRefused = z.output<typeof verify_refused>
export type KeptComment = z.output<typeof kept_comment>
export type CommentRefused = z.output<typeof comment_refused>
export type AgentRequest = z.output<typeof agent_request>["request"]
export type AgentRefused = z.output<typeof agent_refused>
export type { AgentConnection, AgentToken, FiledComment }

/**
 * Infra couldn't be asked, and why, in plain words: no key in a build, a
 * key it refused, an error this version of the package doesn't know, or an
 * answer that didn't come or didn't make sense. `message` is Infra's own
 * when it gave one, and says what fixes it when something does. It's
 * logged where it happens; an app shows it to its own team, never to a
 * visitor, who only learns that login isn't working.
 */
export type InfraUnavailable = { reason: "unavailable"; message: string }
