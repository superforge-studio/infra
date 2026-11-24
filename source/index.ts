// @superforge/infra: Superforge Infra, the backend services Foundation and
// Skylevel apps run on, as an app's server calls it. README.md has how an
// app uses it. Infra's contract, every call's request and answer as zod
// schemas, is here too, and on its own at `@superforge/infra/contract`,
// which needs nothing of Node's, for a page.

// Claude's login to an app's MCP: where a request reached the app, which
// every token is bound to, and the OAuth server's metadata
export { oauthMetadata, requestOrigin } from "./agents.js"
// Calling Infra: the real one over HTTP with a project's key, the
// stand-in, Infra's test mode in memory, and choosing between them by how
// the server runs and the keys it has
export { chooseInfra, type InfraChoice } from "./choose.js"
export { INFRA_URL, infraClient } from "./client.js"
// Infra's contract (contract/): every call's request and answer, every
// reason it refuses one, and the constants they're made of
export * from "./contract/index.js"
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
export {
    standInAgentToken,
    standInInfra,
    type WaitingLogin
} from "./stand-in.js"
// Which release this is, which every call tells Infra in `Infra-Client`
export { PACKAGE_VERSION } from "./version.js"
