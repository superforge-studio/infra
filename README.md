# @superforge/infra

Superforge Infra, the backend services every Foundation and Skylevel app
runs on, as an app's server calls it: login for its people, its comments
from the toolbar, Claude's login to its MCP, and which project its key is
for. It's the one way an app reaches Infra: a typed client, the stand-in
an app's tests and a fresh dev server use in its place, and the choice
between them. Infra's own API, each call with its fields and errors, is
its README in superforge's `source/infra/`, which the Superforge MCP's
`read_infra_docs` hands an agent.

```bash
pnpm add @superforge/infra zod
```

It needs Node 22 or later, and zod 4, which an app has already.

## Using it

An app's server asks for Infra once, and every route and step calls it
there, never with a bare `fetch` (in the templates, `appInfra()` in
`source/backend/infra/index.ts`):

```ts
import { chooseInfra } from "@superforge/infra"

const { infra } = chooseInfra({
    development: import.meta.env.DEV,
    environment: process.env,
    checkout: process.cwd(),
    // The website's hosts, which the stand-in's project has
    domains: ["vmdsystem.com"]
})

const started = await infra.startLogin({
    email: "ada@example.com",
    ip: visitor_ip,
    origin: "https://vmdsystem.com"
})
if (!started.ok) {
    console.warn("Login didn't start", started.error)
}
```

Every call answers a result, `{ ok: true, data }` or `{ ok: false, error }`
(`OperationResult` and `AsyncOperationResult`, which the package exports,
the same shape as the templates' global ones), and throws only for a bug.

### Which Infra

| Runs as    | Has                            | Calls                         |
| ---------- | ------------------------------ | ----------------------------- |
| a build    | `INFRA_SECRET_KEY`, sf_secret_ | Infra, which sends the emails |
| a build    | anything else                  | nothing: login is down        |
| dev server | `INFRA_TEST_KEY`, sf_test_     | Infra, in test mode           |
| dev server | none                           | the stand-in                  |

A build never falls back to the stand-in, which shows the code on the page,
nor takes a test key, which sends no email; a dev server never takes a
secret key, so it can't email real people. A dev server reads its test key
from the checkout's `.env` too, and a git worktree with no `.env` of its
own reads its main checkout's, so the key is set once per computer.
`INFRA_URL` points the server at another Infra, like a superforge
checkout's own dev server (`http://infra.localhost:3002/v1`).

### The stand-in, for tests

`standInInfra()` is Infra's test mode in memory: login sends nothing and
answers the code and the link, which verify as Infra's do (once each, for
15 minutes, a code for five tries); a comment is checked as Infra checks
it and kept nowhere; Claude logs in to nothing, and `checkAgentToken` takes
only the tokens `standInAgentToken()` mints. An app's tests use it, so they
never reach Infra.

## When something goes wrong

Every refusal carries `message`: what went wrong and what fixes it, in
plain words, for whoever runs the app and their agent. It's Infra's own
when Infra said why (its README, "Errors"), and the package's when it
couldn't ask, so an app can show its team why login isn't working instead
of a shrug:

```ts
{
    reason: "unavailable",
    message: "No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway. Make a secret key on superforge.studio, in the project's Settings, and paste it into INFRA_SECRET_KEY on the app's service in Railway."
}
```

- **A refusal the app handles** (`too-soon`, `wrong-code`, `no-link`…) has
  its `reason`, its fields and Infra's `message`.
- **`unavailable`** is everything else: no key in a build, a key Infra
  refused, an Infra that didn't answer or answered something that isn't
  JSON, a success this version can't read, or an error it doesn't know,
  like a call Infra retired. Its `message` says which, so an app on an
  older version of this package still says what to do when Infra changes
  under it.
- **Every answer is logged** with its call and status, and every refusal
  with its `error` and `message` (`Infra refused a call`), so an app's
  logs say why without anyone reproducing it.

A message is for a person: it can be reworded any time, so code branches on
`reason`, never on `message`. Show it to the app's own team; a visitor
should only learn that login isn't working.

## Releases

Each release is a version on npm, `@superforge/infra@x.y.z`, published by
CI when a push to `main` changes the version in `package.json`
(`.github/workflows/ci.yml`): a patch for a fix, a minor for anything an
app can use that it couldn't before, a major for a change an app has to
make code changes for. Every PR is a release: it bumps the version, with
its line at the top of `CHANGELOG.md`. An app takes one by bumping its
dependency (Dependabot opens a PR a month), never by copying code.

Infra keeps answering the versions apps are on: a change to a call is
additive, and a call Infra retires answers 410 `retired` with a message
saying what to do, which every version shows its team.

## Working on it

```bash
pnpm install
pnpm check    # biome, the typecheck, the tests and the build
```

To try a change in a template before it's released, point the template's
checkout at this folder (`pnpm add @superforge/infra@link:<path to this
folder>`), and back to the released version before its PR: a `link:` is
this computer's alone, and CI can't install it.

- `source/index.ts`: everything the package exports.
- `source/infra.ts`: `Infra`, what an app asks of it, and its results.
- `source/client.ts`: Infra over HTTP with a project's key, its answers
  parsed and every one logged. No call is retried: a second start sends a
  second email, and a comment sent again is kept twice.
- `source/answers.ts`: what Infra answers, as zod schemas, which the types
  come from.
- `source/agents.ts`: Claude's login: where a request reached the app,
  passing Claude's OAuth calls through, what Infra answers about requests
  and connections, and checking a token Infra signed with its public keys.
- `source/comments.ts`: what Infra takes of a toolbar's comment.
- `source/stand-in.ts`: the stand-in, and `standInAgentToken`.
- `source/choose.ts`: which Infra a server calls, and why when it's
  none.
- `source/results.ts` and `source/primitives.ts`: the result types, and
  what the package would otherwise take from an app's utilities.
