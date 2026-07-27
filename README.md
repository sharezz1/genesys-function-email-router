# Genesys Email Router

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A **Genesys Cloud Function data action** that applies a rule set to inbound email. Rules live in an Architect datatable,
one per row: a filter expression, and what to do when it matches. The function evaluates them against one message and
reports a decision — transfer to a queue, forward, auto-reply, adjust priority, disconnect — which the calling Architect
flow acts on.

Written in Deno 2.x, bundled to a single CommonJS `index.js` and shipped as `target/index.zip`.

## Not the AWS Lambda data actions integration

Genesys ships two integrations with nearly identical names, and mixing them up is the fastest way to follow wrong
advice.

|                | **Function data actions** (this repo) | AWS Lambda data actions |
| -------------- | ------------------------------------- | ----------------------- |
| Runs in        | Genesys's AWS account                 | _your_ AWS account      |
| IAM role       | none — you have no AWS credentials    | required                |
| VPC / S3 / SQS | unavailable                           | available               |

Everything below assumes the left column. The function has no AWS resources of its own and **no persistent storage of
any kind** — the rule set lives in a datatable because there is nowhere else for it to live.

## How it works

One invocation does this, in order:

1. Authenticates with the credentials the data action passes in `clientContext`.
2. Reads the conversation and the one message named in the request. Two API calls.
3. Reads every row of the rule datatable.
4. Walks the rules top to bottom. For each: skip if disabled, evaluate its filter, run its action.
5. **Stops at the first rule that produces a decision.** Returns the decision and an audit trail.

Rule order is therefore significant, and actions come in two kinds:

| Kind           | Actions                                                                      | Effect                                      |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| **Terminal**   | `route`, `disconnect`                                                        | Sets the decision. Evaluation stops here.   |
| **Continuing** | `reply`, `forward`, `priority_set`, `priority_increase`, `priority_decrease` | Updates the context. Evaluation carries on. |

So a `route` rule placed early makes every rule below it unreachable, and reply/priority rules accumulate until
something terminal fires.

## Quick start

**Prerequisites:** [Deno 2.x](https://docs.deno.com/runtime/getting_started/installation/) and `make`. `make setup`
installs the project's dependencies, not Deno itself.

```sh
make setup             # dependencies and the Cog git hooks
make check && make test
make build             # writes target/index.zip
```

To ship it to a Genesys org, export the three `GENESYS_*` credentials and run `make publish` — see
[Publishing](#publishing).

## The Architect contract

This is the half that lives outside the repo, and the half a first-time adopter gets wrong. **The function decides; the
flow acts.** Nothing is transferred, disconnected or replied by the function itself — with one exception, noted below.

The flow must branch on `decision` and handle every value:

| `decision`       | What the flow must do                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `transfer_queue` | Transfer to the queue named in `target`, applying `skill` and `priority`.                  |
| `transfer_state` | Jump to the flow state named in `target`.                                                  |
| `transfer_email` | The message **has already been forwarded** to `target`. Close out the flow.                |
| `disconnect`     | End the interaction.                                                                       |
| `none`           | No rule produced a decision. Continue on your default path — this is success, not failure. |

Three things that surprise people:

- **`replies` are staged, not sent.** A `reply` rule resolves the canned response text and returns it in `replies`; the
  flow sends it. Delivery belongs to the side that can retry — this function gets one 15-second attempt.
- **`priority` is always present**, seeded to `0`, whether or not a rule set it.
- **`forward` and `route`-to-`email` are not interchangeable.** Both send mail. `forward` is a copy and evaluation
  continues; `route`-to-`email` sends _and_ terminates with `transfer_email`.

### Request

Supplied by the data action's request template:

| Field            | Type    | Required | Meaning                                                 |
| ---------------- | ------- | -------- | ------------------------------------------------------- |
| `datatableId`    | string  | yes      | The Architect datatable holding the rules.              |
| `conversationId` | string  | yes      | The email conversation being routed.                    |
| `messageId`      | string  | yes      | The message within it to evaluate.                      |
| `isTestMode`     | boolean | no       | Evaluate everything, send nothing. Defaults to `false`. |

`isTestMode` is how you arm a new rule set safely: filters run, decisions are reported, and every outbound send is
suppressed.

### Response

| Field          | Type     | Meaning                                                               |
| -------------- | -------- | --------------------------------------------------------------------- |
| `decision`     | string   | One of the five values above.                                         |
| `target`       | string?  | Queue name, flow state, or address.                                   |
| `skill`        | string?  | Skill to require, from the matching `route` rule.                     |
| `priority`     | number?  | Accumulated priority.                                                 |
| `replies`      | string[] | Canned response text for the flow to send.                            |
| `executionLog` | object[] | One entry per rule considered, including the ones that did not match. |

`executionLog` is the only observability this function has. A deployed function emits no logs at all — there is no
CloudWatch — so if a rule is not firing, this array is the answer. Each entry:

```json
{
  "id": "010-block-spam",
  "isValid": true,
  "isMatched": false,
  "isSuccessful": false,
  "message": "Filter did not match",
  "startedAt": 1767225600000,
  "endedAt": 1767225600002,
  "duration": 2
}
```

The three booleans separate the three ways a rule fails: `isValid` is the rule's configuration, `isMatched` its filter,
`isSuccessful` the action it ran.

## The rule datatable

The datatable **is** the configuration surface. Create it in Architect with these columns:

| Column            | Type    | Required | Meaning                                                                                              |
| ----------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `key`             | string  | yes      | The datatable key column. Appears in `executionLog` as `id`.                                         |
| `enabled`         | boolean | yes      | A disabled rule is skipped and recorded as skipped.                                                  |
| `action`          | string  | yes      | `route`, `forward`, `reply`, `disconnect`, `priority_set`, `priority_increase`, `priority_decrease`. |
| `filter`          | string  | no       | Filter expression. Absent means the rule always matches.                                             |
| `targetType`      | string  | no       | `queue`, `state` or `email`. Used by `route`.                                                        |
| `targetName`      | string  | no       | Queue name, flow state, or address. Used by `route` and `forward`.                                   |
| `priority`        | integer | no       | The value or amount for the priority actions.                                                        |
| `skill`           | string  | no       | Skill to require. Applied by `route`.                                                                |
| `responseLibrary` | string  | no       | Response Management library. Used by `reply`.                                                        |
| `responseName`    | string  | no       | Response within that library. Used by `reply`.                                                       |
| `description`     | string  | no       | For humans. Never read by the function.                                                              |

Rules are evaluated in the order the datatable returns them, so name keys such that they sort the way you want them to
run — `010-…`, `020-…` leaves room to insert.

> **Rows are not validated.** They are read as-is, and the datatable's own column types are the only schema enforcement.
> A misspelled column arrives as absent, and the rule is reported invalid in `executionLog` rather than failing the run.
> Get `enabled` typed as `string` rather than `boolean` and a row containing `"false"` will **run** — see
> [Known rough edges](#known-rough-edges).

### Actions

| Action              | Reads                               | Produces                               | Terminal | API calls          |
| ------------------- | ----------------------------------- | -------------------------------------- | -------- | ------------------ |
| `route`             | `targetType`, `targetName`, `skill` | `transfer_queue` / `_state` / `_email` | yes      | 1 if email, else 0 |
| `forward`           | `targetName`                        | sets `target`                          | no       | 1                  |
| `reply`             | `responseLibrary`, `responseName`   | appends to `replies`                   | no       | 2 sweeps           |
| `disconnect`        | —                                   | `disconnect`                           | yes      | 0                  |
| `priority_set`      | `priority`                          | sets `priority`                        | no       | 0                  |
| `priority_increase` | `priority`                          | adds to `priority`                     | no       | 0                  |
| `priority_decrease` | `priority`                          | subtracts, floor 0                     | no       | 0                  |

`reply` is by far the most expensive: resolving a response by name lists every library and then every response in it.
Several matching reply rules multiply that. See [Limits](#limits).

Mail the function sends — `forward`, and `route` to an `email` target — is sent **from the inbound route the message
arrived at**, which is the address the organization already publishes and is configured to send from.

### A worked example

| key                | enabled | action              | filter                                          | targetType | targetName        | priority | responseLibrary | responseName |
| ------------------ | ------- | ------------------- | ----------------------------------------------- | ---------- | ----------------- | -------- | --------------- | ------------ |
| `010-drop-bulk`    | true    | `disconnect`        | `from !* "*@*" OR subject ~ "unsubscribe"`      |            |                   |          |                 |              |
| `020-vip`          | true    | `priority_increase` | `from ∩ ("vip@client.com", "ceo@client.com")`   |            |                   | 5        |                 |              |
| `030-ack-invoices` | true    | `reply`             | `subject ~ "invoice"`                           |            |                   |          | Auto replies    | Invoice ack  |
| `040-invoices`     | true    | `route`             | `subject ~ "invoice" AND attachments * "*.pdf"` | queue      | Billing           |          |                 |              |
| `050-catch-all`    | true    | `route`             |                                                 | queue      | General Enquiries |          |                 |              |

An invoice from a VIP with a PDF attached matches `020`, `030` and `040`. Priority rises to 5, the acknowledgement is
staged, and evaluation stops at `040`:

```json
{
  "decision": "transfer_queue",
  "target": "Billing",
  "priority": 5,
  "replies": ["Thanks — we have your invoice and will respond within one working day."],
  "executionLog": ["…one entry per rule considered, including 010…"]
}
```

`050` never runs. Anything reaching it has matched nothing else, which is what makes a filter-less rule a usable
catch-all.

## Filter language

A filter is a single expression, or several combined with `AND` / `OR` and parentheses. `AND` binds tighter than `OR`.

### Fields

| Field         | Description                  | Multi-valued |
| ------------- | ---------------------------- | ------------ |
| `from`        | The sender of the email      | no           |
| `replyTo`     | The address used for replies | no           |
| `to`          | All "To" recipients          | yes          |
| `cc`          | All "CC" recipients          | yes          |
| `bcc`         | All "BCC" recipients         | yes          |
| `subject`     | The subject line             | no           |
| `body`        | The plain text body          | no           |
| `attachments` | Attachment filenames         | yes          |

Field names are case-insensitive. A field the message does not carry reads as empty and matches nothing, rather than
erroring.

### Operators

| Operator | Meaning                         | Example                                   |
| -------- | ------------------------------- | ----------------------------------------- |
| `=`      | Equals                          | `from = "user@domain.com"`                |
| `!=`     | Not equal                       | `from != "noreply@domain.com"`            |
| `~`      | Contains substring              | `subject ~ "invoice"`                     |
| `!~`     | Does **not** contain substring  | `body !~ "unsubscribe"`                   |
| `*`      | Matches glob pattern            | `attachments * "*.pdf"`                   |
| `!*`     | Does **not** match glob pattern | `attachments !* "*.exe"`                  |
| `~=`     | Matches regular expression      | `subject ~= "invoice [0-9]+"`             |
| `∩`      | Matches any of a list           | `to ∩ ("billing@x.com", "finance@x.com")` |

Every right-hand side may be a single value or a parenthesised list, and every operator accepts both.
`subject ~ ("invoice", "receipt")` means "contains either".

**On multi-valued fields the quantifier follows the operator's sign.** Affirmative operators ask whether _any_ value
matches; negative ones whether _no_ value does. So `to != "x"` reads as "x is not among the recipients" — which is
almost always what you meant — rather than "some recipient is not x".

**All comparisons are case-insensitive.** Both sides are lower-cased before matching.

### Examples

```txt
from !* "*noreply*"
subject ∩ ("urgent", "alert", "payment")
attachments ∩ ("invoice.pdf", "receipt.pdf")
to ∩ ("support@company.com") AND subject ~ "ticket"
(from = "vip@client.com") OR (subject ~ "priority")
replyTo * "support*@example.com"
from !* "*noreply*" AND (subject ~ "invoice" OR subject ~ "receipt")
```

### Regular expressions

`~=` matches against a JavaScript regular expression, and accepts a list:

```txt
subject ~= "invoice [0-9]{4}-[0-9]{2}-[0-9]{2}"
subject ~= ("invoice", "urgent", "alert")
body ~= "(urgent|alert|action required)"
```

An invalid pattern makes the comparison false rather than raising an error, so a typo silently stops the rule matching.
Test a new pattern with `isTestMode` before arming it.

There is no `!~=`. To require that none of several terms appear, chain negations:

```txt
subject !~ "invoice" AND subject !~ "urgent" AND subject !~ "alert"
```

### Glob patterns

The `*` and `!*` operators take a glob, not a regular expression:

| Syntax   | Meaning                               | Example                        |
| -------- | ------------------------------------- | ------------------------------ |
| `*`      | Any run of characters, including none | `attachments * "*.pdf"`        |
| `?`      | Exactly one character                 | `attachments * "invoice?.pdf"` |
| `[abc]`  | One character from a set              | `subject * "quarter [1-4]"`    |
| `[a-z]`  | One character from a range            | `attachments * "*[0-9].pdf"`   |
| `[^abc]` | One character **not** in the set      | `subject * "[^0-9]*"`          |
| `\`      | The next character, literally         | `subject * "10\\* discount"`   |

Everything else matches itself, so `.` is a dot and `+` is a plus — `attachments * "*.pdf"` will not match
`invoiceXpdf`. Globs match the whole value and span newlines, so `body * "*urgent*"` finds the word anywhere in a
multi-line message.

### Quoting

Values are always quoted, with `"` or `'`. A quote of the other kind needs no escaping: `subject ~ "John's invoice"`. To
include the _same_ quote character, escape it with a backslash: `subject ~ "she said \"hello\""`.

## Known rough edges

Honest list, so nobody discovers these the hard way. Each is behaviour as it stands today, not a plan.

- **`∩` and `*` are the same operator.** `∩` is implemented as a glob match, not as set intersection. It behaves as
  documented for plain values, but `to ∩ ("a@x.com", "b@x.com")` is matching globs that happen to contain no wildcards.
- **Regular expressions are lower-cased along with the input.** That delivers the documented case-insensitivity, but it
  also rewrites the pattern — so `\D`, `\S`, `\W` and `\B` become their own inverses, and `[A-Z]` matches nothing. Stick
  to lower-case patterns and the `[a-z]` forms.
- **Backslash escaping is only implemented before a closing quote.** `\\` does not produce a single backslash; write
  regex escapes with one backslash, as `"\.pdf$"`.
- **`enabled` fails open.** The check is a truthiness test, so if the column is typed `string`, the value `"false"`
  enables the rule. Type the column as `boolean`.
- **A failed send still reports success at the top level.** If `route` to an `email` target cannot send, `decision` is
  still `transfer_email`. The failure is recorded in `executionLog`, but a flow branching only on `decision` will not
  see it.
- **Canned response substitutions are not applied.** `{{token}}` placeholders in a Response Management response are
  staged verbatim.
- **A pathological regular expression can exhaust the function.** This applies to `~=` only — globs are matched by a
  bounded matcher that cannot backtrack. A `~=` pattern is handed to the JavaScript engine, which can backtrack
  exponentially: `subject ~= "^(a+)+$"` takes tens of seconds against a subject of a few dozen characters, and the
  platform kills the function at 15. Writing the pattern needs rule-table access, which is an admin permission, but the
  input is the inbound mail — so an unlucky pattern is a denial of service any sender can trigger. Prefer `*`, `~` and
  `starts`-style matching over `~=` unless you need it.

## Limits

Platform constraints, not choices this repo made:

- **15-second hard timeout**, configurable from 1 to 15. Retry belongs to the Architect flow.
- **300 Platform API requests per minute, per token** — and one client-credentials client holds one token, so that is
  this function's entire budget. The floor is 3 calls per invocation; each matching `reply` rule adds two paginated
  sweeps.
- **No logs in production.** `console` output goes nowhere. `executionLog` is the substitute.
- **No AWS resources and no storage.** No IAM, S3, SQS, VPC, or static egress IP.
- **Response budget 732 KB.** `executionLog` grows with the rule set; a very large table is the way to reach it.
- **`clientContext` caps at 3,584 bytes.**

## Publishing

`make publish` runs the full CI gate, then `scripts/publish.ts`, which works out what already exists and creates only
what is missing. On a fresh repo it walks a bootstrap — pick or create the integration, name the action, choose a
runtime, set the timeout — and writes the result into the `genesys` block in `deno.json`, which is committed so nobody
repeats it.

Every run then opens a draft, uploads the zip, validates it, executes it end to end, and publishes. The validate and
execute steps exist to catch an upload that succeeds but misconfigures the runtime, so the function only fails once it
is live inside a flow.

Configuration comes from the **process environment**; nothing loads a `.env` file. [direnv](https://direnv.net) with a
gitignored `.envrc` is the usual choice.

| Variable                  | Required | Notes                                      |
| ------------------------- | -------- | ------------------------------------------ |
| `GENESYS_HOST`            | yes      | e.g. `mypurecloud.com`                     |
| `GENESYS_CLIENT_ID`       | yes      | OAuth client credentials                   |
| `GENESYS_CLIENT_SECRET`   | yes      |                                            |
| `GENESYS_ACTION_ID`       | no       | overrides `genesys.actionId`               |
| `GENESYS_RUNTIME`         | no       | overrides `genesys.runtime`                |
| `GENESYS_TIMEOUT_SECONDS` | no       | overrides `genesys.timeoutSeconds`, max 15 |
| `GENESYS_INTEGRATION_ID`  | no       | skips the integration prompt on bootstrap  |
| `GENESYS_ACTION_NAME`     | no       | bootstrap default                          |

At runtime the function reads its credentials from the `X-Genesys-API-Host`, `-Key` and `-Secret` headers, which the
data action's request headers populate from credentials configured on the integration in Admin, with fields named
`host`, `clientId` and `clientSecret`.

`make publish` changes a live Genesys org. Treat it accordingly.

If you would rather not deploy from a checkout, every
[release](https://github.com/DanzigerGeist/genesys-function-email-router/releases) carries the built
`genesys-function-email-router-<version>.zip`, which you can upload to a function data action by hand. Its handler is
`index.handler`.

## Commands

| Command          | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `make setup`     | Install dependencies and the Cog git hooks. Run once.     |
| `make format`    | Apply formatting                                          |
| `make check`     | Format, lint, type, dependency and JSDoc-example checks   |
| `make test`      | Run the suite and collect coverage                        |
| `make ci`        | Every gate CI runs: checks, coverage, security, zip build |
| `make security`  | Secret scan (gitleaks) and dependency audit               |
| `make build`     | Bundle to CJS and zip to `target/index.zip`               |
| `make publish`   | Deploy the zip to Genesys Cloud                           |
| `make benchmark` | Benchmark the filter language                             |
| `make update`    | Update dependencies within their semver ranges            |
| `make clean`     | Remove generated artifacts and the Deno cache             |
| `make version`   | Print package metadata                                    |
| `make help`      | List all targets                                          |

`make` is a convenience over `deno task`. Run `deno task` with no arguments for the granular tasks.

## Project layout

```
src/
  mod.ts              handler — the entry point Genesys invokes
  routing/            the evaluation loop: build the context, run one rule
  filters/            the filter language: tokenize, compile, evaluate
  actions/            one handler per rule action
  genesys/            the kit for calling Genesys APIs back
  types/              contract types and the rule model
  utils/              email helpers and pagination
scripts/publish.ts    deploy pipeline; never bundled, never imported by src/
tests/                test suite, mirroring src/
benchmarks/           filter-language benchmarks
```

## Contributing

Conventional Commits, enforced by the Cog `commit-msg` hook. Run `make check` and `make test` before committing; the
pre-push hook runs them anyway. Coverage gates at 80% lines, 80% branches and 100% functions.

A useful bug report for this project contains the filter expression verbatim, the datatable row as redacted JSON, and
the `executionLog` from the response.

[`AGENTS.md`](AGENTS.md) is the full engineering reference: platform limits, rate-limit handling, SDK gotchas, and the
invariants to preserve when changing the rule engine.

## License

[MIT](LICENSE).
