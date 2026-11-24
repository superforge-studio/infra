# Changelog

Every release of `@superforge/infra`, newest first. Each is a version on
npm, published when its push reaches `main` (README.md, "Releases").

- 0.4.0 (Nov 24, 2026): the v1.0.0 review's quick fixes (TASK-1905).
  `checkAgentToken` refuses with `{ reason: "invalid-token", message }`,
  saying why (ran out, another address, app, project or mode), rather than
  a bare string, and with `unavailable` when Infra's public keys can't be
  fetched, rather than calling a good token bad; the package's own reasons
  are `CLIENT_ERRORS`, beside `INFRA_ERRORS`. A token must have `exp` and
  `typ: at+jwt`, with 5 seconds' clock skew allowed. A request or
  connection ID that isn't Infra's shape is refused `not-found` before any
  call, and encoded in the path. Claude's OAuth calls refuse a body over
  16 KB with 413. A dev server with `INFRA_SECRET_KEY`, or on Railway,
  calls nothing rather than the stand-in. The stand-in links only to this
  computer and the project's domains, as Infra does. Keys may be 32 to 128
  letters, digits and underscores after their prefix; a success is any
  2xx; times may carry an offset; a way back to Claude must be http or
  https. `LOOPBACK_HOSTNAMES` and `isLoopbackHost` are this computer's
  names, `[::1]` included. `jose` is `^6.2.15`; `main` and `types` are
  set. `example.com` is every example. An app that compared
  `checkAgentToken`'s error to `"invalid-token"` reads `error.reason`
  instead; the templates check only `ok`, so they change nothing.
- 0.3.0 (Nov 23, 2026): a comment goes to `POST /v1/board/comments`, the
  board's prefix, as Claude's login has `/v1/agents` (TASK-1891), with no
  old path kept, so 0.2.0's comments stop reaching Infra once it deploys:
  take this release in its place. Nothing else changes for an app.
- 0.2.0 (Nov 23, 2026): Infra's API takes its v1 shape, with no
  backward compatibility (TASK-1891), so an app must take this release
  when Infra deploys it. Infra's contract, every call's request and answer
  as zod schemas and every reason it refuses one (`INFRA_ERRORS`), is
  here, exported on its own at `@superforge/infra/contract`, and Infra
  checks what it's sent with it. Every refusal is `{ reason, message, … }`,
  as a template's API answers, passed on as it is. Login takes
  `{ channel: "email", address }` and `link_to`, the page its link opens,
  in place of `email` and `origin`, and answers `{ channel, address }`;
  `too-soon` and `too-many` are one `rate-limited`. A comment carries
  `user_id` and `user_name`. Claude's login is under `/v1/agents`: its
  connections are the app's `user_id`'s, every token is for the address
  Claude asked for (`resource`) rather than `/admin/mcp`, the server's
  metadata is built here, and authorize sends the browser to the app's
  Allow page wherever the app keeps it (`paths`). A build never reads
  `INFRA_URL`.
- 0.1.1 (Nov 23, 2026): every call tells Infra which version of the
  package made it, in an `Infra-Client` header (`@superforge/infra/0.1.1`),
  its OAuth calls passed through included, so Infra can see which version
  each app is on and say when one's out of date.
- 0.1.0 (Nov 23, 2026): the first release. Infra's client, the stand-in
  and the choice between them, moved out of Foundation's and Skylevel's
  `source/backend/infra/`, with Skylevel's `project()` for every app. Every
  refusal carries Infra's `message`, what went wrong and what fixes it,
  and `unavailable` says why too: no key in a build, a key Infra refused,
  an Infra that didn't answer, or an error this version doesn't know, like
  a call Infra retired. Every refusal is logged with its words. The result
  types are the package's own, `OperationResult` and
  `AsyncOperationResult`.
