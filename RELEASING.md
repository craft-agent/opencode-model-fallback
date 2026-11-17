# Releasing

Release Drafter keeps a draft release after each successful Tests run on
`main`. Publishing it ships the npm package.

## Flow

Publish releases from the Actions tab: run **Publish release**
(`.github/workflows/release-publish.yml`) there. A release published on the
Releases page is not built and has no tag carrying `dist/`, so the `npm` job
runs only for the Actions-tab run, and nothing ships to consumers from the
Releases page.

1. **`release`** calls the shared release workflow of
   [repo-kit](https://github.com/craftsamo/repo-kit). It sets the draft's
   version in `package.json` with a commit on `main`, builds
   (`pnpm install --frozen-lockfile && pnpm run build`), and tags a release
   commit that adds the built `dist/` to that tree. `main` gets only the version
   commit, so it never holds `dist/`.
2. **`package`** reads `private` from `package.json`; the job below runs only
   when it is not `true`.
3. **`npm`** checks out the tag and publishes the package with
   `npm publish --ignore-scripts`. It installs nothing, since the tag already
   carries `dist/`; it checks that npm is 11.5.1 or later, that `package.json`
   names the tag's version, and that the tarball holds `dist/opencode.js`. It
   authenticates with npm trusted publishing, so no token is stored, and the
   package carries a provenance statement. A version npm already publishes is
   skipped, so a re-run is safe; one npm still holds as staged is waited for,
   up to five minutes, until `npm view` shows it.

If `npm` fails, fix the cause and re-run the failed job.

## Versions

The version lives in `package.json`. Nobody edits it by hand: the release
workflow bumps it.

## One-time setup

- **npm.** The package must exist before its settings do, so publish the first
  version by hand from its tag with
  `npm publish --access public --ignore-scripts --provenance=false`
  (`publishConfig.provenance` is true and a local publish cannot make
  provenance). Then, on npmjs.com, open the package's settings and add a
  trusted publisher: GitHub Actions, the repository's owner and name, workflow
  `release-publish.yml`. npm does not check the entry when it is saved, and
  expires it unless a publish succeeds within two days. Right after a manual
  publish, npm holds the version as staged while it validates it: `npm view`
  answers E404 and another publish is refused as staged. The release workflow
  then waits for `npm view` to show the version, so the job may be run at once;
  if npm still holds it after five minutes, the job fails and may be re-run.
- **Repository.** `repo-kit setup github` creates the release deploy key
  (`RELEASE_DEPLOY_KEY`) that lets the version commit past the protection of
  `main`, and allows the actions the workflows use. Run it again after a
  workflow starts using a new action. An organization must allow deploy keys in
  its repositories (member privileges); where it does not, the key is disabled
  and the `release` job fails when it pushes the version commit.
