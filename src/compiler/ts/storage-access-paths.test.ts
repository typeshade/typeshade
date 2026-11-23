// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { reflect } from '../../core/reflect.js';

const COMPUTE = '@compute([64])\nexport function main(gid: builtin<"global_invocation_id">)';

const program = (body: string, extra = '', decl = 'declare const xs: storage<f32[]>;'): string =>
  `"use typeshade";\n${decl}\n${extra}\n${COMPUTE} {\n  ${body}\n}\n`;

const takeWriting = (source: string, name = 'xs'): void => {
  const halves = bothTake(source);
  expect(halves.result.module.bindings.find((b) => b.name === name)?.access).toBe('read_write');
  expect(halves.result.wgsl).toContain(`var<storage, read_write> ${name}`);
};

const WRITE_PATHS: Readonly<Record<string, string>> = {
  'a closure a helper calls': program(
    'run(gid.x);',
    'function run(i: u32) { const set = (j: u32) => { xs[j] = 1.; }; set(i); }',
  ),
  fill: program('xs.fill(2.);'),
  forEach: program('xs.forEach((v, i) => { xs[i] = v + 1.; });'),
  'a switch case': program('switch (gid.x) { case 0: xs[0] = 1.; break; default: break; }'),
  'a nested block': program('if (gid.x < 4) { { for (let i = 0; i < 2; i++) { xs[i] = 1.; } } }'),
};

describe('a write path reaches read_write in both halves (change 0114, S3)', () => {
  for (const [kind, source] of Object.entries(WRITE_PATHS)) {
    it(`is read_write: ${kind}`, () => takeWriting(source));
  }

  it('is read_write: a destructuring assignment target', () => {
    takeWriting(program('[xs[0], xs[1]] = [1., 2.];'));
  });
});

const entries = (decl: string, second: string): string => `"use typeshade";
${decl}
declare const out: storage<f32[]>;
@compute([64])
export function writer(gid: builtin<"global_invocation_id">) { xs[gid.x] = 1.; }
${second}
`;

const bindingOf = (source: string, name: string) =>
  reflect(bothTake(source).result.module)
    .bindGroups.flatMap((g) => g.entries)
    .filter((b) => b.name === name);

describe('the mode is one for a binding that several entries use', () => {
  const DECL = 'declare const xs: storage<f32[]>;';

  it('is read_write once when only one of two compute entries writes it', () => {
    const source = entries(
      DECL,
      '@compute([64])\nexport function reader(gid: builtin<"global_invocation_id">) { out[gid.x] = xs[gid.x]; }',
    );
    takeWriting(source);
    const found = bindingOf(source, 'xs');
    expect(found).toHaveLength(1);
    expect(found[0]?.access).toBe('read_write');
  });

  it('accepts a fragment entry that reads what a compute entry writes', () => {
    const source = entries(
      DECL,
      '@fragment export function fs(): vec4 { return vec4(xs[0], 0., 0., 1.); }',
    );
    const halves = bothTake(source);
    expect(halves.result.wgsl).toContain('var<storage, read_write> xs');
    expect(bindingOf(source, 'xs')[0]?.access).toBe('read_write');
  });

  it('accepts a vertex entry that reads a binding no entry writes', () => {
    const source = `"use typeshade";
declare const xs: storage<f32[]>;
@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  return vec4(xs[i], 0., 0., 1.);
}
`;
    const halves = bothTake(source);
    expect(halves.result.wgsl).toContain('var<storage, read> xs');
    expect(bindingOf(source, 'xs')[0]?.access).toBe('read');
  });
});

const vertexWriting = (decl: string, body: string, extra = ''): string => `"use typeshade";
${decl}
${extra}
@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  ${body}
  return vec4(0., 0., 0., 1.);
}
`;

const OWN_WRITE = (name: string): string =>
  `WebGPU allows no writable storage buffer in the vertex stage, and the vertex entry "vs" writes "${name}": write it from a compute or fragment entry, or give the vertex stage a separate binding.`;

describe('a vertex entry that writes a storage binding is refused', () => {
  const F32 = 'declare const xs: storage<f32[]>;';
  it('refuses a plain write', () => {
    bothRefuse(vertexWriting(F32, 'xs[i] = 1.;'), 'TS8099', OWN_WRITE('xs'));
  });

  it('refuses a compound write', () => {
    bothRefuse(vertexWriting(F32, 'xs[i] += 1.;'), 'TS8099', OWN_WRITE('xs'));
  });

  it('refuses a write through a helper the entry calls', () => {
    bothRefuse(
      vertexWriting(F32, 'put(i);', 'function put(k: u32) { xs[k] = 2.; }'),
      'TS8099',
      OWN_WRITE('xs'),
    );
  });

  it('refuses an atomic builtin', () => {
    bothRefuse(
      vertexWriting('declare const xs: storage<array<atomic<u32>>>;', 'atomicAdd(xs[0], 1);'),
      'TS8099',
      '"atomicAdd" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows an atomic built-in in a fragment or compute stage only.',
    );
  });

  it('accepts a fragment entry that writes', () => {
    const source = `"use typeshade";
${F32}
@fragment export function fs(): vec4 { xs[0] = 1.; return vec4(0., 0., 0., 1.); }
`;
    const halves = bothHalves(source);
    expect(halves.compiler.filter((d) => d.includes('vertex stage'))).toEqual([]);
    expect(halves.editor).toEqual([]);
    expect(halves.result.wgsl).toContain('var<storage, read_write> xs');
  });
});
