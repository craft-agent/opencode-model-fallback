# Examples

Three plugins for a consumer who answers the fallback's questions over
OpenCode's plugin RPC. Copy one and adapt it; they are not part of the
package's API and are not published with it. Provider and model names in them
are placeholders.

- [`usage-file.js`](usage-file.js) answers `usable` from a JSON usage file you
  keep up to date (option `file`): a step whose provider has nothing left and a
  reset still ahead is passed over, with the reset in the reason. An unreadable
  file leaves every step usable.
- [`refusal-text.js`](refusal-text.js) answers `limit` from a provider's own
  wording (option `patterns`): an error whose message or body matches is a
  limit, with the wait from the pattern or from the minutes it captures.
- [`shared-window.js`](shared-window.js) listens to each `limited` event and
  passes over every step that shares the spent window (option `windows`, with
  `provider/*` for a whole provider; a `#variant` is ignored) until the
  cooldown ends.

To load one beside the fallback, copy it as `index.js` into a folder of its own
and install the package there, since the plugin imports
`@craftsamo/opencode-model-fallback/rpc` (OpenCode loads a local plugin folder
from its root `index` file):

```sh
mkdir -p plugins/usage-file
cp examples/usage-file.js plugins/usage-file/index.js
cd plugins/usage-file && npm init -y && npm pkg set type=module
npm install @craftsamo/opencode-model-fallback@<version>
```

Then list the folder in `opencode.json`, with its options, beside the fallback
pinned to the same version:

```json
{
  "plugins": [
    { "package": "@craftsamo/opencode-model-fallback@<version>", "options": { "routes": {} } },
    { "package": "./plugins/usage-file", "options": { "file": "/var/lib/usage/usage.json" } }
  ]
}
```

Their tests (`*.test.ts` here) run with `bun test`.
