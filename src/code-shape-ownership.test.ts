import { describe, expect, it } from 'vitest';
import { createContextFromSources } from '../scripts/code-shape/context.js';
import { ownership, summariseOwnership } from '../scripts/code-shape/ownership.js';

const SYMBOL = [
  'export interface Sym {',
  '  emitted: string;',
  '  emittedGlsl?: string;',
  '  size: number;',
  '}',
  '',
].join('\n');

const run = (sources: Record<string, string>) => {
  const ctx = createContextFromSources(sources);
  return { ctx, findings: ownership(ctx) };
};

const ofKind = (findings: ReturnType<typeof ownership>, kind: string) =>
  findings.filter((finding) => finding.kind === kind);

describe('ownership: no-owner-function', () => {
  it('reports a function that selects between two fields of its one object parameter', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/names.ts': [
        `import type { Sym } from './sym.js';`,
        `export function glslNameOf(sym: Sym): string {`,
        `  return sym.emittedGlsl ?? sym.emitted;`,
        `}`,
        '',
      ].join('\n'),
    });
    const [hit, ...rest] = ofKind(findings, 'no-owner-function');
    expect(rest).toEqual([]);
    expect(hit).toMatchObject({
      file: 'src/names.ts',
      line: 2,
      remedy: 'give the rule to its owner',
      evidence: {
        function: 'glslNameOf',
        parameterType: 'Sym',
        declaredAt: 'src/sym.ts:1',
        members: ['emitted', 'emittedGlsl'],
        bodyLines: 3,
      },
    });
  });

  it('reports an arrow constant that destructures its parameter', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/area.ts': [
        `import type { Sym } from './sym.js';`,
        `export const doubled = ({ size }: Sym): number => size * 2;`,
        '',
      ].join('\n'),
    });
    expect(ofKind(findings, 'no-owner-function').map((f) => f.evidence.function)).toEqual([
      'doubled',
    ]);
  });

  it('keeps out a predicate over a primitive parameter', () => {
    const { findings } = run({
      'src/spec.ts': [
        `export function isRelativeSpecifier(specifier: string): boolean {`,
        `  return specifier.startsWith('.');`,
        `}`,
        '',
      ].join('\n'),
    });
    expect(ofKind(findings, 'no-owner-function')).toEqual([]);
  });

  it('keeps out a function that reads another symbol of the module', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/names.ts': [
        `import type { Sym } from './sym.js';`,
        `const PREFIX = 'v_';`,
        `export function prefixed(sym: Sym): string {`,
        `  return PREFIX + sym.emitted;`,
        `}`,
        `export function viaHelper(sym: Sym): string {`,
        `  return prefixed(sym);`,
        `}`,
        '',
      ].join('\n'),
    });
    expect(ofKind(findings, 'no-owner-function')).toEqual([]);
  });

  it('keeps out a function that reads an imported value', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/limit.ts': `export const LIMIT = 4;\n`,
      'src/names.ts': [
        `import type { Sym } from './sym.js';`,
        `import { LIMIT } from './limit.js';`,
        `export function tooBig(sym: Sym): boolean {`,
        `  return sym.size > LIMIT;`,
        `}`,
        '',
      ].join('\n'),
    });
    expect(ofKind(findings, 'no-owner-function')).toEqual([]);
  });
});

describe('ownership: repeated-choice', () => {
  const choice = (name: string, variable: string, body: string): string =>
    [
      `import type { Sym } from './sym.js';`,
      `export function ${name}(${variable}: Sym, other: number): string {`,
      `  return (${body}) + other;`,
      `}`,
      '',
    ].join('\n');

  it('reports one pair written at two sites in two files with two variables', () => {
    const { findings, ctx } = run({
      'src/sym.ts': SYMBOL,
      'src/one.ts': choice('one', 'left', 'left.emittedGlsl ?? left.emitted'),
      'src/two.ts': choice(
        'two',
        'right',
        'right.emittedGlsl !== undefined ? right.emittedGlsl : right.emitted',
      ),
    });
    const hits = ofKind(findings, 'repeated-choice');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.evidence).toMatchObject({
      type: 'Sym',
      declaredAt: 'src/sym.ts:1',
      first: 'emittedGlsl',
      second: 'emitted',
      siteCount: 2,
      files: 2,
      sites: ['src/one.ts:3', 'src/two.ts:3'],
    });
    expect(summariseOwnership(ctx, findings).join('\n')).toContain('1 pairs occur at two or more');
  });

  it('counts the logical-or form as the same choice', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/one.ts': choice('one', 'left', 'left.emittedGlsl ?? left.emitted'),
      'src/two.ts': choice('two', 'right', 'right.emittedGlsl || right.emitted'),
    });
    expect(ofKind(findings, 'repeated-choice')).toHaveLength(1);
  });

  it('keeps a single-site choice out of the findings and counts it in the summary', () => {
    const { findings, ctx } = run({
      'src/sym.ts': SYMBOL,
      'src/one.ts': choice('one', 'left', 'left.emittedGlsl ?? left.emitted'),
    });
    expect(ofKind(findings, 'repeated-choice')).toEqual([]);
    expect(summariseOwnership(ctx, findings).join('\n')).toContain(
      '1 pairs occur at a single site',
    );
  });

  it('keeps apart choices on different objects of one expression text', () => {
    const { findings } = run({
      'src/sym.ts': SYMBOL,
      'src/one.ts': [
        `import type { Sym } from './sym.js';`,
        `export const pick = (a: Sym, b: Sym): string => a.emittedGlsl ?? b.emitted;`,
        `export const again = (a: Sym, b: Sym): string => a.emittedGlsl ?? b.emitted;`,
        '',
      ].join('\n'),
    });
    expect(ofKind(findings, 'repeated-choice')).toEqual([]);
  });
});

describe('ownership: tiny-file', () => {
  it('reports a tiny file of one declaration that one file imports', () => {
    const { findings } = run({
      'src/tiny.ts': `export const ANSWER = 42;\n`,
      'src/user.ts': `import { ANSWER } from './tiny.js';\nexport const twice = ANSWER * 2;\n`,
    });
    const hits = ofKind(findings, 'tiny-file');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      file: 'src/tiny.ts',
      evidence: { lines: 1, declaration: 'ANSWER', importer: 'src/user.ts' },
    });
  });

  it('keeps out a facade file', () => {
    const { findings } = run({
      'src/tiny.ts': `export const ANSWER = 42;\n`,
      'src/facade.ts': `export { ANSWER } from './tiny.js';\n`,
      'src/user.ts': `import { ANSWER } from './facade.js';\nexport const twice = ANSWER * 2;\n`,
    });
    expect(ofKind(findings, 'tiny-file').map((f) => f.file)).toEqual(['src/tiny.ts']);
  });

  it('keeps out index.ts', () => {
    const { findings } = run({
      'src/dir/index.ts': `export const ANSWER = 42;\n`,
      'src/user.ts': `import { ANSWER } from './dir/index.js';\nexport const twice = ANSWER * 2;\n`,
    });
    expect(ofKind(findings, 'tiny-file')).toEqual([]);
  });

  it('keeps out a tiny file with two importers', () => {
    const { findings } = run({
      'src/tiny.ts': `export const ANSWER = 42;\n`,
      'src/a.ts': `import { ANSWER } from './tiny.js';\nexport const a = ANSWER;\n`,
      'src/b.ts': `import { ANSWER } from './tiny.js';\nexport const b = ANSWER;\n`,
    });
    expect(ofKind(findings, 'tiny-file')).toEqual([]);
  });
});
