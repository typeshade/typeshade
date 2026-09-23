// ═══ Change proposals: what a change will touch is agreed before it is written, then checked ═══
//
// The gates in this tree catch what a change left behind once it is written. They cannot say,
// before the first line, that a rule change will need the site's constructs page and the editor's
// skill rewritten; that surfaced weeks later, when the site pinned the compiler and its build
// stopped on each stale page in turn. The fix is the practice language projects use for it (an
// RFC, a PEP, a KEP; OpenSpec's change folders): a change of a certain kind starts as a proposal
// that names what it will touch, is agreed, and only then implemented, and the implementation is
// held to what the proposal said.
//
// WHICH CHANGES NEED ONE (changes/README.md). A diff needs a proposal when it:
//
//   rules     changes, adds or removes a `**Rule N.M.**` paragraph of docs/language-design.md
//   exports   adds, removes or reshapes an export in src/__api__/surface.md
//   visible   changes what a repository downstream shows or checks: a numbered section of
//             docs/use-typeshade-surface.md, a diagnostic code (added, removed or renumbered in
//             src/compiler/ts/codes.ts or src/core/diagnostics/codes.ts), or the set of
//             `examples/*.shade.ts` files the site's gallery and the Playground list one by one
//
// Anything else (an internal refactor, a test, a fix that changes none of the above) needs none.
//
// WHAT THE CHECK DOES. For a diff that needs one:
//
//   1. It must name its proposal: a `Change: 0012` line in a commit message of the range, and
//      changes/0012-*.md must exist with `status: accepted` (or `implemented`) on the base
//      branch, so the agreement came before the implementation. A change the criteria catch
//      but that truly needs no proposal (a typo inside a rule) says why on a line of its own:
//      `Change: none, <reason>`. It stays in the history.
//   2. What the diff actually touches must be inside what the proposal declared: every rule it
//      changes, every surface section, every export removed or reshaped, every diagnostic code,
//      every example added or removed. Something outside is either an undeclared cascade or a
//      proposal to update; either way the check stops. What was declared and is not in this diff
//      is listed as still to do: one proposal may be implemented over several pull requests.
//
// Where it runs: the commit hook (scripts/doc-impact.ts --hook), and CI on every pull request.
// A proposal's own shape (front matter, ids, status) is held by src/changes.test.ts.
//
// Usage:
//   bun scripts/changes.ts                     working tree against the merge base with main
//   bun scripts/changes.ts --base origin/main  a pull request's range (messages from base..HEAD)
//   bun scripts/changes.ts --staged            the index against HEAD

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git } from './doc-refs.js';
import { atBase, atHead, changedRules, readDiff, surface, type Diff } from './doc-impact.js';
import { parseFront } from './reqs-sync.js';

export const STATUSES = ['draft', 'accepted', 'implemented', 'archived', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];

/** The repositories a proposal may name as downstream. */
export const DOWNSTREAM_REPOS = ['typeshade.github.io', 'vscode-typeshade'] as const;

export interface Proposal {
  readonly file: string;
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  readonly rules: readonly string[];
  readonly surface: readonly number[];
  readonly exports: readonly string[];
  readonly exportsRemoved: readonly string[];
  readonly codes: readonly string[];
  readonly examples: readonly string[];
  readonly downstream: readonly { repo: string; what: string }[];
}

const DIR = 'changes';
const FILE = /^(\d{4})-[a-z0-9-]+\.md$/;

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x !== '') : [];

/** A proposal from its text; throws, naming the field, on a shape the process does not take. */
export function parseProposal(file: string, text: string): Proposal {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`${file}: no front matter`);
  const f = parseFront(m[1]!);
  const status = String(f.status ?? '') as Status;
  if (!STATUSES.includes(status))
    throw new Error(`${file}: status must be one of ${STATUSES.join(', ')}`);
  const downstream = (Array.isArray(f.downstream) ? f.downstream : []).map((d) => {
    const o = d as Record<string, unknown>;
    return { repo: String(o.repo ?? ''), what: String(o.what ?? '') };
  });
  return {
    file,
    id: String(f.id ?? '').padStart(4, '0'),
    title: String(f.title ?? ''),
    status,
    rules: list(f.rules),
    surface: list(f.surface).map(Number),
    exports: list(f.exports),
    exportsRemoved: list(f['exports-removed']),
    codes: list(f.codes),
    examples: list(f.examples),
    downstream,
  };
}

/** Every proposal file under changes/, read through `read` (the working tree by default). */
export function proposals(
  read: (f: string) => string = (f) => readFileSync(join(ROOT, f), 'utf8'),
  files: readonly string[] = existsSync(join(ROOT, DIR))
    ? readdirSync(join(ROOT, DIR))
        .filter((f) => FILE.test(f))
        .map((f) => `${DIR}/${f}`)
    : [],
): Proposal[] {
  return files.map((f) => parseProposal(f, read(f)));
}

/**
 * The proposals on a git ref (the base of a diff): only an agreement made there counts. `run`
 * is `git` in another checkout, for a downstream repository reading its vendored compiler.
 */
export function proposalsAt(ref: string, run: (...args: string[]) => string = git): Proposal[] {
  let files: string[] = [];
  try {
    files = run('ls-tree', '--name-only', `${ref}:${DIR}`)
      .split('\n')
      .filter((f) => FILE.test(f))
      .map((f) => `${DIR}/${f}`);
  } catch {
    return [];
  }
  return proposals((f) => run('show', `${ref}:${f}`), files);
}

/** The file where a downstream repository records the proposals it has handled. */
export const HANDLED_FILE = 'compiler-changes.md';

/** The ids a downstream `compiler-changes.md` records: each list item that starts with one. */
export function handledIds(text: string): Set<string> {
  return new Set([...text.matchAll(/^[-*]\s+(\d{4})\b/gm)].map((m) => m[1]!));
}

/**
 * What a compiler at some commit owes a downstream repository: every proposal implemented there
 * that names the repository and that its `compiler-changes.md` does not record.
 */
export function owedDownstream(
  all: readonly Proposal[],
  repo: string,
  handled: ReadonlySet<string>,
): Proposal[] {
  return all.filter(
    (p) =>
      (p.status === 'implemented' || p.status === 'archived') &&
      p.downstream.some((d) => d.repo === repo) &&
      !handled.has(p.id),
  );
}

// ─── what a diff touches ───────────────────────────────────────────────────────────────────

export interface Touched {
  readonly rules: ReadonlySet<string>;
  readonly surface: ReadonlySet<number>;
  readonly exports: ReadonlySet<string>;
  readonly exportsRemoved: ReadonlySet<string>;
  readonly codes: ReadonlySet<string>;
  readonly examples: ReadonlySet<string>;
}

export const nothingTouched = (t: Touched): boolean =>
  t.rules.size +
    t.surface.size +
    t.exports.size +
    t.exportsRemoved.size +
    t.codes.size +
    t.examples.size ===
  0;

/** Numbered `## N.` sections of a document containing any of the given lines. */
export function sectionsAt(text: string, lines: ReadonlySet<number> | undefined): Set<number> {
  const out = new Set<number>();
  if (!lines?.size) return out;
  let current: number | null = null;
  let fence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = fence ? null : /^## (\d+)\. /.exec(line);
    if (h) current = Number(h[1]);
    else if (!fence && /^## /.test(line)) current = null;
    if (current !== null && lines.has(i + 1)) out.add(current);
  });
  return out;
}

/** Diagnostic codes by name, from both registries: `NAME` → `TS8006` / `SD0013`. */
export function codeTable(tsCodes: string, sdCodes: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tsCodes.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*'(TS8\d{3})'/gm))
    out.set(m[1]!, m[2]!);
  for (const m of sdCodes.matchAll(/^\s*(SD\d{4}):\s*\{/gm)) out.set(m[1]!, m[1]!);
  return out;
}

const DESIGN = 'docs/language-design.md';
const SURFACE_DOC = 'docs/use-typeshade-surface.md';
const API = 'src/__api__/surface.md';
const TS_CODES = 'src/compiler/ts/codes.ts';
const SD_CODES = 'src/core/diagnostics/codes.ts';

export function touchedBy(diff: Diff): Touched {
  const rulesOf = (t: string): Set<string> =>
    new Set([...t.matchAll(/^\*\*Rule (\d+\.\d+)\.\*\*/gm)].map((m) => m[1]!));
  const baseDesign = atBase(diff, DESIGN);
  const headDesign = atHead(diff, DESIGN);
  const rules = new Set<string>([
    ...changedRules(headDesign, diff.touched.get(DESIGN) ?? new Set()),
    ...changedRules(baseDesign, diff.removedAt.get(DESIGN) ?? new Set()),
  ]);
  const before = rulesOf(baseDesign);
  const after = rulesOf(headDesign);
  for (const r of before) if (!after.has(r)) rules.add(r);
  for (const r of after) if (!before.has(r)) rules.add(r);

  const surfaceSections = new Set<number>([
    ...sectionsAt(atHead(diff, SURFACE_DOC), diff.touched.get(SURFACE_DOC)),
    ...sectionsAt(atBase(diff, SURFACE_DOC), diff.removedAt.get(SURFACE_DOC)),
  ]);

  const apiBefore = surface(atBase(diff, API));
  const apiAfter = surface(atHead(diff, API));
  const exportsRemoved = new Set([...apiBefore.names].filter((n) => !apiAfter.names.has(n)));
  const exports = new Set([...apiAfter.names].filter((n) => !apiBefore.names.has(n)));
  for (const [key, shape] of apiAfter.shapes) {
    const old = apiBefore.shapes.get(key);
    if (old !== undefined && old !== shape) exports.add(shape.split('\u0000')[0]!);
  }

  const codesBefore = codeTable(atBase(diff, TS_CODES), atBase(diff, SD_CODES));
  const codesAfter = codeTable(atHead(diff, TS_CODES), atHead(diff, SD_CODES));
  const codes = new Set<string>();
  for (const [name, code] of codesBefore) if (codesAfter.get(name) !== code) codes.add(code);
  for (const [name, code] of codesAfter) if (codesBefore.get(name) !== code) codes.add(code);

  const shadeExample = /^examples\/([\w-]+)\.shade\.ts$/;
  const examples = new Set<string>();
  for (const f of [...diff.added, ...diff.deleted, ...diff.renamed.flat()]) {
    const m = shadeExample.exec(f);
    if (m && !diff.renamed.some(([a, b]) => a === f && shadeExample.exec(b)?.[1] === m[1]))
      examples.add(m[1]!);
  }

  return { rules, surface: surfaceSections, exports, exportsRemoved, codes, examples };
}

// ─── the check ─────────────────────────────────────────────────────────────────────────────

export interface Verdict {
  /** What stops the change. Empty when it may go ahead. */
  readonly problems: readonly string[];
  /** Declared by the proposal and not in this diff: still to do, in a later pull request. */
  readonly pending: readonly string[];
  readonly proposal: Proposal | null;
}

/** `Change: 0012` lines, and `Change: none, reason`. */
export function changeLines(messages: string): { ids: string[]; none: string | null } {
  const ids = [...messages.matchAll(/^Change:\s*(\d{1,4})\s*$/gm)].map((m) =>
    m[1]!.padStart(4, '0'),
  );
  const none = /^Change:\s*none[,:]?\s+(\S.*)$/m.exec(messages)?.[1] ?? null;
  return { ids: [...new Set(ids)], none };
}

export function judge(touched: Touched, messages: string, agreed: readonly Proposal[]): Verdict {
  if (nothingTouched(touched)) return { problems: [], pending: [], proposal: null };
  const { ids, none } = changeLines(messages);
  const what = describe(touched);
  if (!ids.length) {
    if (none) return { problems: [], pending: [], proposal: null };
    return {
      problems: [
        `This change needs a proposal (changes/README.md): it touches ${what}. Name an accepted one ` +
          'with a `Change: NNNN` line in the commit message, or say why none is needed with ' +
          '`Change: none, <reason>`.',
      ],
      pending: [],
      proposal: null,
    };
  }
  const problems: string[] = [];
  const found = ids.map((id) => agreed.find((p) => p.id === id));
  ids.forEach((id, i) => {
    const p = found[i];
    if (!p)
      problems.push(
        `Change: ${id} names no proposal on the base branch; agree changes/${id}-*.md first.`,
      );
    else if (p.status !== 'accepted' && p.status !== 'implemented')
      problems.push(`Change: ${id} is ${p.status}; only an accepted proposal may be implemented.`);
  });
  const live = found.filter(
    (p): p is Proposal => !!p && (p.status === 'accepted' || p.status === 'implemented'),
  );
  const declared = (pick: (p: Proposal) => readonly (string | number)[]) =>
    new Set(live.flatMap((p) => pick(p).map(String)));
  // [kind, what the diff touches, what the proposal allows, what the proposal still owes]. A
  // removed export also shows as a reshaped one while its declaration shrinks, so `exports`
  // allows both lists but owes only its own: the removal is owed once, as a removed export.
  const checks: [string, ReadonlySet<string | number>, Set<string>, Set<string>][] = [
    ['rule', touched.rules, declared((p) => p.rules), declared((p) => p.rules)],
    ['surface section', touched.surface, declared((p) => p.surface), declared((p) => p.surface)],
    [
      'export',
      touched.exports,
      declared((p) => [...p.exports, ...p.exportsRemoved]),
      declared((p) => p.exports),
    ],
    [
      'removed export',
      touched.exportsRemoved,
      declared((p) => p.exportsRemoved),
      declared((p) => p.exportsRemoved),
    ],
    ['diagnostic code', touched.codes, declared((p) => p.codes), declared((p) => p.codes)],
    ['example', touched.examples, declared((p) => p.examples), declared((p) => p.examples)],
  ];
  const pending: string[] = [];
  if (live.length) {
    for (const [kind, actual, decl, owed] of checks) {
      for (const a of actual) {
        if (!decl.has(String(a)))
          problems.push(
            `${kind} ${fmt(kind, a)} is changed here but not declared by Change: ${ids.join(', ')}; add it to the proposal or leave it out of this change.`,
          );
      }
      for (const d of owed) {
        if (![...actual].map(String).includes(d)) pending.push(`${kind} ${fmt(kind, d)}`);
      }
    }
  }
  return { problems, pending, proposal: live[0] ?? null };
}

const fmt = (kind: string, v: string | number): string =>
  kind === 'rule' ? `Rule ${v}` : kind === 'surface section' ? `surface §${v}` : `\`${v}\``;

export function describe(t: Touched): string {
  const parts: string[] = [];
  if (t.rules.size) parts.push([...t.rules].map((r) => `Rule ${r}`).join(', '));
  if (t.surface.size) parts.push([...t.surface].map((s) => `surface §${s}`).join(', '));
  if (t.exportsRemoved.size) parts.push(`removed export ${[...t.exportsRemoved].join(', ')}`);
  if (t.exports.size) parts.push(`export ${[...t.exports].join(', ')}`);
  if (t.codes.size) parts.push(`code ${[...t.codes].join(', ')}`);
  if (t.examples.size) parts.push(`example ${[...t.examples].join(', ')}`);
  return parts.join('; ');
}

/** The whole check over a diff, for the hook and CI. */
export function checkChange(diff: Diff, messages: string): Verdict {
  return judge(touchedBy(diff), messages, proposalsAt(diff.base));
}

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
    base = git('merge-base', 'origin/main', 'HEAD').trim();
    messages = git('log', '--format=%B', `${base}..HEAD`);
  }
  // CI passes the pull request's description too, where the template asks for the Change line.
  messages += `\n${process.env.PR_BODY ?? ''}`;
  const touched = touchedBy(readDiff(base, staged));
  const verdict = judge(touched, messages, proposalsAt(base));
  if (nothingTouched(touched))
    console.log(
      'This change touches no rule, export or downstream-visible surface: no proposal needed.',
    );
  else console.log(`This change touches ${describe(touched)}.`);
  for (const p of verdict.problems) console.log(`  ✗ ${p}`);
  if (verdict.pending.length)
    console.log(`  still to do under the proposal: ${verdict.pending.join('; ')}`);
  process.exit(verdict.problems.length ? 1 : 0);
}
