// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.1 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { describeRead } from './kernel-loops.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { groupCalls } from '../../core/fuse-group.js';
import type { KernelFace } from '../../core/host-kernel.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/app/main.shade.ts';
const D = '"use typeshade";\n';
const CLASSES = `class Base { static OFFSET: u32 = 1; }
class Derived extends Base {}
class Sibling extends Base {}`;

function check(body: string, expected: string[] = [], files: Record<string, string> = {}) {
  const source = D + body;
  const options = { fileName: FILE, readDocument: (name: string) => files[name] };
  const result = compile(source, options);
  expect(result.diagnostics.map((d) => `${d.category} ${d.code} ${d.message}`)).toEqual(expected);
  const service = createTypeshadeLanguageService(options);
  service.openDocument(FILE, source);
  expect(
    service.getDiagnostics(FILE).map((d) => `${d.severity} ${String(d.code)} ${d.message}`),
  ).toEqual(expected);
  return result;
}

function reads(result: ReturnType<typeof compile>, name = 'read'): (string | undefined)[] {
  const fn = result.module.funcs.find((f) => f.name === name)!;
  const loop = proveKernels(result.module).find((p) => p.fn === name)!.loops[0]!;
  if (!loop.ok) throw new Error('expected an independent loop');
  return loop.reads.map((read) => describeRead(fn, read)?.text);
}

const reading = (declaration: string, expression: string) => `${declaration}
export function read(out: array<f32>, a: array<f32>, b: array<f32>, c: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = ${expression};
  }
}`;

describe('inherited static reads keep their written receiver (#987)', () => {
  it.each(['constant', 'mutable'])('distinguishes three receivers of one %s binding', (kind) => {
    const declaration =
      CLASSES + (kind === 'mutable' ? '\nfunction bump(): void { Base.OFFSET += 1; }' : '');
    const r = check(
      reading(declaration, 'a[i + Base.OFFSET] + b[i + Derived.OFFSET] + c[i + Sibling.OFFSET]'),
    );
    expect(reads(r)).toEqual([
      'a[i + Base.OFFSET]',
      'b[i + Derived.OFFSET]',
      'c[i + Sibling.OFFSET]',
    ]);
    // These are three written names for one storage slot, not three declarations.
    const bindings = kind === 'constant' ? r.module.consts : r.module.vars;
    expect(bindings?.filter((b) => b.name.endsWith('_OFFSET')).map((b) => b.name)).toEqual([
      'Base_OFFSET',
    ]);
  });

  it.each(['constant', 'mutable'])(
    'uses both receivers in the exact %s TS8070 sentence',
    (kind) => {
      const declaration =
        CLASSES + (kind === 'mutable' ? '\nfunction bump(): void { Base.OFFSET += 1; }' : '');
      const body = `${declaration}
export function read(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = a[i + Base.OFFSET + Derived.OFFSET];
  }
}`;
      const line = body.split('\n').findIndex((l) => l.includes('a[i] =')) + 2;
      check(body, [
        `warning TS8070 This loop runs on the CPU because line ${line} reads "a[i + Base.OFFSET + Derived.OFFSET]", which another iteration writes. Read from an array the loop does not write.`,
      ]);
    },
  );

  it('keeps a namespace import and an imported alias in the same linked function', () => {
    const files = {
      '/app/lib.shade.ts': `${D}export class Base { static OFFSET: u32 = 1; }
export class Derived extends Base {}`,
    };
    const r = check(
      reading(
        `import { Base, Derived as Alias } from './lib.shade.ts';
import * as Ns from './lib.shade.ts';`,
        'a[i + Base.OFFSET] + b[i + Alias.OFFSET] + c[i + Ns.Derived.OFFSET]',
      ),
      [],
      files,
    );
    expect(reads(r)).toEqual([
      'a[i + Base.OFFSET]',
      'b[i + Alias.OFFSET]',
      'c[i + Ns.Derived.OFFSET]',
    ]);
  });

  it('retains the read through array callback inlining and local renaming', () => {
    const r = check(`${CLASSES}
export function read(out: array<f32>, a: array<f32>, b: array<f32>) {
  const index: u32 = 0;
  a.forEach((x: f32, i: i32): void => {
    const index = u32(i);
    out[index] = b[index + Derived.OFFSET] + x;
  });
}`);
    expect(reads(r)).toContain('b[index + Derived.OFFSET]');
  });

  it('keeps shared mutable storage and emitted shader text unchanged', () => {
    const body = `${CLASSES}
export function run(): u32 {
  Base.OFFSET += 2;
  Base.OFFSET += 3;
  return Base.OFFSET + Derived.OFFSET + Sibling.OFFSET;
}`;
    const original = check(body);
    const canonical = check(
      body.replaceAll('Derived.OFFSET', 'Base.OFFSET').replaceAll('Sibling.OFFSET', 'Base.OFFSET'),
    );
    expect(original.eval('run')).toBe(18);
    expect(original.wgsl).toBe(canonical.wgsl);
    expect(original.glsl).toEqual(canonical.glsl);
  });

  it('carries each spelling through the generated fusion facts into the planner report', () => {
    const body =
      reading(CLASSES, 'a[i + Base.OFFSET] + b[i + Derived.OFFSET] + c[i + Sibling.OFFSET]') +
      `
export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = 1.; }
}`;
    check(body);
    const face = hostFace(D + body, { fileName: FILE });
    expect(face.diagnostics).toEqual([]);
    const kernel = (name: string): KernelFace => {
      const found = face.exports!.find((e) => e.name === name)!;
      if (found.kind !== 'kernel') throw new Error('expected a kernel');
      // This is how the generated JavaScript transports the facts to the runtime.
      return JSON.parse(JSON.stringify(found.face)) as KernelFace;
    };
    const read = kernel('read');
    const fill = kernel('fill');
    expect(face.code).toContain('b[i + Derived.OFFSET]');
    const arrays = [{}, {}, {}, {}];
    for (const [index, receiver] of ['Base', 'Derived', 'Sibling'].entries()) {
      const report = groupCalls(
        [
          { k: fill, arrays: [arrays[index + 1]], range: { start: 0, n: 8 }, tier: 'webgpu' },
          { k: read, arrays, range: { start: 0, n: 8 }, tier: 'webgpu' },
        ],
        8,
      );
      const array = ['a', 'b', 'c'][index];
      expect(report[1]!.why).toBe(
        `fill and read run as two dispatches because read reads \`${array}[i + ${receiver}.OFFSET]\` (line 7)`,
      );
    }
  });
});
