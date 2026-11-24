import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Row } from './core/coverage/index.js';
import { checkEvidence, type Context } from '../scripts/bake-capability-coverage.js';
import { runCli } from '../scripts/convert-evidence.js';
import { analyze } from '../scripts/convert-evidence/analysis.js';
import { parseArguments } from '../scripts/convert-evidence/arguments.js';
import { findEvidenceLiterals } from '../scripts/convert-evidence/literals.js';
import { buildReport } from '../scripts/convert-evidence/report.js';
import type { Verify } from '../scripts/convert-evidence/verify.js';
import { workingCoverageTexts } from '../scripts/move-purity/line-citations.js';

const file = (...parts: string[]): string => parts.join('/');

const MODEL = file('src', 'model.ts');
const SUITE = file('src', 'model.test.ts');
const NOTES = file('docs', ['notes', 'md'].join('.'));
const TOOL = file('scripts', 'tool.ts');
const MISSING = file('src', 'missing.ts');
const COVERAGE = file('src', 'core', 'coverage', 'rows.ts');

const filler = (count: number, make: (at: number) => string): string =>
  Array.from({ length: count }, (_, at) => make(at)).join('\n');

const MODEL_TEXT = `import { helper } from './helper.js';

export interface Shape {
  readonly sides: number;
  area(): number;
}

export class Counter {
  count = 0;
  bump(): number {
    const next = this.count + 1;
    return next;
  }
}

export function twice(value: number): number {
  return value * 2;
}

export const TABLE = {
  first: 1,
  second: 2,
};

export function bigRun(): number {
${filler(45, (at) => `  const step${at} = ${at};`)}
  const uniqueMarkerToken = 5;
  const rareWord = 6;
  return 11;
}

export function plainRun(): void {
${filler(45, () => '  a += 1;')}
}
`;

const lineOf = (needle: string): number =>
  MODEL_TEXT.slice(0, MODEL_TEXT.indexOf(needle)).split('\n').length;
const lastLine = (name: string): number => {
  const from = lineOf(`export function ${name}`);
  const rest = MODEL_TEXT.split('\n').slice(from - 1);
  return from + rest.indexOf('}');
};

interface RowSpec {
  readonly name: string;
  readonly evidence: string;
  readonly quote?: '"' | '`';
  readonly concatenated?: readonly [string, string];
}

const rowText = (spec: RowSpec): string => {
  const q = spec.quote ?? "'";
  const value =
    spec.concatenated === undefined
      ? `${q}${spec.evidence}${q}`
      : `'${spec.concatenated[0]}' + '${spec.concatenated[1]}'`;
  return `  { name: '\`${spec.name}\`', covers: ['k:${spec.name}'], evidence: ${value} },`;
};

const coverageText = (specs: readonly RowSpec[]): string =>
  `export const ROWS = [\n${specs.map(rowText).join('\n')}\n];\n`;

const bump = lineOf('const next');

const SPECS: readonly RowSpec[] = [
  { name: 'bump', evidence: `${MODEL}:${bump}, ${bump + 1}` },
  {
    name: 'area',
    evidence: `${MODEL}:${lineOf('area()')} (the member); ${MODEL}:${lineOf('twice(value')}`,
  },
  { name: 'twice', evidence: `${MODEL}:${lineOf('twice(value')}-${lineOf('twice(value') + 2}` },
  { name: 'first', evidence: `${MODEL}:${lineOf('first: 1')}`, quote: '`' },
  { name: 'rareWord', evidence: `${MODEL}:${lineOf('uniqueMarkerToken = 5')}` },
  { name: 'smooth', evidence: `${MODEL}:${lineOf('plainRun') + 3}` },
  {
    name: 'bigRun',
    evidence: `${MODEL}:${lineOf('export function bigRun')}-${lastLine('bigRun')}`,
  },
  { name: 'import', evidence: `${MODEL}:1` },
  { name: 'beyond', evidence: `${MODEL}:9999` },
  { name: 'gone', evidence: `${MISSING}:3` },
  { name: 'suite', evidence: `${SUITE}:3` },
  { name: 'notes', evidence: `${NOTES}:3` },
  { name: 'tool', evidence: `${TOOL}:1` },
  { name: 'zebra', evidence: `${MODEL}:${lineOf('second: 2')}` },
  { name: 'joined', evidence: '', concatenated: [`${MODEL}:`, String(bump)] },
];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SOUND = SPECS.filter((spec) => spec.name !== 'beyond' && spec.name !== 'gone');

function fixture(specs: readonly RowSpec[] = SPECS): string {
  const root = mkdtempSync(join(tmpdir(), 'convert-evidence-'));
  roots.push(root);
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put('.prettierrc.json', JSON.stringify({ singleQuote: true, printWidth: 400 }));
  put(MODEL, MODEL_TEXT);
  put(SUITE, 'describe("x", () => {});\n\n\n');
  put(NOTES, 'one\n\n\ntext\n');
  put(TOOL, 'export const tool = 1;\n');
  put(COVERAGE, coverageText(specs));
  return root;
}

const fixtureVerify: Verify = (root) => {
  const rows = [...workingCoverageTexts(root)].flatMap(([path, text]) =>
    findEvidenceLiterals(path, text).map((literal) => ({
      name: literal.rowName,
      covers: literal.covers,
      evidence: literal.value,
    })),
  );
  return checkEvidence(rows as unknown as Row[], { root } as Context);
};

const byRow = (root: string): Map<string, ReturnType<typeof analyze>['results'][number][]> => {
  const map = new Map<string, ReturnType<typeof analyze>['results'][number][]>();
  for (const result of analyze(root).results) {
    const name = result.literal.rowName.replace(/`/g, '');
    map.set(name, [...(map.get(name) ?? []), result]);
  }
  return map;
};

describe('convert-evidence classes', () => {
  const root = fixture();
  const rows = byRow(root);
  const only = (name: string) => rows.get(name)![0]!;

  it('collapses several lines of one declaration to one anchor', () => {
    expect(only('bump').class).toBe('exact');
    expect(only('bump').proposed).toBe(`${MODEL}#Counter.bump`);
  });

  it('joins different declarations and keeps the comment', () => {
    const [area, twice] = rows.get('area')!;
    expect(area!.proposed).toBe(`${MODEL}#Shape.area (the member)`);
    expect(twice!.proposed).toBe(`${MODEL}#twice`);
    expect(only('twice').proposed).toBe(`${MODEL}#twice`);
  });

  it('proposes the member of an object literal and keeps a template quote', () => {
    expect(only('first').proposed).toBe(`${MODEL}#TABLE.first`);
    expect(only('first').literal.quote).toBe('`');
  });

  it('calls a range equal to a large declaration exact', () => {
    expect(only('bigRun').class).toBe('exact');
    expect(only('bigRun').proposed).toBe(`${MODEL}#bigRun`);
  });

  it('prefers a word of the row as the needle, then a token of the cited line', () => {
    expect(only('rareWord').class).toBe('inside-large');
    expect(only('rareWord').proposed).toBe(`${MODEL}#bigRun~"rareWord"`);
    const other = analyze(fixture([SPECS[4]!].map((spec) => ({ ...spec, name: 'other' }))));
    expect(other.results[0]!.proposed).toBe(`${MODEL}#bigRun~"uniqueMarkerToken"`);
  });

  it('proposes the plain symbol when a large declaration offers no needle', () => {
    expect(only('smooth').class).toBe('inside-large');
    expect(only('smooth').proposed).toBe(`${MODEL}#plainRun`);
  });

  it('classifies lines outside a declaration, outside the file and missing files', () => {
    expect(only('import').class).toBe('between');
    expect(only('import').proposed).toBeUndefined();
    expect(only('beyond').class).toBe('out-of-bounds');
    expect(only('gone').class).toBe('out-of-bounds');
  });

  it('leaves test files, non-ts files and ts files outside src alone', () => {
    expect(only('suite').class).toBe('test-file');
    expect(only('notes').class).toBe('non-ts');
    expect(only('tool').class).toBe('outside-src');
    for (const name of ['suite', 'notes', 'tool']) expect(only(name).eligible).toBe(false);
  });

  it('queues an exact segment with no row word nearby', () => {
    expect(only('zebra').class).toBe('exact');
    expect(only('zebra').stale).toBe(true);
    expect(only('zebra').eligible).toBe(false);
    const queued = buildReport(analyze(root).results).queue.find(
      (entry) => entry.row === 'k:zebra',
    );
    expect(queued?.reason).toContain('no-row-word-nearby');
    expect(queued?.cited[0]).toContain('second: 2');
  });

  it('reports a concatenated string and does not make it eligible', () => {
    expect(only('joined').class).toBe('exact');
    expect(only('joined').blocked).toBe('concatenated string');
    expect(only('joined').eligible).toBe(false);
  });

  it('counts classes per coverage file and per cited file', () => {
    const report = buildReport(analyze(root).results);
    expect(report.totals.total).toBe(rows.size + 1);
    expect(report.byCoverageFile[COVERAGE]!.total).toBe(report.totals.total);
    expect(report.byCitedFile[MODEL]!.eligible).toBeGreaterThan(0);
  });
});

describe('convert-evidence --write', () => {
  it('rewrites only exact segments with a row word, and the checker accepts the result', async () => {
    const root = fixture(SOUND);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runCli(['--write', '--only', 'exact', '--repo', root], root, fixtureVerify)).toBe(
      0,
    );
    log.mockRestore();
    const text = readFileSync(join(root, COVERAGE), 'utf8');
    expect(text).toContain(`${MODEL}#Counter.bump`);
    expect(text).toContain(`${MODEL}#Shape.area (the member); ${MODEL}:${lineOf('twice(value')}`);
    expect(text).toContain(`\`${MODEL}#TABLE.first\``);
    expect(text).toContain(`${MODEL}:${lineOf('second: 2')}`);
    expect(text).toContain(`${MODEL}:1'`);
    expect(text).toContain(`'${MODEL}:' + '${bump}'`);
    expect(fixtureVerify(root)).toEqual([]);
    const after = analyze(root).results.filter((result) => result.path === MODEL);
    expect(after.some((result) => result.eligible)).toBe(false);
  });

  it('changes nothing on a second run', async () => {
    const root = fixture(SOUND);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['--write', '--only', 'exact', '--repo', root], root, fixtureVerify);
    const first = readFileSync(join(root, COVERAGE), 'utf8');
    expect(await runCli(['--write', '--only', 'exact', '--repo', root], root, fixtureVerify)).toBe(
      0,
    );
    log.mockRestore();
    expect(readFileSync(join(root, COVERAGE), 'utf8')).toBe(first);
  });

  it('undoes the write when the check finds a defect after it', async () => {
    const root = fixture(SOUND);
    const before = readFileSync(join(root, COVERAGE), 'utf8');
    const calls: number[] = [];
    const verify: Verify = () => (calls.push(1) === 1 ? [] : ['evidence is broken']);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runCli(['--write', '--only', 'exact', '--repo', root], root, verify)).toBe(1);
    error.mockRestore();
    expect(readFileSync(join(root, COVERAGE), 'utf8')).toBe(before);
  });

  it('refuses to write while the evidence already has a defect', async () => {
    const root = fixture();
    const before = readFileSync(join(root, COVERAGE), 'utf8');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runCli(['--write', '--only', 'exact', '--repo', root], root, fixtureVerify)).toBe(
      1,
    );
    error.mockRestore();
    expect(readFileSync(join(root, COVERAGE), 'utf8')).toBe(before);
  });

  it('honours the file and cited filters', async () => {
    const root = fixture(SOUND);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const before = readFileSync(join(root, COVERAGE), 'utf8');
    const args = ['--write', '--only', 'exact', '--repo', root, '--file'];
    await runCli([...args, 'other.ts'], root, fixtureVerify);
    await runCli([...args, 'rows.ts', '--cited', TOOL], root, fixtureVerify);
    log.mockRestore();
    expect(readFileSync(join(root, COVERAGE), 'utf8')).toBe(before);
  });
});

describe('convert-evidence command line', () => {
  it('refuses --write without --only exact', () => {
    expect(parseArguments(['--write'])).toBeUndefined();
    expect(parseArguments(['--report', '--write', '--only', 'exact'])).toBeUndefined();
    expect(parseArguments(['--write', '--only', 'exact'])?.mode).toBe('write');
  });

  it('writes the review queue and prints the report', async () => {
    const root = fixture();
    const queue = join(root, 'queue.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runCli(['--report', '--json', '--queue', queue, '--repo', root], root)).toBe(0);
    const printed = JSON.parse(String(log.mock.calls[0]![0])) as { totals: { total: number } };
    log.mockRestore();
    const entries = JSON.parse(readFileSync(queue, 'utf8')) as {
      class: string;
      proposed: unknown;
    }[];
    expect(printed.totals.total).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.class === 'between')).toBe(true);
    expect(entries.every((entry) => !['test-file', 'non-ts'].includes(entry.class))).toBe(true);
  });
});
