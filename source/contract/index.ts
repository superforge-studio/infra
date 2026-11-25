// Infra's contract, as `@superforge/infra/contract` exports it: the
// constants and types every call is made of, the schemas of what Infra is
// sent, which Infra checks with, and the two answers Infra's own server
// ties itself to. Nothing here runs in Node alone, so a page can import it
// too. Infra's README has the calls.
//
// Every name here is a promise: from 1.0.0 on, taking one away is a major.
// So a name is here only when an app or Infra's server needs it; the rest
// of contract/ is the package's own (all.ts). A schema here is made with
// the package's own zod: parse with it as it is, and never put it inside a
// schema of an app's, which may be another zod's.

export {
    AGENT_ID,
    AGENT_SCOPES,
    type AgentAllow,
    type AgentConnection,
    type AgentRefused,
    type AgentRequest,
    type AgentScope,
    APP_ORIGIN_HEADER,
    APP_PATHS,
    type AppPaths,
    agent_allow,
    connections_query,
    OAUTH_CALLS,
    type OAuthCall
} from "./agents.js"
export {
    COMMENT_BODY_LIMIT,
    type CommentRefused,
    type FiledComment,
    filed_comment,
    type KeptComment,
    LONGEST_COMMENT
} from "./comments.js"
export {
    CLIENT_ERRORS,
    type ClientErrorReason,
    INFRA_ERRORS,
    type InfraErrorReason,
    type InfraIssue
} from "./errors.js"
export {
    LOGIN_CHANNELS,
    type LoginChannel,
    type LoginProof,
    type LoginStart,
    login_start,
    login_verify,
    type StartedLogin,
    type StartRefused,
    started_login,
    type VerifiedLogin,
    type VerifyRefused,
    verified_login
} from "./login.js"
export {
    CLIENT_HEADER,
    type InfraProject,
    isLoopbackHost,
    KEY_BODY,
    KEY_MODES,
    KEY_PREFIXES,
    type KeyMode,
    LOOPBACK_HOSTNAMES,
    PROJECT_ID_PREFIX
} from "./project.js"
