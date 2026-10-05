// Verifies: Rule 8.9 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const material = `class Material {
  value: f32;
  constructor(value: f32) { this.value = value; }
  response(): f32 { return this.value * 2.; }
}
class LeafMaterial extends Material {
  extra: f32;
  constructor(value: f32, extra: f32) { super(value); this.extra = extra; }
  transmission(): f32 { return this.extra; }
}
`;
const shader = (head: string, body: string) => `"use typeshade";
${head}
@fragment
export function fs(): vec4 { ${body} }
`;

function agrees(source: string, result: number[]): ReturnType<typeof compile> {
  const compiled = compile(source);
  expect(compiled.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(compiled.wgsl).not.toBe('');
  expect(compiled.glsl?.fragment).not.toBe('');
  for (const run of [compileModule, compileModuleJs])
    expect(run(compiled.module).fns.fs!(), run.name).toEqual(result);
  return compiled;
}

function refused(source: string): void {
  const compiled = compile(source);
  expect(compiled.diagnostics.some((d) => d.category === 'error')).toBe(true);
  expect(compiled.diagnostics.map((d) => d.message).join('\n')).toContain('derived value');
  expect(compiled.wgsl).toBeUndefined();
}

describe('a proven read-only base view', () => {
  it('accepts the original Material/LeafMaterial constructor argument shape', () => {
    agrees(
      shader(
        `${material}
class Leaf {
  material: Material;
  constructor(material: Material) { this.material = material; }
}
`,
        `const value = new LeafMaterial(3., 9.);
const leaf = new Leaf(value);
return vec4(leaf.material.response(), value.transmission(), 0., 1.);`,
      ),
      [6, 9, 0, 1],
    );
  });

  it('applies one conversion in declarations, assignments, returns and arguments', () => {
    agrees(
      shader(
        `${material}
function returned(): Material { return new LeafMaterial(4., 8.); }
function consume(m: Material): f32 { return m.response(); }
`,
        `const derived = new LeafMaterial(3., 9.);
const declared: Material = derived;
let assigned: Material = new Material(1.);
assigned = derived;
return vec4(declared.response(), assigned.response(), consume(derived), returned().response());`,
      ),
      [6, 6, 6, 8],
    );
  });

  it('converts field initializers and contextual object and array elements', () => {
    agrees(
      shader(
        `${material}
class Holder {
  material: Material = new LeafMaterial(5., 8.);
}
interface Pair { first: Material; second: Material; }
`,
        `const d = new LeafMaterial(3., 9.);
const pair: Pair = { first: d, second: new LeafMaterial(4., 7.) };
const values: array<Material, 2> = [d, new LeafMaterial(6., 10.)];
const holder = new Holder();
return vec4(pair.first.response(), pair.second.response(), values[1].response(), holder.material.response());`,
      ),
      [6, 8, 12, 10],
    );
  });

  it('evaluates a side-effecting factory once and retains argument order', () => {
    const source = shader(
      `${material}
let count: f32 = 0.;
function factory(): LeafMaterial {
  count += 1.;
  return new LeafMaterial(count, count + 10.);
}
function next(): f32 { count += 1.; return count; }
function consume(a: f32, m: Material, c: f32): vec4 {
  return vec4(a, m.response(), c, count);
}
`,
      'return consume(next(), factory(), next());',
    );
    agrees(source, [1, 4, 3, 3]);
  });

  it('accepts fieldless classes and transitive inherited read methods', () => {
    agrees(
      shader(
        `class Empty { value(): f32 { return 3.; } }
class Middle extends Empty {}
class Derived extends Middle { other(): f32 { return 9.; } }
`,
        `const derived = new Derived(); const base: Empty = derived;
return vec4(base.value(), 0., 0., 1.);`,
      ),
      [3, 0, 0, 1],
    );
  });

  it('agrees with the editor without hiding TypeScript errors', () => {
    const source = shader(
      material,
      `const d = new LeafMaterial(3., 9.);
const base: Material = d; return vec4(base.response(), 0., 0., 1.);`,
    );
    agrees(source, [6, 0, 0, 1]);
    const service = createTypeshadeLanguageService();
    service.openDocument('view.shade.ts', source);
    expect(
      service.getHover(
        'view.shade.ts',
        service.positionAt('view.shade.ts', source.indexOf('= d;') + 2),
      )?.contents,
    ).toContain('LeafMaterial');
    expect(service.getDiagnostics('view.shade.ts').filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });

  it('uses namespace and generic ancestry without changing the declared field type', () => {
    agrees(
      shader(
        `class Base { x: f32 = 2.; value(): f32 { return this.x; } }
namespace N {
export class Derived extends Base { y: f32 = 3.; }
}
class Box<T> { x: T; constructor(x: T) { this.x = x; } value(): T { return this.x; } }
class FloatBox extends Box<f32> { y: f32 = 4.; }
`,
        `const n: Base = new N.Derived();
const box: Box<f32> = new FloatBox(5.);
return vec4(n.value(), box.value(), 0., 1.);`,
      ),
      [2, 5, 0, 1],
    );
  });

  it('does not collide with an authored helper name', () => {
    agrees(
      shader(
        `${material}
function LeafMaterial_as_Material(x: f32): f32 { return x + 1.; }
`,
        `const d: Material = new LeafMaterial(3., 9.);
return vec4(d.response(), LeafMaterial_as_Material(10.), 0., 1.);`,
      ),
      [6, 11, 0, 1],
    );
  });

  it('does not confuse a shadowing unrelated receiver with the source declaration', () => {
    agrees(
      shader(
        `${material}
class Other { value: f32; constructor() { this.value = 1.; } }
function shadow(): f32 { const source = new Other(); source.value = 10.; return source.value; }
`,
        `const source = new LeafMaterial(3., 9.);
const base: Material = source;
return vec4(base.response(), shadow(), source.transmission(), 1.);`,
      ),
      [6, 10, 9, 1],
    );
  });
});

describe('an unsafe base view keeps a truthful refusal', () => {
  it('rejects a direct override', () => {
    refused(
      shader(
        `class Base { x: f32 = 1.; value(): f32 { return this.x; } }
class Derived extends Base { value(): f32 { return 2.; } }
`,
        'const b: Base = new Derived(); return vec4(b.value());',
      ),
    );
  });

  it('rejects an override called indirectly by an inherited method', () => {
    refused(
      shader(
        `class Base { x: f32 = 1.; inner(): f32 { return this.x; }
outer(): f32 { return this.inner(); } }
class Derived extends Base { inner(): f32 { return 2.; } }
`,
        'const b: Base = new Derived(); return vec4(b.outer());',
      ),
    );
  });

  it('rejects an accessor override', () => {
    refused(
      shader(
        `class Base { x: f32 = 1.; get value(): f32 { return this.x; } }
class Derived extends Base { get value(): f32 { return 2.; } }
`,
        'const b: Base = new Derived(); return vec4(b.value);',
      ),
    );
  });

  it('rejects receiver mutation and a receiver returned by a method', () => {
    refused(
      shader(
        `class Base { x: f32 = 1.; bump(): f32 { this.x += 1.; return this.x; } }
class Derived extends Base { y: f32 = 2.; }
`,
        'const b: Base = new Derived(); return vec4(b.x);',
      ),
    );
    refused(
      shader(
        `class Base { x: f32 = 1.; self(): Base { return this; } }
class Derived extends Base { y: f32 = 2.; }
`,
        'const b: Base = new Derived(); return vec4(b.x);',
      ),
    );
  });

  it('rejects a later source write and a write through its alias', () => {
    for (const write of ['source.value = 8.;', 'const alias = source; alias.value = 8.;'])
      refused(
        shader(
          material,
          `const source = new LeafMaterial(3., 9.);
const b: Material = source; ${write} return vec4(b.response());`,
        ),
      );
  });

  it('rejects a mutation through an escaped parameter', () => {
    refused(
      shader(
        `${material}
function mutate(m: LeafMaterial): void { m.value = 8.; }
`,
        `const source = new LeafMaterial(3., 9.);
const b: Material = source; mutate(source); return vec4(b.response());`,
      ),
    );
  });

  it('rejects a mutation through a callback capturing the source', () => {
    refused(
      shader(
        `${material}
function invoke(f: () => void): void { f(); }
`,
        `const source = new LeafMaterial(3., 9.);
const b: Material = source;
invoke(() => { source.value = 8.; }); return vec4(b.response());`,
      ),
    );
  });

  it('rejects a nested projected-field write through a stored alias', () => {
    refused(
      shader(
        `${material}
class Holder { material: LeafMaterial; constructor(material: LeafMaterial) { this.material = material; } }
`,
        `const source = new LeafMaterial(3., 9.);
const b: Material = source;
const holder = new Holder(source); holder.material.value = 8.; return vec4(b.response());`,
      ),
    );
  });

  it('does not silently accept unrelated matching layouts', () => {
    const source = shader(
      `class Base { x: f32 = 1.; }
class Other { x: f32 = 2.; }
`,
      'const b: Base = new Other(); return vec4(b.x);',
    );
    expect(compile(source).diagnostics.some((d) => d.category === 'error')).toBe(true);
  });

  it('rejects a component write through an alias of a projected vector field', () => {
    refused(
      shader(
        `class Base { color: vec3; constructor() { this.color = vec3(1.); } }
class Derived extends Base { extra: f32 = 2.; }
`,
        `const source = new Derived(); const b: Base = source;
let alias = source.color; alias.x = 8.; return vec4(b.color, 1.);`,
      ),
    );
  });
});
