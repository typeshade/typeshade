// ═══ Pack: the scope of an issue, ranked, with the checks it owes ═══
//
// The context pack (`bun run scope`) takes an issue and reports where the change lives. Steps 3
// and 5 of the pipeline are here. Step 3 ranks the files: a named path, a definition of a named
// identifier, a caller or callee of one, the footprint of a similar proposal, the files of a
// similar past issue fix, a co-change partner, a path word, and the files that verify a named
// rule. Step 5 names what to check: the tests of the top files, the files that verify a named
// rule, the obligations of the layers the top files reach, and whether the issue probably needs
// a proposal.
//
// Every step reads the repository at one revision (`at`). The code graph is used only when `at`
// is HEAD and the working tree is clean; otherwise the git resolver runs, and the pack's
// resolver note says why. The resolver is chosen and closed by `resolve.ts`.
//
// History rows (footprints, similar fixes, co-change) score source files only. A document is not
// ranked through history; the obligations name what documents a change owes.
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
  tokenize,
  type HistoryCommit,
  type IssueFix,
  type Proposal,
} from './history.js';
import {
  chooseResolver,
  openGraphResolver,
  resolveCommits,
  resolvePaths,
  trackedFiles,
  type Neighbour,
  type OpenGraph,
  type Resolver,
  type SymbolHit,
} from './resolve.js';
import { isSourcePath, szz, type FixResult } from '../szz.js';
import { isTagSource, ruleTags } from '../reqs-sync.js';

export interface PackOptions {
  readonly at?: string; // default 'HEAD'
  readonly limit?: number; // ranked files, default 15
  readonly szz?: boolean; // run SZZ over the past fixes of the top files (slower)
  readonly openGraph?: OpenGraph; // opens the code graph; default openGraphResolver
  readonly weights?: Partial<Weights>; // overrides of DEFAULT_WEIGHTS; default none
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
  readonly rules: ReadonlyArray<{
    readonly rule: string;
    readonly verifiedBy: readonly string[]; // `Verifies: Rule <rule>` tags, exact rule number
    readonly implementedBy: readonly string[]; // `Implements: Rule <rule>` tags, exact rule number
  }>;
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
  readonly files: readonly RankedFile[]; // the top `limit` ranked files
  readonly filesTotal: number; // every ranked file, before the limit
  readonly layers: ReadonlyArray<{ readonly layer: Layer; readonly files: number }>; // PIPELINE order, then the rest
  readonly deepest: Layer | null; // the deepest PIPELINE layer, see deepestFrom
  readonly deepestFrom: 'direct' | 'top5' | null; // 'direct': a best-ranked file with a direct reason; 'top5': none had one
  readonly directFiles: number; // the best-ranked files with a direct reason that the 'direct' layer came from
  readonly obligations: readonly Obligation[];
  readonly tests: readonly string[]; // at most TESTS_CAP, in tier order
  readonly testsTotal: number; // every unique test found, before the cap
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

// Every tunable number of the ranking. A backtest variant overrides some of them through
// PackOptions.weights; with no override the pack is the one these values give.
export const DEFAULT_WEIGHTS = {
  namedPath: 8,
  definition: 2,
  definitionShared: 5,
  neighbour: 1,
  proposal: 3,
  fix: 2,
  cochange: 2,
  rule: 1,
  definitionCrowd: 8,
  cochangeSeedScore: 6,
  similarityFloor: 0.08,
  proposalTop: 3,
  fixTop: 5,
  pathWordCap: 3,
  pathWordBudget: 8,
  specificMax: 3,
  neighbourExpandMax: 8,
  neighbourDamp: 3,
  neighbourCap: 3,
  largeFix: 20,
} as const;
export type Weights = { readonly [K in keyof typeof DEFAULT_WEIGHTS]: number };

// The score of each row of the table in the specification (section 8.1). Exported so a later
// tuning pass can change one number and name the change.
export const SCORE = {
  namedPath: DEFAULT_WEIGHTS.namedPath,
  definition: DEFAULT_WEIGHTS.definition,
  definitionShared: DEFAULT_WEIGHTS.definitionShared, // an identifier with more hits than DEFINITION_CROWD splits this among its hits
  neighbour: DEFAULT_WEIGHTS.neighbour,
  proposal: DEFAULT_WEIGHTS.proposal,
  fix: DEFAULT_WEIGHTS.fix,
  cochange: DEFAULT_WEIGHTS.cochange,
  rule: DEFAULT_WEIGHTS.rule,
} as const;
export const DEFINITION_CROWD = DEFAULT_WEIGHTS.definitionCrowd;
export const COCHANGE_SEED_SCORE = DEFAULT_WEIGHTS.cochangeSeedScore; // a file needs at least this score before its partners are added
export const SIMILARITY_FLOOR = DEFAULT_WEIGHTS.similarityFloor;
export const PROPOSAL_TOP = DEFAULT_WEIGHTS.proposalTop;
export const FIX_TOP = DEFAULT_WEIGHTS.fixTop;
export const PAST_FIXES_PER_FILE = 5;
export const DEFAULT_LIMIT = 15;
export const TESTS_CAP = 20;
export const PATH_WORD_CAP = DEFAULT_WEIGHTS.pathWordCap; // at most this many path words score one file
export const PATH_WORD_BUDGET = DEFAULT_WEIGHTS.pathWordBudget; // a path word shared by n files scores min(1, PATH_WORD_BUDGET / n)
export const PATH_STOPWORDS: readonly string[] = [
  'src',
  'core',
  'compiler',
  'scripts',
  'examples',
  'index',
  'shade',
  'lower',
];
const PATH_STOPWORD_SET: ReadonlySet<string> = new Set(PATH_STOPWORDS);
// The top files that name the deepest layer when none has a direct reason, and the widest pool of
// direct files when none of the DEEPEST_DIRECT_TOP best-ranked ones is in the pipeline.
const DIRECT_TOP_FALLBACK = 5;
export const DEEPEST_DIRECT_TOP = 3; // the best-ranked files with a direct reason that name the deepest layer
// An identifier with at most this many definitions is specific: its definitions are direct reasons.
export const SPECIFIC_MAX = DEFAULT_WEIGHTS.specificMax;
// Neighbour rows (callers and callees): an identifier with more hits than this gets none.
export const NEIGHBOUR_EXPAND_MAX = DEFAULT_WEIGHTS.neighbourExpandMax;
// A neighbour of an identifier with d definitions adds min(1, NEIGHBOUR_DAMP / d).
export const NEIGHBOUR_DAMP = DEFAULT_WEIGHTS.neighbourDamp;
// The most one file gets from neighbour rows.
export const NEIGHBOUR_CAP = DEFAULT_WEIGHTS.neighbourCap;
// A similar fix that touched more code files than this gives no row and is not listed.
export const LARGE_FIX = DEFAULT_WEIGHTS.largeFix;
const OTHER_TESTS_PER_FILE = 3; // test bucket (d): at most this many other tests per top file

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

// The tags of the tagged source files at `at`, by rule number. `git grep` exits 1 when nothing
// matches. The bodies come from ONE `git cat-file --batch` call, read at the revision.
function readRuleTags(
  cwd: string,
  at: string,
  rules: readonly string[],
): Map<string, { verifiedBy: string[]; implementedBy: string[] }> {
  const found = new Map<string, { verifiedBy: string[]; implementedBy: string[] }>();
  for (const rule of rules) found.set(rule, { verifiedBy: [], implementedBy: [] });
  if (rules.length === 0) return found;

  let listing: string;
  try {
    listing = execFileSync(
      'git',
      [
        '-c',
        'core.quotePath=false',
        'grep',
        '-l',
        '-E',
        '(Verifies|Implements):',
        at,
        '--',
        '*.ts',
        '*.mts',
        '*.mjs',
        '*.yml',
        '*.yaml',
      ],
      { cwd, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    if (isExitCode(error, 1)) return found;
    throw error;
  }
  const prefix = `${at}:`;
  const files = listing
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      if (!line.startsWith(prefix)) {
        throw new Error(`scope: git grep line does not start with ${prefix}: ${line}`);
      }
      return line.slice(prefix.length);
    })
    .filter((file) => isTagSource(file))
    .sort(compareFiles);
  if (files.length === 0) return found;

  const batch = execFileSync('git', ['-c', 'core.quotePath=false', 'cat-file', '--batch'], {
    cwd,
    input: files.map((file) => `${at}:${file}\n`).join(''),
    maxBuffer: 256 << 20,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pos = 0;
  for (const file of files) {
    const headerEnd = batch.indexOf(0x0a, pos);
    if (headerEnd < 0) throw new Error(`scope: git cat-file ended before ${file}`);
    const header = batch.toString('utf8', pos, headerEnd).split(' ');
    if (header[1] === 'missing') {
      pos = headerEnd + 1;
      continue;
    }
    const size = Number(header[2]);
    if (!Number.isInteger(size))
      throw new Error(`scope: git cat-file header for ${file}: ${header}`);
    const text = batch.toString('utf8', headerEnd + 1, headerEnd + 1 + size);
    pos = headerEnd + 1 + size + 1;
    for (const tag of ruleTags(text)) {
      const entry = found.get(tag.rule);
      if (entry === undefined) continue;
      const list = tag.kind === 'Verifies' ? entry.verifiedBy : entry.implementedBy;
      if (!list.includes(file)) list.push(file);
    }
  }
  for (const entry of found.values()) {
    entry.verifiedBy.sort(compareFiles);
    entry.implementedBy.sort(compareFiles);
  }
  return found;
}

// A proposal named by the issue has similarity 1. When the issue names none, the top proposals
// by similarity above the floor are matched.
function matchProposals(
  proposals: readonly Proposal[],
  named: readonly string[],
  query: readonly string[],
  w: Weights,
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
    .filter((hit) => hit.score > w.similarityFloor)
    .slice(0, w.proposalTop)
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

function isLargeFix(fix: IssueFix | undefined, largeFix: number): boolean {
  return fix !== undefined && fix.files.filter((file) => isSourcePath(file)).length > largeFix;
}

// The sibling test of a source file: `<dir>/<base>.test.ts`, the extension replaced.
function siblingTest(file: string): string {
  return file.replace(/\.[^./]+$/, '.test.ts');
}

export async function buildPack(
  cwd: string,
  title: string,
  body: string,
  issueNumber: number | null,
  options: PackOptions = {},
): Promise<Pack> {
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

  // Step 2: one resolver for the whole pack. It is closed in the finally below.
  const resolver: Resolver = await chooseResolver(cwd, at, options.openGraph ?? openGraphResolver);
  try {
    return await rankPack({
      cwd,
      at,
      title,
      issueNumber,
      options,
      limit,
      seeds,
      resolver,
      timings,
      lap,
      started,
    });
  } finally {
    await resolver.close();
  }
}

interface RankContext {
  readonly cwd: string;
  readonly at: string;
  readonly title: string;
  readonly issueNumber: number | null;
  readonly options: PackOptions;
  readonly limit: number;
  readonly seeds: Seeds;
  readonly resolver: Resolver;
  readonly timings: Record<string, number>;
  readonly lap: (name: string) => void;
  readonly started: number;
}

async function rankPack(context: RankContext): Promise<Pack> {
  const { cwd, at, title, issueNumber, options, limit, seeds, resolver, timings, lap, started } =
    context;
  const w: Weights = { ...DEFAULT_WEIGHTS, ...options.weights };

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
    const hits = await resolver.find(name);
    if (hits.length === 0) {
      unresolvedNames.push(name);
      continue;
    }
    definitions.set(name, hits);
    for (const hit of hits) {
      const { callers, callees } =
        hits.length > w.neighbourExpandMax
          ? { callers: [], callees: [] }
          : await resolver.neighbours(hit);
      symbols.push({ ...hit, seed: name, callers, callees });
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
  // Files with a direct reason: a named path, a definition of a specific identifier, a path word.
  const direct = new Set<string>();
  // Test files named by a footprint or a similar fix, with the score their row would give.
  const testHistory = new Map<string, number>();
  // A history row scores source files only. A test file is kept apart for tier 3 of the tests.
  const historyRow = (file: string, points: number, reason: string): void => {
    if (isSourcePath(file)) addScore(rows, file, points, reason);
    else if (isTest(file)) testHistory.set(file, (testHistory.get(file) ?? 0) + points);
  };

  for (const path of paths) {
    addScore(rows, path, w.namedPath, 'named in the issue');
    direct.add(path);
  }

  const source = resolver.kind === 'graph' ? 'graph' : 'git grep';
  for (const [name, hits] of definitions) {
    const points =
      hits.length > w.definitionCrowd ? w.definitionShared / hits.length : w.definition;
    for (const hit of hits) {
      addScore(rows, hit.file, points, `defines ${name} (${source})`);
      // Only a specific identifier's definition is a direct reason (deepest, the test tiers).
      if (hits.length <= w.specificMax) direct.add(hit.file);
    }
  }
  // Neighbour rows never count as direct: they say what a file calls, not what the issue names.
  const neighbourTotal = new Map<string, number>();
  const addNeighbour = (file: string, d: number, reason: string): void => {
    const room = w.neighbourCap - (neighbourTotal.get(file) ?? 0);
    const pts = Math.min(Math.min(w.neighbour, w.neighbourDamp / d), room);
    if (pts <= 0) return;
    neighbourTotal.set(file, (neighbourTotal.get(file) ?? 0) + pts);
    addScore(rows, file, pts, reason);
  };
  for (const symbol of symbols) {
    const d = definitions.get(symbol.seed)?.length ?? 1;
    for (const n of symbol.callers) addNeighbour(n.file, d, `calls ${symbol.seed} (graph)`);
    for (const n of symbol.callees) addNeighbour(n.file, d, `called by ${symbol.seed} (graph)`);
  }

  const matched = matchProposals(proposals, seeds.proposals, seeds.words, w);
  for (const { proposal, similarity } of matched) {
    for (const file of proposal.files) {
      historyRow(file, w.proposal * similarity, `proposal ${proposal.id} touched it`);
    }
  }

  const similarFixes: Pack['similarFixes'][number][] = [];
  // A fix that touched more than LARGE_FIX code files matches too many packs: it gives no row.
  const similar = new Similarity(fixes.map((fix, index) => ({ id: String(index), text: fix.text })))
    .rank(seeds.words, fixes.length)
    .filter((hit) => hit.score > w.similarityFloor)
    .filter((hit) => !isLargeFix(fixes[Number(hit.id)], w.largeFix))
    .slice(0, w.fixTop);
  for (const hit of similar) {
    const fix = fixes[Number(hit.id)];
    if (fix === undefined) continue;
    for (const file of fix.files) {
      historyRow(file, w.fix * hit.score, `fix of #${fix.issue} touched it`);
    }
    similarFixes.push({
      issue: fix.issue,
      score: round2(hit.score),
      commits: fix.commits,
      files: fix.files,
    });
  }

  // Path words: a word of the issue that names a token of a source path (section 2, path words).
  // A word shared by n source files scores min(1, PATH_WORD_BUDGET / n) in each of them.
  const words = [...new Set(seeds.words)];
  const pathTokens = new Map<string, Set<string>>();
  for (const file of tracked) {
    if (!isSourcePath(file)) continue;
    const tokens = new Set(tokenize(file).filter((t) => !PATH_STOPWORD_SET.has(t)));
    if (tokens.size > 0) pathTokens.set(file, tokens);
  }
  const wordFiles = new Map<string, number>();
  for (const tokens of pathTokens.values()) {
    for (const word of words)
      if (tokens.has(word)) wordFiles.set(word, (wordFiles.get(word) ?? 0) + 1);
  }
  for (const [file, tokens] of pathTokens) {
    const shared = words.filter((word) => tokens.has(word)).slice(0, w.pathWordCap);
    if (shared.length === 0) continue;
    const points = shared.reduce(
      (sum, word) => sum + Math.min(1, w.pathWordBudget / (wordFiles.get(word) ?? 1)),
      0,
    );
    addScore(rows, file, points, `its path has the words ${shared.join(', ')}`);
    direct.add(file);
  }

  // Co-change: each partner scores once, 2 × its highest confidence over the seed files that
  // pair with it. The reason names that seed file.
  const cochangeSeeds = [...rows.entries()]
    .filter(([file, row]) => !isTest(file) && row.score >= w.cochangeSeedScore)
    .map(([file]) => file)
    .sort(compareFiles);
  const bestPartner = new Map<
    string,
    { confidence: number; seed: string; together: number; total: number }
  >();
  for (const file of cochangeSeeds) {
    const total = history.filter((c) => !noisy.has(c.sha) && c.files.includes(file)).length;
    for (const partner of coChange(history, noisy, file)) {
      if (isTest(partner.file) || !isSourcePath(partner.file)) continue;
      const previous = bestPartner.get(partner.file);
      if (previous === undefined || partner.confidence > previous.confidence) {
        bestPartner.set(partner.file, {
          confidence: partner.confidence,
          seed: file,
          together: partner.together,
          total,
        });
      }
    }
  }
  for (const [partner, best] of bestPartner) {
    addScore(
      rows,
      partner,
      w.cochange * best.confidence,
      `changes with ${best.seed} (${best.together} of ${best.total} commits)`,
    );
  }

  // Step 5 input: the files that verify and implement each named rule.
  const tagged = readRuleTags(cwd, at, seeds.rules);
  const rules = seeds.rules.map((rule) => ({
    rule,
    verifiedBy: tagged.get(rule)?.verifiedBy ?? [],
    implementedBy: tagged.get(rule)?.implementedBy ?? [],
  }));
  for (const { rule, verifiedBy } of rules) {
    for (const file of verifiedBy) {
      if (!isTest(file)) addScore(rows, file, w.rule, `verifies Rule ${rule}`);
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

  // The deepest layer comes from the DEEPEST_DIRECT_TOP best-ranked files with a direct reason.
  // A file further down the list is mostly noise. One stray runtime file far down the top list
  // would set the layer for the whole pack. When none of those files is in the pipeline, the pool
  // widens to the best DIRECT_TOP_FALLBACK files with a direct reason. When no top file has a
  // direct reason, it comes from the top five.
  const directTop = top.filter((file) => direct.has(file.file));
  const usedDirect = directTop.length > 0;
  const inPipeline = (file: RankedFile): boolean => PIPELINE.includes(file.layer);
  let deepestPool: readonly RankedFile[] = top.slice(0, DIRECT_TOP_FALLBACK);
  if (usedDirect) {
    deepestPool = directTop.slice(0, DEEPEST_DIRECT_TOP);
    if (!deepestPool.some(inPipeline)) deepestPool = directTop.slice(0, DIRECT_TOP_FALLBACK);
  }
  let deepest: Layer | null = null;
  for (const layer of PIPELINE) {
    if (deepestPool.some((file) => file.layer === layer)) deepest = layer;
  }
  const deepestFrom: Pack['deepestFrom'] = deepest === null ? null : usedDirect ? 'direct' : 'top5';

  // Tests. Every test found is a candidate (testList, counted by testsTotal). The cap keeps the
  // first of these buckets, each test once, in this order:
  // (0) the test files the issue names as a path, then the test files that define a specific seed
  //     identifier, each in the order the issue gives them;
  // (a) the sibling test of each top file, in rank order;
  // (b) the tests of the files that verify each named rule;
  // (c) the test files of the history rows, by the score their row would give;
  // (d) the other tests of the top files, at most OTHER_TESTS_PER_FILE new ones per file;
  // (e) everything else that was a candidate.
  const testCache = new Map<string, string[]>();
  const testsFor = async (file: string): Promise<string[]> => {
    const cached = testCache.get(file);
    if (cached !== undefined) return cached;
    const found = await resolver.testsOf(file);
    testCache.set(file, found);
    return found;
  };
  const siblings = top.map((file) => siblingTest(file.file)).filter((test) => trackedSet.has(test));
  const ruleTests: string[] = [];
  for (const { verifiedBy } of rules) {
    for (const file of verifiedBy) {
      if (isTest(file)) ruleTests.push(file);
      else ruleTests.push(...(await testsFor(file)));
    }
  }
  const historyTests = [...testHistory.entries()]
    .filter(([file]) => trackedSet.has(file))
    .sort(([fa, sa], [fb, sb]) => sb - sa || compareFiles(fa, fb))
    .map(([file]) => file);
  const directTests = [...direct]
    .sort(compareFiles)
    .filter((file) => isTest(file) && trackedSet.has(file));
  const topTests: string[][] = [];
  for (const file of top) topTests.push(await testsFor(file.file));

  // Bucket (0): the test files the issue names, then the test files that define a specific seed
  // identifier (at most SPECIFIC_MAX definitions, the same crowd rule as a direct reason).
  const namedTests = [
    ...paths.filter((file) => isTest(file)),
    ...[...definitions.values()]
      .filter((hits) => hits.length <= w.specificMax)
      .flatMap((hits) => hits.map((hit) => hit.file))
      .filter(isTest),
  ].filter((file) => trackedSet.has(file));

  const earlier = new Set<string>([...namedTests, ...siblings, ...ruleTests, ...historyTests]);
  const otherTests: string[] = [];
  for (const tests of topTests) {
    let added = 0;
    for (const test of tests) {
      if (added >= OTHER_TESTS_PER_FILE) break;
      if (earlier.has(test)) continue;
      earlier.add(test);
      otherTests.push(test);
      added += 1;
    }
  }
  const testList = [
    ...new Set([
      ...namedTests,
      ...siblings,
      ...directTests,
      ...topTests.flat(),
      ...ruleTests,
      ...historyTests,
    ]),
  ];
  const testOrder = [
    ...new Set([
      ...namedTests,
      ...siblings,
      ...ruleTests,
      ...historyTests,
      ...otherTests,
      ...testList,
    ]),
  ];

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
    resolver: { kind: resolver.kind, note: resolver.note },
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
    filesTotal: ranked.length,
    layers: layerList,
    deepest,
    deepestFrom,
    directFiles: usedDirect ? deepestPool.length : 0,
    obligations: obligationList,
    tests: testOrder.slice(0, TESTS_CAP),
    testsTotal: testList.length,
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
  const directText =
    pack.directFiles === 1 ? 'the best-ranked file' : `the ${pack.directFiles} best-ranked files`;
  const fromText =
    pack.deepestFrom === 'direct'
      ? ` (from ${directText} with a direct reason)`
      : pack.deepestFrom === 'top5'
        ? ' (from the top 5: no top file has a direct reason)'
        : '';
  line(`- Deepest layer: ${pack.deepest ?? 'none'}${fromText}.`);
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
    if (pack.filesTotal > pack.files.length) {
      line();
      line(`… and ${pack.filesTotal - pack.files.length} more ranked files.`);
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
      if (p.downstream.length > 0) {
        line(`  - Downstream: ${capped(p.downstream, LIST_CAP).join('; ')}.`);
      }
    }
    for (const f of pack.similarFixes) {
      const shas = capped(
        f.commits.map((sha) => sha.slice(0, 7)),
        LIST_CAP,
      );
      line(`- Fix of #${f.issue} (score ${f.score}): commits ${shas.join(', ')}.`);
      line(`  - Files: ${capped(f.files, LIST_CAP).join(', ')}.`);
    }
    line();
  }

  line('## Tests and checks to run');
  line();
  if (pack.tests.length > 0) {
    const cut = pack.testsTotal - pack.tests.length;
    const listed = pack.tests.map((t) => `\`${t}\``);
    const tail = cut > 0 ? [`… and ${cut} more`] : [];
    line(`- Tests: ${[...listed, ...tail].join(', ')}.`);
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
      const introducers = capped(
        (p.introducers ?? []).map(
          (i) =>
            `introducer ${i.sha.slice(0, 7)} ${i.subject} (${i.lines} blamed lines in the fix)`,
        ),
        LIST_CAP,
      );
      for (const text of introducers) line(`  - ${text}`);
    }
    line();
  }

  if (pack.rules.length > 0) {
    line('## Rules');
    line();
    for (const r of pack.rules) {
      const by =
        r.verifiedBy.length > 0
          ? capped(r.verifiedBy, LIST_CAP).join(', ')
          : 'no file at this revision names it';
      line(`- Rule ${r.rule}: ${by}.`);
      if (r.implementedBy.length > 0) {
        line(`  - Implemented by: ${capped(r.implementedBy, LIST_CAP).join(', ')}.`);
      }
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
  // The numbering date is read at +09:00, the zone the numbering was made in.
  const numberingDay = new Date((OWN_NUMBERING_SINCE + 9 * 3600) * 1000).toISOString().slice(0, 10);
  line(
    `- Issue numbers in commits before ${numberingDay} (+09:00) come from the X-GIS monorepo and are not used.`,
  );
  line(
    '- History rows (footprints, similar fixes, co-change) score source files only. Path words score source files whose path names a word of the issue.',
  );
  line(
    `- A similar fix that touched more than ${LARGE_FIX} code files gives no row and is not listed.`,
  );
  line();
  line('This pack is mechanical: every line names its source. It is a starting point, not a plan.');
  return `${out.join('\n')}\n`;
}
