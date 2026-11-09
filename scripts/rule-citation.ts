// ═══ Rule 13.1: a pull request that changes what an author can write cites the rule it rests on ═══
//
// Rule 13.1 of docs/language-design.md: "An issue or pull request that changes what an author can
// write must cite the rule of this document it rests on." It was enforced by review alone, and a
// pull request merged with no review was held by nobody (the audit recorded in PR #1099's body).
// This check holds the pull-request half mechanically. An issue has no diff and no CI run, so the
// issue half stays with review.
//
// WHICH PULL REQUESTS. The ones whose diff the proposal criteria of scripts/changes.ts catch
// (changes/README.md): a `**Rule N.M.**` paragraph, an export in src/__api__/surface.md, a numbered
// section of docs/use-typeshade-surface.md, a diagnostic code, or the set of examples. The check
// reuses `touchedBy` so the two can never disagree on what the criteria mean. A diff those
// criteria do not catch needs no citation here; review still reads the rest.
//
// WHAT COUNTS AS A CITATION. `Rule N.M` in the pull request's description, outside HTML comments
// (the template's own placeholder comment names no rule), where N.M is a rule that
// docs/language-design.md defines on the base or on the head. Base or head, because a pull
// request that removes a rule cites it, and one that adds a rule may cite the new one (Rule 13.2).
// A `Change: none, <reason>` line does not excuse the citation: Rule 13.1 has no exception.
//
// Where it runs: CI, the `rule citation (Rule 13.1)` step of the `quality` job, on a pull request,
// with the description from the event payload in `PR_BODY`. The payload is the description when
// the run started: after you edit the description, push a commit (a re-run of the job reuses the
// old payload).
//
// Usage:
//   PR_BODY="…" bun scripts/rule-citation.ts --base origin/main
//   bun scripts/rule-citation.ts --base origin/main --body-file <file>

import { readFileSync } from 'node:fs';
import { git } from './doc-refs.js';
import { atBase, atHead, readDiff, type Diff } from './doc-impact.js';
import { describe, nothingTouched, touchedBy, type Touched } from './changes.js';

const DESIGN = 'docs/language-design.md';

/** The rule numbers a design document defines: each `**Rule N.M.**` paragraph. */
export function rulesIn(design: string): Set<string> {
  return new Set([...design.matchAll(/\*\*Rule (\d+\.\d+)\.\*\*/g)].map((m) => m[1]!));
}

/** The rule numbers a pull request's description cites, HTML comments left out. */
export function citedRules(body: string): Set<string> {
  const text = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  return new Set([...text.matchAll(/\bRules? (\d+\.\d+)\b/g)].map((m) => m[1]!));
}

export interface CitationVerdict {
  /** What stops the change. Empty when it may go ahead. */
  readonly problems: readonly string[];
  /** The cited rules the design document defines. */
  readonly cited: readonly string[];
}

/**
 * Rule 13.1 over one pull request: `touched` is what its diff changes by the proposal criteria,
 * `body` its description, `defined` the rule numbers the design document defines.
 */
export function judgeCitation(
  touched: Touched,
  body: string,
  defined: ReadonlySet<string>,
): CitationVerdict {
  const all = [...citedRules(body)];
  const cited = all.filter((r) => defined.has(r));
  if (nothingTouched(touched)) return { problems: [], cited };
  const problems: string[] = [];
  const unknown = all.filter((r) => !defined.has(r));
  if (!cited.length)
    problems.push(
      `This pull request changes what an author can write (${describe(touched)}), so Rule 13.1 ` +
        'asks its description to cite the rule of docs/language-design.md it rests on: write ' +
        '`Rule N.M` under "Rules cited".' +
        (unknown.length
          ? ` The description names ${unknown.map((r) => `Rule ${r}`).join(', ')}, which the document does not define.`
          : ''),
    );
  return { problems, cited };
}

/** The whole check over a diff and a description, for CI. */
export function checkCitation(diff: Diff, body: string): CitationVerdict {
  const defined = new Set([...rulesIn(atBase(diff, DESIGN)), ...rulesIn(atHead(diff, DESIGN))]);
  return judgeCitation(touchedBy(diff), body, defined);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf('--base');
  const fileAt = args.indexOf('--body-file');
  const body =
    fileAt >= 0 ? readFileSync(args[fileAt + 1]!, 'utf8') : (process.env.PR_BODY ?? undefined);
  if (body === undefined) {
    console.log('No pull request description (PR_BODY or --body-file): Rule 13.1 not checked.');
    process.exit(0);
  }
  const base = git('merge-base', baseAt >= 0 ? args[baseAt + 1]! : 'origin/main', 'HEAD').trim();
  const verdict = checkCitation(readDiff(base, false), body);
  if (verdict.problems.length) for (const p of verdict.problems) console.log(`  ✗ ${p}`);
  else if (verdict.cited.length)
    console.log(`Rule 13.1: cites ${verdict.cited.map((r) => `Rule ${r}`).join(', ')}.`);
  else
    console.log('Rule 13.1: this change touches no rule, export or surface; no citation needed.');
  process.exit(verdict.problems.length ? 1 : 0);
}
