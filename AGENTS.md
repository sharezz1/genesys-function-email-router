# AGENTS.md

Guidance for AI agents working in this repository.

## Project

A **Genesys Cloud Function data action** — an AWS Lambda that Genesys runs inside *its own* account
and invokes from an Architect flow — implementing a rule engine for inbound email.

Rules live in a Genesys Architect datatable. Each rule pairs a filter expression with an action. The
function reads the rule set, evaluates it against one inbound email, and reports a routing decision
back to the flow.

Deno 2.x source, bundled to CommonJS and shipped as `target/index.zip`.

- `src/mod.ts` — the handler Genesys invokes. Entry point, deliberately thin.
- `src/routing/` — the evaluation loop: building the context, running one rule.
- `src/filters/` — the filter language: lex, parse, evaluate.
- `src/actions/` — one handler per rule action.
- `src/genesys/` — the kit for calling Genesys APIs back.
- `src/types/` — the contract types and the rule model.
- `src/utils/` — email helpers and the pagination loop.
- `tests/` — test suite, mirroring `src/`. `benchmarks/` — filter-language benchmarks.
- `scripts/publish.ts` — deployment tooling. Never bundled, never imported by `src/`.

## This is not the AWS Lambda data actions integration

Genesys ships two integrations whose names read almost identically. Confusing them is the single
easiest way to import wrong guidance into this repo.

|                | **Function data actions** (this repo) | AWS Lambda data actions |
| -------------- | ------------------------------------- | ----------------------- |
| Runs in        | Genesys's AWS account                 | *Your* AWS account      |
| IAM role       | none — you have no AWS credentials    | required                |
| VPC / S3 / SQS | unavailable                           | available               |

Every "no IAM", "no VPC", "no static egress IP" statement below is **false** for the second product.
Check which one a source is describing before trusting it.

## Setup

Run `make setup` once — installs dependencies and the Cog git hooks (commit-message validation,
pre-commit format/lint, pre-push checks).

For AI-assisted work, the official [denoland/skills](https://github.com/denoland/skills) plugin is
recommended (`/plugin marketplace add denoland/skills`, then `/plugin install
deno-skills@denoland-skills` in Claude Code).

## Commands

- `make check` — format, lint, type, dependency and JSDoc-example checks
- `make test` — test suite with coverage
- `make security` — secret scan (gitleaks) and vulnerability audit
- `make build` — bundle to CJS and zip to `target/index.zip`
- `make publish` — ship the zip to Genesys Cloud
- `make format` — apply formatting

## How the router works

One invocation, in order:

1. `getClient(context)` authenticates with the credentials in `clientContext`.
2. `getContext(request, client)` reads the conversation and the one message named in the request.
   Two API calls, both unavoidable — the message carries every field a filter can match on.
3. `getRules(context, datatableId)` sweeps the datatable. Every row, every invocation.
4. Each rule runs through `handleRule`: skip if disabled, evaluate the filter, dispatch the action.
5. The loop **stops at the first rule that sets a decision**. Everything else accumulates.

That last point is the model a rule author has to hold in their head, and it is currently implicit
rather than stated in the rule schema:

- **Terminal** — `route` and `disconnect`. They set `decision`, so evaluation stops.
- **Continuing** — `reply`, `forward`, and the three priority actions. They mutate the context and
  evaluation carries on.

So rule order is significant, and a `route` rule placed early makes every rule below it unreachable.

### The rule columns

The datatable *is* the configuration surface. Columns map onto `src/types/Rule.ts`:

| Column            | Type    | Required | Meaning                                                    |
| ----------------- | ------- | -------- | ---------------------------------------------------------- |
| `key`             | string  | yes      | The datatable key column. Identifies the rule in the audit trail. |
| `enabled`         | boolean | yes      | A disabled rule is skipped and recorded as skipped.        |
| `action`          | string  | yes      | One of the `RuleAction` values below.                      |
| `filter`          | string  | no       | Filter expression. Absent means the rule always matches.   |
| `targetType`      | string  | no       | `queue`, `state` or `email`. Used by `route`.               |
| `targetName`      | string  | no       | Queue name, flow state, or address. Used by `route` and `forward`. |
| `priority`        | integer | no       | The value or amount for the three priority actions.        |
| `skill`           | string  | no       | Skill to require. Applied by `route`.                       |
| `responseLibrary` | string  | no       | Response Management library. Used by `reply`.               |
| `responseName`    | string  | no       | Response within that library. Used by `reply`.              |
| `description`     | string  | no       | For humans. The function never reads it.                    |

`RuleAction`: `route`, `forward`, `reply`, `disconnect`, `priority_set`, `priority_increase`,
`priority_decrease`.

`RoutingDecision`, which is what the flow acts on: `none`, `transfer_queue`, `transfer_state`,
`transfer_email`, `disconnect`.

**Rows are cast to `Rule` without validation** (`src/genesys/datatable.ts`). The datatable's own
column types are the only schema enforcement. A missing or misnamed column arrives as `undefined`,
and each handler reports that as an invalid rule rather than failing the run — so a bad rule is
visible in `executionLog` and nowhere else.

### The filter language

`tokenize` → `compile` → `evaluate`, in `src/filters/`. `AND` binds tighter than `OR`; parentheses
override. Fields: `from`, `replyTo`, `to`, `cc`, `bcc`, `subject`, `body`, `attachments`.

Comparators: `=` `!=` `~` (contains) `!~` `*` (glob) `!*` `∩` (intersects) `~=` (regex).

Two things about the semantics that are easy to get wrong when changing this code:

- **Both sides are lower-cased before matching.** Every comparison is case-insensitive, including
  regex — which means a pattern containing `[A-Z]` cannot match anything.
- **Multi-valued fields quantify by comparator.** Affirmative comparators ask whether *any* pair
  matches; negative ones whether *no* pair does. `to != "x"` therefore means "x is not among the
  recipients", not "some recipient is not x".

`∩` is currently implemented identically to `*`. That is not obviously intended; do not "fix" it
without deciding what it should mean, because rules in the field depend on today's behaviour.

`*` and `!*` are matched by `src/filters/glob.ts`, a hand-written matcher supporting `*`, `?`, `[…]`
classes and `\` escapes, and it **must not be reimplemented on `RegExp`**. Translating globs to
regular expressions is what made `body * "*urgent*payment*overdue*"` — three ordinary words — take
26 seconds against a crafted 800-character subject: past the platform's 15-second kill, and
reachable by any sender. The matcher keeps one resume point per star and advances it a character at
a time on failure, so cost is O(text × pattern) rather than exponential.
`tests/filters/glob.test.ts` guards it — a regression to a backtracking engine makes those cases
stop terminating rather than fail an assertion.

`~=` is still backed by `RegExp` and is still vulnerable: `subject ~= "^(a+)+$"` runs for tens of
seconds on a few dozen characters. Truncating the input does not help, because the blow-up does not
need a long one. Closing it means withdrawing the operator or matching on an engine that cannot
backtrack. Treat any change here as security-relevant.

## Talking back to Genesys

`src/genesys/` holds the kit. Import from `src/genesys/mod.ts`, not the individual modules.

```ts
import platformClient from "purecloud-platform-client-v2";
import { getClient } from "./genesys/mod.ts";

const client = await getClient(context);
const routing = new platformClient.RoutingApi(client);

const result = await routing.getRoutingQueues({ name: "Billing" });
```

`getRoutingQueues({ name })` filters server-side, so it costs one call rather than a paginated
sweep. That distinction is the whole rate-limit story — see below.

What the kit exports:

- `getClient(context, credentials?)` — an authenticated `ApiClientClass`.
- `getCredentials(context)` — pulls host, client ID and secret out of `context.clientContext`.
- `clearTokenCache()` — drops the cached token. For tests, and for recovering from a 401.
- `getRules` / `getDatatableRows` — the rule set.
- `getAttributes` / `setAttributes` / `sendEmail` / `forwardEmail` — the conversation.
- `getLibraries` / `getResponses` / `getResponseByName` — canned responses.

Credentials arrive as the `X-Genesys-API-Host`, `-Key` and `-Secret` headers, which the data
action's `config.request.headers` populates — `make publish` wires them up when it creates the
action. Lookup is case-insensitive.

`getClient` builds a fresh `ApiClientClass` per invocation rather than configuring the shared
`ApiClient.instance`, so a warm container cannot leak one org's environment or token into the next
invocation. The access token *is* reused across invocations, and only while the credentials that
minted it are unchanged.

**Not in the kit** — do not import these, they do not exist: error predicates, retry, id-or-name
resolution, rule validation. Write them at the call site, or add the module properly.

## Publishing

`make publish` is the only command you need. It lives in `scripts/publish.ts`, and it works out
which pieces already exist rather than assuming a sequence you have to remember.

After `check`, `test`, `security` and the zip build, it:

1. Opens a draft, PUTs the zip, sets handler / runtime / timeout
2. Validates the draft structurally, without executing it
3. Executes the draft end to end, failing on any bad step
4. Publishes, retrying while Genesys finishes processing the upload

Steps 2 and 3 exist to catch the nastiest failure mode: an upload that succeeds but misconfigures
the runtime, so the function only fails once it is live inside a contact-centre flow.

On a repo with nothing set up yet it walks the bootstrap first — picking or creating an integration,
naming the action, choosing a runtime, then creating the data action and writing the result to the
`genesys` block in `deno.json`. That block is committed, so nobody else has to repeat it.

The prompts appear only when attached to a terminal. Under CI it never waits for input: whatever is
missing is reported as the variable or config key to set, and the run fails instead of hanging.

Configuration is read from the **process environment** — nothing here loads a `.env` file. Export
the variables however you like; [direnv](https://direnv.net) with a gitignored `.envrc` is the usual
choice, and it pairs well with pulling the secrets from a password store rather than writing them to
disk.

| Variable                  | Required | Notes                                      |
| ------------------------- | -------- | ------------------------------------------ |
| `GENESYS_HOST`            | yes      | e.g. `mypurecloud.com`¹                    |
| `GENESYS_CLIENT_ID`       | yes      | OAuth client credentials                   |
| `GENESYS_CLIENT_SECRET`   | yes      |                                            |
| `GENESYS_ACTION_ID`       | no       | overrides `genesys.actionId`               |
| `GENESYS_RUNTIME`         | no       | overrides `genesys.runtime`                |
| `GENESYS_TIMEOUT_SECONDS` | no       | overrides `genesys.timeoutSeconds`, max 15 |
| `GENESYS_INTEGRATION_ID`  | no       | skips the integration prompt on bootstrap  |
| `GENESYS_ACTION_NAME`     | no       | bootstrap default, otherwise the `name`    |

¹ The SDK normalizes this — it strips any protocol and a leading `api.`, so `mypurecloud.com` and
`https://api.mypurecloud.com` are equivalent. What the deployed function receives as
`X-Genesys-API-Host` is a different value with the same job: the `host` field of the credentials
configured on the integration in Admin, which the action's header templates dereference. Configure
those once on the integration, with fields named `host`, `clientId` and `clientSecret`.

Never hardcode a list of supported Node versions anywhere in this repo. The set changes, and
published version lists go stale — the runtime menu `make publish` offers is the live answer, read
from the API at the moment you need it. A deprecated runtime still *executes*, but blocks any create
or update, so a deploy can hard-fail while production traffic keeps working fine.

## Platform limits

Verified against Genesys documentation:

- **Execution timeout is 1–15 seconds**, configurable, and a hard stop. This is the constraint that
  shapes everything else — there is no room for a multi-second retry ladder. The *data action*
  wrapping the function has a separate timeout that goes to 60 seconds; a source quoting "60"
  describes that knob, not this ceiling.
- Handler is configurable — `{path_to_module}.{export_name}`, set per upload. This repo bundles to a
  root `index.js` exporting `handler`, so it always deploys as `index.handler`.
- ZIP ceiling 256 MB, unencrypted. Bundle size is a non-issue.
- **No AWS resources at all** — no IAM, no S3/DynamoDB/SQS, no VPC, no static egress IPs, no client
  certificates. **There is no persistent storage**: anything stateful belongs in a datatable, in
  conversation attributes, or outside the function.
- Response budget is **732 KB** (750,000 bytes) across the function's request and response payloads
  — keep responses under the recommended 256 KB. `executionLog` is the part of this response that
  grows with the rule set; a large rule table is the way to reach that limit.
- `clientContext` caps at 3,584 bytes of base64-encoded data and cannot carry certificates. Anything
  bulky belongs in the request template body, which has no size restriction.
- Memory is **1536 MB** with one vCPU.

Not documented by Genesys — treat as engineering judgement, not fact:

- Container reuse, container lifetime, cold-start behaviour. The token cache assumes warm containers
  exist; if they do not, it degrades to re-authenticating every time, at no risk.
- **Datatable row ordering.** The engine treats row order as rule order, but Genesys does not
  document that `getFlowsDatatableRows` returns rows in a stable order. If first-match-wins matters
  to a change you are making, this is the assumption to check first.

## Rate limits

The Platform API limit is per **token** — 300 requests per minute by default. A client-credentials
client holds one cached token at a time, so in practice that is this function's whole budget.

This function's floor is 3 calls per invocation (conversation, message, one page of rules). Every
reply rule that matches adds **two paginated sweeps** — `getResponseByName` lists every library and
then every response in one — which makes reply the most expensive action by a wide margin. A rule
table that fans out to several reply rules is the realistic way to exhaust the budget here.

Design around it rather than retrying into it: filter server-side instead of paginating and
filtering locally, use a batch endpoint where one exists, and do not re-fetch what has not changed.

When you are limited:

- The response is **429**, carrying a `Retry-After` header.
- Headers only exist on a rejection after `client.setReturnExtendedResponses(true)` — the default
  rejection is the bare error body, which carries no headers at all.
- v257 stores header names lowercased: read `headers["retry-after"]`, or `headers.get("Retry-After")`,
  which ignores case. The platform docs say to read it exact-case — for this SDK that advice is
  backwards.
- `Retry-After` is in **seconds**.
- A response *without* `Retry-After` must not be retried automatically.

The documented backoff for 502/503/504 — 3 s, rising to 9 s and 27 s — **cannot run here**. This
function's entire lifetime is 15 seconds. Check the remaining time before any sleep and fail fast
when the wait would not leave room to finish. Retry is the caller's job: the Architect flow above
can retry far more cheaply than a function spending its own 15-second budget doing it.

## Logs exist only in test runs

The function runs in Genesys's AWS account, so there is no CloudWatch and no log group. In a deployed
function, `console` output goes nowhere — do not reach for logging to diagnose live traffic. The
`no-console` lint rule is on for this reason.

**`executionLog` in the response is the only production observability this function has.** Every
path through `handleRule` appends exactly one entry, including the paths that do nothing, which is
what makes "why did my rule not fire?" answerable at all. Preserve that invariant.

Test executions are the exception. The `TestExecutionResult` contains an "External execution log"
operation carrying the run's full log: every `console.log` and `console.error` as structured
entries, plus the Lambda START/END/REPORT lines. Genesys caps it at the last 4 KB. Never let a
credential into a log line, even here.

What comes back from a test:

- **The draft test inside `make publish`** — a structured `TestExecutionResult`: `operations[]` of
  `{step, name, success, result, error}`, plus top-level `finalResult`, `error` and `success`. The
  `error` fields are `ErrorBody` objects — `{message, code, status, …}` — not strings.
- **`postIntegrationsActionTest`** — the same, against the published action rather than the draft.
- **Your return value, and anything you throw.** A thrown `Error`'s message and stack come back
  verbatim in the failing step's `error`; in production the same `ErrorBody` takes the flow's failure
  path. Make the message one a human can act on.

Keep the handler thin and put the logic in functions a test can call directly.

## SDK gotchas

Verified against `purecloud-platform-client-v2` **v257**. Re-check after a major bump.

- **Three rejection shapes.** An HTTP error rejects with the parsed error body — `{message, code,
  status}`, a plain object. After `setReturnExtendedResponses(true)` it is `{status, statusText,
  headers, body, text, error}` instead — still plain, but `message` is gone. A transport failure
  rejects with the raw `AxiosError`, which *is* an `Error`. Never assume a field exists on a caught
  rejection; probe for it. `describe()` in `src/actions/handleReply.ts` exists precisely because of
  this.
- **Nothing ships with retry, pagination or caching** — write them at the call site. `paginate` in
  `src/utils/` is this repo's answer. A hook seam exists (`setPreHook`/`setPostHook`), but the v257
  wiring ejects against the wrong axios object, so prefer call-site wrappers.
- **`ApiClient.instance` assignment is guarded**, so constructing your own instance does not clobber
  it. Injection is free — every API class takes a client.
- **Default HTTP timeout is 16000 ms**, longer than the function's maximum 15-second lifetime, so it
  can never fire. A transport hang becomes a hard function kill rather than a catchable error. Set a
  per-call deadline with `client.getHttpClient().setTimeout(ms)` where it matters.
- The 401 refresh path only applies to the authorization code grant; under client credentials it is
  correctly skipped. Client credentials issue no refresh token, so an expired token means running
  the full grant again.
- **The typings are the reference, not the website.** Deno caches them under the path `deno info
  --json` reports as `npmCache`, at `.../purecloud-platform-client-v2/<version>/index.d.ts`. Grep
  that file — `deno doc` does not work on this package, because its default-export namespace does
  not surface.

## Where to look things up

In rough order of how much to trust them:

1. **The SDK's own typings** (see above).
2. **The live API.** `getIntegrationsActionsFunctionsRuntimes` beats any published runtime list. The
   full swagger sits at `https://api.mypurecloud.com/api/v2/docs/swagger` — authoritative, but it
   redirects to a 22 MB JSON document, so filter it rather than reading it.
3. **[developer.genesys.cloud](https://developer.genesys.cloud)** — API Explorer, resource reference,
   platform guides.
4. **[The developer forum](https://developer.genesys.cloud/forum/)** — often the only place a
   Functions-specific behaviour is described at all.

**The developer centre renders its content in JavaScript.** A plain HTTP fetch returns an empty
shell, not the page — so a fetch that "succeeds" and shows nothing useful has not actually failed in
a way you will notice. Use a renderer such as Firecrawl, and treat an empty result as a tooling
problem rather than as an absence of documentation.

Two further cautions:

- **Some pages carry an AI-generated summary.** Read the body text, not the summary.
- **Search results conflate the two integrations.** Confirm a result is about Function data actions
  before acting on it.

## Relationship to the template

This repo is generated from
[template-genesys-function](https://github.com/DanzigerGeist/template-genesys-function), which is
itself generated from [template-deno](https://github.com/DanzigerGeist/template-deno) — the single
source of truth for the shared toolchain: the `deno.json` task graph, Makefile, `cog.toml`, CI
workflows, lint rules, coverage thresholds and git hooks. Sync those from the baseline and treat any
difference as drift, **unless** it is one of the intentional divergences below. When you add a new
one, record it here so the next sync knows it is deliberate.

Inherited from `template-genesys-function` and unchanged: `src/genesys/client.ts`,
`src/genesys/context.ts`, `src/types/Credentials.ts` and `scripts/publish.ts` are the template's
files verbatim. Fix a bug in them upstream and sync down, rather than patching here.

Divergences of this repo from the template:

- **A domain, not a placeholder.** The template's `FunctionRequest` / `FunctionResponse` are
  placeholders it tells you to edit; here they carry the router's real contract. The names are the
  template's on purpose.
- **`src/routing/` and `src/filters/` and `src/actions/`** have no template counterpart. The
  template only knows `mod.ts`, `genesys/` and `types/`.
- **`benchmarks/` measures the filter language, not the handler.** The template benchmarks its
  placeholder handler, which is meaningful only because that handler does nothing. Here the handler
  is dominated by network round trips, so benchmarking it would measure the stubs.
- **No `[skip ci]` on commit messages.** The template mandates it; this repo forbids it, because it
  suppresses the `push` trigger that drives the release workflow. Do not restore it on a sync.
- **The release gate is a tag comparison, not a dry run.** The template gates on whether
  `cog bump --auto --dry-run` exited zero, which cannot work: cog exits zero whether or not it had
  anything to bump, reporting "No conventional commits ... required a bump" on stdout. So any
  non-bumping commit on `master` — `ci:`, `docs:`, `chore:`, `test:`, `refactor:` — made the job
  believe it had released, and `git describe --tags` then returned `v0.1.0-1-gabc1234`, which the
  release job could not check out. This repo records the tag before the bump and compares after.
  Use `--abbrev=0`; without it `git describe` returns a describe string rather than a tag name.
- **The GitHub release carries the function zip.** `release.yml` builds at the tag and attaches
  `genesys-function-email-router-<version>.zip`. The template publishes notes only, which is fine
  for a template and wrong for a deployable artifact. Built in the release job rather than carried
  from the checks run, so the artifact is the source the tag names — the checks run predates the
  version bump. The zip's *internal* entry stays `index.js`, so `index.handler` is unaffected by
  the outer filename.
- **`cog.toml` sets `remote`, `owner` and `repository`.** The template omits the whole block. Cog
  treats the three as a set and panics during `bump` if one is missing — and `--dry-run` does not
  build the changelog context, so the dry-run gate in `release.yml` passes and the real bump is what
  crashes. If you sync `cog.toml`, keep all three or drop all three.

Divergences inherited from `template-genesys-function` (do not re-fix these against `template-deno`):

- **Build and release.** Ships an AWS Lambda zip, not a JSR/npm package. The `build:genesys*` tasks
  replace the bundle/npm/binary tasks; `publish` runs `scripts/publish.ts` against a live Genesys
  org; there is no docs site and no JSR/npm publish job.
- **No `check:docs`.** The public API is expressed in vendor types (`Context`, `Handler`,
  `ApiClientClass`), which `deno doc --lint` rejects as private-type references. Typed exports are
  still enforced by the `explicit-module-boundary-types` lint rule.
- **Test permissions.** The Platform SDK reads `process.env` and the home directory as it loads, so
  tests run with `--allow-env --allow-sys --allow-read` rather than the baseline's bare `--no-prompt`.
- **`scripts/` is not linted.** `publish.ts` is an interactive CLI that writes to the console, which
  the baseline's `no-console` rule forbids. It is still type-checked — `check:types` covers
  `src/ tests/ scripts/`.

## Conventions

- **Conventional Commits**, enforced by the Cog `commit-msg` hook and by CI.
- **Commit messages are a single line.** No bodies, no `Co-Authored-By:` trailers, no multi-line
  messages. This overrides the default behaviour of most coding agents.
- **Never append `[skip ci]`.** GitHub Actions honours that marker literally and skips every
  workflow for the push, so a commit carrying it never runs CI and never reaches the release job —
  which is the only thing that bumps the version and cuts a tag. It also lands verbatim in the
  generated changelog. The release workflow pushes with `GITHUB_TOKEN`, and pushes made with that
  token do not trigger further workflow runs, so there is no release loop to guard against.
- **All dependencies live in the `deno.json` `imports` map** — source files use bare specifiers only;
  never write inline `npm:`/`jsr:` specifiers in `src/`. `deno lint` enforces this. `scripts/` is the
  one exception — its prompt library is pinned inline and disabled per-file, deliberately, so that
  nothing reachable from `src/` can import it.
- **Avoid `node_modules` in every possible case** — prefer `jsr:` packages, use `npm:` only when no
  JSR alternative exists, and never set `nodeModulesDir`. The bundle has to load under Node without
  one.
- **Coverage targets**: 80% lines, 80% branches, 100% functions — every function exercised by tests.
- **Test fixtures are fixed, not generated.** `tests/fixtures.ts` is deterministic on purpose: a
  filter test cannot assert that `subject ~ "invoice"` matches unless it knows the subject, and a
  generator turns a case-sensitivity bug into an intermittent failure that CI retries away.
- Formatting and linting follow `deno fmt` / `deno lint` (line width 120).
- Every exported symbol needs JSDoc; public functions ship a runnable `@example`, checked by
  `deno task check:examples`.

## Boundaries

Always:

- Run `make check` and `make test` before preparing a commit.
- Keep `deno.lock` in sync — `deno task check:dependencies` verifies it.
- Treat the 15-second ceiling as the budget when adding any API call.
- Keep every `handleRule` path appending exactly one `executionLog` entry.
- Honour `isTestMode` in any handler that performs a side effect. A dry run that sends mail is worse
  than no dry run at all.

Ask first:

- Adding or updating a dependency.
- Changing the filter language's semantics, or the rule columns. Both are contracts with datatables
  already deployed in customer orgs; a change breaks rule sets nobody in this repo can see.
- Changing CI workflows, `cog.toml`, the `publish` task, or `scripts/publish.ts`.
- Raising or lowering coverage thresholds.
- Running `make publish` — it changes a live Genesys org.

Never:

- Log `clientSecret`, an access token, or anything else from `clientContext`.
- Cache live state — conversation state, queue or agent statistics, presence. Serving those stale
  returns a wrong answer into a live flow, which reads as a working function.
- Commit secrets — `make security` runs gitleaks over both the working tree and the full Git history.
- Skip, delete, or weaken failing tests, or bypass hooks with `--no-verify`.
- Edit `version` in `deno.json` by hand — `cog bump` owns it.
- Commit generated artifacts: `target/`, `.coverage/`.
