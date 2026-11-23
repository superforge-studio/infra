# Changelog

Every release of `@superforge/infra`, newest first. Each is a version on
npm, published when its push reaches `main` (README.md, "Releases").

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
