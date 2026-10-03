// Verifies: Rule 8.9, Rule 8.21 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { wgslLayout } from '../../core/reflect.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function program(body: string) {
  const source = `"use typeshade";\n${body}`;
  const r = compile(source);
  expect(r.diagnostics).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('fieldless.shade.ts', source);
  expect(
    service.getDiagnostics('fieldless.shade.ts').filter((d) => d.severity === 'error'),
  ).toEqual([]);
  return r;
}

describe('fieldless classes', () => {
  it('keeps CPU and host values empty while the GPU has a carrier', () => {
    const r = program(`class Empty {}
export function make(): Empty { return new Empty(); }
export function accept(e: Empty): Empty { return e; }
@fragment export function fs(): vec4 { const e = new Empty(); return vec4(1.); }`);
    expect(r.module.structs.find((s) => s.name === 'Empty')!.fields).toEqual([]);
    expect(r.eval('make')).toEqual({});
    expect(r.eval('accept', [{}])).toEqual({});
    expect(r.wgsl).toContain('_empty: u32');
    expect(r.glsl!.fragment).toContain('#version 300 es');
  });

  it('dispatches methods, getters and this calls, including construction effects', () => {
    const r = program(`let count: f32 = 0.;
class Scene {
  constructor() { count = count + 1.; }
  get unit(): f32 { return 2.; }
  add(x: f32): f32 { return x + this.unit; }
  value(x: f32): f32 { return this.add(x); }
  same(): this { return this; }
}
export function answer(): f32 { const s = new Scene(); return s.same().value(3.) + count; }`);
    expect(r.eval('answer')).toBe(6);
  });

  it('inherits empty bases without injecting their carrier into real source fields', () => {
    const r = program(`class Base { value(): f32 { return 2.; } }
class Empty extends Base { value(): f32 { return super.value() + 1.; } }
class Data extends Empty { x: f32 = 4.; value(): f32 { return super.value() + this.x; } }
class Again extends Data {}
export function answer(): f32 { return new Empty().value() + new Again().value(); }`);
    expect(r.eval('answer')).toBe(10);
    expect(r.module.structs.find((s) => s.name === 'Again')!.fields.map((f) => f.name)).toEqual([
      'x',
    ]);
  });

  it('constructs static-only, namespace and generic fieldless classes', () => {
    const r = program(`class Util { static unit(): f32 { return 2.; } }
namespace N { export class Empty<T> { value(x: T): T { return x; } } }
export function answer(): f32 { const u: Util = new Util(); const e = new N.Empty<f32>(); return e.value(Util.unit()); }`);
    expect(r.eval('answer')).toBe(2);
    expect(r.module.structs.find((s) => s.name === 'Util')!.fields).toEqual([]);
  });

  it('assigns memory footprint without exposing a generated field in reflection', () => {
    const r = program(`class Empty {}
class Values { head: f32; item: Empty; items: array<Empty, 2>; tail: f32; }
export function consume(v: Values): f32 { return v.head + v.tail; }`);
    const structs = new Map(r.module.structs.map((s) => [s.name, s]));
    const empty = structs.get('Empty')!;
    expect(wgslLayout(empty, 'std430', structs)).toEqual({
      name: 'Empty',
      size: 4,
      align: 4,
      fields: [],
    });
    expect(wgslLayout(empty, 'std140', structs)).toEqual({
      name: 'Empty',
      size: 16,
      align: 16,
      fields: [],
    });
    expect(
      wgslLayout(structs.get('Values')!, 'std430', structs).fields.map((f) => f.offset),
    ).toEqual([0, 4, 8, 16]);
    expect(
      wgslLayout(structs.get('Values')!, 'std140', structs).fields.map((f) => f.offset),
    ).toEqual([0, 16, 32, 64]);
  });

  it('constructs fieldless mixins and inherited static factories', () => {
    const r = program(`class Base { value(): f32 { return 2.; } }
function More<TBase extends AnyClass>(Base: TBase) {
  return class extends Base { extra(): f32 { return 3.; } };
}
class Mixed extends More(Base) {}
class Factory {
  static make<C extends Factory>(this: { new (): C }): C { return new this(); }
}
class Derived extends Factory {}
export function emptyDerived(): Derived { return Derived.make(); }
export function answer(): f32 { const f = Derived.make(); const m = new Mixed(); return m.value() + m.extra(); }`);
    expect(r.eval('answer')).toBe(5);
    expect(r.eval('emptyDerived')).toEqual({});
  });

  it('keeps a generated carrier inaccessible from source', () => {
    const r = compile(
      `"use typeshade"; class Empty {} export function wrong(e: Empty): u32 { return e._empty; }`,
    );
    expect(r.diagnostics.some((d) => d.message.includes('Unknown field "_empty"'))).toBe(true);
  });
});
