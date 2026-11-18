import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const module = (body: string): string => `"use typeshade";\n${body}\n`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

describe('a read under a guard on the counter is checked over the iterations the guard keeps (#997)', () => {
  // Rule 11.8, Rule 8.22: the call checks a read at `a*i + c` against the array's length before
  // it dispatches (#655). It took the counter's whole range for the range of the read, so a loop
  // that reads `xs` only under `if (i < 4)` was refused for the indices the guard keeps out, with
  // a `TypeError` at the call and nothing in the compiler or the editor.
  const padTo = (
    guard: string,
    extra = '',
  ): string => `export function padTo(out: array<f32>, xs: array<f32>${extra}): void {
  for (let i: u32 = 0; i < 8; i++) {
    let v = 0.;
    if (${guard}) {
      v = xs[i];
    }
    out[i] = v;
  }
}`;
  const plain = `export function padTo(out: array<f32>, xs: array<f32>): void {
  for (let i: u32 = 0; i < 8; i++) {
    out[i] = xs[i];
  }
}`;

  /** The plan of the GPU loops, as the plugin writes it into the generated module. */
  const gpu = (body: string) => {
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    return kernel?.kind === 'kernel' ? kernel.face.gpu : undefined;
  };
  const checksOf = (body: string) => gpu(body)?.loops[0]?.checks.filter((c) => c.param === 'xs');

  it('accepts the loop of the issue in both halves, and the guard stays in the GPU loop', () => {
    const body = padTo('i < 4');
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    expect(gpu(body)?.loops).toHaveLength(1);
    expect(gpu(body)?.wgsl).toContain('if ((i < 4u)) {\n    v = xs[i];');
  });

  it('plans the check of the read with the guard as a function of the host', () => {
    expect(checksOf(padTo('i < 4'))).toEqual([
      { param: 'xs', a: 1, c: 0, read: true, guards: [{ cop: '<', fn: 'padTo__guard0_0' }] },
    ]);
    expect(checksOf(padTo('i >= 2 && i < n', ', n: u32'))).toEqual([
      {
        param: 'xs',
        a: 1,
        c: 0,
        read: true,
        guards: [
          { cop: '>=', fn: 'padTo__guard0_0' },
          { cop: '<', fn: 'padTo__guard0_1' },
        ],
      },
    ]);
  });

  it('plans a loop that reads with no guard as it planned it', () => {
    expect(checksOf(plain)).toEqual([{ param: 'xs', a: 1, c: 0, read: true }]);
    expect(checksOf(padTo('n > 2', ', n: u32'))).toEqual([{ param: 'xs', a: 1, c: 0, read: true }]);
  });

  it('leaves out a bound the host cannot compute, which reads an element of an array', () => {
    // The call knows an array by its length, so `ys[0]` is a number only the device holds.
    const body = padTo('i < ys[0]', ', ys: array<u32>');
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    expect(checksOf(body)).toEqual([{ param: 'xs', a: 1, c: 0, read: true }]);
  });

  it('gives on the CPU oracle what a plain loop gives', () => {
    const r = compile(module(padTo('i < 4')), { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const cpu = compileModule(r.module, { precision: 'f32' });
    const xs = [1, 2, 3, 4];
    const out = new Array<number>(8).fill(9);
    cpu.fns.padTo!(out as never, xs as never);
    const want = Array.from({ length: 8 }, (_, i) => (i < 4 ? xs[i]! : 0));
    expect(out).toEqual(want);
  });
});
