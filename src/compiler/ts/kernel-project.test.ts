// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkCall, type KernelFace } from '../../core/host-kernel.js';
import { packed, projectInputLayout } from '../../core/host-entry.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { projectKernelInputs } from '../../core/passes/kernel-project.js';
import { emitModule } from '../../core/backends/wgsl.js';

const item = 'class Item { a:f32; b:i32; c:u32; unused:f32; }';
function read(body: string, helpers = '', fuse?: boolean, declaration = item) {
  const source = `"use typeshade"; ${declaration} ${helpers}
export function sample(xs:array<Item>,out:array<f32>) { ${body} }`;
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  const editor = createTypeshadeLanguageService();
  editor.openDocument('/app/project.shade.ts', source);
  expect(editor.getDiagnostics('/app/project.shade.ts')).toEqual([]);
  const host = hostFace(source, {
    fileName: '/app/project.shade.ts',
    runtime: 'typeshade/runtime/internal',
    ...(fuse !== undefined ? { fuse } : {}),
  });
  expect(host.diagnostics).toEqual([]);
  const exported = host.exports!.find((e) => e.name === 'sample');
  if (exported?.kind !== 'kernel') throw new Error('Expected a kernel face');
  expect(exported.face.gpu).toBeDefined();
  return { source, result, host, face: exported.face };
}
const one = 'for(let i:u32=0;i<xs.length;i++){out[i]=xs[i].a;}';
const fields = (face: KernelFace) => {
  const l = face.gpu?.projected?.arrays.find((b) => b.name === 'xs')?.layout;
  return l?.k === 'a' && l.e.k === 'o' ? l.e.f.map(([name]) => name) : undefined;
};

describe('private kernel input projection', () => {
  it('reads the packed journey through both halves and keeps its one-loop and two-loop facts distinct', () => {
    const source = readFileSync(
      new URL('../../../journeys/_host-import/src/loops.shade.ts', import.meta.url),
      'utf8',
    );
    const file = '/app/loops.shade.ts';
    expect(compile(source).diagnostics).toEqual([]);
    const editor = createTypeshadeLanguageService();
    editor.openDocument(file, source);
    expect(editor.getDiagnostics(file)).toEqual([]);
    const host = hostFace(source, { fileName: file });
    expect(host.diagnostics).toEqual([]);
    for (const [name, loops] of [
      ['layoutMap', 1],
      ['layoutRead', 2],
    ] as const) {
      const exported = host.exports?.find((e) => e.name === name);
      if (exported?.kind !== 'kernel') throw new Error('Expected a kernel face');
      expect(exported.face.fuse?.facts).toHaveLength(loops);
      expect(fields(exported.face)).toEqual(['f0', 'f3']);
    }
  });

  it('packs live fields in declaration order and keeps the logical type and external emit', () => {
    const { face, result, host } = read(
      'for(let i:u32=0;i<xs.length;i++){out[i]=f32(xs[i].c)+xs[i].a;}',
    );
    expect(fields(face)).toEqual(['a', 'c']);
    const logical = face.params[0];
    expect(logical.k === 'array' && logical.layout.st).toBe(16);
    const physical = face.gpu!.projected!.arrays[0]!;
    expect(physical.layout.k === 'a' && physical.layout.st).toBe(8);
    const input = [{ a: 1.25, b: -9, c: 7, unused: 100 }];
    expect([...new Uint32Array(packed(physical, input))]).toEqual([0x3fa00000, 7]);
    expect(input[0]!.unused).toBe(100);
    expect(result.wgsl).not.toContain('Item_projected');
    expect(face.gpu!.wgsl).not.toContain('Item_projected');
    expect(face.gpu!.projected!.wgsl).toContain('array<Item_projected>');
    expect(host.view).toContain('unused: number');
  });

  it('retains field read order and checks unused values during physical packing', () => {
    const { face } = read(one);
    const logical = face.params[0];
    if (logical.k !== 'array') throw new Error('Expected an array');
    const physical = face.gpu!.projected!.arrays[0]!;
    projectInputLayout(logical.layout, physical.layout);
    const reads: string[] = [];
    const value = Object.fromEntries(['a', 'b', 'c', 'unused'].map((name) => [name, 1]));
    for (const name of Object.keys(value))
      Object.defineProperty(value, name, {
        get: () => {
          reads.push(name);
          return 1;
        },
      });
    packed(face.gpu!.arrays[0]!, [value]);
    const before = reads.splice(0);
    expect(packed(physical, [value]).byteLength).toBe(4);
    expect(reads).toEqual(before);
    expect(reads).toEqual(['a', 'b', 'c', 'unused']);
    let lengths = 0;
    const rows = new Proxy([value], {
      get: (target, name, receiver) => {
        if (name === 'length') lengths++;
        return Reflect.get(target, name, receiver);
      },
    });
    packed(face.gpu!.arrays[0]!, rows);
    const originalLengths = lengths;
    lengths = 0;
    packed(physical, rows);
    expect(lengths).toBe(originalLengths);
    expect(() => packed(physical, [{ a: 1, b: 2, c: 3, unused: 'bad' }])).toThrow();
  });

  it.each([
    'class Item { a:f32; other:vec3f; }',
    'class Inner { value:f32; } class Item { a:f32; other:Inner; }',
  ])('keeps unsupported element layouts intact', (declaration) => {
    expect(fields(read(one, '', false, declaration).face)).toBeUndefined();
  });

  it('unions field reads across loops, conditions and transitive by-value helpers', () => {
    const { face } = read(
      `${one} for(let j:u32=0;j<out.length;j++){out[j]=out[j]+read(xs[j]);}`,
      'function inner(p:Item):f32{return f32(p.c);} function read(p:Item):f32{return inner(p);}',
    );
    expect(fields(face)).toEqual(['a', 'c']);
    expect(face.gpu!.projected!.wgsl).toContain('Item(');
    expect(face.gpu!.loops).toHaveLength(2);
  });

  it.each([
    [
      'all fields',
      'for(let i:u32=0;i<xs.length;i++){out[i]=xs[i].a+f32(xs[i].b)+f32(xs[i].c)+xs[i].unused;}',
      '',
    ],
    ['no live field', 'for(let i:u32=0;i<xs.length;i++){out[i]=1.;}', ''],
    ['whole-value alias', 'for(let i:u32=0;i<xs.length;i++){const x=xs[i];out[i]=x.a;}', ''],
    [
      'helper returns its value',
      'for(let i:u32=0;i<xs.length;i++){out[i]=identity(xs[i]).a;}',
      'function identity(p:Item):Item{return p;}',
    ],
    [
      'index call',
      'for(let i:u32=0;i<xs.length;i++){out[i]=xs[index(i)].a;}',
      'function index(i:u32):u32{return i;}',
    ],
    ['writes object fields', 'for(let i:u32=0;i<xs.length;i++){xs[i].a=2.;out[i]=xs[i].a;}', ''],
  ])('keeps full AoS for %s', (_name, body, helper) => {
    expect(fields(read(body, helper).face)).toBeUndefined();
  });

  it.each([undefined, true, false])(
    'keeps ordinary projection independent of the fuse option %s (0085)',
    (fuse) => {
      const { face } = read(one, '', fuse);
      expect(fields(face)).toEqual(['a']);
      expect(face.fuse !== undefined).toBe(fuse !== false);
      expect(face.gpu!.arrays[0]!.layout).toMatchObject({ k: 'a', st: 16 });
      expect(face.gpu!.projected!.arrays[0]!.layout).toMatchObject({ k: 'a', st: 4 });
      expect(face.gpu!.wgsl).not.toContain('Item_projected');
      if (face.fuse) expect(JSON.stringify(face.fuse)).not.toContain('Item_projected');
    },
  );

  it('validates unused fields and empty inputs with the logical layout', () => {
    const { face } = read(one);
    expect(fields(face)).toEqual(['a']);
    // Shape checks precede ranges and all device activity on every tier.
    const k = { ...face, gpu: undefined };
    const cpu = { F: {}, $: { bindings: {}, vars: {} } };
    for (const invalid of [undefined, 'bad', null])
      expect(() =>
        checkCall(cpu, k, 2, [[{ a: 1, b: 2, c: 3, unused: invalid }], new Float32Array(1)]),
      ).toThrow(/unused/);
    expect(() => checkCall(cpu, k, 2, [[], new Float32Array(0)])).toThrow(/empty array/);
  });

  it('projects reduction inputs without changing the original plan', () => {
    const source = `"use typeshade"; ${item} export function total(xs:array<Item>):f32{let sum=0.;for(let i:u32=0;i<xs.length;i++){sum+=xs[i].a;}return sum;}`;
    const c = compile(source);
    expect(c.diagnostics).toEqual([]);
    const editor = createTypeshadeLanguageService();
    editor.openDocument('total.shade.ts', source);
    expect(editor.getDiagnostics('total.shade.ts')).toEqual([]);
    const f = c.module.funcs.find((f) => f.name === 'total')!;
    const plan = lowerKernel(f, c.module, proveKernels(c.module)[0]!);
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const before = emitModule(plan.module);
    const projected = projectKernelInputs(plan, f)!;
    expect(projected).toBeDefined();
    expect(plan.loops[0]!.reduce).toBeDefined();
    expect(emitModule(projected)).toContain('Item_projected');
    expect(emitModule(plan.module)).toBe(before);
  });
});
