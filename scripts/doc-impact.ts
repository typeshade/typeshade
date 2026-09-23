// ═══ What a change owes the prose: every sentence that names what the diff removed or touched ═══
//
// `doc-refs.ts` answers "does every reference still resolve?" on one tree. That catches a file,
// a rule, a code or a script that is gone, but not the two cascades a reviewer misses most:
//
//   1. A NAME that is gone. A bare `oldName` in a sentence is not a reference the tree can
//      resolve on its own (it may be the reader's variable, a WGSL word, a TypeScript one), so
//      no single-tree gate can say it is dead. A DIFF can: the name was exported or declared
//      before this change and is declared nowhere after it, and there it still is, written on a
//      line this change did not touch. That is a must-fix, and `--check` fails on it.
//   2. A MEANING that moved. A function kept its name and changed its contract; a rule kept its
//      number and changed its text; a file was rewritten. Every sentence that describes it may
//      now be false, and no tool can say which. What a tool can do is list them, so that
//      reading them is a step rather than a memory. That is the review list.
//
// WHAT A CHANGE IS MADE OF, and where each part is read:
//
//   removed name     an `export`/`declare` of a name on a `-` line, declared nowhere in the tree
//                    after the change; plus every export `src/__api__/surface.md` lists before
//                    and not after (the bake is the exact public surface, `api-surface.test.ts`)
//   changed shape    a definition line of `src/__api__/surface.md` whose shape changed
//   removed/moved    a file deleted or renamed (the old path)
//   changed file     a file the diff modifies
//   changed rule     a `**Rule N.M.**` paragraph of `docs/language-design.md` with a changed line:
//                    every citation of `Rule N.M`, in prose and in code, is listed for review
//   (a dependency no name or path reveals is a `LINT.IfChange` block: `scripts/ifchange.ts`)
//
// Usage:
//   bun scripts/doc-impact.ts                     working tree against the merge base with main
//   bun scripts/doc-impact.ts --base origin/main  against another base
//   bun scripts/doc-impact.ts --staged            the index against HEAD (what `git commit` takes)
//   bun scripts/doc-impact.ts --check             exit 1 when a must-fix remains
//   bun scripts/doc-impact.ts --markdown          GitHub Markdown, for a job summary
//   bun scripts/doc-impact.ts --hook              a Claude Code PreToolUse hook (stdin: the call)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HISTORY_FILES, ROOT, extractRefs, git, markdownFiles, sourceFiles } from './doc-refs.js';

export interface Mention {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface Impact {
  /** What changed, e.g. "export `foo` removed" or "`src/core/emit.ts` changed". */
  readonly subject: string;
  readonly severity: 'must-fix' | 'review';
  readonly mentions: readonly Mention[];
}

// ─── the diff ──────────────────────────────────────────────────────────────────────────────

export interface Diff {
  /** `null` when the other side is the working tree or the index. */
  readonly base: string;
  readonly staged: boolean;
  readonly deleted: readonly string[];
  /** Renames as [old, new]. */
  readonly renamed: readonly (readonly [string, string])[];
  readonly modified: readonly string[];
  readonly added: readonly string[];
  /** Per file, the head-side line numbers the diff added or changed. */
  readonly touched: ReadonlyMap<string, ReadonlySet<number>>;
  /** Per base-side file, the removed (`-`) lines. */
  readonly removedLines: ReadonlyMap<string, readonly string[]>;
  /** Per base-side file, the base-side line numbers the diff removed. */
  readonly removedAt: ReadonlyMap<string, ReadonlySet<number>>;
}

function diffArgs(base: string, staged: boolean): string[] {
  return staged ? ['--cached', base] : [base];
}

export function readDiff(base: string, staged: boolean): Diff {
  const deleted: string[] = [];
  const renamed: [string, string][] = [];
  const modified: string[] = [];
  const added: string[] = [];
  for (const row of git('diff', '--name-status', '-M', ...diffArgs(base, staged)).split('\n')) {
    const [status, a, b] = row.split('\t');
    if (!status || !a) continue;
    if (status.startsWith('D')) deleted.push(a);
    else if (status.startsWith('R') && b) renamed.push([a, b]);
    else if (status.startsWith('A')) added.push(a);
    else modified.push(a);
  }
  if (!staged) {
    // An untracked file is part of the change the author is about to make.
    for (const f of git('ls-files', '--others', '--exclude-standard').split('\n'))
      if (f) added.push(f);
  }
  const touched = new Map<string, Set<number>>();
  const removedLines = new Map<string, string[]>();
  const removedAt = new Map<string, Set<number>>();
  // A removed line belongs to the base-side path (a deleted file's `+++` is /dev/null); an
  // added line to the head-side path.
  let oldFile = '';
  let newFile = '';
  let at = 0;
  let oldAt = 0;
  for (const line of git('diff', '-U0', '-M', ...diffArgs(base, staged)).split('\n')) {
    if (line.startsWith('--- ')) {
      oldFile = line.slice(4).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      newFile = line.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldAt = Number(hunk[1]);
      at = Number(hunk[2]);
      continue;
    }
    if (line.startsWith('+')) {
      if (!touched.has(newFile)) touched.set(newFile, new Set());
      touched.get(newFile)!.add(at++);
    } else if (line.startsWith('-')) {
      if (!removedLines.has(oldFile)) removedLines.set(oldFile, []);
      removedLines.get(oldFile)!.push(line.slice(1));
      if (!removedAt.has(oldFile)) removedAt.set(oldFile, new Set());
      removedAt.get(oldFile)!.add(oldAt++);
    }
  }
  return { base, staged, deleted, renamed, modified, added, touched, removedLines, removedAt };
}

/** A file's text on the base side of the diff, or `''` when it did not exist there. */
export function atBase(diff: Diff, file: string): string {
  try {
    return git('show', `${diff.base}:${file}`);
  } catch {
    return '';
  }
}

/** A file's text on the head side: the index when staged, the working tree otherwise. */
export function atHead(diff: Diff, file: string): string {
  if (diff.staged) {
    try {
      return git('show', `:${file}`);
    } catch {
      return '';
    }
  }
  return existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
}

// ─── the parts of a change ─────────────────────────────────────────────────────────────────

const DECLARATION =
  /^\s*(?:export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?|declare\s+)(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

/** Names a `-` line declared. */
export function declaredNames(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    const m = DECLARATION.exec(line);
    if (m) out.add(m[1]!);
  }
  return out;
}

/** The export names `src/__api__/surface.md` lists, and each definition's shape line by name. */
export function surface(text: string): { names: Set<string>; shapes: Map<string, string> } {
  const names = new Set<string>();
  const shapes = new Map<string, string>();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence && /^[A-Za-z_$][\w$]*$/.test(line)) names.add(line);
    const shape = /^(\S+#([A-Za-z_$][\w$]*))\s{2,}(.*)$/.exec(line);
    if (shape) shapes.set(shape[1]!, `${shape[2]}\u0000${shape[3]}`);
  }
  return { names, shapes };
}

/** Rule numbers whose paragraph in `docs/language-design.md` contains a touched line. */
export function changedRules(text: string, touched: ReadonlySet<number>): Set<string> {
  const out = new Set<string>();
  let current: string | null = null;
  text.split('\n').forEach((line, i) => {
    const rule = /^\*\*Rule (\d+\.\d+)\.\*\*/.exec(line);
    if (rule) current = rule[1]!;
    else if (/^#{1,6} /.test(line)) current = null;
    if (current && touched.has(i + 1)) out.add(current);
  });
  return out;
}

// ─── where the prose names a thing ─────────────────────────────────────────────────────────

const lineCache = new Map<string, string[]>();
function linesOf(file: string): string[] {
  let lines = lineCache.get(file);
  if (!lines) {
    lines = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8').split('\n') : [];
    lineCache.set(file, lines);
  }
  return lines;
}

/** The prose a mention can live in: Markdown outside the history files. */
function proseFiles(): string[] {
  return markdownFiles().filter((f) => !HISTORY_FILES.has(f));
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Backticked mentions of an identifier: `name`, `name(…)`, `name<…>`, `.name`, `Owner.name`. */
export function nameMentions(name: string, files = proseFiles()): Mention[] {
  const inTicks = new RegExp(`\`[^\`\\n]*?(?<![\\w$])${escape(name)}(?![\\w$])[^\`\\n]*?\``);
  const out: Mention[] = [];
  for (const file of files) {
    linesOf(file).forEach((text, i) => {
      if (inTicks.test(text)) out.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return out;
}

/** Every place a file is named: a resolved path reference in the prose, or a `.md` path in code. */
export function fileMentions(path: string): Mention[] {
  const out: Mention[] = [];
  const tail = path.split('/').slice(-2).join('/');
  const base = path.split('/').pop()!;
  for (const file of [...proseFiles(), ...(path.endsWith('.md') ? sourceFiles() : [])]) {
    for (const ref of extractRefs(file)) {
      if (ref.kind !== 'path') continue;
      const t = ref.text.replace(/(:\d+(-\d+)?|#.*)$/, '').replace(/^(\.\.?\/)+/, '');
      if (out.some((m) => m.file === file && m.line === ref.line)) continue;
      if (
        t === path ||
        path.endsWith(`/${t}`) ||
        (t.includes('/') && t.endsWith(tail)) ||
        t === base
      ) {
        out.push({ file, line: ref.line, text: linesOf(file)[ref.line - 1]?.trim() ?? ref.text });
      }
    }
  }
  return out;
}

export function ruleMentions(rule: string): Mention[] {
  const re = new RegExp(`\\bRule ${escape(rule)}(?![\\d])`);
  const out: Mention[] = [];
  for (const file of [...proseFiles(), ...sourceFiles()]) {
    if (file === 'docs/language-design.md') continue;
    linesOf(file).forEach((text, i) => {
      if (re.test(text)) out.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return out;
}

// ─── the impact ────────────────────────────────────────────────────────────────────────────

const SURFACE = 'src/__api__/surface.md';

export function impactOf(diff: Diff): Impact[] {
  const impacts: Impact[] = [];
  const untouched = (m: Mention): boolean => !diff.touched.get(m.file)?.has(m.line);

  // 1. Names that are gone.
  const removed = new Map<string, string>();
  for (const [file, lines] of diff.removedLines) {
    if (!/\.(ts|mts|mjs)$/.test(file) || file.endsWith('.test.ts')) continue;
    for (const name of declaredNames(lines))
      removed.set(name, `\`${name}\` no longer declared (was in \`${file}\`)`);
  }
  const before = surface(atBase(diff, SURFACE));
  const after = surface(atHead(diff, SURFACE));
  for (const name of before.names) {
    if (!after.names.has(name))
      removed.set(name, `export \`${name}\` removed from the public surface`);
  }
  if (removed.size) {
    const headSources = sourceFiles()
      .filter((f) => !f.endsWith('.test.ts'))
      .map((f) => atHead(diff, f))
      .join('\n');
    for (const [name, subject] of removed) {
      // Still declared somewhere, or re-exported under the name: moved, not gone. (The bake is
      // not consulted here: a stale `surface.md` must not hide a removal it has not caught up with.)
      const kept = new RegExp(
        `(?:(?:export|declare)[^\\n]*?\\b(?:function\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${escape(name)}\\b)|(?:export\\s*\\{[^}]*\\b${escape(name)}\\b)`,
      );
      if (kept.test(headSources)) continue;
      if (name.length < 3) continue;
      const mentions = nameMentions(name).filter(untouched);
      if (mentions.length) impacts.push({ subject, severity: 'must-fix', mentions });
    }
  }

  // 2. Files that are gone.
  for (const path of [...diff.deleted, ...diff.renamed.map(([a]) => a)]) {
    const to = diff.renamed.find(([a]) => a === path)?.[1];
    const mentions = fileMentions(path).filter(untouched);
    if (mentions.length) {
      impacts.push({
        subject: to ? `\`${path}\` moved to \`${to}\`` : `\`${path}\` deleted`,
        severity: 'must-fix',
        mentions,
      });
    }
  }

  // 3. Shapes that changed.
  for (const [key, shape] of after.shapes) {
    const old = before.shapes.get(key);
    if (old === undefined || old === shape) continue;
    const name = shape.split('\u0000')[0]!;
    const mentions = nameMentions(name);
    if (mentions.length)
      impacts.push({
        subject: `the shape of \`${name}\` changed (\`${key.split('#')[0]}\`)`,
        severity: 'review',
        mentions,
      });
  }

  // 4. Rules whose text changed.
  const ld = 'docs/language-design.md';
  const ldTouched = diff.touched.get(ld);
  if (ldTouched) {
    for (const rule of changedRules(atHead(diff, ld), ldTouched)) {
      const mentions = ruleMentions(rule);
      if (mentions.length)
        impacts.push({ subject: `the text of Rule ${rule} changed`, severity: 'review', mentions });
    }
  }

  // 5. Files that changed. (A dependency no name reveals is a LINT.IfChange block: scripts/ifchange.ts.)
  const changed = [...diff.modified, ...diff.renamed.map(([, b]) => b), ...diff.added].filter(
    (f) => !f.endsWith('.md') && !f.includes('__emit-goldens__') && f !== SURFACE,
  );
  for (const path of changed) {
    const mentions = /\.test\.ts$/.test(path) ? [] : fileMentions(path);
    if (mentions.length)
      impacts.push({ subject: `\`${path}\` changed`, severity: 'review', mentions });
  }
  return impacts;
}

// ─── output ────────────────────────────────────────────────────────────────────────────────

const MAX_MENTIONS = 12;

export function render(impacts: readonly Impact[], diff: Diff, markdown: boolean): string {
  const docsTouched = new Set([...diff.modified, ...diff.added, ...diff.renamed.map(([, b]) => b)]);
  const out: string[] = [];
  const section = (title: string, rows: readonly Impact[]): void => {
    if (!rows.length) return;
    out.push(markdown ? `### ${title}\n` : `\n${title}\n${'─'.repeat(title.length)}`);
    for (const impact of rows) {
      out.push(markdown ? `- **${impact.subject}**` : `\n• ${impact.subject.replace(/`/g, '')}`);
      for (const m of impact.mentions.slice(0, MAX_MENTIONS)) {
        const flag = docsTouched.has(m.file) ? ' (file edited in this change)' : '';
        const text = m.text.length > 110 ? `${m.text.slice(0, 107)}…` : m.text;
        out.push(
          markdown
            ? `  - \`${m.file}:${m.line}\`${flag}`
            : `    ${m.file}:${m.line}${flag}  ${text}`,
        );
      }
      if (impact.mentions.length > MAX_MENTIONS)
        out.push(`    … and ${impact.mentions.length - MAX_MENTIONS} more`);
    }
  };
  const mustFix = impacts.filter((i) => i.severity === 'must-fix');
  const review = impacts.filter((i) => i.severity === 'review');
  if (markdown) out.push('## Documentation impact\n');
  section('Must fix: the prose still names what this change removed', mustFix);
  section('Review: the prose that describes what this change touched', review);
  if (!impacts.length)
    out.push(
      markdown
        ? 'No prose names what this change removed or touched.'
        : 'No prose names what this change removed or touched.',
    );
  return out.join('\n');
}

function defaultBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try {
      return git('merge-base', ref, 'HEAD').trim();
    } catch {
      /* next */
    }
  }
  return 'HEAD';
}

// ─── the Claude Code hook ──────────────────────────────────────────────────────────────────
//
// LINT.IfChange(hook)
// Registered in `.claude/settings.json` as a PreToolUse hook on Bash. It does nothing unless the
// call is a `git commit`. Then it checks what the commit takes, reports every problem at once,
// and blocks the call (exit 2, the report goes to the agent) when any remains:
//
//   must-fix             a removed name or file that the prose still names on an untouched line
//   IfChange unmet       a LINT.IfChange block changed and a ThenChange target did not, and the
//                        message carries no `NO_IFTTT=<reason>` (scripts/ifchange.ts)
//   traceability         reqs/ is stale (`bun run reqs:sync`), or Doorstop, when installed, finds
//                        an unreviewed rule, a suspect link or a lost reference (reqs/README.md)
//   open review items    prose that describes what the commit changes, in files it leaves alone,
//                        and no `Docs-Impact:` trailer
//
// The trailer is the agent's statement that it read the listed prose and found it still true
// (`Docs-Impact: reviewed, AUTHORING.md#fp64 still describes the lowering`), or that the change
// has none (`Docs-Impact: none, test-only`). It stays in the history, where a reviewer sees it.
// The trailer answers only the review list: nothing in a message waives a must-fix or a suspect
// link, which are fixed or reviewed, never declared.

async function hook(): Promise<number> {
  let input: { tool_input?: { command?: string } };
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as typeof input;
  } catch {
    return 0;
  }
  const command = input.tool_input?.command ?? '';
  if (!/(^|[;&|\s])git\s+(?:-C\s+\S+\s+)?commit\b/.test(command)) return 0;
  let message = command;
  const file = /(?:-F|--file)[=\s]+(\S+)/.exec(command)?.[1];
  if (file && existsSync(file)) message += readFileSync(file, 'utf8');
  const all = /\scommit\b[^|;&]*\s(-a|--all|-\w*a\w*)\b/.test(command);
  const diff = all ? readDiff('HEAD', false) : readDiff('HEAD', true);
  const report: string[] = [];

  const impacts = impactOf(diff);
  const mustFix = impacts.filter((i) => i.severity === 'must-fix');
  if (mustFix.length) {
    report.push(
      `${render(mustFix, diff, false)}\n\nThe prose above still names what this commit removes, on lines it leaves ` +
        'alone. Update or delete each sentence (CHANGELOG.md and docs/HISTORY.md are exempt).',
    );
  }

  const { unmet, describeUnmet, waiver, staticProblems } = await import('./ifchange.js');
  const misses = unmet(diff);
  const broken = staticProblems();
  if (broken.length) {
    report.push(
      `LINT.IfChange blocks that are malformed:\n${broken.map((p) => `    ${p.file}:${p.line}  ${p.message}`).join('\n')}`,
    );
  }
  if (misses.length && !waiver(message)) {
    report.push(
      `LINT.IfChange blocks this commit changes without their ThenChange targets:\n${misses.map((u) => `    ${describeUnmet(u)}`).join('\n')}\n\n` +
        'Change each target to match, or, if it truly needs no change, say why in the message: `NO_IFTTT=<reason>`.',
    );
  }

  const { stale } = await import('./reqs-sync.js');
  const drift = stale();
  if (drift.length) {
    report.push(
      `reqs/ is stale:\n${drift.map((d) => `    ${d}`).join('\n')}\n\nRun \`bun run reqs:sync\`, then \`doorstop -C\` (reqs/README.md).`,
    );
  } else {
    const ds = spawnSync('doorstop', ['-C', '-e', '-F'], { cwd: ROOT, encoding: 'utf8' });
    if (!ds.error && ds.status !== 0) {
      const errors = `${ds.stdout}${ds.stderr}`.split('\n').filter((l) => /ERROR|WARNING/.test(l));
      report.push(
        `Doorstop:\n${errors.map((l) => `    ${l}`).join('\n')}\n\nRead each flagged item, bring it in line, then ` +
          '`doorstop review <RULE>` / `doorstop clear <SURF>` (reqs/README.md). Never clear what you have not read.',
      );
    }
  }

  const committedDocs = new Set([
    ...diff.modified,
    ...diff.added,
    ...diff.renamed.map(([, b]) => b),
  ]);
  const openReview = impacts.filter(
    (i) => i.severity === 'review' && i.mentions.some((m) => !committedDocs.has(m.file)),
  );
  if (openReview.length && !/^\s*Docs-Impact:\s*\S/m.test(message)) {
    report.push(
      `${render(openReview, diff, false)}\n\nThe prose above describes what this commit changes, and the commit leaves it alone. ` +
        'Read each location and fix what is no longer true; then add a trailer that says what you found, ' +
        'for example `Docs-Impact: reviewed, the listed sections still hold` or `Docs-Impact: none, internal refactor`.',
    );
  }

  if (!report.length) return 0;
  process.stderr.write(`${report.join('\n\n────────\n\n')}\n`);
  return 2;
}
// LINT.ThenChange(AGENTS.md:docs-follow-the-code, CLAUDE.md:the-prose-follows-the-code)

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--hook')) process.exit(await hook());
  const staged = args.includes('--staged');
  const baseAt = args.indexOf('--base');
  const base =
    baseAt >= 0
      ? git('merge-base', args[baseAt + 1]!, 'HEAD').trim()
      : staged
        ? 'HEAD'
        : defaultBase();
  const diff = readDiff(base, staged);
  const impacts = impactOf(diff);
  console.log(render(impacts, diff, args.includes('--markdown')));
  const mustFix = impacts.filter((i) => i.severity === 'must-fix').length;
  process.exit(args.includes('--check') && mustFix ? 1 : 0);
}
