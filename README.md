# @superforge/infra

Superforge Infra, the backend services every Foundation and Skylevel app
runs on, as an app's server calls it: login for its people, its comments
from the toolbar, Claude's login to its MCP, and which project its key is
for. It's the one way an app reaches Infra: a typed client, the stand-in
an app's tests and a fresh dev server use in its place, and the choice
between them. Infra's own API reference, each call with its fields and
errors, isn't public: an agent reads it with the Superforge MCP's
`read_infra_docs`. Everything an app calls is below.

```bash
pnpm add @superforge/infra
```

It needs Node 22 or later. It brings its own zod 4, so an app can be on any
zod, and move to the next one without waiting for the package.

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
    domains: ["example.com"]
})

const started = await infra.startLogin({
    channel: "email",
    address: "ada@example.com",
    ip: visitor_ip,
    link_to: "https://example.com/login"
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
Only a dev server reads `INFRA_URL`, which points it at another Infra,
like a superforge checkout's own (`http://infra.localhost:3002/v1`),
while Infra itself is worked on: a build always calls Infra's own
address, so no variable can send its secret key, or anyone's login,
anywhere else.

A dev server that has `INFRA_SECRET_KEY`, or runs on Railway
(`RAILWAY_DEPLOYMENT_ID`), calls nothing either: it's a deployed server
built as a dev one, and the stand-in would show anyone the code.

`chooseInfra` takes `development`, `environment` (`process.env`),
`checkout` (the folder whose `.env` a dev server reads), `domains` (the
stand-in project's) and `paths`, and answers `{ infra, using }`, `using`
being `"secret key"`, `"test key"`, `"stand-in"` or `"nothing"`.

### What `Infra` answers

Every method answers a result; every refusal but `unavailable` and
`invalid-token` is Infra's own, as its contract types it.

| Method                                                 | Answers                                                                                 | Refuses with                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `project()`                                            | the key's project, its mode and its domains                                             | `unavailable`                                     |
| `startLogin({ channel, address, ip, link_to? })`       | the address, `with_link`, `expires_at`, and `test` (the code and link, with a test key) | `rate-limited`, `not-sent`, `unavailable`         |
| `verifyLogin({ channel, address, code } \| { token })` | whose address it was                                                                    | `wrong-code`, `no-code`, `no-link`, `unavailable` |
| `fileComment(comment)`                                 | the comment's `id` and `created_at`                                                     | `invalid`, `too-large`, `unavailable`             |
| `passOAuth(request, call, origin)`                     | the `Response` for one of Claude's OAuth calls                                          | (a `Response`: OAuth's own errors)                |
| `agentRequest(request_id)`                             | what the Allow page shows                                                               | `not-found`, `unavailable`                        |
| `allowAgent(request_id, { user_id, scopes })`          | `{ redirect_to }`, back to Claude                                                       | `not-found`, `not-asked`, `unavailable`           |
| `denyAgent(request_id)`                                | `{ redirect_to }`, back to Claude                                                       | `not-found`, `unavailable`                        |
| `agentConnections(user_id)`                            | their connections, oldest first                                                         | `unavailable`                                     |
| `endAgentConnection(connection_id)`                    | `null`                                                                                  | `not-found`, `unavailable`                        |
| `endAgentConnections(user_id)`                         | how many it ended                                                                       | `unavailable`                                     |
| `checkAgentToken(token, { origin, resource })`         | `{ user_id, scopes, connection_id }`                                                    | `invalid-token`, `unavailable`                    |

A request or connection ID that isn't Infra's shape (letters, digits, `_`
and `-`, at most 128) is refused `not-found` before any call, so a route
that passes on what it was sent can't reach another of Infra's addresses.

### Claude's login

- **`requestOrigin(request.url)`**: where a request reached the app,
  `https://<host>`, or `http://<host>` on this computer
  (`LOOPBACK_HOSTNAMES` and names under `localhost`). Every token is
  bound to it, as its issuer; give it to `passOAuth` and
  `checkAgentToken`.
- **`passOAuth`** answers `metadata`, `authorize`, `token`, `register` and
  `revoke`. A body over 16 KB is refused 413, never sent on.
- **`checkAgentToken`** checks the token with Infra's public keys, fetched
  and cached, with no call to Infra while they're fresh. A token that's
  run out, for another address, app, project or mode, or not Infra's is
  `invalid-token`, with why in `message`; the app answers it 401. Infra's
  keys out of reach is `unavailable`, so the app answers 503 and Claude
  tries again rather than logging in again.
- **`APP_PATHS`** (`{ oauth: "/oauth", allow: "/connect" }`) is where the
  app answers Claude's login; an app that keeps it elsewhere gives
  `chooseInfra` its own `paths`.
- **`AGENT_SCOPES`** (`["read", "act"]`) is what someone lets Claude do.
  An app that checks scopes with zod builds its own list from it,
  `z.enum(AGENT_SCOPES)`, with its own zod.

### `infraClient`

`infraClient({ key, url?, send?, paths? })` is the real Infra, which
`chooseInfra` makes; an app calls it itself only to point a test at a fake
of Infra (`send` is `fetch`, or the test's own; `url` is Infra's own
address unless set).

### The stand-in, for tests

`standInInfra({ domains? })` is Infra's test mode in
memory: login sends nothing and answers the code and the link, which
verify as Infra's do (once each, for 15 minutes, a code for five tries),
and links, as Infra's do, only to this computer and the project's
`domains`, over https; any other host gets `with_link: false`. A comment
is checked as Infra checks it and kept nowhere; Claude logs in to nothing,
and `checkAgentToken` takes only the tokens `standInAgentToken()` mints:
`standInAgentToken({ user_id, resource, scopes?, origin?, expires_in? })`,
`origin` being `http://localhost` and `expires_in` `"10m"` unless set. An
app's tests use it, so they never reach Infra.

### The contract

`@superforge/infra/contract` is Infra's contract with nothing of Node's, so
a page can import it: the constants and types every call is made of, every
reason a call is refused, Infra's (`INFRA_ERRORS`) and the package's own
(`CLIENT_ERRORS`), and the zod schemas of what Infra is sent (`login_start`,
`login_verify`, `filed_comment`, `agent_allow`, `connections_query`), which
Infra checks with, with the two answers Infra's own server ties itself to
(`started_login`, `verified_login`). The package itself exports the same
constants and types, and no schema.

A schema here is made with the package's own zod: parse with it as it is,
and never put it inside a schema of the app's own, which may be another
zod's and then fails. Build the app's own from the constants instead.

Every name either entry exports is a promise: from 1.0.0 on, taking one
away is a major. So they export only what an app or Infra's server uses;
the rest is the package's own.

## When something goes wrong

Every refusal is Infra's own `error`, as it answered it, in the shape a
template's API answers too: `reason`, for code to branch on, `message`,
what went wrong and what fixes it in plain words, and any fields the call
adds, like `retry_after`. Infra's contract has every reason
(`INFRA_ERRORS`, and the package's own, `CLIENT_ERRORS`). When the package couldn't ask Infra, it says why in
the same shape:

```ts
{
    reason: "unavailable",
    message: "No one can log in: INFRA_SECRET_KEY isn't set on the app's service in Railway. Make a secret key on superforge.studio, in the project's Settings, and paste it into INFRA_SECRET_KEY on the app's service in Railway."
}
```

- **A refusal the app handles** (`rate-limited`, `wrong-code`,
  `no-link`…) is Infra's `error` as it is.
- **`unavailable`** is everything else: no key in a build, a key Infra
  refused, an Infra that didn't answer or answered something that isn't
  JSON, or an answer outside the contract. Its `message` says which.
- **Every answer is logged** with its call and status, and every refusal
  with its `reason` and `message` (`Infra refused a call`), so an app's
  logs say why without anyone reproducing it.

A message is for a person: it can be reworded any time, so code branches on
`reason`, never on `message`. Show it to the app's own team; a visitor
should only learn that login isn't working.

## What every call tells Infra

Every call, Claude's OAuth calls passed through and the fetch of Infra's
public keys included, carries `Infra-Client: @superforge/infra/<version>`
(`CLIENT_HEADER`, in the contract), so Infra knows which version each app
is on. That release is the version Infra answers the call as: once Infra
changes an answer, a release from before the change still gets the shape
it reads. A call that names no release, like one from a terminal, is
answered as the oldest release Infra still answers. The version is written
in `source/version.ts`, which a test checks against `package.json`.

## Releases

Each release is a version on npm, `@superforge/infra@x.y.z`, published by
CI when a push to `main` changes the version in `package.json`
(`.github/workflows/ci.yml`): a patch for a fix, a minor for anything an
app can use that it couldn't before, a major for a change an app has to
make code changes for. Every PR is a release: it bumps the version, with
its line at the top of `CHANGELOG.md`. An app takes one by bumping its
dependency (Dependabot opens a PR a month), never by copying code.

CI signs in to npm with trusted publishing: npm trusts this repository's
`ci.yml` to publish the package (the package's settings on npmjs.com,
"Trusted publisher"), so no npm token is kept anywhere. A PR's
`release-version` check refuses one whose version isn't the one right
after `main`'s, with its line in `CHANGELOG.md`.

Infra changes its API additively: it adds fields and calls, and never
renames or drops one an app's release calls, so a release keeps working
until the app takes the next. Until 1.0.0 it keeps no older shapes: an app
takes the latest release.

A release reads what Infra adds without breaking: a field it doesn't know
is dropped, a 429's `limit` is read as any name, and a request's or a
connection's `scopes` keep only the scopes the release knows. A refusal
whose `reason` it doesn't know is `unavailable`, with Infra's `message`.
`mode` and a login's `channel` stay closed lists: an app only meets a new
one once it asks for it.

## Working on it

```bash
pnpm install
pnpm check    # biome, the typecheck, the tests and the build
```

To try a change in a template before it's released, point the template's
checkout at this folder (`pnpm add @superforge/infra@link:<path to this
folder>`), and back to the released version before its PR: a `link:` is
this computer's alone, and CI can't install it.

- `source/index.ts`: everything the package exports, by name.
- `source/contract/`: Infra's contract, with nothing of Node's: every
  call's request and answer as zod schemas, which Infra checks what it's
  sent with, and every reason it refuses one (`errors.ts`), a file per
  area: `login.ts`, `comments.ts`, `agents.ts`, `project.ts` and
  `people.ts` (`user_id`, the app's ID for one of its people).
  `index.ts` is what `@superforge/infra/contract` exports, by name;
  `all.ts` is all of it, which only the package itself imports.
- `source/infra.ts`: `Infra`, what an app asks of it, and its results.
- `source/client.ts`: Infra over HTTP with a project's key, its answers
  parsed with the contract and every one logged. No call is retried: a
  second start sends a second message, and a comment sent again is kept
  twice.
- `source/agents.ts`: Claude's login: where a request reached the app,
  the OAuth server's metadata, built here, Claude's other OAuth calls,
  passed on to Infra, the authorize request sending the browser to the
  app's Allow page, and checking a token Infra signed with its public
  keys.
- `source/stand-in.ts`: the stand-in, and `standInAgentToken`.
- `source/choose.ts`: which Infra a server calls, and why when it's
  none.
- `source/results.ts` and `source/primitives.ts`: the result types, and
  what the package would otherwise take from an app's utilities.
