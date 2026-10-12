// ═══ Pack: the scope of an issue, ranked, with the checks it owes ═══
//
// The context pack (`bun run scope`) takes an issue and reports where the change lives. Steps 3
// and 5 of the pipeline are here. Step 3 ranks the files: a named path, a definition of a named
// identifier, a caller or callee of one, the footprint of a similar proposal, the files of a
// similar past issue fix, and a co-change partner. Step 5 names what to check: the tests of the
// top files, the files that verify a named rule, the obligations of the layers the top files
// reach, and whether the issue probably needs a proposal.
//
// Every step reads the repository at one revision (`at`). The code graph is used only when `at`
// is HEAD and the working tree is clean; otherwise the git resolver runs, and the pack's
// resolver note says why.
//
// Scores are the constants below. A reason names its source for each score row, so a reader can
// check each line of the output. The pack is a report: it is a starting point, not a plan.
//
// Usage: imported by scripts/scope.ts. It has no command line.

import { execFileSync } from 'node:child_process';
import { extractSeeds, type Seeds } from './seeds.js';
import {
  LAYERS,
  PIPELINE,
  isTest,
  layerOf,
  obligations,
  type Layer,
  type Obligation,
} from './layers.js';
import {
  MAX_FILES,
  OWN_NUMBERING_SINCE,
  Similarity,
  coChange,
  git,
  issueFixes,
  noisyCommits,
  pastFixes,
  readHistory,
  readProposals,
  type HistoryCommit,
  type Proposal,
} from './history.js';
import {
  gitResolver,
  graphResolver,
  resolveCommits,
  resolvePaths,
  trackedFiles,
  type Neighbour,
  type Resolver,
  type SymbolHit,
} from './resolve.js';
import { szz, type FixResult } from '../szz.js';

export interface PackOptions {
  readonly at?: string; // default 'HEAD'
  readonly limit?: number; // ranked files, default 15
  readonly szz?: boolean; // run SZZ over the past fixes of the top files (slower)
}

export interface RankedFile {
  readonly file: string;
  readonly layer: Layer;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface PackSymbol extends SymbolHit {
  readonly seed: string;
  readonly callers: readonly Neighbour[];
  readonly callees: readonly Neighbour[];
}

export interface Pack {
  readonly at: string; // full sha
  readonly issue: { readonly number: number | null; readonly title: string };
  readonly resolver: { readonly kind: 'graph' | 'git'; readonly note: string };
  readonly seeds: Seeds;
  readonly symbols: readonly PackSymbol[];
  readonly unresolved: readonly string[]; // identifiers, untracked paths and unresolved commit tokens
  readonly rules: ReadonlyArray<{ readonly rule: string; readonly verifiedBy: readonly string[] }>;
  readonly proposals: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly why: string;
    readonly files: readonly string[];
    readonly downstream: readonly string[];
  }>;
  readonly similarFixes: ReadonlyArray<{
    readonly issue: number;
    readonly score: number;
    readonly commits: readonly string[];
    readonly files: readonly string[];
  }>;
  readonly files: readonly RankedFile[];
  readonly layers: ReadonlyArray<{ readonly layer: Layer; readonly files: number }>; // PIPELINE order, then the rest
  readonly deepest: Layer | null; // the PIPELINE layer furthest from authoring among the top files
  readonly obligations: readonly Obligation[];
  readonly tests: readonly string[]; // at most TESTS_CAP
  readonly pastFixes: ReadonlyArray<{
    readonly file: string;
    readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
    readonly introducers?: ReadonlyArray<{
      readonly sha: string;
      readonly subject: string;
      readonly lines: number;
    }>;
  }>;
  readonly downstream: readonly string[];
  readonly needsProposal: { readonly likely: boolean; readonly why: readonly string[] };
  readonly timings: Readonly<Record<string, number>>; // ms per step
}

// The score of each row of the table in the specification (section 8.1). Exported so a later
// tuning pass can change one number and name the change.
export const SCORE = {
  namedPath: 5,
  definition: 4,
  definitionShared: 5, // an identifier with more hits than DEFINITION_CROWD splits this among its hits
  neighbour: 1,
  proposal: 3,
  fix: 2,
  cochange: 2,
  rule: 1,
} as const;
export const DEFINITION_CROWD = 8;
export const COCHANGE_SEED_SCORE = 4; // a file needs at least this score before its partners are added
export const SIMILARITY_FLOOR = 0.08;
export const PROPOSAL_TOP = 3;
export const FIX_TOP = 5;
export const PAST_FIXES_PER_FILE = 5;
export const DEFAULT_LIMIT = 15;
export const TESTS_CAP = 20;

// A proposal layer or a layer that a proposal governs: a change there needs an accepted proposal.
const PROPOSAL_LAYERS: ReadonlySet<Layer> = new Set<Layer>([
  'rules',
  'surface',
  'exports',
  'diagnostics',
  'examples',
]);

// The sections of an issue that say what the change must do.
const REQUEST_SECTIONS: ReadonlySet<string> = new Set([
  'what was expected',
  'desired behavior',
  'acceptance criteria',
]);

interface Row {
  score: number;
  reasons: string[];
}

function addScore(rows: Map<string, Row>, file: string, points: number, reason: string): void {
  const row = rows.get(file) ?? { score: 0, reasons: [] };
  row.score += points;
  if (!row.reasons.includes(reason)) row.reasons.push(reason);
  rows.set(file, row);
}

function compareFiles(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isExitCode(error: unknown, code: number): boolean {
  return (error as { status?: unknown }).status === code;
}

// The graph is used only for the working tree at HEAD. The git resolver answers every other
// case, and the note says which resolver ran and why the other one did not.
function chooseResolver(cwd: string, at: string): { resolver: Resolver; note: string } {
  const head = git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}').trim();
  const reasons: string[] = [];
  if (at !== head) reasons.push(`${at.slice(0, 7)} is not HEAD (${head.slice(0, 7)})`);
  if (git(cwd, 'status', '--porcelain').trim() !== '') reasons.push('the working tree has changes');
  if (reasons.length === 0) {
    const graph = graphResolver(cwd);
    if (graph !== null) return { resolver: graph, note: graph.note };
    reasons.push('the code graph is not available for this repository');
  }
  const fallback = gitResolver(cwd, at);
  return {
    resolver: fallback,
    note: `${fallback.note}; the graph resolver did not run: ${reasons.join('; ')}`,
  };
}

// The files at `at` that hold `Verifies: Rule <rule>`. `git grep` exits 1 when nothing matches.
function verifiers(cwd: string, at: string, rule: string): string[] {
  let output: string;
  try {
    output = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'grep', '-l', '-F', '-e', `Verifies: Rule ${rule}`, at, '--'],
      { cwd, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    if (isExitCode(error, 1)) return [];
    throw error;
  }
  const prefix = `${at}:`;
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .sort(compareFiles);
}

// A proposal named by the issue has similarity 1. When the issue names none, the top proposals
// by similarity above the floor are matched.
function matchProposals(
  proposals: readonly Proposal[],
  named: readonly string[],
  query: readonly string[],
): Array<{ proposal: Proposal; similarity: number; why: string }> {
  const byId = new Map(proposals.map((p) => [p.id, p] as const));
  const namedHits = proposals.filter((p) => named.includes(p.id));
  if (namedHits.length > 0) {
    return namedHits.map((proposal) => ({ proposal, similarity: 1, why: 'named by the issue' }));
  }
  const similarity = new Similarity(
    proposals.map((p) => ({ id: p.id, text: `${p.title}\n${p.text}` })),
  );
  return similarity
    .rank(query, proposals.length)
    .filter((hit) => hit.score > SIMILARITY_FLOOR)
    .slice(0, PROPOSAL_TOP)
    .flatMap((hit) => {
      const proposal = byId.get(hit.id);
      if (proposal === undefined) return [];
      return [
        { proposal, similarity: hit.score, why: `similar to the issue (${hit.score.toFixed(2)})` },
      ];
    });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPack(
  cwd: string,
  title: string,
  body: string,
  issueNumber: number | null,
  options: PackOptions = {},
): Pack {
  const timings: Record<string, number> = {};
  const started = performance.now();
  let mark = started;
  const lap = (name: string): void => {
    const now = performance.now();
    timings[name] = Math.round(now - mark);
    mark = now;
  };

  const at = git(cwd, 'rev-parse', '--verify', `${options.at ?? 'HEAD'}^{commit}`).trim();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const seeds = extractSeeds(title, body);
  lap('seeds');

  // Step 2: resolve the names against the repository at `at`.
  const { resolver, note } = chooseResolver(cwd, at);
  const tracked = trackedFiles(cwd, at);
  const trackedSet = new Set(tracked);
  const paths = resolvePaths(seeds.paths, tracked);
  const unresolvedPaths = seeds.paths.filter((p) => resolvePaths([p], tracked).length === 0);
  const namedCommits = resolveCommits(cwd, at, seeds.commits);
  const unresolvedCommits = seeds.commits.filter(
    (hex) => !namedCommits.some((sha) => sha.startsWith(hex)),
  );

  const definitions = new Map<string, SymbolHit[]>();
  const symbols: PackSymbol[] = [];
  const unresolvedNames: string[] = [];
  for (const name of seeds.identifiers) {
    const hits = resolver.find(name);
    if (hits.length === 0) {
      unresolvedNames.push(name);
      continue;
    }
    definitions.set(name, hits);
    for (const hit of hits) {
      const neighbours = resolver.neighbours(hit);
      symbols.push({
        ...hit,
        seed: name,
        callers: neighbours.filter((n) => n.direction === 'caller'),
        callees: neighbours.filter((n) => n.direction === 'callee'),
      });
    }
  }
  lap('resolve');

  // Step 3: history, then the ranking rows of the table in section 8.1.
  const history: HistoryCommit[] = readHistory(cwd, at);
  const noisy = noisyCommits(cwd, at, history);
  const proposals = readProposals(cwd, at, history, noisy);
  const fixes = issueFixes(history, noisy);
  lap('history');

  const rows = new Map<string, Row>();
  for (const path of paths) addScore(rows, path, SCORE.namedPath, 'named in the issue');

  const source = resolver.kind === 'graph' ? 'graph' : 'git grep';
  for (const [name, hits] of definitions) {
    const points =
      hits.length > DEFINITION_CROWD ? SCORE.definitionShared / hits.length : SCORE.definition;
    for (const hit of hits) addScore(rows, hit.file, points, `defines ${name} (${source})`);
  }
  for (const symbol of symbols) {
    for (const n of symbol.callers) {
      addScore(rows, n.file, SCORE.neighbour, `calls ${symbol.seed} (graph)`);
    }
    for (const n of symbol.callees) {
      addScore(rows, n.file, SCORE.neighbour, `called by ${symbol.seed} (graph)`);
    }
  }

  const matched = matchProposals(proposals, seeds.proposals, seeds.words);
  for (const { proposal, similarity } of matched) {
    for (const file of proposal.files) {
      addScore(rows, file, SCORE.proposal * similarity, `proposal ${proposal.id} touched it`);
    }
  }

  const similarFixes = new Similarity(
    fixes.map((fix, index) => ({ id: String(index), text: fix.text })),
  )
    .rank(seeds.words, fixes.length)
    .filter((hit) => hit.score > SIMILARITY_FLOOR)
    .slice(0, FIX_TOP)
    .flatMap((hit) => {
      const fix = fixes[Number(hit.id)];
      if (fix === undefined) return [];
      for (const file of fix.files) {
        addScore(rows, file, SCORE.fix * hit.score, `fix of #${fix.issue} touched it`);
      }
      return [
        { issue: fix.issue, score: round2(hit.score), commits: fix.commits, files: fix.files },
      ];
    });

  // Co-change partners are added only to files that the rows above scored high enough.
  const cochangeSeeds = [...rows.entries()]
    .filter(([file, row]) => !isTest(file) && row.score >= COCHANGE_SEED_SCORE)
    .map(([file]) => file)
    .sort(compareFiles);
  for (const file of cochangeSeeds) {
    const total = history.filter((c) => !noisy.has(c.sha) && c.files.includes(file)).length;
    for (const partner of coChange(history, noisy, file)) {
      if (isTest(partner.file)) continue;
      addScore(
        rows,
        partner.file,
        SCORE.cochange * partner.confidence,
        `changes with ${file} (${partner.together} of ${total} commits)`,
      );
    }
  }

  // Step 5 input: the files that verify each named rule.
  const rules = seeds.rules.map((rule) => ({ rule, verifiedBy: verifiers(cwd, at, rule) }));
  for (const { rule, verifiedBy } of rules) {
    for (const file of verifiedBy) {
      if (!isTest(file)) addScore(rows, file, SCORE.rule, `verifies Rule ${rule}`);
    }
  }

  const ranked: RankedFile[] = [...rows.entries()]
    .filter(([file]) => !isTest(file) && trackedSet.has(file))
    .sort(([fa, ra], [fb, rb]) => rb.score - ra.score || compareFiles(fa, fb))
    .map(([file, row]) => ({
      file,
      layer: layerOf(file),
      score: round2(row.score),
      reasons: row.reasons,
    }));
  const top = ranked.slice(0, limit);
  lap('rank');

  // Step 4 and step 5: the layers the top files reach, what they owe, and the tests to run.
  const layerCounts = new Map<Layer, number>();
  for (const file of top) layerCounts.set(file.layer, (layerCounts.get(file.layer) ?? 0) + 1);
  const layerOrder = [...PIPELINE, ...LAYERS.filter((l) => !PIPELINE.includes(l))];
  const layerList = layerOrder
    .filter((layer) => layerCounts.has(layer))
    .map((layer) => ({ layer, files: layerCounts.get(layer) ?? 0 }));
  let deepest: Layer | null = null;
  for (const layer of PIPELINE) if (layerCounts.has(layer)) deepest = layer;

  const tests = new Set<string>();
  for (const file of top) for (const t of resolver.testsOf(file.file)) tests.add(t);
  for (const { verifiedBy } of rules) {
    for (const file of verifiedBy) {
      if (isTest(file)) tests.add(file);
      for (const t of resolver.testsOf(file)) tests.add(t);
    }
  }
  for (const [file] of rows) if (isTest(file) && trackedSet.has(file)) tests.add(file);

  const fixesByFile = top.map((file) => ({
    file: file.file,
    fixes: pastFixes(history, file.file, PAST_FIXES_PER_FILE),
  }));

  let introducersByFile = new Map<string, Array<{ sha: string; subject: string; lines: number }>>();
  if (options.szz === true) {
    const shas = [...new Set(fixesByFile.flatMap((f) => f.fixes.map((c) => c.sha)))];
    const results: FixResult[] = szz(cwd, shas, {});
    introducersByFile = new Map(
      top.map((file) => [
        file.file,
        results.flatMap((result) =>
          result.candidates
            .filter((c) => c.files.includes(file.file))
            .map((c) => ({ sha: c.commit.sha, subject: c.commit.subject, lines: c.lines })),
        ),
      ]),
    );
  }

  const matchedDownstream = matched.flatMap(({ proposal }) =>
    proposal.downstream.map((d) => `${d.repo}: ${d.what}`),
  );

  // Needs a proposal: a rule, a surface section or a code the issue asks to change, or a top file
  // in a layer a proposal governs. A prediction.
  const needsWhy: string[] = [];
  for (const [key, text] of Object.entries(seeds.sections)) {
    const heading = key
      .replace(/^##\s*/, '')
      .trim()
      .toLowerCase();
    if (!REQUEST_SECTIONS.has(heading)) continue;
    const named = extractSeeds('', text);
    for (const r of named.rules) needsWhy.push(`${key} names Rule ${r}`);
    for (const s of named.surface) needsWhy.push(`${key} names §${s}`);
    for (const c of named.codes) needsWhy.push(`${key} names ${c}`);
  }
  for (const file of top.slice(0, 5)) {
    if (PROPOSAL_LAYERS.has(file.layer)) needsWhy.push(`${file.file} is in ${file.layer}`);
  }

  const obligationList = obligations(new Set(layerCounts.keys()));
  lap('layers');

  const unresolved = [...unresolvedNames, ...unresolvedPaths, ...unresolvedCommits];
  lap('checks');
  timings.total = Math.round(performance.now() - started);

  return {
    at,
    issue: { number: issueNumber, title },
    resolver: { kind: resolver.kind, note },
    seeds,
    symbols,
    unresolved,
    rules,
    proposals: matched.map(({ proposal, why }) => ({
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      why,
      files: proposal.files,
      downstream: proposal.downstream.map((d) => `${d.repo}: ${d.what}`),
    })),
    similarFixes,
    files: top,
    layers: layerList,
    deepest,
    obligations: obligationList,
    tests: [...tests].sort(compareFiles).slice(0, TESTS_CAP),
    pastFixes: fixesByFile.map(({ file, fixes: past }) => ({
      file,
      commits: past.map((c) => ({ sha: c.sha, subject: c.subject })),
      ...(options.szz === true ? { introducers: introducersByFile.get(file) ?? [] } : {}),
    })),
    downstream: [...new Set(matchedDownstream)].sort(compareFiles),
    needsProposal: { likely: needsWhy.length > 0, why: needsWhy },
    timings,
  };
}

// ── Markdown ──────────────────────────────────────────────────────────────────────────────────

const LIST_CAP = 10;

function capped(items: readonly string[], cap: number): string[] {
  if (items.length <= cap) return [...items];
  return [...items.slice(0, cap), `… and ${items.length - cap} more`];
}

// The layer counts of a set of files, in pipeline order: `front-end 4 · ir 2`.
function layerLine(files: readonly string[]): string {
  const counts = new Map<Layer, number>();
  for (const file of files) {
    const layer = layerOf(file);
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  return LAYERS.filter((l) => counts.has(l))
    .map((l) => `${l} ${counts.get(l) ?? 0}`)
    .join(' · ');
}

export function formatPackMarkdown(pack: Pack): string {
  const out: string[] = [];
  const line = (text = ''): void => {
    out.push(text);
  };

  line(`# Context pack: ${pack.issue.title}`);
  line();
  line(
    `at ${pack.at.slice(0, 7)} · resolver: ${pack.resolver.note} · ${pack.timings.total ?? 0} ms`,
  );
  line();

  line('## Scope at a glance');
  line();
  line(`- Deepest layer: ${pack.deepest ?? 'none'}.`);
  line(
    `- Layers: ${pack.layers.length > 0 ? pack.layers.map((l) => `${l.layer} ${l.files}`).join(' · ') : 'none'}.`,
  );
  line(
    `- Needs a proposal (a prediction, not a decision): ${pack.needsProposal.likely ? 'likely' : 'not predicted'}.`,
  );
  for (const why of pack.needsProposal.why) line(`  - ${why}`);
  line();

  if (pack.files.length > 0) {
    line('## Files to read first');
    line();
    line('| File | Layer | Score | Why |');
    line('| --- | --- | --- | --- |');
    for (const file of pack.files) {
      line(`| \`${file.file}\` | ${file.layer} | ${file.score} | ${file.reasons.join('; ')} |`);
    }
    line();
  }

  if (pack.symbols.length > 0) {
    line('## Symbols named in the issue');
    line();
    const symbolLines = pack.symbols.map((s) => {
      const callers = s.callers.map((n) => `${n.name} (${n.file})`);
      const callees = s.callees.map((n) => `${n.name} (${n.file})`);
      return [
        `- \`${s.seed}\` → \`${s.file}:${s.startLine}-${s.endLine}\` (${s.label})`,
        `  - callers: ${callers.length > 0 ? capped(callers, LIST_CAP).join(', ') : 'none'}`,
        `  - callees: ${callees.length > 0 ? capped(callees, LIST_CAP).join(', ') : 'none'}`,
      ];
    });
    for (const text of capped(
      symbolLines.map((l) => l.join('\n')),
      LIST_CAP,
    ))
      line(text);
    line();
  }

  if (pack.obligations.length > 0) {
    line('## Obligations');
    line();
    for (const o of pack.obligations) line(`- \`${o.id}\`: ${o.owe} (${o.source})`);
    line();
  }

  if (pack.proposals.length > 0 || pack.similarFixes.length > 0) {
    line('## Similar past work');
    line();
    for (const p of pack.proposals) {
      line(`- Proposal \`${p.id}\` ${p.title} (${p.status}): ${p.why}.`);
      line(`  - Footprint: ${layerLine(p.files) || 'none'}.`);
      if (p.downstream.length > 0) line(`  - Downstream: ${p.downstream.join('; ')}.`);
    }
    for (const f of pack.similarFixes) {
      line(`- Fix of #${f.issue} (score ${f.score}): commits ${f.commits.join(', ')}.`);
      line(`  - Files: ${capped(f.files, LIST_CAP).join(', ')}.`);
    }
    line();
  }

  line('## Tests and checks to run');
  line();
  if (pack.tests.length > 0) {
    line(`- Tests: ${pack.tests.map((t) => `\`${t}\``).join(', ')}.`);
  } else {
    line('- Tests: none found.');
  }
  line('- Gates from the obligations:');
  for (const o of pack.obligations) line(`  - ${o.owe}`);
  line();

  if (pack.pastFixes.some((p) => p.commits.length > 0)) {
    line('## Past fixes in these files');
    line();
    for (const p of pack.pastFixes) {
      if (p.commits.length === 0) continue;
      const fixes = capped(
        p.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`),
        3,
      );
      line(`- \`${p.file}\`: ${fixes.join('; ')}`);
      for (const i of p.introducers ?? []) {
        line(
          `  - introducer ${i.sha.slice(0, 7)} ${i.subject} (${i.lines} blamed lines in the fix)`,
        );
      }
    }
    line();
  }

  if (pack.rules.length > 0) {
    line('## Rules');
    line();
    for (const r of pack.rules) {
      const by =
        r.verifiedBy.length > 0 ? r.verifiedBy.join(', ') : 'no file at this revision names it';
      line(`- Rule ${r.rule}: ${by}.`);
    }
    line();
  }

  if (pack.unresolved.length > 0) {
    line('## Not resolved');
    line();
    line(
      `- Identifiers, untracked paths and commit tokens that no resolver found: ${capped(pack.unresolved, 30).join(', ')}.`,
    );
    line();
  }

  line('## How this was built');
  line();
  line(`- Resolver: ${pack.resolver.note}.`);
  line(
    `- Noisy commits are left out of the statistics: a commit over ${MAX_FILES} files, a commit listed in .git-blame-ignore-revs at this revision, or a chore(changelog) commit. Past fixes in a file keep them.`,
  );
  line(
    `- Issue numbers in commits before ${new Date(OWN_NUMBERING_SINCE * 1000).toISOString().slice(0, 10)} come from the X-GIS monorepo and are not used.`,
  );
  line();
  line('This pack is mechanical: every line names its source. It is a starting point, not a plan.');
  return `${out.join('\n')}\n`;
}
