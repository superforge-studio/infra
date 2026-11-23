# CLAUDE.md

This is `@superforge/infra`, the npm package every Foundation and Skylevel
app reaches Superforge Infra through. Infra itself, its API and its
README, lives in superforge's `source/infra/`; this is only how an app's
server calls it. README.md has how an app uses it, its releases, and what
each file is.

## How the code here is written

The templates' conventions hold here too (Foundation's
`workbench/writing-code.md`):

- **American English**, everywhere: code, comments, docs, messages.
- **Names in full**: `error`, never `err`; `context`, never `ctx`.
- **Zod wherever data comes in**: every answer of Infra's is parsed in
  `answers.ts` or `agents.ts` before an app sees it, and types come from
  the schemas.
- **Results, not throws**, for what can fail in an expected way:
  `OperationResult` and `AsyncOperationResult` (`results.ts`), the same
  shape as the templates' global ones. `throw` is for bugs.
- **Every failure says why in words.** A refusal's `message` is Infra's
  when it gave one, else the package's own, naming what fixes it in terms
  an app's owner can act on (Railway, superforge.studio, "ask Claude to
  update …"). Owners never run commands or paste tokens into a chat: a
  secret key is made on superforge.studio and pasted into Railway.
- **Logs** are `console.*`, a static message with the details in an
  object beside it.
- **Nothing of an app's**: no `@/` imports. What the package needs of an
  app's utilities is in `primitives.ts`.
- **Imports end in `.js`**, as Node's ESM resolution needs of a published
  package.

## Before you call it done

```bash
pnpm format && pnpm check
```

Every PR is a release: bump the version in `package.json` (a patch for a
fix, a minor for something new an app can use, a major for a change an app
must make code changes for) and add its line at the top of `CHANGELOG.md`.
Merging to `main` publishes it. A change to what Infra answers goes to
superforge's Infra first, additive, so the versions apps are on keep
working.
