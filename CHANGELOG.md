# Changelog

Every release of `@superforge/infra`, newest first. Each is a version on
npm, published when its push reaches `main` (README.md, "Releases").

- 0.1.0 (Nov 23, 2026): the first release. Infra's client, the stand-in
  and the choice between them, moved out of Foundation's and Skylevel's
  `source/backend/infra/`, with Skylevel's `project()` for every app. Every
  refusal carries Infra's `message`, what went wrong and what fixes it,
  and `unavailable` says why too: no key in a build, a key Infra refused,
  an Infra that didn't answer, or an error this version doesn't know, like
  a call Infra retired. Every refusal is logged with its words. The result
  types are the package's own, `OperationResult` and
  `AsyncOperationResult`.
