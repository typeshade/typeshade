import { describe, expect, it } from 'vitest';
import { checkMove } from '../scripts/move-purity.js';
import { applied, plan } from './core/testing/move-declarations-fixtures.js';

const LIB = `export const helper = (x: number): number => x;\n`;

const OPERATIONS = `import { helper } from './lib.js';

export function one(x: number): number {
  return helper(x) + 1;
}

export function two(x: number): number {
  return one(x) * 2;
}

export type Pair = [number, number];

export function stay(): number {
  return 3;
}
`;

const CONSUMER = `import { one, two, stay, type Pair } from './a.js';\n\nexport const all: Pair = [one(1) + two(2), stay()];\n`;

const SPLIT = { 'src/a.ts': OPERATIONS, 'src/lib.ts': LIB, 'src/consumer.ts': CONSUMER };

const purely = (files: Record<string, string>, result: Awaited<ReturnType<typeof plan>>): void => {
  expect(result.report.findings).toEqual([]);
  expect(checkMove(new Map(Object.entries(files)), applied(files, result)).pure).toBe(true);
};

describe('move-declarations (docs/structure-refactoring-plan.md, S0 item b)', () => {
  it('splits two functions and a type, drops the import the source no longer uses, and leaves consumers alone', async () => {
    const result = await plan(SPLIT, 'src/a.ts', 'src/a/ops.ts', 'one,two,Pair');
    purely(SPLIT, result);
    expect(result.texts.target).toBe(`import { helper } from '../lib.js';

export function one(x: number): number {
  return helper(x) + 1;
}

export function two(x: number): number {
  return one(x) * 2;
}

export type Pair = [number, number];
`);
    expect(result.texts.source).toBe(`export { one, two } from './a/ops.js';
export type { Pair } from './a/ops.js';

export function stay(): number {
  return 3;
}
`);
    expect(result.sourceImportsRemoved).toEqual([`import { helper } from './lib.js';`]);
    expect(result.moved.map((unit) => unit.names[0])).toEqual(['one', 'two', 'Pair']);
    expect(result.sourceLines).toEqual({ before: 15, after: 6, withinLimit: true });
  });

  it('keeps the other files of the program byte for byte', async () => {
    const result = await plan(SPLIT, 'src/a.ts', 'src/a/ops.ts', 'one,two,Pair');
    const head = applied(SPLIT, result);
    expect(head.get('src/consumer.ts')).toBe(CONSUMER);
    expect(head.get('src/lib.ts')).toBe(LIB);
  });

  it('puts the target in the same directory when the path says so, with specifiers unchanged', async () => {
    const result = await plan(SPLIT, 'src/a.ts', 'src/ops.ts', 'one,two,Pair');
    purely(SPLIT, result);
    expect(result.texts.target.startsWith(`import { helper } from './lib.js';\n`)).toBe(true);
    expect(result.texts.source).toContain(`from './ops.js';`);
  });

  it('recomputes relative specifiers for a deeper directory', async () => {
    const result = await plan(SPLIT, 'src/a.ts', 'src/a/deep/ops.ts', 'one,two,Pair');
    purely(SPLIT, result);
    expect(result.targetImports).toEqual([`import { helper } from '../../lib.js';`]);
    expect(result.texts.source).toContain(`from './a/deep/ops.js';`);
  });

  it('prints the plan of a dry run as data and writes nothing of its own', async () => {
    const first = await plan(SPLIT, 'src/a.ts', 'src/a/ops.ts', 'one,two,Pair', '--dry-run');
    const second = await plan(SPLIT, 'src/a.ts', 'src/a/ops.ts', 'one,two,Pair', '--dry-run');
    expect(second).toEqual(first);
    expect(SPLIT['src/a.ts']).toBe(OPERATIONS);
  });

  it('pulls a private helper that only the moved group uses when --closure is given', async () => {
    const files = {
      'src/a.ts': `const STEP = 2;

function scale(x: number): number {
  return x * STEP;
}

export function grow(x: number): number {
  return scale(x) + 1;
}

export function other(): number {
  return 9;
}
`,
    };
    const result = await plan(files, 'src/a.ts', 'src/a/grow.ts', 'grow', '--closure');
    purely(files, result);
    expect(result.moved.map((unit) => [unit.names[0], unit.pulled])).toEqual([
      ['STEP', true],
      ['scale', true],
      ['grow', false],
    ]);
    expect(result.texts.source).toBe(`export { grow } from './a/grow.js';

export function other(): number {
  return 9;
}
`);
    expect(result.texts.target.startsWith('const STEP = 2;')).toBe(true);
  });

  it('exports a private name in the target and imports it back when the source still uses it', async () => {
    const files = {
      'src/a.ts': `function shared(x: number): number {
  return x + 1;
}

export function moved(x: number): number {
  return shared(x);
}

export function kept(x: number): number {
  return shared(x) * 2;
}
`,
      'src/user.ts': `import { kept } from './a.js';\nexport const value = kept(1);\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/a/moved.ts', 'moved,shared');
    purely(files, result);
    expect(result.exportsAdded).toEqual(['shared']);
    expect(result.texts.target).toContain('export function shared(');
    expect(result.texts.source).toContain(`import { shared } from './a/moved.js';`);
    expect(result.texts.source).toContain(`export { moved } from './a/moved.js';`);
    expect(result.texts.source).not.toContain('export { shared');
    expect(result.report.units.exportsAdded.map((unit) => unit.names)).toEqual([['shared']]);
  });

  it('writes import type for a type-only use in the target and in the import back', async () => {
    const files = {
      'src/gadget.ts': `export class Gadget {\n  id = 2;\n}\n`,
      'src/a.ts': `import { Gadget } from './gadget.js';

export interface Shape {
  gadget: Gadget;
}

export function build(): Gadget {
  return new Gadget();
}

export function area(shape: Shape): number {
  return shape.gadget.id;
}
`,
    };
    const result = await plan(files, 'src/a.ts', 'src/a/shape.ts', 'Shape');
    purely(files, result);
    expect(result.texts.target).toBe(`import type { Gadget } from '../gadget.js';

export interface Shape {
  gadget: Gadget;
}
`);
    expect(result.texts.source).toContain(`import type { Shape } from './a/shape.js';`);
    expect(result.texts.source).toContain(`export type { Shape } from './a/shape.js';`);
    expect(result.texts.source).toContain(`import { Gadget } from './gadget.js';`);
  });

  it('keeps an import statement of the source as it is when the move leaves its other names in use', async () => {
    const files = {
      'src/lib.ts': `export const left = (): number => 1;\nexport const right = (): number => 2;\n`,
      'src/a.ts': `import { left, right } from './lib.js';

export function takeLeft(): number {
  return left();
}

export function takeRight(): number {
  return right();
}
`,
    };
    const result = await plan(files, 'src/a.ts', 'src/a/left.ts', 'takeLeft');
    purely(files, result);
    expect(result.texts.source).toContain(`import { right } from './lib.js';`);
    expect(result.texts.target).toContain(`import { left } from '../lib.js';`);
  });

  it('moves every overload signature with its implementation', async () => {
    const files = {
      'src/a.ts': `export function pick(a: string): string;
export function pick(a: number): number;
export function pick(a: string | number): string | number {
  return a;
}

export const KEEP = 1;
`,
    };
    const result = await plan(files, 'src/a.ts', 'src/pick.ts', 'pick');
    purely(files, result);
    expect(result.moved).toHaveLength(3);
    expect(result.texts.source).toBe(
      `export { pick } from './pick.js';\n\nexport const KEEP = 1;\n`,
    );
  });

  it('moves a statement of several declarators whole and refuses to split it', async () => {
    const files = { 'src/a.ts': `export const LOW = 1,\n  HIGH = 2;\n\nexport const MID = 3;\n` };
    const whole = await plan(files, 'src/a.ts', 'src/range.ts', 'LOW,HIGH');
    purely(files, whole);
    expect(whole.texts.source).toContain(`export { LOW, HIGH } from './range.js';`);
    await expect(plan(files, 'src/a.ts', 'src/range.ts', 'LOW')).rejects.toThrow(
      /declared together.*missing HIGH/s,
    );
  });

  it('moves a name that is both a type and a value as one and re-exports it as a value', async () => {
    const files = {
      'src/a.ts': `export type Id = string;

export const Id = (text: string): Id => text;

export const OTHER = 1;
`,
      'src/user.ts': `import { Id } from './a.js';\nexport const made: Id = Id('x');\n`,
    };
    const result = await plan(files, 'src/a.ts', 'src/id.ts', 'Id');
    purely(files, result);
    expect(result.moved).toHaveLength(2);
    expect(result.texts.source).toContain(`export { Id } from './id.js';`);
    expect(result.texts.source).not.toContain('export type');
  });

  it('refuses a default export', async () => {
    const files = { 'src/a.ts': `export default function main(): number {\n  return 1;\n}\n` };
    await expect(plan(files, 'src/a.ts', 'src/main.ts', 'main')).rejects.toThrow(/default export/);
  });
});
