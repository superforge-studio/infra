// What the package needs of what an app has in its own utilities, kept
// here so the package depends on nothing of an app's

/** A second, a minute, in milliseconds */
export const SECOND = 1000
export const MINUTE = 60 * SECOND

/** 32 random bytes in base64url: a login link's token, as Infra makes one */
export function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
}

/** What someone on an app's team can let Claude do through its MCP */
export const AGENT_SCOPES = ["read", "act"] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]

/**
 * Where an app's MCP answers, which Infra logs Claude in to: the admin's,
 * for the app's own team. Every token Claude holds is for it.
 */
export const MCP_PATH = "/admin/mcp"
