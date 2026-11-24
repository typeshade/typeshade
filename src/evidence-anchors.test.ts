import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COVERAGE_ROWS, type Row } from './core/coverage/index.js';
import { checkEvidence, loadContext } from '../scripts/bake-capability-coverage.js';
import { lineCitedPaths } from '../scripts/move-purity/line-citations.js';
import { parseAnchors } from '../scripts/symbol-anchors/grammar.js';
import { AnchorResolver, type Resolution } from '../scripts/symbol-anchors/resolve.js';

const file = (...parts: string[]): string => parts.join('/');
const spec = (name: string): string => `./${name}.js`;

const MODEL = file('src', 'model.ts');
const BARREL = file('src', 'barrel.ts');
const STAR = file('src', 'star.ts');
const RENAMED = file('src', 'renamed.ts');
const SUITE = file('src', 'model.test.ts');
const NOTES = file('docs', ['notes', 'md'].join('.'));
const SPLIT_OLD = file('src', 'split.ts');
const SPLIT_DIR = file('src', 'split');

const MODEL_TEXT = `export interface Shape {
  readonly sides: number;
  area(): number;
}

export enum Color {
  Red,
  Green,
}

export const TABLE = {
  first: 1,
  second: 'two',
  run() {
    return 3;
  },
} as const;

export class Counter {
  count = 0;
  constructor() {}
  bump(): number {
    return this.count + 1;
  }
}

export function twice(value: number): number {
  return value * 2;
}

export type Pair = { left: number; right: number };

export const dup = 1;
export interface dup {
  readonly kept: true;
}

export function over(a: number): number;
export function over(a: string): string;
export function over(a: number | string): number | string {
  return a;
}
`;

const SUITE_TEXT = `describe('the model', () => {
  it('doubles a number', () => {
    expect(1).toBe(1);
  });
});
`;

const root = mkdtempSync(join(tmpdir(), 'evidence-anchors-'));
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

write(MODEL, MODEL_TEXT);
write(BARREL, `export { twice, Counter as Tally } from '${spec('model')}';\n`);
write(STAR, `export * from '${spec('barrel')}';\nexport * from '${spec('model')}';\n`);
write(RENAMED, `export * from '${spec('barrel')}';\n`);
write(SUITE, SUITE_TEXT);
write(NOTES, '# notes\n');
write(file('src', 'split', 'part.ts'), 'export const part = 1;\n');

const MOD = file('src', 'mod.ts');
const MOD_DIR = file('src', 'mod');
write(MOD, `export { shown } from '${spec('mod/shown')}';\nconst own = 1;\n`);
write(
  file(MOD_DIR, 'shown.ts'),
  `export const shown = 1;\nconst hidden = 'inner';\nconst own = 2;\nconst viaStar = 3;\n`,
);
write(
  file(MOD_DIR, 'tools.ts'),
  `class Hidden {\n  run(): number {\n    return 42;\n  }\n}\nconst TABLE = { key: 1 };\nconst twin = 1;\nconst shown = 'directory copy';\n`,
);
write(file(MOD_DIR, 'deep', 'nested.ts'), `function nestedOnly(): void {}\nconst twin = 2;\n`);
write(file(MOD_DIR, 'tools.test.ts'), `const onlyInTest = 1;\n`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const resolver = new AnchorResolver(root);
const anchorOf = (text: string) => {
  const parsed = parseAnchors(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.anchors[0]!;
};
const resolve = (path: string, text: string): Resolution => resolver.resolve(path, anchorOf(text));
const lines = (path: string, text: string): [number, number] | string => {
  const found = resolve(path, text);
  return found.ok ? [found.startLine, found.endLine] : found.kind;
};

describe('the anchor grammar', () => {
  it('reads each form and its length', () => {
    const parsed = parseAnchors('Counter.bump~"count" (a note)');
    expect(parsed).toMatchObject({ ok: true, length: 'Counter.bump~"count"'.length });
    const several = parseAnchors('A|B.c~"x y"|"title"');
    expect(several.ok && several.anchors.map((anchor) => anchor.text)).toEqual([
      'A',
      'B.c~"x y"',
      '"title"',
    ]);
  });

  it('refuses text that is not an anchor', () => {
    expect(parseAnchors('1abc').ok).toBe(false);
    expect(parseAnchors('A|').ok).toBe(false);
    expect(parseAnchors('A~""')).toMatchObject({ ok: true, length: 1 });
    expect(parseAnchors('A~"a|b"').ok).toBe(true);
  });
});

describe('the anchor resolver', () => {
  it('resolves each declaration form', () => {
    expect(lines(MODEL, 'Shape')).toEqual([1, 4]);
    expect(lines(MODEL, 'Color')).toEqual([6, 9]);
    expect(lines(MODEL, 'TABLE')).toEqual([11, 17]);
    expect(lines(MODEL, 'Counter')).toEqual([19, 25]);
    expect(lines(MODEL, 'twice')).toEqual([27, 29]);
    expect(lines(MODEL, 'Pair')).toEqual([31, 31]);
  });

  it('resolves each member form', () => {
    expect(lines(MODEL, 'Shape.area')).toEqual([3, 3]);
    expect(lines(MODEL, 'Color.Green')).toEqual([8, 8]);
    expect(lines(MODEL, 'TABLE.second')).toEqual([13, 13]);
    expect(lines(MODEL, 'TABLE.run')).toEqual([14, 16]);
    expect(lines(MODEL, 'Counter.bump')).toEqual([22, 24]);
    expect(lines(MODEL, 'Counter.constructor')).toEqual([21, 21]);
    expect(lines(MODEL, 'Pair.right')).toEqual([31, 31]);
  });

  it('merges the overloads of a function', () => {
    expect(lines(MODEL, 'over')).toEqual([38, 42]);
  });

  it('finds a needle inside the declaration and reports its line', () => {
    const found = resolve(MODEL, 'Counter~"this.count + 1"');
    expect(found).toMatchObject({ ok: true, startLine: 19, endLine: 25, needleLine: 23 });
    expect(resolve(MODEL, 'TABLE.run~"return 3"')).toMatchObject({ ok: true, needleLine: 15 });
  });

  it('resolves a title in a test file', () => {
    expect(lines(SUITE, '"doubles a number"')).toEqual([2, 4]);
    expect(lines(SUITE, '"the model"')).toEqual([1, 5]);
  });

  it('reports each failure kind', () => {
    expect(lines(file('src', 'absent.ts'), 'A')).toBe('file-missing');
    expect(lines(NOTES, 'A')).toBe('not-typescript');
    expect(lines(MODEL, 'Missing')).toBe('symbol-not-found');
    expect(lines(MODEL, 'dup')).toBe('symbol-ambiguous');
    expect(lines(MODEL, 'Counter.missing')).toBe('member-not-found');
    expect(lines(MODEL, 'Shape~"nowhere"')).toBe('needle-not-found');
    expect(lines(SUITE, '"no such title"')).toBe('needle-not-found');
    expect(lines(MODEL, '"a title"')).toBe('anchor-form');
    expect(lines(SUITE, 'twice')).toBe('anchor-form');
  });

  it('reports an ambiguous member', () => {
    const path = file('src', 'twin.ts');
    write(path, 'export class Twin {\n  a = 1;\n  a = 2;\n}\n');
    expect(lines(path, 'Twin.a')).toBe('member-ambiguous');
  });

  it('follows a named re-export, a renamed one and a star re-export', () => {
    expect(resolve(BARREL, 'twice')).toMatchObject({ ok: true, file: MODEL, startLine: 27 });
    expect(resolve(BARREL, 'Tally.bump')).toMatchObject({ ok: true, startLine: 22 });
    expect(resolve(BARREL, 'Counter')).toMatchObject({ ok: false, kind: 'symbol-not-found' });
    expect(resolve(RENAMED, 'twice')).toMatchObject({ ok: true, file: MODEL });
    expect(resolve(STAR, 'Pair')).toMatchObject({ ok: true, file: MODEL });
    expect(resolve(BARREL, 'twice~"value * 2"')).toMatchObject({ ok: true, needleLine: 28 });
  });

  it('resolves a renamed re-export under its exported name', () => {
    expect(resolve(BARREL, 'Tally')).toMatchObject({ ok: true, file: MODEL, startLine: 19 });
  });

  it('does not guess a file in the directory of a moved module', () => {
    const found = resolve(SPLIT_OLD, 'part');
    expect(found).toMatchObject({ ok: false, kind: 'file-missing' });
    expect(found.ok ? '' : found.message).toContain(`${SPLIT_DIR}/ exists`);
  });

  it('follows a declaration into the directory named for the file', () => {
    expect(resolve(MOD, 'hidden')).toMatchObject({
      ok: true,
      file: file(MOD_DIR, 'shown.ts'),
      startLine: 2,
    });
    expect(resolve(MOD, 'Hidden.run')).toMatchObject({
      ok: true,
      file: file(MOD_DIR, 'tools.ts'),
      startLine: 2,
    });
    expect(resolve(MOD, 'TABLE.key')).toMatchObject({ ok: true, file: file(MOD_DIR, 'tools.ts') });
    expect(resolve(MOD, 'Hidden~"return 42"')).toMatchObject({ ok: true, needleLine: 3 });
    expect(resolve(MOD, 'nestedOnly')).toMatchObject({
      ok: true,
      file: file(MOD_DIR, 'deep', 'nested.ts'),
      startLine: 1,
    });
  });

  it('refuses a name that two parts of the directory declare', () => {
    const found = resolve(MOD, 'twin');
    expect(found).toMatchObject({ ok: false, kind: 'symbol-ambiguous' });
    expect(found.ok ? '' : found.message).toContain(file(MOD_DIR, 'deep', 'nested.ts'));
    expect(found.ok ? '' : found.message).toContain(file(MOD_DIR, 'tools.ts'));
  });

  it('ignores a test file of the directory', () => {
    expect(resolve(MOD, 'onlyInTest')).toMatchObject({ ok: false, kind: 'symbol-not-found' });
  });

  it('prefers the file itself, then a re-export, over the directory', () => {
    expect(resolve(MOD, 'own')).toMatchObject({ ok: true, file: MOD, startLine: 2 });
    expect(resolve(MOD, 'shown')).toMatchObject({
      ok: true,
      file: file(MOD_DIR, 'shown.ts'),
      startLine: 1,
    });
  });

  it('reports not found when the file has no directory', () => {
    expect(resolve(MODEL, 'absent')).toMatchObject({ ok: false, kind: 'symbol-not-found' });
    expect(resolve(MOD, 'absent')).toMatchObject({ ok: false, kind: 'symbol-not-found' });
  });

  it('follows a moved declaration', () => {
    const moved = file('src', 'moved.ts');
    write(moved, 'export const before = 1;\n');
    const fresh = new AnchorResolver(root);
    const anchor = anchorOf('later');
    write(moved, 'export const later = 1;\n');
    expect(fresh.resolve(moved, anchor)).toMatchObject({ ok: true, startLine: 1 });
    const shifted = new AnchorResolver(root);
    write(moved, '\n\n\nexport const later = 1;\n');
    expect(shifted.resolve(moved, anchor)).toMatchObject({ ok: true, startLine: 4 });
  });
});

describe('checkEvidence with anchors', () => {
  const context = { ...loadContext(), root };
  const base = COVERAGE_ROWS[0]!;
  const check = (evidence: string): string[] =>
    checkEvidence([{ ...base, evidence } satisfies Row], context);

  it('accepts anchors, lines and a mix of both', () => {
    expect(check(`${MODEL}#Counter.bump~"count"|twice`)).toEqual([]);
    expect(check(`${MODEL}#TABLE.run (a note)`)).toEqual([]);
    expect(check(`${MODEL}:1-3; ${BARREL}#twice; ${SUITE}#"doubles"; ${NOTES}`)).toEqual([]);
  });

  it('names each anchor that fails', () => {
    const messages = check(`${MODEL}#twice|Missing; ${MODEL}:99999`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain(`cites ${MODEL}#Missing, which does not resolve`);
    expect(messages[1]).toContain('the file has');
  });

  it('refuses a defective anchor and a segment that holds lines and anchors', () => {
    expect(check(`${MODEL}#1x`)[0]).toContain('defective anchor');
    expect(check(`${MODEL}:3#twice`)[0]).toContain('does not follow the evidence grammar');
    expect(check(`${NOTES}#Heading`)[0]).toContain('is not a .ts file');
  });
});

describe('line citations and anchors', () => {
  const coverage = file('src', 'core', 'coverage', 'rows.ts');
  const rows = (evidence: string): string =>
    `export const ROWS = [\n  {\n    evidence: '${evidence}',\n  },\n];\n`;

  it('counts a line citation and ignores an anchor', () => {
    const texts = new Map([
      [coverage, rows(`${MODEL}:3; ${MODEL}#twice; ${BARREL}#Tally~"x"|twice`)],
    ]);
    const cited = lineCitedPaths(texts);
    expect([...cited.keys()]).toEqual([MODEL]);
    expect(cited.get(MODEL)?.segments).toBe(1);
  });
});
