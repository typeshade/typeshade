// ═══ LINT.IfChange / LINT.ThenChange: two places that must change together say so, and a diff is held to it ═══
//
// Some pairs cannot be derived from each other and cannot be found by name: the allowlist in a
// test and the table in the design rules that must list the same rows, the CI jobs and the list
// of gates in AGENTS.md. This is the convention Google's code review uses for them (and Chromium
// in the open), with its syntax, so that a reader who has met it elsewhere reads it here unchanged:
//
//   // LINT.IfChange(extensions)
//   const TYPESHADE_EXTENSIONS = [ … ];
//   // LINT.ThenChange(docs/language-design.md:extensions)
//
//   <!-- LINT.IfChange(extensions) -->
//   | Family | Name | Reason |
//   <!-- LINT.ThenChange(src/core/spec-conformance/surface-names.test.ts:extensions) -->
//
// A block runs from its `LINT.IfChange` line to its `LINT.ThenChange` line. The label is optional,
// and names the block so that another block can target it; `LINT.ThenChange()` with no target
// makes a block that is only a target (a list the prose keeps in step with the code above it). A target is `path` (the whole file),
// `path:label` (that block of that file), or `:label` (a block of this file), with the path taken
// from the repository root. `//repo/path[:label]` targets a file in another TypeShade repository
// (`//typeshade.github.io/…`, `//vscode-typeshade/…`); this repository cannot see that change, so
// the target is checked where both sides meet, by the downstream pin (`--downstream`).
//
// THE RULE. When a diff changes a line inside a block (on either side: an added line in the new
// block, a removed line in the old one), every local target must change in the same diff: the
// file anywhere, or a line inside the target block. A change that truly needs only one side says
// why, in the commit message or the pull request, with `NO_IFTTT=<reason>` (Google's spelling).
//
// Two checks, and where each runs:
//   static  every block closes, no block nests, every target file and label exists
//           (`src/ifchange.test.ts`, in `bun run test`)
//   diff    the rule above: the commit hook (`scripts/doc-impact.ts --hook`) and CI on every
//           pull request, where `NO_IFTTT=` is read from the commit messages of the range
//
// Usage:
//   bun scripts/ifchange.ts                     working tree against the merge base with main
//   bun scripts/ifchange.ts --base origin/main  against another base (NO_IFTTT read from base..HEAD)
//   bun scripts/ifchange.ts --staged            the index against HEAD

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, trackedFiles } from './doc-refs.js';
import { atBase, atHead, readDiff, type Diff } from './doc-impact.js';

export interface Target {
  /** Repository-relative path; `null` repo means this repository. */
  readonly repo: string | null;
  readonly path: string;
  readonly label: string | null;
}

export interface Block {
  readonly file: string;
  readonly label: string | null;
  /** 1-based lines of the `IfChange` and `ThenChange` markers. */
  readonly start: number;
  readonly end: number;
  readonly targets: readonly Target[];
}

export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

// A marker is a whole comment: `//`, `#`, `<!--` or `/*`, the marker, and nothing after it but the
// comment's close. A sentence that mentions `LINT.IfChange` is not one, and neither is a line of
// a wrapped comment that happens to begin with the marker and goes on talking (the site's
// deploy.yml had one, and it failed the build as a ThenChange with no IfChange above it).
const IF = /^\s*(?:\/\/|#|<!--|\/\*|\*)\s*LINT\.IfChange(?:\(([\w.-]+)\))?\s*(?:-->|\*\/)?\s*$/;
const THEN = /^\s*(?:\/\/|#|<!--|\/\*|\*)\s*LINT\.ThenChange\(([^)]*)\)\s*(?:-->|\*\/)?\s*$/;

/** The files a block can live in: tracked text, minus this checker, its test and the generated. */
export function candidateFiles(files = trackedFiles()): string[] {
  const self = new Set(['scripts/ifchange.ts', 'src/ifchange.test.ts']);
  return files.filter(
    (f) =>
      /\.(ts|mts|mjs|js|md|ya?ml|json|css|astro|html|sh)$/.test(f) &&
      !self.has(f) &&
      !f.startsWith('reqs/rules/') &&
      !f.startsWith('reqs/surface/'),
  );
}

export function parseTarget(raw: string, from: string): Target {
  const t = raw.trim();
  const cross = /^\/\/([^/]+)\/(.+)$/.exec(t);
  const [pathPart, label] = (cross ? cross[2]! : t).split(/:(?=[\w.-]+$)/) as [string, string?];
  return {
    repo: cross ? cross[1]! : null,
    path: pathPart === '' ? from : pathPart,
    label: label ?? null,
  };
}

/** The blocks of one file, and what is malformed about them. */
export function parseBlocks(file: string, text: string): { blocks: Block[]; problems: Problem[] } {
  const blocks: Block[] = [];
  const problems: Problem[] = [];
  let open: { label: string | null; line: number } | null = null;
  text.split('\n').forEach((line, i) => {
    const at = i + 1;
    const then = THEN.exec(line);
    const iff = IF.exec(line);
    if (iff && !then) {
      if (open)
        problems.push({
          file,
          line: at,
          message: `LINT.IfChange inside the block opened on line ${open.line}`,
        });
      open = { label: iff[1] ?? null, line: at };
    } else if (then) {
      if (!open) {
        problems.push({
          file,
          line: at,
          message: 'LINT.ThenChange with no LINT.IfChange above it',
        });
        return;
      }
      const targets = then[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseTarget(s, file));
      blocks.push({ file, label: open.label, start: open.line, end: at, targets });
      open = null;
    }
  });
  if (open)
    problems.push({
      file,
      line: (open as { line: number }).line,
      message: 'LINT.IfChange is never closed',
    });
  return { blocks, problems };
}

const readText = (f: string): string =>
  existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '';

/** Every block in the tree. */
export function allBlocks(
  read: (f: string) => string = readText,
  files = candidateFiles(),
): { blocks: Block[]; problems: Problem[] } {
  const blocks: Block[] = [];
  const problems: Problem[] = [];
  for (const f of files) {
    const text = read(f);
    if (!text.includes('LINT.')) continue;
    const r = parseBlocks(f, text);
    blocks.push(...r.blocks);
    problems.push(...r.problems);
  }
  return { blocks, problems };
}

/** The static check: every local target file and label exists, and labels are unique per file. */
export function staticProblems(): Problem[] {
  const { blocks, problems } = allBlocks();
  const labels = new Map<string, Block[]>();
  for (const b of blocks) {
    if (!b.label) continue;
    const key = `${b.file}:${b.label}`;
    labels.set(key, [...(labels.get(key) ?? []), b]);
  }
  for (const [key, bs] of labels) {
    if (bs.length > 1)
      problems.push({
        file: bs[1]!.file,
        line: bs[1]!.start,
        message: `label ${key} is used twice`,
      });
  }
  for (const b of blocks) {
    for (const t of b.targets) {
      if (t.repo) continue;
      if (!existsSync(join(ROOT, t.path))) {
        problems.push({ file: b.file, line: b.end, message: `target ${t.path} does not exist` });
      } else if (t.label && !labels.has(`${t.path}:${t.label}`)) {
        problems.push({
          file: b.file,
          line: b.end,
          message: `no block labelled ${t.label} in ${t.path}`,
        });
      }
      if (t.path === b.file && t.label === b.label) {
        problems.push({ file: b.file, line: b.end, message: 'a block names itself as its target' });
      }
    }
  }
  return problems;
}

// ─── the diff check ────────────────────────────────────────────────────────────────────────

const inside = (b: Block, lines: ReadonlySet<number> | undefined): boolean =>
  !!lines && [...lines].some((n) => n > b.start && n < b.end);

export interface Unmet {
  readonly block: Block;
  readonly target: Target;
}

/** The blocks this diff changed whose local targets it left alone. */
export function unmet(diff: Diff): Unmet[] {
  const changedFiles = new Set([
    ...diff.modified,
    ...diff.added,
    ...diff.deleted,
    ...diff.renamed.flatMap(([a, b]) => [a, b]),
  ]);
  const head = allBlocks(
    (f) => atHead(diff, f),
    candidateFiles([...new Set([...trackedFiles(), ...changedFiles])]),
  );
  const base = allBlocks((f) => atBase(diff, f), candidateFiles([...changedFiles]));
  const changed: Block[] = [
    ...head.blocks.filter((b) => inside(b, diff.touched.get(b.file))),
    ...base.blocks.filter((b) => inside(b, diff.removedAt.get(b.file))),
  ];
  const blockTouched = (path: string, label: string): boolean =>
    head.blocks.some(
      (b) => b.file === path && b.label === label && inside(b, diff.touched.get(path)),
    ) ||
    base.blocks.some(
      (b) => b.file === path && b.label === label && inside(b, diff.removedAt.get(path)),
    );
  const out: Unmet[] = [];
  const seen = new Set<string>();
  for (const block of changed) {
    for (const target of block.targets) {
      if (target.repo) continue;
      const met = target.label
        ? blockTouched(target.path, target.label)
        : changedFiles.has(target.path);
      const key = `${block.file}:${block.start}->${target.path}:${target.label}`;
      if (!met && !seen.has(key)) {
        seen.add(key);
        out.push({ block, target });
      }
    }
  }
  return out;
}

export const describeUnmet = (u: Unmet): string =>
  `${u.block.file}:${u.block.start}${u.block.label ? ` (${u.block.label})` : ''} changed, but ` +
  `${u.target.path}${u.target.label ? `:${u.target.label}` : ''} did not`;

/** `NO_IFTTT=reason` on a line of its own, with a reason; a sentence that mentions it is not one. */
export const waiver = (message: string): string | null =>
  /^NO_IFTTT=(\S.*)$/m.exec(message)?.[1] ?? null;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const baseAt = args.indexOf('--base');
  let base = 'HEAD';
  let messages = '';
  if (baseAt >= 0) {
    base = git('merge-base', args[baseAt + 1]!, 'HEAD').trim();
    messages = git('log', '--format=%B', `${base}..HEAD`);
  } else if (!staged) {
    for (const ref of ['origin/main', 'main']) {
      try {
        base = git('merge-base', ref, 'HEAD').trim();
        messages = git('log', '--format=%B', `${base}..HEAD`);
        break;
      } catch {
        /* next */
      }
    }
  }
  const problems = staticProblems();
  for (const p of problems) console.log(`${p.file}:${p.line}  ${p.message}`);
  const misses = unmet(readDiff(base, staged));
  for (const u of misses) console.log(describeUnmet(u));
  const why = waiver(messages);
  if (misses.length && why)
    console.log(`\nNO_IFTTT=${why}: the ${misses.length} unmet pair(s) above are waived.`);
  const fail = problems.length > 0 || (misses.length > 0 && !why);
  if (!problems.length && !misses.length)
    console.log(
      'Every LINT.IfChange block this change touched has its ThenChange targets changed too.',
    );
  process.exit(fail ? 1 : 0);
}
