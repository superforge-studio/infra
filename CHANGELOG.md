# Changelog

Every release of `@superforge/infra`, newest first. Each is a version on
npm, published when its push reaches `main` (README.md, "Releases").

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
  each app is on and say when one's out of date. The first version on npm:
  0.1.0 was staged and never approved.
- 0.1.0 (Nov 23, 2026): the first release. Infra's client, the stand-in
  and the choice between them, moved out of Foundation's and Skylevel's
  `source/backend/infra/`, with Skylevel's `project()` for every app. Every
  refusal carries Infra's `message`, what went wrong and what fixes it,
  and `unavailable` says why too: no key in a build, a key Infra refused,
  an Infra that didn't answer, or an error this version doesn't know, like
  a call Infra retired. Every refusal is logged with its words. The result
  types are the package's own, `OperationResult` and
  `AsyncOperationResult`.
