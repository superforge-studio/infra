// What the package needs of what an app has in its own utilities, kept
// here so the package depends on nothing of an app's

/** A second, a minute, in milliseconds */
export const SECOND = 1000
export const MINUTE = 60 * SECOND

/**
 * How long a call waits for Infra's answer. Starting a login waits on
 * Infra sending the email, which takes a second or two.
 */
export const CALL_TIMEOUT = 15 * SECOND

/** 32 random bytes in base64url: a login link's token, as Infra makes one */
export function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
}
