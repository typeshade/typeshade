import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { hostFace } from '../compiler/ts/host-face.js';
import { fusedFor, type Fused } from './fuse-entry.js';
import type { FuseLoop, KernelFace } from './host-kernel.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const RUNTIME = resolve(__dirname, 'host-runtime.ts');

const SOURCE = `"use typeshade";
export function copy(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i];
  }
}
export function icopy(out: array<i32>, x: array<i32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i];
  }
}
export function vcopy(out: array<vec4<f32>>, x: array<vec4<f32>>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i];
  }
}
export function plain(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
@workgroup_size([128]) export function wide(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * 3.;
  }
}
@workgroup_size([64]) export function narrow(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * 4.;
  }
}
`;

const NAMED = `"use typeshade";
const _fk: f32 = 2.;
function fused_fsum_fold(x: f32): f32 { return x; }
export function pre(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i] * _fk;
  }
}
export function fsum(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += fused_fsum_fold(xs[i]);
  }
  return s;
}
`;

const facesOf = (source: string, fileName: string): Map<string, KernelFace> => {
  const g = hostFace(source, { fileName, runtime: RUNTIME, fuse: true });
  const faces = new Map<string, KernelFace>();
  for (const e of g.exports ?? []) if (e.kind === 'kernel') faces.set(e.name, e.face);
  return faces;
};
const FACES = facesOf(SOURCE, '/app/inv.shade.ts');
const NAMES = facesOf(NAMED, '/app/named.shade.ts');

const face = (name: string): KernelFace => (FACES.get(name) ?? NAMES.get(name))!;
const loopOf = (k: KernelFace): FuseLoop => k.fuse!.facts[0]!;
const withLoop = (k: KernelFace, patch: Partial<Mutable<FuseLoop>>): KernelFace => ({
  ...k,
  fuse: { ...k.fuse!, facts: [{ ...loopOf(k), ...patch }] },
});
const declaring = (k: KernelFace): KernelFace => withLoop(k, { declared: true });
const walk = (node: unknown, visit: (n: Record<string, unknown>) => void): void => {
  if (Array.isArray(node)) node.forEach((x) => walk(x, visit));
  else if (typeof node === 'object' && node !== null) {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((x) => walk(x, visit));
  }
};

const built = (r: Fused | { readonly none: string }): Fused => {
  if ('none' in r) throw new Error(r.none);
  return r;
};
const refusal = (r: Fused | { readonly none: string }): string => {
  if (!('none' in r)) throw new Error('built an entry');
  return r.none;
};

const wgsl = (...members: { k: string; slots: number[] }[]): string =>
  built(fusedFor(members.map((m) => ({ k: face(m.k), slots: m.slots })))).entry.wgsl;

describe('the names a fused entry makes', () => {
  it('prefixes its names with a prefix that no name of any member starts with', () => {
    const f = built(fusedFor([{ k: face('pre'), slots: [0, 1] }]));
    expect(f.args.name).toBe('_ffargs');
    expect(f.module.structs.map((s) => s.name)).toContain('_ffArgs');
  });

  it('keeps the entry, fold and iteration names apart from every name a member declares', () => {
    const f = built(fusedFor([{ k: face('fsum'), slots: [0] }]));
    expect(f.entry.fn).toBe('fused_fsum_');
    expect(f.reduce!.fold.fn).toBe('fused_fsum__fold');
    const names = f.module.funcs.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('fused_fsum_fold');
  });

  it('declares no struct of a member beside the merged uniform', () => {
    const f = built(
      fusedFor([
        { k: face('copy'), slots: [0, 1] },
        { k: face('copy'), slots: [2, 0] },
      ]),
    );
    expect(f.module.structs.map((s) => s.name)).toEqual(['_fArgs']);
  });
});

describe('the arrays a fused entry binds', () => {
  it('refuses one array that two calls type differently', () => {
    const r = refusal(
      fusedFor([
        { k: face('copy'), slots: [0, 1] },
        { k: face('icopy'), slots: [2, 1] },
      ]),
    );
    expect(r).toMatch(/^one array is .*f32.* in one call and .*i32.* in icopy\(\)$/);
  });

  it('refuses to contract a slot that no call reaches', () => {
    const r = refusal(fusedFor([{ k: face('copy'), slots: [0, 1] }], [7]));
    expect(r).toBe('the group has no array in slot 7 to contract');
  });

  it('holds an array of vec4<f32> as one local, and binds no buffer for it', () => {
    const f = built(
      fusedFor(
        [
          { k: face('vcopy'), slots: [0, 1] },
          { k: face('vcopy'), slots: [2, 0] },
        ],
        [0],
      ),
    );
    expect(f.entry.wgsl).toContain('var _fs0: vec4<f32>;');
    expect(f.slots.map((s) => s.array)).toEqual([1, 2]);
  });
});

describe('an edge between two calls', () => {
  it('is no edge for an array that the entry holds as a local', () => {
    const f = wgsl({ k: 'copy', slots: [0, 1] }, { k: 'copy', slots: [2, 0] });
    expect(f).toMatch(/var _fe0: f32;/);
    const held = built(
      fusedFor(
        [
          { k: face('copy'), slots: [0, 1] },
          { k: face('copy'), slots: [2, 0] },
        ],
        [0],
      ),
    );
    expect(held.entry.wgsl).not.toMatch(/_fe\d/);
    expect(held.entry.wgsl.match(/if \(_live\)/g)).toHaveLength(2);
  });

  it('is made only for a read after the write, never for a read before it', () => {
    const f = wgsl({ k: 'copy', slots: [0, 1] }, { k: 'copy', slots: [1, 2] });
    expect(f.match(/if \(_live\)/g)).toHaveLength(2);
  });

  it('leaves the reads of the writer itself on the array', () => {
    const f = wgsl({ k: 'copy', slots: [0, 0] }, { k: 'copy', slots: [1, 0] });
    expect(f).toMatch(/_fr0\[_fc0_i\] = _fr0\[_fc0_i\];/);
    expect(f).toMatch(/_fe0 = _fr0\[_fc0_i\];/);
  });
});

describe('a member that the builder reads', () => {
  const copy = face('copy');
  const alone = (k: KernelFace): string => refusal(fusedFor([{ k, slots: [0, 1] }]));

  it('refuses a record of more than one loop', () => {
    const two = { ...copy, fuse: { ...copy.fuse!, facts: [loopOf(copy), loopOf(copy)] } };
    expect(alone(two)).toBe('copy() carries no fuse record of one loop');
  });

  it('refuses a map whose iteration is not its entry', () => {
    expect(alone(withLoop(copy, { iterates: 'other' }))).toMatch(/^copy\(\) has no map entry /);
  });

  it('refuses a reduction whose face lacks the reduction', () => {
    const plain = face('plain');
    const loops = plain.gpu!.loops.map((l) => ({ ...l }));
    delete (loops[0] as { reduce?: unknown }).reduce;
    const bare: KernelFace = { ...plain, gpu: { ...plain.gpu!, loops } };
    expect(refusal(fusedFor([{ k: bare, slots: [0] }]))).toMatch(
      /^plain\(\) has no reducing entry /,
    );
  });

  it('refuses a reduction whose partials binding is not in its module', () => {
    const plain = face('plain');
    const loops = plain.gpu!.loops.map((l) => ({
      ...l,
      reduce: {
        ...l.reduce!,
        vars: l.reduce!.vars.map((v) => ({ ...v, binding: { ...v.binding, name: 'nope' } })),
      },
    }));
    const k: KernelFace = { ...plain, gpu: { ...plain.gpu!, loops } };
    expect(refusal(fusedFor([{ k, slots: [0] }]))).toBe('plain() has no binding for "nope"');
  });

  it('refuses an array whose binding is not in its module', () => {
    const arrays = copy.gpu!.arrays.map((a) => ({ ...a, binding: a.binding + 40 }));
    const k: KernelFace = { ...copy, gpu: { ...copy.gpu!, arrays } };
    expect(alone(k)).toMatch(/^copy\(\) has no binding for "/);
  });

  it('refuses an arguments struct that is not in its module', () => {
    const k: KernelFace = {
      ...copy,
      gpu: { ...copy.gpu!, args: { ...copy.gpu!.args, s: 'Nope' } },
    };
    expect(alone(k)).toBe('copy() has no struct "Nope"');
  });

  it('refuses an entry that does not start with the invocation index', () => {
    expect(alone(withLoop(copy, { iteration: 0 }))).toBe(
      'copy() does not start its entry with the invocation index',
    );
  });

  it('refuses an iteration that does not start with the counter', () => {
    expect(alone(withLoop(copy, { iteration: loopOf(copy).iteration + 1 }))).toBe(
      "copy() does not start its iteration with the loop's counter",
    );
  });
});

describe('the size of a fused group', () => {
  it('refuses a call that declares another size than the group runs at', () => {
    const r = refusal(
      fusedFor([
        { k: declaring(face('wide')), slots: [0, 1] },
        { k: declaring(face('narrow')), slots: [2, 0] },
      ]),
    );
    expect(r).toBe('narrow() runs in workgroups of 64 and the group in workgroups of 128');
  });
});

describe('the declarations of a fused module', () => {
  it('names each feature the members enable once', () => {
    const enabling = (k: KernelFace): KernelFace => ({
      ...k,
      fuse: {
        ...k.fuse!,
        ir: {
          ...k.fuse!.ir,
          module: { ...(k.fuse!.ir.module as object), enables: ['floatRenderTarget'] },
        },
      },
    });
    const f = built(
      fusedFor([
        { k: enabling(face('copy')), slots: [0, 1] },
        { k: enabling(face('copy')), slots: [2, 0] },
      ]),
    );
    expect(f.module.enables).toEqual(['floatRenderTarget']);
  });

  it('passes the lane flag of a reduction helper as its parameter', () => {
    const f = built(
      fusedFor([
        { k: face('copy'), slots: [0, 1] },
        { k: face('plain'), slots: [0] },
      ]),
    );
    const params: string[] = [];
    walk(f.module.funcs, (n) => {
      if (n['op'] === 'param' && typeof n['name'] === 'string') params.push(n['name']);
    });
    expect(params).toContain('_live');
  });
});
