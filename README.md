# opencode-model-fallback

Fall back between models in OpenCode when a primary agent or a subagent hits a limit.

An OpenCode plugin, delivered as an npm package and pinned by its version. It
needs OpenCode 2.1.2 or later. It is tested on OpenCode 2.1.2 and 2.3.0, and
CI loads the plugin into both.

The fallback routes launches: a subagent starts on the first usable model of
its agent's route, and a model that hit a limit is passed over for a while. It
also moves a session, a primary agent's or a subagent's, to the next usable
model of its route when its model hits a limit. With nothing configured, the
plugin changes nothing.

[`docs/conventions.md`](docs/conventions.md) describes how the tools are named
and how they behave, and the rules of the fallback.

## Install

Install from the npm package, pinned to a version. In the commands below,
`<version>` is a release's version (`1.2.3`).

OpenCode takes the package and its options in `opencode.json`:

```json
{
  "plugins": [{ "package": "@craftsamo/opencode-model-fallback@<version>", "options": { "read_only": false } }],
  "permissions": [{ "action": "fallback_*", "resource": "*", "effect": "ask" }]
}
```

OpenCode allows any action no rule names, so the plugin's request is granted
silently unless a rule says `ask`. Read tools never ask, so the `fallback_*` glob
is safe.

## Routes

A route is an agent's models, in the order they are tried. Each step is written
`provider/model#variant`, as `/models` and an agent's `model` write it; the
`#variant` is optional. `routes` is a plugin option only, with no environment
variable or flag:

```json
{
  "plugins": [
    {
      "package": "@craftsamo/opencode-model-fallback@<version>",
      "options": { "routes": { "reviewer": ["provider-a/model-x", "provider-b/model-y#high"] } }
    }
  ]
}
```

A new subagent launch of a listed agent takes the first step whose model
OpenCode lists as usable: enabled, active, able to call tools and, for a step
with a variant, having that variant. OpenCode lists only the providers it can
use, so a provider without a login is skipped. The route wins over the model
the agent's own definition names. The agent keeps its prompt and permissions.

Some launches are left as they are:

- a continuation of an existing child;
- a launch that names a model;
- an agent with no route.

When no step is usable, the launch goes ahead as OpenCode would have made it.

### Notices

The result of a launch starts with one `[Model fallback: …]` line, but only
when the model changed or no step was usable. When the model changed:

```text
[Model fallback: reviewer provider-a/model-x → provider-b/model-y#high; provider-a/model-x is not in OpenCode's models]
```

The reason is the steps passed over, or `the route replaces the agent's model`
(`the inherited model`, when the agent names none) when the first step was
taken. When no step was usable:

```text
[Model fallback: reviewer: no step of its route is usable; launched on provider-c/model-z]
```

It reads `launched on OpenCode's choice` when no model is known. The same facts
are in the result's metadata under `opencode-model-fallback.launch`: `agent`,
`from`, `to` (`null` when no step was usable), `reason` and `skipped` (a list
of `{ model, reason }`).

Route entries that cannot be read, and fallback features that stayed off, are
told once, on the first launch:

```text
[Model fallback: config ignored: routes.reviewer[1]: "provider-b" is not provider/model#variant]
```

## Cooldowns

Once `routes` is configured, the plugin watches OpenCode's retries. A model
hits a limit when a request to it fails with:

- a quota error (`provider.quota`), or
- a rate limit (`provider.rate-limit`, or status 429) that OpenCode will retry
  only after a wait longer than `max_wait_ms`.

Any other error, authentication failures included, is not a limit, and a rate
limit OpenCode retries within `max_wait_ms` is left to OpenCode.

A model that hit a limit cools down: launches pass over a step with that model
(`a/x is cooling down until 2026-11-17T09:30:00.000Z` in the notice) until the
wait OpenCode reported, else `cooldown_ms`. A model listed without a variant
cools down in every variant; one listed with a variant, in that variant only.
A model that hits a limit again keeps the later end. A cooldown never changes
OpenCode's own decision to retry; a [move](#moves) may.

Cooldowns are saved in `cooldowns.json` in the state directory, so they survive
a restart. Ends already past are dropped when the file is read and written.
Processes that share a state directory (the background service and a
standalone run) merge on every save: per model the later end wins. A process
sees another's cooldown once it next saves. A file that cannot be read, when
loading or saving, is renamed to `cooldowns.json.unreadable`, counts as empty
and is told once in a notice; a file that cannot be written is told once too,
and the cooldowns stay in memory. The settings are in the [table](#settings):
`max_wait_ms`, `cooldown_ms` and `state_dir`.

## Moves

A session moves when its model hits a limit (see [Cooldowns](#cooldowns)) and
both of these hold: its agent has a route, and its model is a step of it. The
agent is the one OpenCode names for the retry, else the session's own. The model
is the step it equals, provider, ID and variant; a model with no variant that
equals no step is taken for the first step with its provider and ID. A model
off the route, or an agent with no route, is left to OpenCode, which decides as
it would have. This holds for primary agents and subagents alike.

The session moves to the first usable step after its own. A step is usable as it
is for a launch: OpenCode lists its model for the session's directory as
enabled, active and able to call tools (and, for a step with a variant, with
that variant), and the model is not cooling down. The model that hit the limit
is cooled down first, so it stays passed over. The plugin then switches the
session to the step, variant included, and tells OpenCode to retry at once,
replacing its own decision.

When no step is left, the last step of the route being the common case, a
subagent with a route stops retrying, so its parent gets the failure instead of
waiting on a model that cannot answer. A primary agent is left to OpenCode, so
a person still sees its retry or its error.

A move or a stop is recorded in the session's metadata, under
`opencode-model-fallback.moves`, as a list of `{ from, to, reason, at }` that
keeps the session's other keys: `from` and `to` are steps (`to` is `null` for a
stop), `reason` says why (`a/x hit a quota limit`, `a/x hit a rate limit`; a
stop adds `; no usable step left`) and `at` is an ISO time. A record that cannot
be written is dropped, and the move stands.

When a subagent moves or stops, its parent is told. The result of the subagent
call starts with one line for each move or stop made during that call (after any
launch line), and the same records are in the result's metadata under
`opencode-model-fallback.moves`. For a move:

```text
[Model fallback: reviewer provider-a/model-x → provider-b/model-y#high; provider-a/model-x hit a quota limit]
```

For a stop:

```text
[Model fallback: reviewer stopped on provider-b/model-y#high; provider-b/model-y#high hit a rate limit; no usable step left]
```

A call that continues a child tells only the moves made since the call began,
and is otherwise left as it is. A child that cannot be read tells nothing.

The moves need `session.switchModel`, `session.update` and `model.list` of
OpenCode. A host without one keeps moves off, says so once, and still records
cooldowns.

## Plugging in your own judgment

Your own OpenCode plugin can answer two questions the fallback asks, over
OpenCode's plugin RPC. Register handlers against `STEPS_RPC`, which the package
exports from `@craftsamo/opencode-model-fallback/rpc` (the same schemas the
fallback asks with):

- `usable({ agent, model })` → `{ usable, reason? }`: may this agent run on this
  step now? `model` is the step, `provider/model#variant`. The fallback asks it
  of a step only after its own checks passed it (OpenCode lists the model, it is
  not cooling down), in the order of the route, for a launch and for a move,
  and stops at the first step you do not refuse, so it asks at most once for
  each candidate. `{ usable: false }` passes the step over, for that launch or
  move only, as `a/x is unusable: <reason>` in the notice (`a/x is unusable`
  without a reason).
- `limit({ agent, model, error, wait_ms? })` → `{ limit, wait_ms?, reason? }`:
  is this error a limit? It is asked of a failed request the fallback's own
  rule does not take for a limit (see [Cooldowns](#cooldowns)); a quota or rate
  limit it found itself is never put to you. `error` is
  `{ type, status?, message, body? }` as OpenCode reported it, and `wait_ms` is
  the wait OpenCode's own decision gave, when it will retry after one; `agent`
  is empty when OpenCode names none for the retry. `{ limit: true }` cools the
  model down for `wait_ms` (the `cooldown_ms` setting when you give none, or
  zero) and moves a routed session on, with `a/x hit a limit: <reason>` as the
  move's reason (`a/x hit a limit` without one). One retry is asked once, even
  though both the cooldown and the move read it.

No answer means the fallback decides as it would alone: no plugin registered, a
handler that throws, an answer that does not fit the schema, a host without
RPC, or no answer within 2 seconds each count as one. Your plugin can never
break a launch or a move; the cost of a slow handler is up to 2 seconds for each
question. A reason is shown as one line of at most 200 characters.

An example plugin that passes over a step whose provider has an empty balance,
and takes an "insufficient balance" error for a limit:

```js
import { readFile } from "node:fs/promises"
import { STEPS_RPC } from "@craftsamo/opencode-model-fallback/rpc"

const HOUR_MS = 3_600_000

/** The balance left for a provider, from a file this plugin's owner keeps up to date. */
async function balanceOf(provider) {
  try {
    return Number(await readFile(`/var/lib/balances/${provider}`, "utf8"))
  } catch {
    return undefined
  }
}

export default {
  id: "balance-check",
  async setup(ctx) {
    const registration = await ctx.rpc.register(STEPS_RPC, {
      async usable({ model }) {
        const balance = await balanceOf(model.split("/")[0])
        return balance === 0 ? { usable: false, reason: "balance is empty" } : { usable: true }
      },
      async limit({ error }) {
        return /insufficient balance/i.test(error.message)
          ? { limit: true, wait_ms: HOUR_MS, reason: "balance is empty" }
          : { limit: false }
      },
    })
    return () => registration.dispose()
  },
}
```

Load it beside the fallback in `opencode.json`; for the RPC the order does not
matter, since the fallback looks for an answering plugin at each question. The
last plugin to register for the RPC wins. The package ships no type
declarations for the subpath yet. (A plugin that rewrites retry waits is a
different matter: see [Beside other plugins](#beside-other-plugins).)

### Remaining usage

The package reads no usage source of its own. A consumer that knows what usage
is left (a usage plugin, a file, a provider's API) answers `usable` with
`{ usable: false, reason }` for a step that is spent. To use paid credit only
after included usage, list the paid step after the included ones in the route:
a route's order is the whole policy.

## Beside other plugins

OpenCode runs every `retry` hook on the same event in the order the hooks were
registered, which is the order the plugins are listed, and each may replace
`event.decision`. List this plugin after any plugin that rewrites retry waits:

```json
{
  "plugins": [
    { "package": "@slkiser/opencode-quota" },
    { "package": "@craftsamo/opencode-model-fallback@<version>", "options": { "routes": {} } }
  ]
}
```

A plugin such as opencode-quota, whose `waitForQuotaReset` (on by default)
replaces a limit's decision with a wait for the window's reset, up to five
hours, must run first. Listed after this plugin, it would turn a move's
immediate retry, or a child's stop, into that wait. Listed before it, this
plugin has the last word, and the wait the other plugin set for a spent window
is read as a limit and makes a good cooldown.

## Tools and skills

The plugin registers no tool by default. Each toolset comes with a skill that
tells an agent how to use its tools. A skill names its toolset under `metadata`
in its frontmatter (`metadata: { toolset: <name> }`, written as a block).
OpenCode registers it only when the settings register at least one of that
toolset's tools, so a profile with the toolset off, or with all its tools
removed, does not see it; a skill without a toolset is always registered.

### Grants (`grants`)

Off by default. Delegates bounded writes for jobs where no person can answer.

| Tool                    | What it does                                             | Class          |
| ----------------------- | -------------------------------------------------------- | -------------- |
| `fallback_grant_create` | ask a person to delegate one tool's writes within limits | administrative |
| `fallback_grant_read`   | list grants and their use, or read the usage log         | read           |
| `fallback_grant_revoke` | remove a grant so no more calls run under it             | overwrite      |

Every write tool can be granted for its targets, calls per hour and expiry.
A tool adds what a grant can also limit by declaring `bounds` and giving
`measure(args, context)` in its spec: a ceiling (`max`), a yes or no
(`allow`), values from a list (`oneOf`) or the paths a value must sit under
(`prefix`); see the
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve).

## Adding a tool

1. Write the spec in `src/core/<domain>/<verb>.ts` with `defineTool`: an ID
   `<prefix>_<domain>_<verb>`, a title and description, the Zod argument and
   output schemas, its toolset and write class, and `execute(args, context)`.
   A write tool also gives `targets(args, context)`: what the call writes to,
   as a permission rule should name it. A tool whose settings can put some
   calls out of reach whatever the person answers gives
   `gate(args, context)`, which throws for such a call; it is refused before
   anyone is asked, and before `execute`.
2. Test it beside the spec (`<verb>.test.ts`), calling it through `invoke` as
   the plugin does. A tool that runs a program is tested against a fake of
   that program on `PATH`; no test reaches a real service.
3. List it in `src/tools.ts`. A new toolset goes into `toolsets` in
   `src/project.ts` (and `defaultToolsets` when it is on by default), a
   setting of the package's own into `options`, and a variable the tool reads
   besides the settings into `toolVariables`.
4. Add or update the toolset's skill, `skills/<prefix>-<toolset>/SKILL.md`,
   whose frontmatter names the toolset under `metadata`, then describe the
   tool under "Tools and skills".

[`docs/conventions.md`](docs/conventions.md) has the rules each step follows.

A package declares each option as `text`, `boolean`, `number`, `list`, `path`
or `paths`, or as an object with `type` and optional bounds. For example, in
`src/project.ts`:

```ts
options: {
  notes_dir: "path",
  note_limit: { type: "number", integer: true, min: 1, max: 50 },
}
```

`integer: true` requires a whole number; `min` and `max` bound a number or
count a `list` or `paths` value's items. An object with only `type` means the
same as the type alone.

## Reads and writes

Every read tool is named `<prefix>_<domain>_read`. Reads never ask; the plugin
asks OpenCode's permission before every other call.

OpenCode grants any action no rule names, so a write runs unasked unless a rule
asks for it: add the `fallback_*` rule shown under [Install](#install).

A call a tool's `gate` refuses never runs, whatever the answer. The plugin
refuses it before it asks, so no prompt shows it.

## Writes no one is there to approve

A grant limits a job's writes to one tool, for at most 90 days. The person
decides the rest: the targets (named ones, or `*` for any), the bounds the
tool declares (one left out is no limit) and the calls per hour (left out,
any number). Every call made under a grant is logged. A grant never
overrides OpenCode's permissions. The
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve) give the
contract.

1. In a session where a person answers, supply the key described under
   [Settings](#settings), turn on the `grants` toolset alongside the job's
   toolset, and ask the agent to delegate. It calls `fallback_grant_create`;
   the prompt shows the tool, targets, rate, days, every bound the tool
   declares (`no limit` for one left out) and the reason.
   Approve once.
2. Set the same key and `unattended` for the job only, for example
   `OPENCODE_MODEL_FALLBACK_UNATTENDED=true`. Otherwise grants are not checked.
3. Let OpenCode allow the write tool in that run: `opencode run` rejects every
   question unless an allow rule names the tool
   (`"permission": { "fallback_note_create": "allow" }`) or the run starts with
   `--auto`. The grant still bounds each call.
4. Revoke with `fallback_grant_revoke`, or list grants and their use with
   `fallback_grant_read`.

### Limits

- A run with every approval skipped (an always-approve mode, or an explicit
  `allow` for `fallback_grant_create`) shows no prompt. A grant created there
  is not a person's answer, and it can be as wide as any target, no bound and
  no rate for 90 days: create grants only where OpenCode asks.
- An earlier copy of the grants directory put back whole is not detected.
  Expiry, at most 90 days, bounds what it can restore.
- Anyone who can read the key can sign grants. Keep it where the agent's
  tools cannot read it.
- The plugin forces a question for `fallback_grant_create` through a hook;
  only OpenCode versions that offer that hook run it.

The OpenCode service keeps the environment it started with; see
[Settings](#settings) before changing the job's variables.

## Settings

An option wins over its environment variable.

| Setting         | Variable                                | Meaning                                                                                                                                                    |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolsets`      | `OPENCODE_MODEL_FALLBACK_TOOLSETS`      | the toolsets that are on, or `all`; default those `src/project.ts` names                                                                                   |
| `read_only`     | `OPENCODE_MODEL_FALLBACK_READ_ONLY`     | registers no tool that writes; wins over every other setting                                                                                               |
| `unattended`    | `OPENCODE_MODEL_FALLBACK_UNATTENDED`    | no person can answer: a write runs only under a grant that covers it; off by default                                                                       |
| `grants_dir`    | `OPENCODE_MODEL_FALLBACK_GRANTS_DIR`    | where grants and their use are kept; default `$XDG_STATE_HOME/opencode-model-fallback/grants`, else `~/.local/state/opencode-model-fallback/grants`        |
| `tools`         | `OPENCODE_MODEL_FALLBACK_TOOLS`         | single tools to add by ID, whatever their toolset                                                                                                          |
| `exclude_tools` | `OPENCODE_MODEL_FALLBACK_EXCLUDE_TOOLS` | single tools to remove by ID; wins over `tools` and `toolsets`                                                                                             |
| `language`      | `OPENCODE_MODEL_FALLBACK_LANGUAGE`      | the approval prompt's language, such as `ja`                                                                                                               |
| `max_wait_ms`   | `OPENCODE_MODEL_FALLBACK_MAX_WAIT_MS`   | the longest wait, in milliseconds, OpenCode may ask of a rate limit before it counts as a limit; at least 0, default 10000                                 |
| `cooldown_ms`   | `OPENCODE_MODEL_FALLBACK_COOLDOWN_MS`   | how long, in milliseconds, a model that hit a limit is passed over when OpenCode gave no wait; at least 1, default 3600000                                 |
| `state_dir`     | `OPENCODE_MODEL_FALLBACK_STATE_DIR`     | where the plugin keeps its state, the cooldowns included; default `$XDG_STATE_HOME/opencode-model-fallback`, else `~/.local/state/opencode-model-fallback` |

`OPENCODE_MODEL_FALLBACK_GRANT_KEY` is a variable only, never a plugin option.
Use at least 32 characters, for example from `openssl rand -hex 32`, stored
where you keep secrets. Without it no write runs while unattended and no grant
can be created.

Lists are comma-separated in a variable and arrays in a plugin option. A
package's own settings, listed in `options` in `src/project.ts`, take a row
each here and are read the same way. A `path` is trimmed; `~` and `~/…` (also
with the platform separator) stand for the home directory (`HOME` when it is
absolute, else the account's). It must then be absolute and reaches the tool
normalized, without a filesystem check. `paths` is a list of such paths,
comma-separated in a variable and an array of strings in a plugin option. Blank
paths and lists with no items after trimming and dropping blanks count as
unset. Bounds check only a given value, not an unset option. Refused values are
`invalid_argument`, naming the variable or option and what it must be.

OpenCode takes the plugin `options` shown above, with lists as arrays and
`read_only` as a boolean, and falls back to the variables. OpenCode runs
plugins in its background service, which keeps the environment it started
with: a variable set where `opencode run` starts has no effect until the
service is restarted in that environment (`opencode service restart`).

## Layout

- `src/project.ts` — the package's name, tool ID prefix, setting prefix,
  toolsets, tool options and the other variables its tools read.
- `src/core/` — the tool contract and the tools, free of any harness and of
  the project's names.
- `src/entry/` — settings, permissions, prompts and grants handling shared by
  the tools.
- `src/tools.ts` — the list of every tool, which the plugin registers.
- `src/words.ts` — the translations of the tools' words, per language, which
  the plugin uses in its approval prompts.
- `src/opencode/` — the OpenCode plugin, built to `dist/opencode.js`; its
  `fallback/rpc.ts` is the RPC consumers register against, built to
  `dist/rpc.js`.
- `skills/` — one skill per toolset, `skills/<name>/SKILL.md`, which the plugin
  registers only for the toolsets that are on.

How a release is made is in [`RELEASING.md`](RELEASING.md).

## License

[AGPL-3.0 with Commons Clause](LICENSE)
