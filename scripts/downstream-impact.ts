// ═══ What a compiler bump owes a downstream repository: the site and the editor extension ═══
//
// typeshade.dev (`typeshade.github.io`) and the editor packages (`vscode-typeshade`) vendor this
// repository as a git submodule and move the pin in one pull request at a time
// (`.github/workflows/pin-compiler.yml` in each). Everything this repository does to keep its own
// prose true stops at its own root, so a compiler change that removed an export the site's copy
// still names, or rewrote a section the editor's docs restate, arrived downstream as a green pin
// with stale text beside it. This script runs IN the downstream repository, from the pinned
// compiler, over the range the pin moves:
//
//   must fix   an export the compiler's `src/__api__/surface.md` lists at the old pin and not at
//              the new one, still named in a downstream file on a line the downstream branch did
//              not touch; a compiler file deleted or moved that a downstream file still names
//   must fix   a compiler `LINT.IfChange` block the range changed whose `ThenChange` names a file
//              in THIS repository (`//typeshade.github.io/src/pages/index.astro`), when the
//              downstream branch did not change that target: the cross-repository half of
//              `scripts/ifchange.ts`, checked where both sides finally meet. A commit message on
//              the downstream branch that says `NO_IFTTT=<reason>` waives this kind, and only
//              this kind: a removed name is fixed, never declared away.
//   must fix   a change proposal (`changes/`, `changes/README.md`) implemented at the new pin
//              that names THIS repository in its `downstream` list, when this repository's
//              `compiler-changes.md` does not record its id. The proposal says what the
//              repository owes; the record, a list item that starts with the id, says it is
//              done. Nothing waives it.
//
// The downstream repository's own `LINT.IfChange` pairs are checked by the same `ifchange.ts`,
// pointed at the downstream root: `TYPESHADE_DOCS_ROOT=$PWD bun <submodule>/scripts/ifchange.ts`.
//
// Usage, from the downstream root:
//   bun vendor/typeshade/scripts/downstream-impact.ts --repo vscode-typeshade \
//       --submodule vendor/typeshade --old <sha> [--new <sha>] [--base origin/main] \
//       [--check] [--markdown]
// `--old` defaults to the pin on `--base`, `--new` to the checked-out pin. `--hook` is the Claude
// Code commit hook (below).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks, waiver, type Block } from './ifchange.js';
import { surface } from './doc-impact.js';
import { HANDLED_FILE, handledIds, owedDownstream, proposalsAt } from './changes.js';

export interface Finding {
  /** `removed` and `proposal`: fix it, nothing waives it. `ifchange`: a `NO_IFTTT=` message can. */
  readonly kind: 'removed' | 'ifchange' | 'proposal';
  readonly subject: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const tryRun = (cwd: string, ...args: string[]): string => {
  try {
    return run(cwd, ...args);
  } catch {
    return '';
  }
};

/** Exports listed in the old bake and not the new one. */
export function removedExports(oldSurface: string, newSurface: string): string[] {
  const after = surface(newSurface).names;
  return [...surface(oldSurface).names].filter((n) => !after.has(n) && n.length >= 3).sort();
}

/** Lines a diff added, per head-side path (`git diff -U0` output). */
export function touchedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file = '';
  let at = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('--- ')) continue;
    else if (/^@@ /.test(line)) at = Number(/\+(\d+)/.exec(line)![1]);
    else if (line.startsWith('+')) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file)!.add(at++);
    }
  }
  return out;
}

/** Removed lines per base-side path, by base line number. */
function removedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file = '';
  let at = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) file = line.slice(4).replace(/^a\//, '');
    else if (line.startsWith('+++ ')) continue;
    else if (/^@@ /.test(line)) at = Number(/^@@ -(\d+)/.exec(line)![1]);
    else if (line.startsWith('-')) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file)!.add(at++);
    }
  }
  return out;
}

const TEXT = /\.(md|mdx|ts|mts|mjs|js|cjs|astro|json|ya?ml|html|css)$/;

export interface Options {
  readonly root: string;
  readonly repo: string;
  readonly submodule: string;
  readonly oldSha: string;
  readonly newSha: string;
  readonly base: string;
}

export function downstreamImpact(o: Options): { mustFix: Finding[]; waived: string | null } {
  const sub = join(o.root, o.submodule);
  const files = run(o.root, 'ls-files')
    .split('\n')
    .filter(
      (f) =>
        f &&
        TEXT.test(f) &&
        !f.startsWith(`${o.submodule}/`) &&
        f !== o.submodule &&
        !/(^|\/)(package-lock\.json|bun\.lock|CHANGELOG\.md)$/.test(f) &&
        existsSync(join(o.root, f)),
    );
  const mergeBase = run(o.root, 'merge-base', o.base, 'HEAD').trim();
  const branchDiff = run(o.root, 'diff', '-U0', mergeBase, '--', '.', `:!${o.submodule}`);
  const touched = touchedLines(branchDiff);
  const changedFiles = new Set(
    run(o.root, 'diff', '--name-only', mergeBase, '--', '.', `:!${o.submodule}`)
      .split('\n')
      .filter(Boolean),
  );
  const messages = run(o.root, 'log', '--format=%B', `${mergeBase}..HEAD`);
  const text = new Map(files.map((f) => [f, readFileSync(join(o.root, f), 'utf8').split('\n')]));
  const untouched = (f: string, line: number): boolean => !touched.get(f)?.has(line);
  const mustFix: Finding[] = [];

  // 1. Exports the pin removes.
  const removed = removedExports(
    tryRun(sub, 'show', `${o.oldSha}:src/__api__/surface.md`),
    tryRun(sub, 'show', `${o.newSha}:src/__api__/surface.md`),
  );
  for (const name of removed) {
    const re = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`);
    for (const [f, lines] of text) {
      lines.forEach((l, i) => {
        if (re.test(l) && untouched(f, i + 1)) {
          mustFix.push({
            kind: 'removed',
            subject: `export \`${name}\` removed from the compiler`,
            file: f,
            line: i + 1,
            text: l.trim(),
          });
        }
      });
    }
  }

  // 2. Compiler files the pin deletes or moves.
  for (const row of run(sub, 'diff', '--name-status', '-M', o.oldSha, o.newSha).split('\n')) {
    const [status, path, to] = row.split('\t');
    if (!status || !path || !(status.startsWith('D') || status.startsWith('R'))) continue;
    if (!path.includes('/') && !/\.(md|ts)$/.test(path)) continue;
    const needles = [`${o.submodule}/${path}`, path.includes('/') ? path : `/${path}`];
    for (const [f, lines] of text) {
      lines.forEach((l, i) => {
        if (needles.some((n) => l.includes(n)) && untouched(f, i + 1)) {
          mustFix.push({
            kind: 'removed',
            subject: to
              ? `compiler \`${path}\` moved to \`${to}\``
              : `compiler \`${path}\` deleted`,
            file: f,
            line: i + 1,
            text: l.trim(),
          });
        }
      });
    }
  }

  // 3. Compiler blocks the range changed that name a file in this repository.
  const rangeDiff = run(sub, 'diff', '-U0', '-M', o.oldSha, o.newSha);
  const subTouched = touchedLines(rangeDiff);
  const subRemoved = removedLines(rangeDiff);
  const inside = (b: Block, lines: Set<number> | undefined): boolean =>
    !!lines && [...lines].some((n) => n > b.start && n < b.end);
  const changedBlocks: Block[] = [];
  for (const path of new Set([...subTouched.keys(), ...subRemoved.keys()])) {
    for (const [sha, lines] of [
      [o.newSha, subTouched.get(path)],
      [o.oldSha, subRemoved.get(path)],
    ] as const) {
      const body = tryRun(sub, 'show', `${sha}:${path}`);
      if (!body.includes('LINT.')) continue;
      changedBlocks.push(...parseBlocks(path, body).blocks.filter((b) => inside(b, lines)));
    }
  }
  const downstreamBlocks = [...text].flatMap(
    ([f, lines]) => parseBlocks(f, lines.join('\n')).blocks,
  );
  const reported = new Set<string>();
  for (const block of changedBlocks) {
    for (const t of block.targets) {
      if (t.repo !== o.repo) continue;
      // One edit shows up on both sides of the range (removed from the old block, added to the new).
      const key = `${block.file}:${block.label ?? block.start}->${t.path}:${t.label ?? ''}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const met = t.label
        ? downstreamBlocks.some(
            (b) => b.file === t.path && b.label === t.label && inside(b, touched.get(t.path)),
          )
        : changedFiles.has(t.path);
      if (!met) {
        mustFix.push({
          kind: 'ifchange',
          subject: `compiler ${block.file}:${block.start}${block.label ? ` (${block.label})` : ''} changed; its ThenChange names this repository`,
          file: t.path,
          line: 1,
          text: `${t.path}${t.label ? `:${t.label}` : ''} did not change on this branch`,
        });
      }
    }
  }

  // 4. Proposals the new pin implements that name this repository and are not yet recorded.
  const handledPath = join(o.root, HANDLED_FILE);
  const handled = handledIds(existsSync(handledPath) ? readFileSync(handledPath, 'utf8') : '');
  const atPin = proposalsAt(o.newSha, (...args) => run(sub, ...args));
  for (const p of owedDownstream(atPin, o.repo, handled)) {
    const owed = p.downstream.filter((d) => d.repo === o.repo).map((d) => d.what);
    mustFix.push({
      kind: 'proposal',
      subject: `compiler change ${p.id} (${p.file}) owes this repository work`,
      file: HANDLED_FILE,
      line: 1,
      text: `${owed.join('; ')}. Do it on this branch, then record \`- ${p.id}\` in ${HANDLED_FILE}.`,
    });
  }

  return { mustFix, waived: waiver(messages) };
}

export function renderFindings(findings: readonly Finding[], markdown: boolean): string {
  if (!findings.length) return 'Nothing in this repository names what the compiler bump removes.';
  const bySubject = new Map<string, Finding[]>();
  for (const f of findings) bySubject.set(f.subject, [...(bySubject.get(f.subject) ?? []), f]);
  const out: string[] = [];
  for (const [subject, fs] of bySubject) {
    out.push(markdown ? `- **${subject}**` : `• ${subject.replace(/`/g, '')}`);
    for (const f of fs.slice(0, 20)) {
      const t = f.text.length > 100 ? `${f.text.slice(0, 97)}…` : f.text;
      out.push(
        markdown
          ? `  - \`${f.file}:${f.line}\` ${t.replace(/`/g, "'")}`
          : `    ${f.file}:${f.line}  ${t}`,
      );
    }
    if (fs.length > 20) out.push(`    … and ${fs.length - 20} more`);
  }
  return out.join('\n');
}

// ─── the Claude Code hook ──────────────────────────────────────────────────────────────────
//
// A downstream repository registers this in its `.claude/settings.json` as a PreToolUse hook on
// Bash, guarded on the file existing (a pin from before it has none):
//
//   [ ! -f vendor/typeshade/scripts/downstream-impact.ts ] ||
//     bun vendor/typeshade/scripts/downstream-impact.ts --hook --repo vscode-typeshade \
//       --submodule vendor/typeshade
//
// It does nothing unless the call is a `git commit`. Then, when the commit moves the pin (the
// staged gitlink differs from HEAD's), it runs the check above over that move; and it runs
// `ifchange.ts` over this repository's staged diff. It blocks the commit (exit 2, the report goes
// to the agent) on a removed export or file still named here, on a proposal the new pin owes
// this repository and `compiler-changes.md` does not record, and on an unmet ThenChange that
// the message does not waive with a `NO_IFTTT=<reason>` line.

function hook(repo: string, submodule: string): number {
  let input: { tool_input?: { command?: string } };
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as typeof input;
  } catch {
    return 0;
  }
  const command = input.tool_input?.command ?? '';
  if (!/(^|[;&|\s])git\s+(?:-C\s+\S+\s+)?commit\b/.test(command)) return 0;
  const root = process.cwd();
  let message = command;
  const file = /(?:-F|--file)[=\s]+(\S+)/.exec(command)?.[1];
  if (file && existsSync(file)) message += readFileSync(file, 'utf8');
  const report: string[] = [];

  const oldSha = tryRun(root, 'rev-parse', `HEAD:${submodule}`).trim();
  const newSha = /^\d+ ([0-9a-f]{40}) /.exec(tryRun(root, 'ls-files', '-s', submodule))?.[1] ?? '';
  if (oldSha && newSha && oldSha !== newSha) {
    const { mustFix } = downstreamImpact({ root, repo, submodule, oldSha, newSha, base: 'HEAD' });
    const binding = mustFix.filter((f) => f.kind !== 'ifchange' || !waiver(message));
    if (binding.length) {
      report.push(
        `${renderFindings(binding, false)}\n\nThis commit moves the compiler pin, and the new compiler ` +
          'removes what the lines above still name, or owes this repository the work above. Do each on this branch.',
      );
    }
  }

  const ifchange = spawnSync(
    'bun',
    [join(dirname(fileURLToPath(import.meta.url)), 'ifchange.ts'), '--staged'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, TYPESHADE_DOCS_ROOT: root } },
  );
  if (!ifchange.error && ifchange.status !== 0 && !waiver(message)) {
    report.push(
      `${ifchange.stdout.trim()}\n\nChange each ThenChange target to match, or say why it needs no ` +
        'change on a line of its own in the message: `NO_IFTTT=<reason>`.',
    );
  }

  if (!report.length) return 0;
  process.stderr.write(`${report.join('\n\n────────\n\n')}\n`);
  return 2;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = process.cwd();
  const submodule = arg('--submodule') ?? 'vendor/typeshade';
  const base = arg('--base') ?? 'origin/main';
  const repo = arg('--repo');
  if (repo && args.includes('--hook')) process.exit(hook(repo, submodule));
  if (!repo) {
    console.error(
      'usage: downstream-impact.ts --repo <name> [--submodule <path>] [--old <sha>] [--new <sha>] [--base <ref>]',
    );
    process.exit(2);
  }
  const oldSha = arg('--old') ?? run(root, 'rev-parse', `${base}:${submodule}`).trim();
  const newSha = arg('--new') ?? run(join(root, submodule), 'rev-parse', 'HEAD').trim();
  const { mustFix, waived } = downstreamImpact({ root, repo, submodule, oldSha, newSha, base });
  const markdown = args.includes('--markdown');
  console.log(markdown ? '## What this compiler bump owes this repository\n' : '');
  console.log(renderFindings(mustFix, markdown));
  const binding = mustFix.filter((f) => f.kind !== 'ifchange' || !waived);
  if (waived && binding.length < mustFix.length) {
    console.log(`\nNO_IFTTT=${waived}: the cross-repository IfChange findings above are waived.`);
  }
  process.exit(args.includes('--check') && binding.length ? 1 : 0);
}
