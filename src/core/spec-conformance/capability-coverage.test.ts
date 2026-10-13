// ═══ The coverage table holds to the rules of proposal 0059 and to the sources it classifies ═══
//
// WHAT THIS IS FOR. docs/capability-coverage.md gives every capability of WebGPU and of WebGL2 one
// status per target: `typed`, `raw`, `refused`, `planned`, `gap` or `n/a`. Its rows are the
// classification in src/core/coverage/. This test holds the rows to what they classify (every key of
// the pinned sources has exactly one row, and no row names a key that no source has), to the rules
// that define a status (Rules 11.14 to 11.18), to the proposals, tests, hatches and lines they cite,
// and to the two generated texts, which must be what the bake writes from the rows.
//
// WHY A TEST AND NOT ONLY THE BAKE. The bake (scripts/bake-capability-coverage.ts) writes the table
// even when a row is wrong, and prints the defects it finds. This test is the gate. A row that cites
// a missing file, a rule the rules document does not define or a hatch that Rule 11.17 does not list
// fails here, and the message names the row.
//
// PROVE THE INSTRUMENT FIRST (AGENTS.md#gate-discipline). 'each check sees a failure' gives each check
// a copy of a real row, doctored to the defect that check exists for. The check must report that row
// by name. Each case replaces one cell, one key or one line of a real row, and the message it looks
// for is the one the check writes (read through the bake's label builders). An accepts case also
// shows that its filter finds the defect it would otherwise miss. None of these cases asserts an
// installed version or depends on the data being complete, so they hold on every TypeScript leg.
//
// THE TREE OF A CASE. A case that depends on files builds its own small tree in the OS temp directory
// (`withTree`): the test, journey and gate files of the typed cases, the changes/ of the proposal
// reader, and the cited files of the evidence grammar. Its cases read nothing of this checkout. The
// other cases read the rows of the table, and the files of this checkout that they name (for example
// src/core/coverage/model.ts, which is a file of the tree that every checkout holds).
//
// THE FLOORS. The row checks pass on an empty table. 'the table is not truncated' sets the floors on
// the rows, on the cells of each status that must exist and on the sub-gaps. The floor on the source
// keys (SOURCE_FLOOR) sits in 'the rows hold to their sources', with the other source checks, so it is
// skipped on the TypeScript legs that skip those checks.
//
// SOURCES AND VERSIONS. The checks of the sources, of the evidence lines and the bake read the
// installed @webgpu/types and TypeScript. They run only when the installed versions are the ones
// package.json pins (proposal 0059, Unresolved decisions, item 3). On other TypeScript legs they are
// skipped, and the skip title says why. The pins themselves are asserted on every leg.
//
// HOW TO RE-BAKE. A row that changes, or a source that moves to another version, re-bakes the table:
//
//   bun run bake:capability-coverage
//
// The diff of docs/capability-coverage.md and of the Appendix C block of docs/language-design.md is
// read as a change of the table (Rule 11.4 and Rule 11.15).
//
// Verifies: Rule 11.14
// Verifies: Rule 11.15
// Verifies: Rule 11.16
// Verifies: Rule 11.17
// Verifies: Rule 11.18

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COVERAGE_ROWS,
  ESCAPE_HATCHES,
  andGap,
  gap,
  na,
  planned,
  raw,
  refused,
  typed,
  type Cell,
  type Door,
  type GapGroup,
  type Row,
  type TableId,
} from '../coverage/index.js';
import { PINNED, readSources, type SourceMember } from '../../../scripts/capability-sources.js';
import {
  CHECKS,
  DESIGN,
  DOC,
  HATCH_FILES,
  HATCH_MARK,
  cellLabel,
  checkCoverage,
  checkEvidence,
  checkGap,
  checkHatchDocs,
  checkHatchList,
  checkNa,
  checkPlanned,
  checkRaw,
  checkRefused,
  checkStray,
  checkSubGaps,
  checkTyped,
  checkWebGl2Only,
  evidenceLabel,
  format,
  hatchDocumentsOf,
  hatchSites,
  loadContext,
  pinMismatches,
  proposalStatuses,
  render,
  renderAppendix,
  rowLabel,
  ruleHatches,
  validate,
  type Context,
  type TargetLabel,
} from '../../../scripts/bake-capability-coverage.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ctx: Context = loadContext(REPO);

/** A rule number the rules document does not define. It is built from parts: written out, the doc-refs
 *  reader (scripts/doc-refs.ts) would read it as a reference to a rule that does not exist. */
const ABSENT_RULE = `Rule ${99}.${9}`;
/** The markdown suffix, written in parts: a path in this file that ends in the suffix is read by the
 *  doc-refs reader (scripts/doc-refs.ts) as a reference into the prose, and a synthetic tree names no
 *  file of the checkout. The same trap as ABSENT_RULE, for file names. */
const MD = '.' + 'md';
/** A test path that does not exist. */
const NO_SUCH_TEST = 'src/core/spec-conformance/no-such.test.ts';
/** A test that exists, for the cells whose test path a case does not study. */
const A_TEST = 'src/core/spec-conformance/surface-names.test.ts';
/** A file of the tree with a known line count, for the evidence boundary (read at run time, not copied). */
const MODEL = 'src/core/coverage/model.ts';
/** The status of a cell that can carry a sub-gap (K2): a typed, raw or planned cell. */
const SUB_GAP_STATUSES: readonly string[] = ['typed', 'raw', 'planned'];
/** Floors on the source keys (Rule 11.15), set a little below the keys the committed sources hold. */
const SOURCE_FLOOR = 1200;
/** Floors on the rows, set a little below the committed table. Proposal 0059, item 4, names ten
 *  capabilities that only WebGL2 has: the table must hold at least that many WebGL2-only rows. */
const ROW_FLOORS = { rows: 900, A: 400, B: 270, C: 120, D: 60, webgl2Only: 10 } as const;

/** The hatch of Rule 11.17 that each declaration documents, with the text the declaration's member
 *  starts with. The anchor occurs once in its file: the JSDoc block right before it is the marker. */
const DECLARED_HATCHES: readonly {
  readonly hatch: string;
  readonly file: string;
  readonly anchor: string;
}[] = [
  { hatch: 'Frame.encoder', file: 'src/runtime/runtime.ts', anchor: 'readonly encoder: object;' },
  { hatch: 'RenderPass.raw', file: 'src/runtime/runtime.ts', anchor: 'readonly raw: object;' },
  { hatch: 'Runtime.device', file: 'src/runtime/runtime.ts', anchor: 'readonly device: D;' },
  {
    hatch: 'createRuntime({ device })',
    file: 'src/runtime/runtime.ts',
    anchor: 'readonly device?: D;',
  },
  {
    hatch: 'Runtime.submit(…encoders)',
    file: 'src/runtime/runtime.ts',
    anchor: "submit(...encoders: readonly object[]): ReturnType<Frame['submit']>;",
  },
  {
    hatch: 'Texture.texture',
    file: 'src/runtime/resources.ts',
    anchor: 'readonly texture: object;',
  },
  {
    hatch: 'Sampler.sampler',
    file: 'src/runtime/resources.ts',
    anchor: 'readonly sampler: object;',
  },
  {
    hatch: 'RenderPipeline.draw(pass, …)',
    file: 'src/runtime/program.ts',
    anchor: 'draw(pass: object, bindings: B, geometry: Geometry): void;',
  },
  {
    hatch: 'ComputePipeline.dispatch(target, …)',
    file: 'src/runtime/program.ts',
    anchor: 'dispatch(target: object, bindings: B, workgroups: number | readonly number[]): void;',
  },
];

/** The seven hatches that are host objects (Rule 11.17): a documented block names each of them. */
const HOST_HATCHES = [
  'GPUBuffer',
  'GPUTexture',
  'GPUTextureView',
  'GPUSampler',
  'WebGLBuffer',
  'WebGLTexture',
  'WebGLSampler',
] as const;

// ── the pins and the installed versions ──

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
  devDependencies: { typescript: string; '@webgpu/types': string };
};

/** The version of an installed package, or undefined when node_modules does not hold it. */
function installedVersion(name: string): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(REPO, 'node_modules', name, 'package.json'), 'utf8'),
    ) as { version: string };
    return manifest.version;
  } catch {
    return undefined;
  }
}

const installed = {
  typescript: installedVersion('typescript'),
  webgpuTypes: installedVersion('@webgpu/types'),
};
const sourcesPinned =
  installed.typescript === pkg.devDependencies.typescript &&
  installed.webgpuTypes === pkg.devDependencies['@webgpu/types'];
const WHY_SKIPPED =
  `installed TypeScript ${installed.typescript ?? 'missing'}, pinned ${pkg.devDependencies.typescript}; ` +
  `installed @webgpu/types ${installed.webgpuTypes ?? 'missing'}, pinned ${pkg.devDependencies['@webgpu/types']}. ` +
  'The source-dependent suites read the pinned versions (proposal 0059, Unresolved decisions, item 3).';

/** The sources at their installed versions, read on first use: a skipped suite never reads them. */
let sourceCache: SourceMember[] | undefined;
function sources(): SourceMember[] {
  if (sourceCache === undefined) sourceCache = readSources(REPO);
  return sourceCache;
}

/** The text between the markers of Appendix C, trimmed: what the bake writes between them. */
function appendixBlock(design: string): string {
  const lines = design.split('\n');
  const begin = lines.findIndex((line) => line.startsWith('<!-- capability-coverage:begin'));
  const end = lines.findIndex((line) => line.trim() === '<!-- capability-coverage:end -->');
  if (begin < 0 || end <= begin) {
    throw new Error(`${DESIGN} has no capability-coverage marker pair`);
  }
  return lines
    .slice(begin + 1, end)
    .join('\n')
    .trim();
}

describe('the pins', () => {
  it('package.json pins @webgpu/types exactly (no ^ or ~)', () => {
    expect(
      pkg.devDependencies['@webgpu/types'],
      'a range pin lets two installs read two declaration files, so the table would differ between them',
    ).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package.json pins typescript exactly, the version the table reads', () => {
    expect(
      pkg.devDependencies.typescript,
      'the table reads the lib.dom.d.ts of the pinned TypeScript, so its pin is exact',
    ).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('the table is not truncated', () => {
  it(`holds at least ${ROW_FLOORS.rows} rows`, () => {
    const count = COVERAGE_ROWS.length;
    expect(count, `the table holds ${count} rows`).toBeGreaterThanOrEqual(ROW_FLOORS.rows);
  });

  for (const table of ['A', 'B', 'C', 'D'] as const) {
    it(`table ${table} holds at least ${ROW_FLOORS[table]} rows`, () => {
      const count = COVERAGE_ROWS.filter((r) => r.table === table).length;
      expect(count, `table ${table} holds ${count} rows`).toBeGreaterThanOrEqual(ROW_FLOORS[table]);
    });
  }

  it(`flags at least ${ROW_FLOORS.webgl2Only} rows WebGL2-only (proposal 0059, item 4)`, () => {
    const count = COVERAGE_ROWS.filter((r) => r.webgl2Only !== undefined).length;
    expect(count, `${count} rows carry a webgl2Only flag`).toBeGreaterThanOrEqual(
      ROW_FLOORS.webgl2Only,
    );
  });

  // The checks of a status pass on an empty set, so each status that must exist has a floor of its own.
  // `planned` has none: it may truly reach zero.
  for (const status of ['typed', 'raw', 'refused', 'gap', 'n/a'] as const) {
    it(`holds at least one ${status} cell on a target`, () => {
      const count = COVERAGE_ROWS.reduce(
        (n, r) => n + (r.webgpu.status === status ? 1 : 0) + (r.webgl2.status === status ? 1 : 0),
        0,
      );
      expect(count, `the table holds ${count} ${status} cells`).toBeGreaterThanOrEqual(1);
    });
  }

  it('holds at least one sub-gap (proposal 0059, decision K2)', () => {
    const count = COVERAGE_ROWS.reduce(
      (n, r) =>
        n +
        [r.webgpu, r.webgl2].filter(
          (cell) => SUB_GAP_STATUSES.includes(cell.status) && 'subGap' in cell && cell.subGap,
        ).length,
      0,
    );
    expect(count, `the table holds ${count} sub-gaps`).toBeGreaterThanOrEqual(1);
  });
});

describe('the rows hold to the rules of proposal 0059', () => {
  it("ESCAPE_HATCHES is Rule 11.17's list", () => {
    const messages = checkHatchList(ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('every hatch is documented as one (Rule 11.17)', () => {
    const messages = checkHatchDocs(ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a typed cell names a test that exists (Rule 11.18)', () => {
    const messages = checkTyped(COVERAGE_ROWS, ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a refused cell names a rule and a portable spelling (Rule 11.18)', () => {
    const messages = checkRefused(COVERAGE_ROWS, ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a planned cell names a live proposal (Rule 11.18)', () => {
    const messages = checkPlanned(COVERAGE_ROWS, ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a raw cell names a hatch (Rule 11.17)', () => {
    const messages = checkRaw(COVERAGE_ROWS);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a gap cell names a group and a note (Rule 11.18)', () => {
    const messages = checkGap(COVERAGE_ROWS);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('an n/a cell names its reason (Rule 11.18)', () => {
    const messages = checkNa(COVERAGE_ROWS);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a WebGL2-only row enters by a door (Rule 11.16)', () => {
    const messages = checkWebGl2Only(COVERAGE_ROWS, ctx);
    expect(messages, messages.join('\n')).toEqual([]);
  });

  it('a sub-gap names a group and a note', () => {
    const messages = checkSubGaps(COVERAGE_ROWS);
    expect(messages, messages.join('\n')).toEqual([]);
  });
});

describe.skipIf(!sourcesPinned)(
  `the rows hold to their sources${sourcesPinned ? '' : ` (skipped: ${WHY_SKIPPED})`}`,
  () => {
    it('every source key has exactly one row (Rule 11.14)', () => {
      const messages = checkCoverage(COVERAGE_ROWS, sources());
      expect(messages, messages.join('\n')).toEqual([]);
    });

    it('no row covers a key no source has (Rule 11.15)', () => {
      const messages = checkStray(COVERAGE_ROWS, sources());
      expect(messages, messages.join('\n')).toEqual([]);
    });

    it('every evidence citation resolves', () => {
      const messages = checkEvidence(COVERAGE_ROWS, ctx);
      expect(messages, messages.join('\n')).toEqual([]);
    });

    it(`the sources hold at least ${SOURCE_FLOOR} keys (Rule 11.15)`, () => {
      const count = sources().length;
      expect(count, `the sources hold ${count} keys`).toBeGreaterThanOrEqual(SOURCE_FLOOR);
    });

    describe('the committed table is the bake', () => {
      it(`${DOC} is the bake of the rows`, () => {
        const baked = render(COVERAGE_ROWS, sources(), PINNED);
        const committed = readFileSync(join(REPO, DOC), 'utf8').replace(/\r\n/g, '\n');
        expect(
          committed,
          `${DOC} is not the bake of the rows. Run bun run bake:capability-coverage, then read the diff.`,
        ).toBe(baked);
      });

      it(`the Appendix C block of ${DESIGN} is the bake of the rows`, async () => {
        const baked = (await format(renderAppendix(COVERAGE_ROWS), DESIGN)).trim();
        const committed = appendixBlock(
          readFileSync(join(REPO, DESIGN), 'utf8').replace(/\r\n/g, '\n'),
        );
        expect(
          committed,
          `The Appendix C block of ${DESIGN} is not the bake of the rows. Run bun run bake:capability-coverage, then read the diff.`,
        ).toBe(baked);
      });
    });
  },
);

// ── the instrument: each check reports a doctored copy of a real row, by name ──

/** How many rows of the real table cover each source key. */
const KEY_OWNERS = new Map<string, number>();
for (const row of COVERAGE_ROWS) {
  for (const key of row.covers) KEY_OWNERS.set(key, (KEY_OWNERS.get(key) ?? 0) + 1);
}

/** A real row whose every key no other row covers, so that dropping it leaves those keys bare. */
const isSole = (row: Row): boolean =>
  row.covers.length > 0 && row.covers.every((key) => KEY_OWNERS.get(key) === 1);

/** The text of a file with the hatch marker removed from the JSDoc block that sits right before the
 *  `anchor` text. A text that does not hold exactly one anchor, or a block without the marker, is a
 *  broken case, not a pass. */
function withoutMarkerBefore(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at < 0 || text.indexOf(anchor, at + 1) >= 0) {
    throw new Error(`the case needs exactly one "${anchor}" in its file`);
  }
  const open = text.lastIndexOf('/**', at);
  if (open < 0) throw new Error(`no JSDoc block precedes "${anchor}"`);
  const block = text.slice(open, at);
  if (!block.trimEnd().endsWith('*/') || !block.includes(HATCH_MARK)) {
    throw new Error(`the block before "${anchor}" does not carry "${HATCH_MARK}"`);
  }
  return text.slice(0, open) + block.replace(HATCH_MARK, '') + text.slice(at);
}

/** The text with the hatch marker removed from each JSDoc block that carries it and names `word`, and
 *  the number of such blocks. A text with no such block is a broken case, not a pass. */
function withoutMarkerNaming(
  text: string,
  word: string,
): { readonly text: string; readonly blocks: number } {
  const named = new RegExp(`\\b${word}\\b`);
  let blocks = 0;
  const out = text.replace(/\/\*\*[\s\S]*?\*\//g, (block) => {
    if (!block.includes(HATCH_MARK) || !named.test(block)) return block;
    blocks += 1;
    return block.replace(HATCH_MARK, '');
  });
  return { text: out, blocks };
}

/** The content of a synthetic file of ten lines: the evidence cases cite line numbers of it. */
const TEN_LINES = 'line\n'.repeat(10);

/** A small tree of its own, written to the OS temp directory for one case and removed after it. The
 *  files are the keys of `files`, with the text of each; a directory exists when a file lies in it. */
function withTree(files: Readonly<Record<string, string>>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'capability-coverage-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('each check sees a failure', () => {
  /** The first real row of a table: the row each case copies and doctors. */
  function rowOf(table: TableId): Row {
    const row = COVERAGE_ROWS.find((r) => r.table === table);
    if (row === undefined) throw new Error(`the table holds no row of table ${table}`);
    return row;
  }

  /** A real row whose every key no other row covers, so that dropping it leaves those keys bare. */
  function soleRow(): Row {
    const row = COVERAGE_ROWS.find(isSole);
    if (row === undefined)
      throw new Error('every row shares a key with another: none can be dropped');
    return row;
  }

  /** The real table with one row replaced by its doctored copy. */
  const withRow = (victim: Row, next: Row): Row[] =>
    COVERAGE_ROWS.map((r) => (r === victim ? next : r));

  /** The sources of the real table: every key a row covers, once. Needs no node_modules. */
  function sourcesOfRows(rows: readonly Row[]): SourceMember[] {
    const keys = new Map<string, SourceMember>();
    for (const row of rows) {
      for (const key of row.covers) {
        if (!keys.has(key)) {
          keys.set(key, { table: row.table, key, location: row.evidence, display: key });
        }
      }
    }
    return [...keys.values()];
  }

  /** A text with one part removed. A part the text does not hold is a broken case, not a pass. */
  function without(text: string, part: string): string {
    if (!text.includes(part))
      throw new Error(`the case cannot remove "${part}": the text lacks it`);
    return text.replace(part, '');
  }

  /** One message names the row by its first key and says `what`. With `target`, the message must name
   *  the cell of that target (the bake's cellLabel), so a message about the other target does not pass. */
  function namesRow(
    messages: readonly string[],
    row: Row,
    what: string,
    target?: TargetLabel,
  ): void {
    const key = row.covers[0] ?? '';
    const head = target === undefined ? key : cellLabel(row, target);
    const hit = messages.some((m) => m.includes(head) && m.includes(what));
    expect(
      hit,
      `no message names ${head} and says "${what}". The check said:\n${messages.join('\n') || '(nothing)'}`,
    ).toBe(true);
  }

  /** One message says `what`. */
  function says(messages: readonly string[], what: string): void {
    const hit = messages.some((m) => m.includes(what));
    expect(
      hit,
      `no message says "${what}". The check said:\n${messages.join('\n') || '(nothing)'}`,
    ).toBe(true);
  }

  /** The messages about one row: about one of its cells (the target's name) or, with no target, about
   *  its evidence. The labels are the bake's own builders, so the filter follows a change of wording. */
  function messagesAbout(
    messages: readonly string[],
    row: Row,
    target?: 'WebGPU' | 'WebGL2',
  ): string[] {
    const head = target === undefined ? evidenceLabel(row) : cellLabel(row, target);
    return messages.filter((m) => m.includes(head));
  }

  it('the bake runs its thirteen checks, in this order', () => {
    expect(CHECKS.map((check) => check.name)).toEqual([
      'coverage',
      'stray',
      'hatch-list',
      'typed',
      'refused',
      'planned',
      'raw',
      'gap',
      'n/a',
      'webgl2-only',
      'hatch-docs',
      'sub-gaps',
      'evidence',
    ]);
  });

  it('coverage reports a source key whose only row is dropped (Rule 11.14)', () => {
    const victim = soleRow();
    const rows = COVERAGE_ROWS.filter((r) => r !== victim);
    namesRow(checkCoverage(rows, sourcesOfRows(COVERAGE_ROWS)), victim, 'has no row');
  });

  it('coverage reports a source key that two rows cover, and names both rows (Rule 11.14)', () => {
    const first = rowOf('A');
    const key = first.covers[0]!;
    const second: Row = { ...first, name: 'an instrument row that covers the same key' };
    const messages = checkCoverage([...COVERAGE_ROWS, second], sourcesOfRows(COVERAGE_ROWS));
    const hit = messages.find((m) => m.startsWith(`source key ${key} is covered by 2 rows`));
    expect(
      hit,
      `no message says ${key} is covered by 2 rows. The check said:\n${messages.join('\n') || '(nothing)'}`,
    ).toBeDefined();
    expect(hit).toContain(`"${first.name}" (${key})`);
    expect(hit).toContain(`"${second.name}" (${key})`);
  });

  it('stray reports a row that names a key no source has (Rule 11.15)', () => {
    const stray: Row = {
      table: 'A',
      kind: 'WebGPU member',
      name: '`GPUDevice.noSuchMember()`',
      covers: ['GPUDevice.noSuchMember'],
      evidence: 'src/core/coverage/model.ts:1',
      webgpu: na('an instrument row, added to the real table'),
      webgl2: na('an instrument row, added to the real table'),
    };
    const rows = [...COVERAGE_ROWS, stray];
    namesRow(checkStray(rows, sourcesOfRows(COVERAGE_ROWS)), stray, 'which no source has');
  });

  it('stray reports a row that covers no key at all (Rule 11.15)', () => {
    // Rule 11.14 cannot see an empty `covers`: this branch is the only guard against it.
    const victim = rowOf('A');
    const doctored: Row = { ...victim, covers: [] };
    says(
      checkStray(withRow(victim, doctored), sourcesOfRows(COVERAGE_ROWS)),
      `row ${rowLabel(doctored)} covers no key (Rule 11.15)`,
    );
  });

  it('hatch-list reports a rule text that lists one hatch fewer (Rule 11.17)', () => {
    const doctored: Context = {
      ...ctx,
      rule1117: without(ctx.rule1117, '`Runtime.device`, '),
    };
    says(checkHatchList(doctored), 'differs from the names Rule 11.17 lists');
  });

  /** The Rule 11.17 text with the part that holds its hatch list (from "exactly these:" to "Each is
   *  documented") rebuilt by `edit`. A text without the two markers is a broken case, not a pass. */
  function withHatchList(text: string, edit: (list: string) => string): string {
    const from = text.indexOf('exactly these:');
    const to = text.indexOf('Each is documented');
    if (from < 0 || to < from) throw new Error('the case cannot find the hatch list of Rule 11.17');
    return text.slice(0, from) + edit(text.slice(from, to)) + text.slice(to);
  }
  /** The list with its first two hatches exchanged: the same names, two of them in another order. */
  function swapFirstTwo(list: string): string {
    const [first, second] = [...list.matchAll(/`([^`]+)`/g)];
    if (!first || !second) throw new Error('the case needs two hatches in the list');
    const at = first.index!;
    const next = second.index!;
    return (
      list.slice(0, at) +
      `\`${second[1]}\`` +
      list.slice(at + first[0].length, next) +
      `\`${first[1]}\`` +
      list.slice(next + second[0].length)
    );
  }
  /** The list without its last hatch. */
  function dropLast(list: string): string {
    const last = [...list.matchAll(/`([^`]+)`/g)].at(-1);
    if (!last) throw new Error('the case needs a hatch in the list');
    return list.slice(0, last.index!) + list.slice(last.index! + last[0].length);
  }

  it('hatch-list reports a rule text whose hatches are in another order (Rule 11.17)', () => {
    const doctored: Context = { ...ctx, rule1117: withHatchList(ctx.rule1117, swapFirstTwo) };
    // The control: the list changed, and it has as many hatches as ESCAPE_HATCHES, so only the order
    // check can report it (the length check cannot).
    expect(ruleHatches(doctored.rule1117), 'the case changes the order of the list').not.toEqual(
      ruleHatches(ctx.rule1117),
    );
    expect(ruleHatches(doctored.rule1117).length).toBe(ESCAPE_HATCHES.length);
    says(checkHatchList(doctored), 'differs from the names Rule 11.17 lists');
  });

  it('hatch-list reports a rule text that drops its last hatch (Rule 11.17)', () => {
    const doctored: Context = { ...ctx, rule1117: withHatchList(ctx.rule1117, dropLast) };
    // The control: the list is the real list without its last name, so only the length check can
    // report it (the names that remain are in their order).
    expect(ruleHatches(doctored.rule1117)).toEqual(ruleHatches(ctx.rule1117).slice(0, -1));
    says(checkHatchList(doctored), 'differs from the names Rule 11.17 lists');
  });

  it('typed reports a test path that does not exist (Rule 11.18)', () => {
    const row = rowOf('A');
    const doctored: Row = { ...row, webgpu: typed(NO_SUCH_TEST) };
    namesRow(
      checkTyped(withRow(row, doctored), ctx),
      doctored,
      `${NO_SUCH_TEST}, which does not exist`,
      'WebGPU',
    );
  });

  it('typed reports a cell that names no test (Rule 11.18)', () => {
    // The doctored cell must be the only defect the check can report for it. Today the data holds typed
    // cells with no path, so a row whose WebGPU cell is already typed would report this same message
    // with the doctoring removed, and the case would prove nothing. A row that is not typed does not.
    const row = COVERAGE_ROWS.find((r) => r.table === 'A' && r.webgpu.status !== 'typed');
    if (row === undefined)
      throw new Error('every WebGPU cell of table A is typed: no row is left to doctor');
    const doctored: Row = { ...row, webgpu: typed('') };
    const messages = messagesAbout(checkTyped(withRow(row, doctored), ctx), doctored, 'WebGPU');
    expect(
      messages,
      `the check does not report the WebGPU cell of ${rowLabel(doctored)} as naming no test`,
    ).toEqual([`${cellLabel(doctored, 'WebGPU')} names no test (Rule 11.18)`]);
  });

  it('typed reports a path that is a file but not a test (Rule 11.18)', () => {
    const row = rowOf('A');
    const doctored: Row = { ...row, webgpu: typed('src/core/coverage/model.ts') };
    namesRow(
      checkTyped(withRow(row, doctored), ctx),
      doctored,
      'names src/core/coverage/model.ts, which is not a test',
      'WebGPU',
    );
  });

  /** The tree of the typed cases. Its one gate file is `scripts/gate.mjs`, named by `tree()`. */
  const TYPED_TREE = {
    'src/a.test.ts': TEN_LINES,
    'src/a..b.test.ts': TEN_LINES,
    'src/notes.txt': TEN_LINES,
    'src/dir/inner.ts': TEN_LINES,
    'scripts/gate.mjs': TEN_LINES,
    'scripts/other.mjs': TEN_LINES,
    'journeys/README.md': TEN_LINES,
    'journeys/_harness.mjs': TEN_LINES,
    'journeys/alpha/run.mjs': TEN_LINES,
    'journeys/alpha/data/input.json': TEN_LINES,
    'journeys/_hidden/run.mjs': TEN_LINES,
  } as const;
  /** The context of the typed tree: its root, and `scripts/gate.mjs` as the one file a gate runs. */
  const treeContext = (root: string): Context => ({
    ...ctx,
    root,
    gateFiles: new Set(['scripts/gate.mjs']),
  });
  /** The messages of a typed WebGPU cell that names `path`, checked alone against `context`. */
  const typedAt = (path: string, context: Context): string[] => {
    const doctored: Row = { ...rowOf('A'), webgpu: typed(path) };
    return messagesAbout(checkTyped([doctored], context), doctored, 'WebGPU');
  };

  it('typed accepts a test file, a file a gate runs, a journey and a file in it (Rule 11.18)', () => {
    withTree(TYPED_TREE, (root) => {
      const context = treeContext(root);
      // The control: a path that does not exist is reported for this cell, so the filter is not empty.
      expect(
        typedAt('src/none.test.ts', context),
        'the control: the filter finds the defect',
      ).not.toEqual([]);
      for (const path of [
        'src/a.test.ts',
        // A file name with two dots is a file name: only a `..` segment leaves the repository.
        'src/a..b.test.ts',
        'scripts/gate.mjs',
        'journeys/alpha',
        'journeys/alpha/run.mjs',
        'journeys/alpha/data/input.json',
      ]) {
        expect(typedAt(path, context), `typed names ${path}`).toEqual([]);
      }
    });
  });

  it('typed reports a path that is not a test, a directory, an absolute path or a path with .. (Rule 11.18)', () => {
    withTree(TYPED_TREE, (root) => {
      const context = treeContext(root);
      const cases: readonly (readonly [path: string, what: string])[] = [
        // The absolute path names a real test: the check refuses the form, whatever the file is.
        [join(root, 'src/a.test.ts'), 'which is an absolute path'],
        // A Windows drive path is refused as an absolute path, not read as a relative name.
        ['C:\\x/a.test.ts', 'which is an absolute path'],
        ['src/../src/a.test.ts', "which leaves the repository through '..'"],
        ['src/dir', 'which is a directory, not a test'],
        ['journeys/alpha/data', 'which is a directory, not a test'],
        ['journeys/_hidden', 'which is a directory, not a test'],
        ['journeys/_hidden/run.mjs', 'which is not a test'],
        ['journeys/README.md', 'which is not a test'],
        ['journeys/_harness.mjs', 'which is not a test'],
        ['scripts/other.mjs', 'which is not a test'],
        ['src/notes.txt', 'which is not a test'],
        ['src/none.test.ts', 'which does not exist'],
      ];
      for (const [path, what] of cases) {
        namesRow(typedAt(path, context), rowOf('A'), `names ${path}, ${what}`, 'WebGPU');
      }
    });
  });

  it('typed accepts a file that is not a *.test.ts only when a gate runs it (Rule 11.18)', () => {
    // The gate files are the context's own (see treeContext), not the gate:* scripts of package.json.
    withTree(TYPED_TREE, (root) => {
      expect(typedAt('scripts/gate.mjs', treeContext(root))).toEqual([]);
      const noGate: Context = { ...treeContext(root), gateFiles: new Set() };
      says(typedAt('scripts/gate.mjs', noGate), 'which is not a test');
    });
  });

  it('refused reports a rule the rules document does not define (Rule 11.18)', () => {
    const row = rowOf('B');
    const doctored: Row = { ...row, webgpu: refused(ABSENT_RULE, 'none: an instrument row') };
    namesRow(checkRefused(withRow(row, doctored), ctx), doctored, `names ${ABSENT_RULE}`, 'WebGPU');
  });

  it('refused reports a cell with no portable spelling (Rule 11.18)', () => {
    const row = rowOf('B');
    const doctored: Row = { ...row, webgpu: refused('Rule 11.11', '') };
    namesRow(
      checkRefused(withRow(row, doctored), ctx),
      doctored,
      'gives no portable spelling (Rule 11.18)',
      'WebGPU',
    );
  });

  it('refused reports a rule text that is not exactly "Rule N.M", though it holds a defined number (Rule 11.18)', () => {
    const row = rowOf('B');
    // The control: the same rule written exactly is accepted, so the filter is not empty for a good cell.
    const control: Row = { ...row, webgpu: refused('Rule 11.11', 'none: an instrument row') };
    expect(
      messagesAbout(checkRefused(withRow(row, control), ctx), control, 'WebGPU'),
      'the control: Rule 11.11 is accepted',
    ).toEqual([]);
    for (const rule of ['see 11.11', 'Rule 11.11 and Rule 4.1']) {
      const doctored: Row = { ...row, webgpu: refused(rule, 'none: an instrument row') };
      namesRow(
        checkRefused(withRow(row, doctored), ctx),
        doctored,
        `names "${rule}", which is not of the form "Rule N.M"`,
        'WebGPU',
      );
    }
  });

  it('planned reports a proposal with no file, or a status other than draft or accepted (Rule 11.18)', () => {
    const row = rowOf('B');
    // The statuses are synthetic: the case does not depend on what changes/ holds. 9001 is the id
    // the case gives each status, and `undefined` is a proposal with no file in changes/.
    const planning = (status: string | undefined): Context => ({
      ...ctx,
      proposals: status === undefined ? new Map() : new Map([['9001', status]]),
    });
    const cases: readonly (readonly [status: string | undefined, what: string])[] = [
      [undefined, 'which has no file in changes/'],
      ['implemented', 'which is implemented'],
      ['archived', 'which is archived'],
      ['withdrawn', 'which is withdrawn'],
    ];
    for (const [status, what] of cases) {
      const doctored: Row = { ...row, webgpu: planned('9001', 'an instrument row') };
      namesRow(
        checkPlanned(withRow(row, doctored), planning(status)),
        doctored,
        `proposal 9001, ${what}`,
        'WebGPU',
      );
    }
  });

  it('planned accepts a proposal whose status is draft or accepted (Rule 11.18)', () => {
    const row = rowOf('B');
    for (const status of ['draft', 'accepted']) {
      const context: Context = { ...ctx, proposals: new Map([['9001', status]]) };
      const doctored: Row = { ...row, webgpu: planned('9001', 'an instrument row') };
      expect(
        messagesAbout(checkPlanned(withRow(row, doctored), context), doctored, 'WebGPU'),
        `a planned cell that names a ${status} proposal`,
      ).toEqual([]);
    }
  });

  it('planned reports an id that is not four digits (Rule 11.18)', () => {
    const row = rowOf('B');
    const doctored: Row = { ...row, webgpu: planned('59', 'an instrument row') };
    namesRow(
      checkPlanned(withRow(row, doctored), ctx),
      doctored,
      'names proposal 59, which is not a four-digit id',
      'WebGPU',
    );
  });

  it('proposalStatuses reads the status of each proposal file of changes/ (Rule 11.18)', () => {
    withTree(
      {
        [`changes/0001-first${MD}`]: "---\nid: '0001'\nstatus: implemented\n---\n\nText.\n",
        [`changes/0002-second${MD}`]: '---\nid: 0002\nstatus: "draft"\n---\n',
        'changes/README.md': '# Not a proposal\n',
      },
      (root) => {
        expect(proposalStatuses(root)).toEqual(
          new Map([
            ['0001', 'implemented'],
            ['0002', 'draft'],
          ]),
        );
      },
    );
  });

  it('raw reports a hatch that Rule 11.17 does not list (Rule 11.17)', () => {
    const row = rowOf('C');
    const doctored: Row = {
      ...row,
      webgpu: { status: 'raw', hatch: 'Nope.nope' } as unknown as Cell,
    };
    namesRow(checkRaw(withRow(row, doctored)), doctored, 'names hatch Nope.nope', 'WebGPU');
  });

  it('gap reports a group that GAP_GROUPS does not define (Rule 11.18)', () => {
    const row = rowOf('C');
    const outside: number = 0;
    const doctored: Row = { ...row, webgpu: gap(outside as GapGroup, 'an instrument row') };
    namesRow(checkGap(withRow(row, doctored)), doctored, 'names gap group 0', 'WebGPU');
  });

  it('gap reports a cell with no note (Rule 11.18)', () => {
    const row = rowOf('C');
    const doctored: Row = { ...row, webgpu: gap(1, '') };
    namesRow(
      checkGap(withRow(row, doctored)),
      doctored,
      'is a gap with no note (Rule 11.18)',
      'WebGPU',
    );
  });

  it('gap reports an issue that is not a positive integer (Rule 11.18)', () => {
    const row = rowOf('C');
    for (const issue of [0, -2, 1.5]) {
      const doctored: Row = { ...row, webgpu: gap(1, 'an instrument row', issue) };
      namesRow(
        checkGap(withRow(row, doctored)),
        doctored,
        `names issue ${issue}, which is not a positive integer`,
        'WebGPU',
      );
    }
  });

  it('n/a reports a cell with no reason (Rule 11.18)', () => {
    const row = rowOf('D');
    const doctored: Row = { ...row, webgl2: na('') };
    namesRow(checkNa(withRow(row, doctored)), doctored, 'is n/a with no reason', 'WebGL2');
  });

  it('webgl2-only reports a WebGL2 cell typed behind a door of none (Rule 11.16)', () => {
    const row = rowOf('D');
    const doctored: Row = {
      ...row,
      webgl2Only: { door: 'none' },
      webgl2: typed(A_TEST),
    };
    namesRow(
      checkWebGl2Only(withRow(row, doctored), ctx),
      doctored,
      'is typed with no door',
      'WebGL2',
    );
  });

  it('webgl2-only reports a §9.3 door that TYPESHADE_EXTENSIONS does not hold (Rule 11.16)', () => {
    const row = rowOf('D');
    const doctored: Row = {
      ...row,
      webgl2Only: { door: '§9.3', row: 'no such extension row' },
      webgl2: typed(A_TEST),
    };
    namesRow(
      checkWebGl2Only(withRow(row, doctored), ctx),
      doctored,
      'which TYPESHADE_EXTENSIONS does not hold',
      'WebGL2',
    );
  });

  it('webgl2-only reports a §10 door the capability table does not hold (Rule 11.16)', () => {
    const row = rowOf('D');
    const doctored: Row = {
      ...row,
      webgl2Only: { door: '§10', capability: 'noSuchCapability' },
      webgl2: typed(A_TEST),
    };
    namesRow(
      checkWebGl2Only(withRow(row, doctored), ctx),
      doctored,
      'which the capability table does not hold',
      'WebGL2',
    );
  });

  it('webgl2-only accepts a door that exists, and an n/a that cites a rule (Rule 11.16)', () => {
    const row = rowOf('D');
    const extensionRow = [...ctx.extensionRows][0]!;
    const capability = [...ctx.capabilities][0]!;
    const accepted: readonly Door[] = [
      { door: '§9.3', row: extensionRow },
      { door: '§10', capability },
    ];
    // The control: a typed cell behind no door is reported for this cell, so the filter is not empty.
    const broken: Row = { ...row, webgl2Only: { door: 'none' }, webgl2: typed(A_TEST) };
    expect(
      messagesAbout(checkWebGl2Only(withRow(row, broken), ctx), broken, 'WebGL2'),
      'the control: the filter finds a WebGL2 cell typed with no door',
    ).not.toEqual([]);
    for (const door of accepted) {
      const doctored: Row = { ...row, webgl2Only: door, webgl2: typed(A_TEST) };
      expect(
        messagesAbout(checkWebGl2Only(withRow(row, doctored), ctx), doctored, 'WebGL2'),
        `door ${JSON.stringify(door)}`,
      ).toEqual([]);
    }
    const cited: Row = {
      ...row,
      webgl2Only: { door: 'none' },
      webgl2: na('a platform fact, under Rule 11.16'),
    };
    expect(
      messagesAbout(checkWebGl2Only(withRow(row, cited), ctx), cited, 'WebGL2'),
      'an n/a that cites Rule 11.16',
    ).toEqual([]);
  });

  it('webgl2-only reports an n/a that cites no rule, or a rule nobody defines (Rule 11.16)', () => {
    const row = rowOf('D');
    for (const reason of [
      'a platform fact, no rule named',
      `a platform fact, under ${ABSENT_RULE}`,
    ]) {
      const doctored: Row = { ...row, webgl2Only: { door: 'none' }, webgl2: na(reason) };
      namesRow(
        checkWebGl2Only(withRow(row, doctored), ctx),
        doctored,
        'is n/a with no rule number in its reason',
        'WebGL2',
      );
    }
  });

  it('hatch-docs reports a hatch no declaration documents (Rule 11.17)', () => {
    const hatchDocs = new Map(ctx.hatchDocs);
    hatchDocs.delete('Frame.encoder');
    says(checkHatchDocs({ ...ctx, hatchDocs }), 'escape hatch Frame.encoder has no declaration');
  });

  it('hatch-docs reports a hatch whose own marker is removed from its declaration (Rule 11.17)', () => {
    const texts = HATCH_FILES.map((file) => readFileSync(join(REPO, file), 'utf8'));
    expect(
      hatchDocumentsOf(texts).get('Frame.encoder'),
      'the real declarations document Frame.encoder',
    ).toBe(true);
    for (const { hatch, file, anchor } of DECLARED_HATCHES) {
      expect(ESCAPE_HATCHES, `${hatch} is not an escape hatch`).toContain(hatch);
      const doctored = HATCH_FILES.map((name, i) =>
        name === file ? withoutMarkerBefore(texts[i]!, anchor) : texts[i]!,
      );
      const docs = hatchDocumentsOf(doctored);
      expect(docs.get(hatch), `${hatch} still reads as documented without its marker`).toBe(false);
      says(checkHatchDocs({ ...ctx, hatchDocs: docs }), `escape hatch ${hatch} has no declaration`);
    }
  });

  it('hatch-docs reports each host-object hatch that no marked block names (Rule 11.17)', () => {
    const texts = HATCH_FILES.map((file) => readFileSync(join(REPO, file), 'utf8'));
    expect(
      hatchDocumentsOf(texts).get('GPUBuffer'),
      'the real declarations document GPUBuffer',
    ).toBe(true);
    for (const host of HOST_HATCHES) {
      expect(ESCAPE_HATCHES, `${host} is not an escape hatch`).toContain(host);
      const cut = texts.map((text) => withoutMarkerNaming(text, host));
      expect(
        cut.reduce((n, c) => n + c.blocks, 0),
        `no marked block names ${host}, so the case removes nothing`,
      ).toBeGreaterThan(0);
      const docs = hatchDocumentsOf(cut.map((c) => c.text));
      expect(docs.get(host), `${host} still reads as documented without its marker`).toBe(false);
      says(checkHatchDocs({ ...ctx, hatchDocs: docs }), `escape hatch ${host} has no declaration`);
    }
  });

  it('the hatch lists of this file name each hatch of ESCAPE_HATCHES once, and no other (Rule 11.17)', () => {
    // The checks above read these two lists by hand, so a hatch added to Rule 11.17 would get no case
    // unless this assertion sees it. The check runs both ways: a case with no hatch fails it too.
    const listed = [...DECLARED_HATCHES.map((h) => h.hatch), ...HOST_HATCHES].sort();
    expect(
      listed,
      'the hatch cases of this file differ from ESCAPE_HATCHES: a hatch has no case, or a case names no hatch',
    ).toEqual([...ESCAPE_HATCHES].sort());
  });

  it('hatchSites names the owner and the member of each dotted hatch (Rule 11.17)', () => {
    const sites = hatchSites(readFileSync(join(REPO, 'src/runtime/runtime.ts'), 'utf8'));
    const pairs = sites.map((site) => `${site.owner}.${site.member}`);
    for (const pair of ['Frame.encoder', 'RenderPass.raw', 'Runtime.device', 'Runtime.submit']) {
      expect(pairs, `no hatch site names ${pair}`).toContain(pair);
    }
    expect(
      sites.some((site) => site.member === 'device' && site.ownerDoc.includes('createRuntime')),
      'no hatch site documents createRuntime({ device })',
    ).toBe(true);
  });

  it('sub-gaps reports a sub-gap with no note', () => {
    const row = rowOf('A');
    const doctored: Row = {
      ...row,
      webgpu: andGap(typed(A_TEST), 1, ''),
    };
    namesRow(
      checkSubGaps(withRow(row, doctored)),
      doctored,
      'has a sub-gap with no note',
      'WebGPU',
    );
  });

  it('sub-gaps reports a sub-gap in a group GAP_GROUPS does not define', () => {
    const row = rowOf('A');
    const outside: number = 99;
    const doctored: Row = {
      ...row,
      webgpu: andGap(typed(A_TEST), outside as GapGroup, 'an instrument row'),
    };
    namesRow(
      checkSubGaps(withRow(row, doctored)),
      doctored,
      'has a sub-gap in group 99, which GAP_GROUPS does not define',
      'WebGPU',
    );
  });

  it('sub-gaps reports a sub-gap whose issue is not a positive integer', () => {
    const row = rowOf('A');
    const doctored: Row = {
      ...row,
      webgpu: andGap(typed(A_TEST), 1, 'an instrument row', 0),
    };
    namesRow(
      checkSubGaps(withRow(row, doctored)),
      doctored,
      'has a sub-gap naming issue 0, which is not a positive integer',
      'WebGPU',
    );
  });

  it('sub-gaps reports a defect on a raw cell and on a planned cell, not only on a typed one', () => {
    const row = rowOf('A');
    const onRaw: Row = { ...row, webgpu: andGap(raw('RenderPass.raw'), 1, '') };
    namesRow(checkSubGaps(withRow(row, onRaw)), onRaw, 'has a sub-gap with no note', 'WebGPU');
    const onPlanned: Row = {
      ...row,
      webgl2: andGap(planned('0050'), 2, 'an instrument row', 0),
    };
    namesRow(
      checkSubGaps(withRow(row, onPlanned)),
      onPlanned,
      'has a sub-gap naming issue 0, which is not a positive integer',
      'WebGL2',
    );
    // The control: a sub-gap with a note and a group is accepted on a raw cell.
    const sound: Row = { ...row, webgpu: andGap(raw('RenderPass.raw'), 1, 'an instrument row') };
    expect(
      messagesAbout(checkSubGaps(withRow(row, sound)), sound, 'WebGPU'),
      'the control: a sub-gap with a note is accepted on a raw cell',
    ).toEqual([]);
  });

  it('evidence reports a line past the end of its file', () => {
    const row = rowOf('C');
    const doctored: Row = { ...row, evidence: 'src/core/coverage/model.ts:99999' };
    namesRow(
      checkEvidence(withRow(row, doctored), ctx),
      doctored,
      'cites src/core/coverage/model.ts:99999',
    );
  });

  it('evidence reports an issue named in the evidence (Rule 11.18)', () => {
    const row = rowOf('A');
    const doctored: Row = { ...row, evidence: 'src/core/coverage/model.ts:1; #535' };
    namesRow(
      checkEvidence(withRow(row, doctored), ctx),
      doctored,
      'names an issue; an issue belongs to the cell',
    );
  });

  it('evidence reports a citation that names no file', () => {
    const row = rowOf('A');
    const doctored: Row = { ...row, evidence: 'the model, by hand' };
    namesRow(checkEvidence(withRow(row, doctored), ctx), doctored, 'names no file of the tree');
  });

  it('evidence reports a file that does not exist', () => {
    const row = rowOf('A');
    const doctored: Row = { ...row, evidence: 'src/core/coverage/no-such-file.ts:1' };
    namesRow(
      checkEvidence(withRow(row, doctored), ctx),
      doctored,
      'names src/core/coverage/no-such-file.ts, which does not exist',
    );
  });

  it('evidence reports a line that starts at 0, or a range that runs backwards', () => {
    const row = rowOf('A');
    const atZero: Row = { ...row, evidence: 'src/core/coverage/model.ts:0' };
    namesRow(
      checkEvidence(withRow(row, atZero), ctx),
      atZero,
      'cites src/core/coverage/model.ts:0, but the file has',
    );
    const backwards: Row = { ...row, evidence: 'src/core/coverage/model.ts:5-3' };
    namesRow(
      checkEvidence(withRow(row, backwards), ctx),
      backwards,
      'cites src/core/coverage/model.ts:5-3, which runs backwards',
    );
  });

  it('evidence accepts lines and ranges that are in range', () => {
    const row = rowOf('A');
    // The control: a line past the end is reported for this row, so the filter is not empty.
    const broken: Row = { ...row, evidence: 'src/core/coverage/model.ts:99999' };
    expect(
      messagesAbout(checkEvidence(withRow(row, broken), ctx), broken),
      'the control: the filter finds a defective evidence citation',
    ).not.toEqual([]);
    const doctored: Row = { ...row, evidence: 'src/core/coverage/model.ts:1-5, 9' };
    expect(
      messagesAbout(checkEvidence(withRow(row, doctored), ctx), doctored),
      'a valid citation',
    ).toEqual([]);
  });

  it('evidence accepts the last line of a file and rejects the line after it (Rule 11.18)', () => {
    const row = rowOf('A');
    // The line count, read the way the bake reads it: a file that ends in a newline has one line less than
    // its newlines split into. The boundary is pinned on one file with a known count, not on a copied number.
    const text = readFileSync(join(REPO, MODEL), 'utf8');
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
    for (const spec of [`${lines}`, `${lines}-${lines}`]) {
      const doctored: Row = { ...row, evidence: `${MODEL}:${spec}` };
      expect(
        messagesAbout(checkEvidence(withRow(row, doctored), ctx), doctored),
        `${MODEL}:${spec} names the last line of the file`,
      ).toEqual([]);
    }
    const past: Row = { ...row, evidence: `${MODEL}:${lines + 1}` };
    says(
      checkEvidence(withRow(row, past), ctx),
      `cites ${MODEL}:${lines + 1}, but the file has ${lines} lines`,
    );
  });

  /** The files of the evidence cases: a ten-line file, and a directory with a file in it. */
  const EVIDENCE_TREE = { 'src/a.ts': TEN_LINES, 'src/dir/inner.ts': TEN_LINES } as const;
  /** The messages of an evidence string of a real row, checked alone against `context`. */
  const evidenceAt = (evidence: string, context: Context): string[] => {
    const doctored: Row = { ...rowOf('C'), evidence };
    return messagesAbout(checkEvidence([doctored], context), doctored);
  };

  it('evidence reports a second citation past the end, and only that one (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      // The control: a second citation inside the file is accepted.
      expect(evidenceAt('src/a.ts:1-5; src/a.ts:9', context)).toEqual([]);
      const messages = evidenceAt('src/a.ts:1-5; src/a.ts:99', context);
      expect(messages, messages.join('\n')).toHaveLength(1);
      says(messages, 'cites src/a.ts:99, but the file has 10 lines');
    });
  });

  it('evidence reports the second range of one path past the end, and only that one (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      expect(evidenceAt('src/a.ts:1-5, 9', context)).toEqual([]);
      const messages = evidenceAt('src/a.ts:1-5, 99', context);
      expect(messages, messages.join('\n')).toHaveLength(1);
      says(messages, 'cites src/a.ts:99, but the file has 10 lines');
    });
  });

  it('evidence reports the first item past the end when a later item is inside, and only that one (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      // The first item is past the end and the later one is inside: a check that reads only the last
      // item finds nothing here, so each form must give exactly one message.
      for (const evidence of ['src/a.ts:99; src/a.ts:1-5', 'src/a.ts:99, 1']) {
        const messages = evidenceAt(evidence, context);
        expect(messages, `${evidence}: ${messages.join('\n')}`).toHaveLength(1);
        says(messages, 'cites src/a.ts:99, but the file has 10 lines');
      }
    });
  });

  it('evidence reports a range whose end is past the end of the file (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      expect(evidenceAt('src/a.ts:5-10', context), 'the last line is in range').toEqual([]);
      const messages = evidenceAt('src/a.ts:5-99', context);
      expect(messages, messages.join('\n')).toHaveLength(1);
      says(messages, 'cites src/a.ts:5-99, but the file has 10 lines');
    });
  });

  it('evidence refuses a path with a .. segment or an absolute path, though the file exists (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      // Each form names a file that exists inside the tree: only the form is refused.
      says(
        evidenceAt('src/../src/a.ts:1', context),
        "names src/../src/a.ts, which leaves the repository through '..'",
      );
      says(evidenceAt('/src/a.ts:1', context), 'names /src/a.ts, which is an absolute path');
    });
  });

  it('evidence reports a directory cited as a file, and accepts the file in it (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      expect(evidenceAt('src/dir/inner.ts', context), 'the file in the directory').toEqual([]);
      says(evidenceAt('src/dir', context), 'names src/dir, which is a directory; cite a file');
    });
  });

  it('evidence reports a number after a parenthetical, and writes the lines after the path (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      expect(evidenceAt('src/a.ts:5 (see below)', context), 'the lines first').toEqual([]);
      expect(evidenceAt('src/a.ts (see below)', context), 'a whole file').toEqual([]);
      for (const evidence of ['src/a.ts (see below):5', 'src/a.ts (see below) 5']) {
        says(evidenceAt(evidence, context), 'write the lines after the path');
      }
    });
  });

  it('evidence reports text after a parenthetical comment (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      says(
        evidenceAt('src/a.ts:5 (note) more', { ...ctx, root }),
        'nothing may follow the comment',
      );
    });
  });

  it('evidence reports a segment that does not follow the grammar, and accepts a sound one (Rule 11.18)', () => {
    withTree(EVIDENCE_TREE, (root) => {
      const context: Context = { ...ctx, root };
      for (const evidence of ['src/a.ts:1,2', 'src/a.ts:1 2']) {
        says(evidenceAt(evidence, context), 'does not follow the evidence grammar');
      }
      // Segments joined by "; ", each with lines, a comment, or neither.
      expect(
        evidenceAt('src/a.ts:1-5, 9 (note); src/a.ts (whole file); src/dir/inner.ts:10', context),
      ).toEqual([]);
    });
  });

  it('the generated texts follow the rows: a renamed row changes the table, a dropped row the appendix', () => {
    const sourceOf = sourcesOfRows(COVERAGE_ROWS);
    const real = render(COVERAGE_ROWS, sourceOf, PINNED);
    const victim = rowOf('B');
    const renamed: Row = { ...victim, name: `${victim.name} (an instrument row)` };
    expect(
      render(withRow(victim, renamed), sourceOf, PINNED),
      'a renamed row left the rendered table unchanged',
    ).not.toBe(real);
    expect(
      renderAppendix(COVERAGE_ROWS.filter((r) => r !== victim)),
      'a dropped row left the Appendix C text unchanged',
    ).not.toBe(renderAppendix(COVERAGE_ROWS));
  });

  it('a row of the compact table stays on one line of as many cells as the header (Rule 11.15)', () => {
    // A `|` or a newline in a name or a note must not split a row: the bake escapes the one and joins
    // the other. No committed cell holds either, so only this case reads the property.
    const victim = rowOf('A');
    const doctored: Row = {
      ...victim,
      name: '`Row marker 7Q | <one>`\nand a second line',
      webgpu: typed(A_TEST, 'a note | with a pipe, <angle>\nand a newline'),
    };
    const lines = render(withRow(victim, doctored), sourcesOfRows(COVERAGE_ROWS), PINNED).split(
      '\n',
    );
    const held = lines.filter((line) => line.includes('Row marker 7Q'));
    expect(held, 'the lines that hold the doctored row').toHaveLength(1);
    const header = lines.find((line) =>
      line.startsWith('| Kind | Name | Source | Evidence | WebGPU | WebGL2 | Note |'),
    );
    expect(header, 'the header of table A').toBeDefined();
    // An escaped pipe (`\|`) is text, not the boundary of a cell.
    const cells = (line: string): string[] => line.split(/(?<!\\)\|/);
    expect(cells(held[0]!), 'the cells of the doctored row').toHaveLength(cells(header!).length);
  });

  it('a row note is the last cell of its row, with its pipe escaped and its line joined (Rule 11.15)', () => {
    // Row.note is the Note column. The bake escapes its `|` and `<` and joins its newline, as it does
    // for every other cell, so the note stays in one cell of its row.
    const victim = rowOf('A');
    const noted: Row = {
      ...victim,
      note: 'Row note 4K | a distinct note, <angle>\nand a second line',
    };
    const lines = render(withRow(victim, noted), sourcesOfRows(COVERAGE_ROWS), PINNED).split('\n');
    const held = lines.filter((line) => line.includes('Row note 4K'));
    expect(held, 'the lines that hold the doctored note').toHaveLength(1);
    expect(
      held[0]!.endsWith('| Row note 4K \\| a distinct note, \\<angle> and a second line |'),
      `the note is not the last cell of its row: ${held[0]}`,
    ).toBe(true);
  });

  it('the Appendix C block is read between its markers, and a text without a marker pair is refused', () => {
    expect(appendixBlock(readFileSync(join(REPO, DESIGN), 'utf8'))).toContain(
      'The coverage table has',
    );
    expect(() => appendixBlock('a text with no markers in it')).toThrow(
      'has no capability-coverage marker pair',
    );
    expect(() => appendixBlock('<!-- capability-coverage:end -->\nx\n')).toThrow(
      'has no capability-coverage marker pair',
    );
  });

  it('the bake refuses a table read at versions other than the pins, and names both (proposal 0059, item 3)', () => {
    const pins = {
      webgpuTypes: pkg.devDependencies['@webgpu/types'],
      typescript: pkg.devDependencies.typescript,
    };
    expect(pinMismatches({ ...pins }, pins), 'the pins match themselves').toEqual([]);
    const one = pinMismatches({ ...pins, typescript: '5.6.2' }, pins);
    expect(one, 'one version differs: one message').toHaveLength(1);
    says(one, `TypeScript 5.6.2 is installed, and package.json pins ${pins.typescript}`);
    const both = pinMismatches({ webgpuTypes: '0.1.73', typescript: '5.6.2' }, pins);
    expect(both, 'both versions differ: two messages').toHaveLength(2);
    says(both, `@webgpu/types 0.1.73 is installed, and package.json pins ${pins.webgpuTypes}`);
  });

  it('validate() reports one defect of each check in one doctored table', () => {
    // Each case takes its own row, so no two defects share a cell.
    const taken = new Set<Row>();
    const take = (table: TableId, pred: (row: Row) => boolean = () => true): Row => {
      const row = COVERAGE_ROWS.find((r) => r.table === table && !taken.has(r) && pred(r));
      if (row === undefined) throw new Error(`no row of table ${table} is left for a case`);
      taken.add(row);
      return row;
    };
    const dropped = take('A', isSole);
    const typedVictim = take('A');
    const refusedVictim = take('B');
    const plannedVictim = take('B');
    const rawVictim = take('C');
    const gapVictim = take('C');
    const naVictim = take('D');
    const doorVictim = take('D');
    const webgl2NaVictim = take('D');
    const subGapVictim = take('A');
    const evidenceVictim = take('C');

    const noGroup: number = 0;
    const undefinedGroup: number = 99;
    const typedRow: Row = { ...typedVictim, webgpu: typed(NO_SUCH_TEST) };
    const refusedRow: Row = {
      ...refusedVictim,
      webgpu: refused(ABSENT_RULE, 'none: an instrument row'),
    };
    const plannedRow: Row = { ...plannedVictim, webgpu: planned('9999', 'an instrument row') };
    const rawRow: Row = {
      ...rawVictim,
      webgpu: { status: 'raw', hatch: 'Nope.nope' } as unknown as Cell,
    };
    const gapRow: Row = { ...gapVictim, webgpu: gap(noGroup as GapGroup, 'an instrument row') };
    const naRow: Row = { ...naVictim, webgl2: na('') };
    const doorRow: Row = { ...doorVictim, webgl2Only: { door: 'none' }, webgl2: typed(A_TEST) };
    const webgl2NaRow: Row = {
      ...webgl2NaVictim,
      webgl2Only: { door: 'none' },
      webgl2: na('a platform fact, no rule named'),
    };
    const subGapRow: Row = {
      ...subGapVictim,
      webgpu: andGap(typed(A_TEST), undefinedGroup as GapGroup, 'a note'),
    };
    const evidenceRow: Row = { ...evidenceVictim, evidence: 'src/core/coverage/model.ts:99999' };
    const stray: Row = {
      table: 'A',
      kind: 'WebGPU member',
      name: '`GPUDevice.noSuchMember()`',
      covers: ['GPUDevice.noSuchMember'],
      evidence: 'src/core/coverage/model.ts:1',
      webgpu: na('an instrument row, added to the real table'),
      webgl2: na('an instrument row, added to the real table'),
    };

    const replaced = new Map<Row, Row>([
      [typedVictim, typedRow],
      [refusedVictim, refusedRow],
      [plannedVictim, plannedRow],
      [rawVictim, rawRow],
      [gapVictim, gapRow],
      [naVictim, naRow],
      [doorVictim, doorRow],
      [webgl2NaVictim, webgl2NaRow],
      [subGapVictim, subGapRow],
      [evidenceVictim, evidenceRow],
    ]);
    const rows = [
      ...COVERAGE_ROWS.filter((r) => r !== dropped).map((r) => replaced.get(r) ?? r),
      stray,
    ];
    const doctoredCtx: Context = {
      ...ctx,
      rule1117: without(ctx.rule1117, '`Runtime.device`, '),
      hatchDocs: new Map([...ctx.hatchDocs].filter(([hatch]) => hatch !== 'Frame.encoder')),
    };

    const messages = validate(rows, sourcesOfRows(COVERAGE_ROWS), doctoredCtx);
    namesRow(messages, dropped, 'has no row (Rule 11.14)');
    namesRow(messages, stray, 'which no source has (Rule 11.15)');
    says(messages, 'differs from the names Rule 11.17 lists');
    namesRow(messages, typedRow, `${NO_SUCH_TEST}, which does not exist`, 'WebGPU');
    namesRow(
      messages,
      refusedRow,
      `names ${ABSENT_RULE}, which docs/language-design.md does not define`,
      'WebGPU',
    );
    namesRow(messages, plannedRow, 'names proposal 9999, which has no file in changes/', 'WebGPU');
    namesRow(messages, rawRow, 'names hatch Nope.nope, which Rule 11.17 does not list', 'WebGPU');
    namesRow(messages, gapRow, 'names gap group 0, which GAP_GROUPS does not define', 'WebGPU');
    namesRow(messages, naRow, 'is n/a with no reason', 'WebGL2');
    namesRow(messages, doorRow, 'is typed with no door', 'WebGL2');
    namesRow(
      messages,
      webgl2NaRow,
      'is n/a with no rule number in its reason (Rule 11.16)',
      'WebGL2',
    );
    namesRow(
      messages,
      subGapRow,
      'has a sub-gap in group 99, which GAP_GROUPS does not define',
      'WebGPU',
    );
    namesRow(messages, evidenceRow, 'cites src/core/coverage/model.ts:99999');
    says(messages, 'escape hatch Frame.encoder has no declaration');
  });
});
