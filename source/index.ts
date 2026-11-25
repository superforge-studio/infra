// @superforge/infra: Superforge Infra, the backend services Foundation and
// Skylevel apps run on, as an app's server calls it. README.md has how an
// app uses it.
//
// Every name here is a promise: from 1.0.0 on, taking one away is a major.
// So the package exports what an app calls, its constants and its types,
// and no zod schema: those are at `@superforge/infra/contract` alone
// (contract/index.ts), made with the package's own zod.

// Where a request reached the app, which every token Claude holds is bound to
export { requestOrigin } from "./agents.js"
// Calling Infra: the real one over HTTP with a project's key, chosen by
// how the server runs and the keys it has, or the stand-in, Infra's test
// mode in memory, which an app's tests use
export { chooseInfra, type InfraChoice } from "./choose.js"
export { infraClient } from "./client.js"
// The constants and types of Infra's contract an app calls with
export {
    AGENT_SCOPES,
    type AgentAllow,
    type AgentConnection,
    type AgentRefused,
    type AgentRequest,
    type AgentScope,
    APP_PATHS,
    type AppPaths,
    type ClientErrorReason,
    type CommentRefused,
    type FiledComment,
    type InfraErrorReason,
    type InfraIssue,
    type InfraProject,
    type KeptComment,
    type KeyMode,
    type LoginChannel,
    type LoginProof,
    type LoginStart,
    OAUTH_CALLS,
    type OAuthCall,
    type StartedLogin,
    type StartRefused,
    type VerifiedLogin,
    type VerifyRefused
} from "./contract/index.js"
// What an app asks of Infra, and what the app learns from Claude's token
export type {
    AgentToken,
    AgentTokenRefused,
    Infra,
    InfraUnavailable
} from "./infra.js"
// The result types every call answers, the same shape as the templates'
// global `OperationResult` and `AsyncOperationResult`
export type { AsyncOperationResult, OperationResult } from "./results.js"
export { standInAgentToken, standInInfra } from "./stand-in.js"
