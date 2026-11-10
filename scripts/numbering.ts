// ═══ Rules 3.7 and 12.2: surface section numbers and diagnostic codes are claimed in order ═══
//
// Rule 3.7 of docs/language-design.md: a new surface section takes the next free `§` number in
// docs/use-typeshade-surface.md, and a new diagnostic the next free `TS80xx` code in
// src/compiler/ts/codes.ts. A branch working in parallel may be handed a block of numbers instead.
// A number is never renumbered, a retired number is never reused, and the unused numbers of a
// block stay a gap, recorded by the pull request that lands the block. Rule 12.2 holds the codes
// to the same order, with `TS8099` parked as the catch-all. Both rules said "Enforced by: review",
// and a pull request merged with no review was held by nobody (the audit in PR #1099's body).
//
// WHAT THE CHECK HOLDS, over the numbers in the order the file declares them:
//
//   duplicate   a number declared twice
//   order       a number declared below a larger one (the file lists them in the order added)
//   gap         a number skipped between two declared ones that the tables below do not record
//   reuse       a declared number inside a recorded gap (a retired number, a block's unspent one)
//   stale       a recorded order exception the file no longer needs
//
// WHAT IT CANNOT HOLD. Whether a block was really handed to a branch is a fact of the
// conversation (Rule 13.5's claim in the issue), not of the tree. The check asks instead that each
// gap be recorded here, with where it is recorded in prose, in the same change that leaves it:
// Rule 3.7's "a gap a block leaves is recorded by the pull request that lands the block, in the
// same change". A renumbering that leaves no gap and no duplicate (two codes trading numbers) is
// not visible in one tree either; scripts/changes.ts reports every renumbered code to the proposal
// check, and review reads the rest.
//
// Where it runs: src/numbering.test.ts, in the unit suite (the required `typecheck + unit`).
//
// Usage:
//   bun scripts/numbering.ts      the tree's numbers, and what the check finds

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './doc-refs.js';

export const SURFACE_DOC = 'docs/use-typeshade-surface.md';
export const TS_CODES_FILE = 'src/compiler/ts/codes.ts';

/** The catch-all code Rule 12.2 parks past the sequential range. */
export const CATCH_ALL = { name: 'UNSUPPORTED', number: 8099 } as const;

export interface Gap {
  readonly from: number;
  readonly to: number;
  /** Why the numbers are unspent, and where the prose records it. */
  readonly why: string;
}

/** The recorded gaps in the `TS80xx` codes. A new gap is added here in the change that leaves it. */
export const CODE_GAPS: readonly Gap[] = [
  { from: 8011, to: 8012, why: 'retired codes; the head comment of codes.ts' },
  {
    from: 8039,
    to: 8040,
    why: 'unspent block of #162; the head comment of codes.ts (TS8039 to TS8067)',
  },
  { from: 8042, to: 8049, why: 'unspent block of #162; the head comment of codes.ts' },
  {
    from: 8053,
    to: 8053,
    why: 'retired by change 0134 (INT_LITERAL_DEPRECATION); recorded in codes.ts above RESERVED_BINDING_NAME',
  },
  { from: 8054, to: 8067, why: 'unspent block of #162; the head comment of codes.ts' },
  {
    from: 8076,
    to: 8076,
    why:
      'reserved by draft proposal 0052 (not on main); recorded in codes.ts above KERNEL_WORKGROUP_REDUCES, ' +
      'changes/0067-kernel-workgroup-size.md (decision D7) and changes/0107-numerical-contract.md',
  },
  {
    from: 8078,
    to: 8078,
    why: 'retired by change 0131 (numerics); recorded in codes.ts above UNSUPPORTED',
  },
];

/** The recorded gaps in the surface document's `§` numbers. */
export const SURFACE_GAPS: readonly Gap[] = [
  { from: 41, to: 41, why: 'unspent block; the note under surface §42' },
  { from: 56, to: 61, why: 'unspent block; the note under surface §42' },
];

/** Sections the document places out of numeric order, each a recorded exception. */
export const SURFACE_ORDER_EXCEPTIONS: readonly { section: number; why: string }[] = [
  {
    section: 66,
    why: 'placed between §63 and §64 since PR #273; found by this check on 2026-11-09, not moved',
  },
];

/** The codes of codes.ts in declaration order: `NAME: 'TS8nnn'`. */
export function codesIn(text: string): { name: string; number: number }[] {
  return [...text.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*'TS(8\d{3})'/gm)].map((m) => ({
    name: m[1]!,
    number: Number(m[2]),
  }));
}

/** The numbered `## N.` sections of a Markdown document in document order, fences left out. */
export function sectionsIn(text: string): number[] {
  const out: number[] = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = fence ? null : /^## (\d+)\. /.exec(line);
    if (h) out.push(Number(h[1]));
  }
  return out;
}

const inGap = (n: number, gaps: readonly Gap[]): Gap | undefined =>
  gaps.find((g) => n >= g.from && n <= g.to);

const span = (from: number, to: number, unit: string): string =>
  from === to ? `${unit}${from}` : `${unit}${from} to ${unit}${to}`;

/**
 * The problems in one sequence of numbers, in declaration order. `unit` spells a number in a
 * message (`§`, `TS`); `exceptions` are numbers whose place in the order is recorded elsewhere.
 */
export function numberingProblems(
  declared: readonly number[],
  gaps: readonly Gap[],
  unit: string,
  exceptions: readonly number[] = [],
): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const n of declared) {
    if (seen.has(n)) problems.push(`duplicate: ${unit}${n} is declared twice.`);
    seen.add(n);
  }
  let high = -Infinity;
  for (const n of declared) {
    if (exceptions.includes(n)) continue;
    if (n < high)
      problems.push(`order: ${unit}${n} is declared after ${unit}${high}; numbers go in order.`);
    high = Math.max(high, n);
  }
  for (const e of exceptions) {
    const rest = declared.filter((n) => !exceptions.includes(n) || n === e);
    const sorted = rest.every((n, i) => i === 0 || n > rest[i - 1]!);
    if (!declared.includes(e) || sorted)
      problems.push(`stale: ${unit}${e} is recorded as out of order and no longer is; remove it.`);
  }
  for (const n of seen) {
    const g = inGap(n, gaps);
    if (g)
      problems.push(
        `reuse: ${unit}${n} is declared inside the recorded gap ${span(g.from, g.to, unit)} (${g.why}); a gap is never reused (Rule 3.7).`,
      );
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    for (let n = sorted[i - 1]! + 1; n < sorted[i]!; n++) {
      if (inGap(n, gaps)) continue;
      let to = n;
      while (to + 1 < sorted[i]! && !inGap(to + 1, gaps)) to++;
      problems.push(
        `gap: ${span(n, to, unit)} is skipped and recorded nowhere. Take the next free number, or ` +
          'record the block in scripts/numbering.ts and in the prose in this change (Rule 3.7).',
      );
      n = to;
    }
  }
  return problems;
}

/** Rule 12.2 over codes.ts: the sequence without the catch-all, and the catch-all itself. */
export function codeProblems(text: string, gaps: readonly Gap[] = CODE_GAPS): string[] {
  const codes = codesIn(text);
  const problems: string[] = [];
  const catchAll = codes.filter((c) => c.number === CATCH_ALL.number);
  if (catchAll.length !== 1 || catchAll[0]!.name !== CATCH_ALL.name)
    problems.push(
      `TS${CATCH_ALL.number} must be declared once, as \`${CATCH_ALL.name}\` (Rule 12.2).`,
    );
  else if (codes[codes.length - 1]!.number !== CATCH_ALL.number)
    problems.push(`TS${CATCH_ALL.number} is parked past the sequential codes; declare it last.`);
  const sequence = codes.filter((c) => c.number !== CATCH_ALL.number).map((c) => c.number);
  const top = Math.max(...sequence);
  if (top >= CATCH_ALL.number)
    problems.push(`TS${top} is past the catch-all TS${CATCH_ALL.number}; the sequence ran out.`);
  return [...problems, ...numberingProblems(sequence, gaps, 'TS')];
}

/** Rule 3.7 over the surface document's sections. */
export function surfaceProblems(
  text: string,
  gaps: readonly Gap[] = SURFACE_GAPS,
  exceptions: readonly number[] = SURFACE_ORDER_EXCEPTIONS.map((e) => e.section),
): string[] {
  return numberingProblems(sectionsIn(text), gaps, '§', exceptions);
}

/** The first number past `n` that no recorded gap holds. */
function pastGaps(n: number, gaps: readonly Gap[]): number {
  let next = n + 1;
  while (inGap(next, gaps)) next++;
  return next;
}

/** The next free numbers: one past the highest declared (the catch-all left out), and past a
 *  recorded gap there (a code retired at the top of the sequence, TS8078). */
export function nextFree(
  codesText: string,
  surfaceText: string,
): { code: number; section: number } {
  const seq = codesIn(codesText)
    .map((c) => c.number)
    .filter((n) => n !== CATCH_ALL.number);
  return {
    code: pastGaps(Math.max(...seq), CODE_GAPS),
    section: pastGaps(Math.max(...sectionsIn(surfaceText)), SURFACE_GAPS),
  };
}

if (import.meta.main) {
  const codes = readFileSync(join(ROOT, TS_CODES_FILE), 'utf8');
  const doc = readFileSync(join(ROOT, SURFACE_DOC), 'utf8');
  const problems = [
    ...codeProblems(codes).map((p) => `${TS_CODES_FILE}: ${p}`),
    ...surfaceProblems(doc).map((p) => `${SURFACE_DOC}: ${p}`),
  ];
  const next = nextFree(codes, doc);
  console.log(`Next free numbers: TS${next.code}, §${next.section}.`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}
