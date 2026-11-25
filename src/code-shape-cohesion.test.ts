import { describe, expect, it } from 'vitest';
import { analyseFile } from '../scripts/code-shape/cohesion/components.js';
import {
  cohesion,
  GIANT_SHARE,
  HUB_MIN_DECLARATIONS,
  HUB_SHARE,
  MIN_COMPONENT_LINES,
  MIN_DECLARATIONS,
  summariseCohesion,
} from '../scripts/code-shape/cohesion.js';
import { createContextFromSources } from '../scripts/code-shape/context.js';

const body = (lines: number): string =>
  Array.from({ length: lines }, (_, at) => `  total += ${at};`).join('\n');

const fn = (name: string, lines: number, calls: readonly string[] = []): string =>
  [
    `export function ${name}(): number {`,
    '  let total = 0;',
    body(lines),
    ...calls.map((call) => `  total += ${call}();`),
    '  return total;',
    '}',
    '',
  ].join('\n');

const run = (sources: Record<string, string>) => {
  const ctx = createContextFromSources(sources);
  return { ctx, findings: cohesion(ctx) };
};

const PUSH = `export function pushDiag(): number {\n  return 1;\n}\n`;

const PADS = ['pad1', 'pad2', 'pad3'];

const padSource = PADS.map((name) => `export function ${name}(): number {\n  return 1;\n}\n`).join(
  '\n',
);

const cutSource = [
  PUSH,
  padSource,
  fn('alpha', 45, ['pushDiag', 'alphaHelper', ...PADS]),
  fn('alphaHelper', 5, ['pushDiag']),
  fn('beta', 45, ['pushDiag', 'betaHelper']),
  fn('betaHelper', 5, ['pushDiag']),
].join('\n');

describe('the cohesion signal', () => {
  it('has the documented constants', () => {
    expect(HUB_SHARE).toBe(0.3);
    expect(MIN_COMPONENT_LINES).toBe(40);
    expect(GIANT_SHARE).toBe(0.5);
    expect(MIN_DECLARATIONS).toBe(4);
    expect(HUB_MIN_DECLARATIONS).toBe(8);
  });

  it('reports a cut-line for two groups that share only a hub', () => {
    const { findings } = run({ 'src/core/cut.ts': cutSource });
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding).toMatchObject({
      signal: 'cohesion',
      kind: 'cut-line',
      remedy: 'split along the components',
    });
    expect(finding.evidence.hubs).toEqual(['pushDiag']);
    const components = finding.evidence.components as readonly string[];
    expect(components).toHaveLength(2);
    expect(components[0]).toContain('alpha@');
    expect(components[0]).toContain('alphaHelper@');
    expect(components[1]).toContain('beta@');
  });

  it('lists the imports only one component uses', () => {
    const { findings } = run({
      'src/core/dep-a.ts': 'export const a = 1;\n',
      'src/core/dep-b.ts': 'export const b = 1;\n',
      'src/core/cut.ts': [
        `import { a } from './dep-a.js';`,
        `import { b } from './dep-b.js';`,
        cutSource
          .replace('total += 0;', 'total += a;')
          .replace(
            'export function beta(): number {\n  let total = 0;',
            'export function beta(): number {\n  let total = b;',
          ),
      ].join('\n'),
    });
    const components = findings[0]!.evidence.components as readonly string[];
    const all = components.join('\n');
    expect(all).toContain('imports only it uses: ./dep-a.js');
    expect(all).toContain('imports only it uses: ./dep-b.js');
  });

  it('adds giantShare evidence to a cut-line', () => {
    const { findings } = run({ 'src/core/cut.ts': cutSource });
    expect(typeof findings[0]!.evidence.giantShare).toBe('number');
  });

  it('removing the hub changes the component count', () => {
    const ctx = createContextFromSources({ 'src/core/cut.ts': cutSource });
    const entry = analyseFile(ctx.checker, ctx.analysed[0]!)!;
    expect(entry.allComponents).toHaveLength(1);
    expect(entry.components).toHaveLength(2);
    expect(entry.hubs.map((at) => entry.declarations[at]!.name)).toEqual(['pushDiag']);
  });

  it('finds no hub in a file of fewer than 8 declarations', () => {
    const ctx = createContextFromSources({
      'src/core/few.ts': [
        PUSH,
        fn('alpha', 45, ['pushDiag', 'alphaHelper']),
        fn('alphaHelper', 5, ['pushDiag']),
        fn('beta', 45, ['pushDiag', 'betaHelper']),
        fn('betaHelper', 5, ['pushDiag']),
      ].join('\n'),
    });
    const entry = analyseFile(ctx.checker, ctx.analysed[0]!)!;
    expect(entry.declarations).toHaveLength(5);
    expect(entry.hubs).toEqual([]);
    expect(cohesion(ctx)).toEqual([]);
  });

  it('does not report two groups that call each other', () => {
    const { findings } = run({
      'src/core/merged.ts': [
        fn('alpha', 45, ['alphaHelper', 'beta']),
        fn('alphaHelper', 5),
        fn('beta', 45, ['betaHelper']),
        fn('betaHelper', 5),
      ].join('\n'),
    });
    expect(findings).toEqual([]);
  });

  it('reports a giant declaration that calls small helpers', () => {
    const helpers = ['h1', 'h2', 'h3'];
    const { findings } = run({
      'src/core/giant.ts': [
        ...helpers.map((name) => `export function ${name}(): number {\n  return 1;\n}\n`),
        fn('giant', 300, helpers),
      ].join('\n'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'giant-declaration',
      remedy: 'design change inside a declaration',
      evidence: { declaration: 'giant', references: 3 },
    });
    expect(Number(findings[0]!.evidence.giantShare)).toBeGreaterThanOrEqual(0.5);
    expect(String(findings[0]!.evidence.note)).toBe(
      'a split by moving declarations does not separate this declaration; a cut would be inside it',
    );
  });

  it('does not report a giant declaration in a file under 200 lines', () => {
    const { findings } = run({
      'src/core/short.ts': [
        ...['h1', 'h2', 'h3'].map((name) => `export const ${name} = 1;\n`),
        fn('big', 120, ['h1']),
      ].join('\n'),
    });
    expect(findings).toEqual([]);
  });

  it('does not report a small cohesive file', () => {
    const { findings } = run({
      'src/core/small.ts': [
        fn('a', 3, ['b']),
        fn('b', 3, ['c']),
        fn('c', 3, ['d']),
        fn('d', 3),
      ].join('\n'),
    });
    expect(findings).toEqual([]);
  });

  it('does not analyse a file under 4 declarations', () => {
    const { findings } = run({
      'src/core/few.ts': [fn('a', 60), fn('b', 60), fn('c', 60)].join('\n'),
    });
    expect(findings).toEqual([]);
  });

  it('counts a type-only reference as an edge', () => {
    const shape = (name: string): string =>
      `export interface ${name} {\n${Array.from({ length: 14 }, (_, at) => `  p${at}: number;`).join('\n')}\n}\n`;
    const user = (name: string, type: string): string =>
      `export function ${name}(value: ${type}): number {\n  let total = value.p0;\n${body(26)}\n  return total;\n}\n`;
    const { findings } = run({
      'src/core/pair.ts': [
        shape('Left'),
        user('useLeft', 'Left'),
        shape('Right'),
        user('useRight', 'Right'),
        'export const one = 1;\n',
        'export const two = 2;\n',
      ].join('\n'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('cut-line');
    expect(findings[0]!.evidence.components).toHaveLength(2);
  });

  it('summarises the counts of both kinds', () => {
    const { ctx, findings } = run({ 'src/core/cut.ts': cutSource });
    const text = summariseCohesion(ctx, findings).join('\n');
    expect(text).toContain('1 files have a cut-line');
    expect(text).toContain('0 files have a giant declaration');
    expect(text).toContain('files have 4 or more declarations; 1 of them are one component');
    expect(text).toContain('after the hubs (if any) are removed');
  });
});
