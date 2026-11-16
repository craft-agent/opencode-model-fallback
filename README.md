# opencode-model-fallback

Fall back between models in OpenCode when a primary agent or a subagent hits a limit.

An OpenCode plugin, delivered as an npm package and pinned by its version. It
needs OpenCode 2.1.2 or later.

The fallback itself is being built: it will route each agent through an ordered
list of models, launch a subagent on the first one that is available, and move
a session to the next model when one hits a limit. Its settings will be
documented here as they land. With nothing configured, the plugin changes
nothing.

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

| Setting         | Variable                                | Meaning                                                                                                                                             |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolsets`      | `OPENCODE_MODEL_FALLBACK_TOOLSETS`      | the toolsets that are on, or `all`; default those `src/project.ts` names                                                                            |
| `read_only`     | `OPENCODE_MODEL_FALLBACK_READ_ONLY`     | registers no tool that writes; wins over every other setting                                                                                        |
| `unattended`    | `OPENCODE_MODEL_FALLBACK_UNATTENDED`    | no person can answer: a write runs only under a grant that covers it; off by default                                                                |
| `grants_dir`    | `OPENCODE_MODEL_FALLBACK_GRANTS_DIR`    | where grants and their use are kept; default `$XDG_STATE_HOME/opencode-model-fallback/grants`, else `~/.local/state/opencode-model-fallback/grants` |
| `tools`         | `OPENCODE_MODEL_FALLBACK_TOOLS`         | single tools to add by ID, whatever their toolset                                                                                                   |
| `exclude_tools` | `OPENCODE_MODEL_FALLBACK_EXCLUDE_TOOLS` | single tools to remove by ID; wins over `tools` and `toolsets`                                                                                      |
| `language`      | `OPENCODE_MODEL_FALLBACK_LANGUAGE`      | the approval prompt's language, such as `ja`                                                                                                        |

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
- `src/opencode/` — the OpenCode plugin, built to `dist/opencode.js`.
- `skills/` — one skill per toolset, `skills/<name>/SKILL.md`, which the plugin
  registers only for the toolsets that are on.

How a release is made is in [`RELEASING.md`](RELEASING.md).

## License

[AGPL-3.0 with Commons Clause](LICENSE)
