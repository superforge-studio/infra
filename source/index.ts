// @superforge/infra: Superforge Infra, the backend services Foundation and
// Skylevel apps run on, as an app's server calls it. README.md has how an
// app uses it.

// Claude's login to an app's MCP: where a request reached the app, which
// every token is bound to, and the path its MCP answers at
export { APP_ORIGIN_HEADER, requestOrigin } from "./agents.js"
// Calling Infra: the real one over HTTP with a project's key, the
// stand-in, Infra's test mode in memory, and choosing between them by how
// the server runs and the keys it has
export { chooseInfra, type InfraChoice } from "./choose.js"
export { INFRA_URL, infraClient } from "./client.js"
// What Infra takes of a comment from an app's toolbar
export {
    COMMENT_BODY_LIMIT,
    filed_comment,
    LONGEST_COMMENT
} from "./comments.js"
// What an app asks of Infra, and what Infra answers, typed
export type {
    AgentConnection,
    AgentRefused,
    AgentRequest,
    AgentToken,
    CommentRefused,
    FiledComment,
    Infra,
    InfraProject,
    InfraUnavailable,
    KeptComment,
    LoginProof,
    StartedLogin,
    StartRefused,
    VerifyRefused
} from "./infra.js"
export { AGENT_SCOPES, type AgentScope, MCP_PATH } from "./primitives.js"
// The result types every call answers, the same shape as the templates'
// global `OperationResult` and `AsyncOperationResult`
export type { AsyncOperationResult, OperationResult } from "./results.js"
export {
    standInAgentToken,
    standInInfra,
    type WaitingLogin
} from "./stand-in.js"
// Which version this is, which every call tells Infra in `Infra-Client`
export { CLIENT_HEADER, PACKAGE_VERSION } from "./version.js"
