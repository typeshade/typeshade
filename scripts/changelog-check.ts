// Every change to what the package ships names itself in CHANGELOG.md, or says why it does not.
//
// Between 0.1.0 and #866, 90 of 355 merged pull requests changed code and wrote no entry, because
// nothing asked for one: RELEASING.md moves `[Unreleased]` at a release, and no commit or pull
// request check read the file. This check asks. A diff that changes a shipped source file (under
// `src/`, not a test, not a fixture) passes when it also changes CHANGELOG.md, or when a commit
// message or the pull request's description carries `Changelog: none, <reason>` (an internal
// refactor, a test-only helper under `src/`, a fix a later entry already describes). The trailer
// stays in the history, where a reviewer reads it, as `Change:` and `Docs-Impact:` do.
//
//   bun scripts/changelog-check.ts --base origin/main   a pull request's range
//   bun scripts/changelog-check.ts --staged             the index, with --message-file <path>

import { readFileSync } from 'node:fs';
import { git } from './doc-refs.js';
import { readDiff, type Diff } from './doc-impact.js';

/** Whether `path` is a file the package ships: under `src/`, and not a test or test support. */
export function ships(path: string): boolean {
  if (!path.startsWith('src/')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  if (/(^|\/)(__fixtures__|__snapshots__|testing)\//.test(path)) return false;
  return /\.[cm]?[jt]sx?$/.test(path);
}

/** The `Changelog: none, <reason>` line of `messages`, or null. A reason is required. */
export function changelogNone(messages: string): string | null {
  const m = /^\s*Changelog:\s*none\s*,\s*(\S.*)$/im.exec(messages);
  return m ? m[1]!.trim() : null;
}

/** The problems with `diff` and `messages`: none when nothing shipped changed, when CHANGELOG.md
 *  changed with it, or when a message says why not. */
export function judgeChangelog(diff: Diff, messages: string): string[] {
  const changed = [...diff.modified, ...diff.added, ...diff.renamed.map(([, b]) => b)];
  const shipped = [...changed, ...diff.deleted].filter(ships);
  if (shipped.length === 0) return [];
  if (changed.includes('CHANGELOG.md')) return [];
  if (changelogNone(messages) !== null) return [];
  const shown = shipped.slice(0, 5).join(', ') + (shipped.length > 5 ? ', …' : '');
  return [
    `this change ships ${shipped.length} source file(s) (${shown}) and leaves CHANGELOG.md alone. ` +
      'Add an entry under `## [Unreleased]` saying what a user of the package now sees, or say why ' +
      'it has none with a `Changelog: none, <reason>` line in the message.',
  ];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const baseAt = args.indexOf('--base');
  const fileAt = args.indexOf('--message-file');
  let base = 'HEAD';
  let messages = fileAt >= 0 ? readFileSync(args[fileAt + 1]!, 'utf8') : '';
  if (baseAt >= 0) {
    base = git('merge-base', args[baseAt + 1]!, 'HEAD').trim();
    messages += git('log', '--format=%B', `${base}..HEAD`);
  }
  // CI passes the pull request's description too.
  messages += `\n${process.env.PR_BODY ?? ''}`;
  const problems = judgeChangelog(readDiff(base, staged), messages);
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (problems.length === 0) console.log('CHANGELOG.md: nothing owed.');
  process.exit(problems.length ? 1 : 0);
}
