// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { reflect } from '../../core/reflect.js';

const accessOf = (source: string, name = 'xs'): string | undefined => {
  const halves = bothTake(source);
  return halves.result.module.bindings.find((b) => b.name === name)?.access;
};

const compute = (decl: string, body: string, extra = ''): string => `"use typeshade";
${decl}
${extra}
@compute([64])
export function main(gid: builtin<"global_invocation_id">) {
  ${body}
}
`;

const WRITES: Readonly<Record<string, string>> = {
  assignment: compute('declare const xs: storage<f32[]>;', 'xs[gid.x] = 1.;'),
  'compound assignment': compute('declare const xs: storage<f32[]>;', 'xs[gid.x] += 1.;'),
  'atomic builtin': compute(
    'declare const xs: storage<array<atomic<u32>>>;',
    'atomicAdd(xs[0], 1);',
  ),
  'atomic load': compute(
    'declare const xs: storage<array<atomic<u32>>>;',
    'const n = atomicLoad(xs[0]); if (n > 100) { return; }',
  ),
  'write through a helper': compute(
    'declare const xs: storage<f32[]>;',
    'put(gid.x);',
    'function put(i: u32) { xs[i] = 2.; }',
  ),
  'write through a reference parameter': compute(
    'declare const xs: storage<Acc[]>;',
    'put(xs[gid.x], 1.);',
    'class Acc { total: f32; }\nfunction put(a: Acc, v: f32) { a.total = v; }',
  ),
  'write through a struct method': compute(
    'declare const xs: storage<Acc[]>;',
    'xs[gid.x].add(1.);',
    'class Acc { total: f32; add(v: f32) { this.total += v; } }',
  ),
};

describe('a storage binding takes its access from the program (change 0114, S3)', () => {
  for (const [kind, source] of Object.entries(WRITES)) {
    it(`is read_write when an entry writes it: ${kind}`, () => {
      expect(accessOf(source)).toBe('read_write');
      expect(bothTake(source).result.wgsl).toContain('var<storage, read_write> xs');
    });
  }

  const UNTYPED_INDEX: Readonly<Record<string, string>> = {
    'a let counter': 'let i = 0; xs[i] = 1.;',
    'a counter raised by the invocation id': 'let n = 0; n += gid.x; xs[n] = 1.;',
    'a while loop counter': 'let i = 0; while (i < 4) { xs[i] = 1.; i++; }',
  };
  for (const [kind, body] of Object.entries(UNTYPED_INDEX)) {
    it(`is read_write when the index is an untyped integer local: ${kind}`, () => {
      const source = compute('declare const xs: storage<f32[]>;', body);
      expect(accessOf(source)).toBe('read_write');
      expect(bothTake(source).result.wgsl).toContain('var<storage, read_write> xs');
    });
  }

  it('is read when entries only read it', () => {
    const source = compute(
      'declare const xs: storage<f32[]>;\ndeclare const out: storage<f32[]>;',
      'out[gid.x] = xs[gid.x];',
    );
    expect(accessOf(source, 'xs')).toBe('read');
    expect(accessOf(source, 'out')).toBe('read_write');
    const wgsl = bothTake(source).result.wgsl!;
    expect(wgsl).toContain('var<storage, read> xs');
    expect(wgsl).toContain('var<storage, read_write> out');
  });

  it('stays read when a helper no entry calls only reads it', () => {
    const source = compute(
      'declare const xs: storage<f32[]>;\ndeclare const out: storage<f32[]>;',
      'out[gid.x] = xs[gid.x];',
      'function unused(i: u32): f32 { return xs[i]; }',
    );
    expect(accessOf(source, 'xs')).toBe('read');
  });

  it('keeps the explicit "read_write" argument, written or not', () => {
    const source = compute(
      'declare const xs: storage<f32[], "read_write">;\ndeclare const out: storage<f32[]>;',
      'out[gid.x] = xs[gid.x];',
    );
    expect(accessOf(source, 'xs')).toBe('read_write');
  });

  it('is reported by reflect() as the buffer type of its bind group layout', () => {
    const source = compute(
      'declare const xs: storage<f32[]>;\ndeclare const out: storage<f32[]>;',
      'out[gid.x] = xs[gid.x];',
    );
    const found = reflect(bothTake(source).result.module).bindGroups.flatMap((g) => g.entries);
    expect(found.find((b) => b.name === 'xs')?.access).toBe('read');
    expect(found.find((b) => b.name === 'out')?.access).toBe('read_write');
  });
});

describe('a readonly value type is the promise that nothing writes the binding', () => {
  it('refuses a write in both halves', () => {
    bothRefuse(
      compute('declare const xs: storage<readonly f32[]>;', 'xs[gid.x] = 1.;'),
      'TS8005',
      'Cannot write to "xs" — its type "readonly f32[]" promises that nothing writes it. Write "declare const xs: storage<f32[]>" to write to it.',
    );
  });

  it('refuses a write to a binding declared "read" in both halves', () => {
    bothRefuse(
      compute('declare const xs: storage<f32[], "read">;', 'xs[gid.x] = 1.;'),
      'TS8005',
      'Cannot assign to "xs" — it is a read-only resource. Write "declare const xs: storage<array<f32>, "read_write">" to write to it.',
    );
  });

  it('refuses a write in a helper no entry reaches, as a write to a read binding', () => {
    const halves = bothHalves(
      compute(
        'declare const xs: storage<f32[]>;\ndeclare const out: storage<f32[]>;',
        'out[gid.x] = xs[gid.x];',
        'function unused(i: u32) { xs[i] = 3.; }',
      ),
    );
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toBe(
      'typeshade TS8005: Cannot assign to "xs" — it is a read-only resource. Write "declare const xs: storage<array<f32>, "read_write">" to write to it.',
    );
    expect(halves.editor).toEqual(halves.compiler);
  });
});

const vertexReading = (decl: string): string => `"use typeshade";
${decl}
declare const out: storage<f32[]>;
@vertex
export function vs(@builtin("vertex_index") i: u32): builtin<"position"> {
  return vec4(xs[i], 0., 0., 1.);
}
@compute([64])
export function step(gid: builtin<"global_invocation_id">) {
  xs[gid.x] = out[gid.x];
}
`;

describe('a binding the module writes cannot be read by a vertex entry', () => {
  it('is refused in both halves with the two remedies', () => {
    const halves = bothHalves(vertexReading('declare const xs: storage<f32[]>;'));
    const sentence =
      'typeshade TS8099: WebGPU allows no writable storage buffer in the vertex stage, and the module writes "xs" that the vertex entry "vs" reads: give the vertex stage a separate binding, or declare "xs" readonly and write nothing to it.';
    expect(halves.compiler).toContain(sentence);
    expect(halves.editor).toContain(sentence);
  });
});

describe('a storage binding declared with let is refused, so no accepted program has one', () => {
  it('refuses declare let on a binding no entry writes in both halves', () => {
    bothRefuse(
      compute('declare let xs: storage<f32[]>;', 'const v = xs[gid.x]; if (v > 1.) { return; }'),
      'TS8099',
      '"xs" is a storage binding, and a binding is declared const: write "declare const xs: storage<f32[], "read">". A storage binding\'s access mode is its second type argument, not the declaration keyword.',
    );
  });
});
