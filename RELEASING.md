# Releasing `typeshade`

Publishing is a GitHub release. Creating the release runs
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which re-runs every CI gate,
builds, rewrites the manifest onto `dist/`, proves the packed tarball installs and imports, and
uploads it to npm with a provenance attestation. There is no manual `npm publish`, and no
credential on anyone's machine.

**npm cannot un-publish a version.** A bad upload burns that version number permanently and the
next release has to be the one after it, with an explanation. That is why the gates run twice
and why the dry run below is worth the four minutes.

---

## 0. Authentication (already set up)

**Nothing to do here for the first release.** The repository secret `NPM_ACCESS_TOKEN` exists
and the workflow reads it; §1 is where the work starts. This section is for changing that
later.

### What is configured today

|          |                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `NPM_ACCESS_TOKEN`, **already set** in Settings → Secrets and variables → Actions                                                             |
| Used by  | `.github/workflows/publish.yml`, written to `.npmrc` immediately before `npm publish`                                                         |
| Rotation | On expiry, generate a new granular token scoped to the `typeshade` package with **Read and write**, and update the secret under the same name |

The workflow's log says which path it took, so a run that silently fell back is visible.

### Moving to trusted publishing (optional, and better)

npm exchanges the workflow's OIDC identity for a short-lived publish credential, so there is no
token to store, leak, or rotate. Worth doing once the first release has proved the pipeline,
but not before, because a misconfiguration here fails **after** the tag is pushed.

1. Sign in to npmjs.com as the package maintainer (`su.noh`).
2. Go to <https://www.npmjs.com/package/typeshade> → **Settings** → **Trusted publisher**.
3. Choose **GitHub Actions** and fill in:
   - Organization or user: `typeshade`
   - Repository: `typeshade`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
4. Save, then **delete the `NPM_ACCESS_TOKEN` secret**. While it exists the workflow uses it and
   trusted publishing is never attempted, so leaving it in place means the OIDC path is
   configured but untested, which is the worst of both.

Two things will break this silently, so they are worth knowing now: **renaming
`publish.yml`** invalidates the registered publisher until you re-register it, and trusted
publishing needs **npm ≥ 11.5.1**, which is why the workflow upgrades npm before publishing
rather than using the runner's bundled 10.x.

### Going back to a token

Re-create the secret and the workflow uses it again on the next run; nothing else changes.
npmjs.com → your avatar → **Access Tokens** → **Generate New Token** → **Granular Access
Token**, scoped to the `typeshade` package only, permission **Read and write**, with the
shortest expiry you are willing to renew. Not a classic "Automation" token scoped to every
package you own. Add it under **Settings → Secrets and variables → Actions** as
`NPM_ACCESS_TOKEN`.

### What the package already is

Reserved by the owner on 2026-09-07 as a `0.0.0` placeholder: maintainer `su.noh`, homepage
`https://typeshade.dev`, MIT. The scope `@typeshade` is the same owner's and `@typeshade/core`
is a second placeholder held for a possible future split, and **nothing is published to it**.

---

## 1. Prepare the release commit

**0.1.0 is the first real release.** The `0.0.1` in `package.json` is placeholder-era and was
never published. Authentication needs nothing from you (§0).

1. Set the version. Edit `package.json` by hand, or:

   ```bash
   npm version 0.1.0 --no-git-tag-version
   ```

   `--no-git-tag-version` matters: the tag is created in step 3, on a commit that is already on
   `main`, not by npm on your working copy.

2. Move the `## Unreleased` entries in `CHANGELOG.md` under a new heading for the version, and
   leave `## Unreleased` in place, empty, for what comes next. Everything below `### 2026-09`
   is generated monorepo-era history, so do not touch it.

3. Run the gates locally. The workflow runs them too, but finding a failure here costs a
   commit and finding it there costs a release:

   ```bash
   bun install
   bun run build
   bun run test
   bun run gate:compile          # needs Chromium once: ./node_modules/.bin/playwright install --only-shell chromium
   bun run bake:api-surface      # must produce no diff
   bunx prettier --check .
   ```

4. Look at what would ship. This rewrites `package.json` in your working tree. The message
   says so, and `git checkout -- package.json` puts it back:

   ```bash
   bun run manifest:publish              # preview the published manifest; no files written
   bun scripts/publish-manifest.ts --write
   npm pack --dry-run
   git checkout -- package.json
   ```

5. Open a pull request with the version bump and the changelog entry, and merge it.

---

## 2. Dry run (recommended for the first release)

From the **Actions** tab → **publish** → **Run workflow**, with `dry_run` left checked. It runs
every gate, builds, packs, installs the tarball into a scratch project and imports every
subpath, then calls `npm publish --dry-run` and uploads nothing. The job summary reports the
tarball's size and file count.

A dry run on `main` before tagging tells you the pipeline works without spending a version
number.

---

## 3. Tag and release

The tag must be `v` + the exact `package.json` version, or the workflow stops before publishing
and says so.

```bash
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```

Then create the release on GitHub, under **Releases → Draft a new release**, choosing the tag
you just pushed, and publish it. ("Publish release" is the button that starts the workflow; saving
a draft does not.)

You can also create the tag from the release form itself, in which case the `git tag` /
`git push` above are unnecessary.

---

## 4. What the workflow does

| Step                                       | What it is for                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`                                   | Calls `ci.yml`: type check, the full unit suite, and the compile gate (every example emitted and compiled by Tint and a real WebGL2 context). Not a copy of CI; the same file.                                                                                                                                |
| tag check                                  | `v$(package.json version)` must equal the release tag. Wrong tag, no upload.                                                                                                                                                                                                                                  |
| `bun run build`                            | Emits `dist/src/**`, `dist/examples/**` and `dist/shade.d.ts`.                                                                                                                                                                                                                                                |
| `publish-manifest.ts --write`              | Rewrites `main`, `types`, `exports` and `sideEffects` onto `dist/`. Derived from the repository's own `exports` map by one rule, and it exits non-zero naming any entry point the build did not produce.                                                                                                      |
| `npm pack`                                 | Records name, version, size and file count in the job summary.                                                                                                                                                                                                                                                |
| tarball check                              | Installs the packed tarball into a scratch project, imports every runtime subpath **read back out of the published `exports` map** (eight today; `./shade` is types-only and skipped), and compiles a small `"use typeshade"` program through it. The last chance to catch a tarball that cannot be imported. |
| `npm publish --provenance --access public` | Uploads, with a provenance attestation linking the tarball to this workflow run and commit.                                                                                                                                                                                                                   |

---

## 5. Verify on the registry

```bash
npm view typeshade version          # 0.1.0
npm view typeshade dist.tarball
npm view typeshade exports          # every subpath must point under ./dist/
```

Then install it somewhere clean and use it:

```bash
mkdir /tmp/check && cd /tmp/check
echo '{"name":"check","version":"1.0.0","private":true,"type":"module"}' > package.json
npm install typeshade
node --input-type=module -e "
  const { compile } = await import('typeshade')
  const r = compile('\"use typeshade\"\nexport function f(x: f32): f32 { return x * x }\n')
  console.log(r.diagnostics.length, 'diagnostics')
  console.log(r.wgsl)
"
```

The package page should show the **Provenance** panel with this repository and the workflow run.
Its absence means `--provenance` did not take effect. The release is still valid, but worth
looking into before the next one.

Last, re-pin the site: `typeshade/typeshade.github.io` vendors the compiler, and its guide links
to <https://www.npmjs.com/package/typeshade>.

---

## 6. When something goes wrong

| Symptom                                                                       | What happened, and what to do                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release tag 'vX' does not match package.json version 'Y'`                    | The tag and the manifest disagree. Nothing was published. Delete the tag and the release, fix whichever is wrong, and cut it again.                                                                                                       |
| `403 Forbidden` / `You cannot publish over the previously published versions` | That version is already on the registry. npm never allows it to be replaced. Bump to the next patch and release that.                                                                                                                     |
| `ENEEDAUTH`, or a 401 on publish                                              | Neither auth path worked. If `NPM_ACCESS_TOKEN` is set, it has expired or lost its scope, so rotate it (§0). If it was deleted, the trusted publisher is not registered or does not match. The workflow log says which path it attempted. |
| Trusted publishing refused the OIDC exchange                                  | Most often the workflow filename registered on npmjs.com no longer matches, or npm is older than 11.5.1. Both are in §0.                                                                                                                  |
| A gate failed in `verify`                                                     | Nothing was built or uploaded. Fix it on `main`, delete the tag and the release, and cut it again from the fixed commit.                                                                                                                  |
| The tarball check failed                                                      | An entry point does not resolve from the packed package. Nothing was uploaded. `src/publish-manifest.test.ts` D3 and D4 cover this case locally, so run `bun run build && bun run test` and they should reproduce it.                     |

Nothing in this file publishes anything by itself. Every path to the registry goes through a
release you create.
