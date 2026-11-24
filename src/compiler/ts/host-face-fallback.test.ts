import { describe, expect, it, vi } from 'vitest';
import { hostFace, type HostExport } from './host-face.js';

const generator = vi.hoisted(() => ({ refused: new Set<string>() }));

vi.mock('../../core/cpu-codegen.js', async (original) => {
  const real = await original<typeof import('../../core/cpu-codegen.js')>();
  return {
    ...real,
    generateModuleJs: (...args: Parameters<typeof real.generateModuleJs>) => {
      const generated = real.generateModuleJs(...args);
      return { ...generated, fallbacks: [...generated.fallbacks, ...generator.refused] };
    },
  };
});

const FALLBACK = 'the CPU tier does not generate code for a function it reaches yet (Rule 11.7)';

function faceOf(source: string) {
  generator.refused = new Set(['broken']);
  const f = hostFace(source, { fileName: '/app/m.shade.ts' });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f;
}

const exportsOf = (source: string): readonly HostExport[] => faceOf(source).exports!;
const viewOf = (source: string): string => faceOf(source).view!;

function declaration(view: string, name: string): string {
  const start = view.indexOf(`export declare class ${name}`);
  expect(start, `the view declares ${name}`).toBeGreaterThan(-1);
  return view.slice(start, view.indexOf('\n}\n', start));
}

function named(all: readonly HostExport[], name: string): HostExport {
  const found = all.find((e) => e.name === name);
  expect(found, `the face has ${name}`).toBeDefined();
  return found!;
}

describe('an export whose code the CPU tier cannot generate', () => {
  const SOURCE = `"use typeshade";
function broken(x: f32): f32 { return x + 1.; }
export function viaBroken(x: f32): f32 { return broken(x) * 2.; }
export function direct(x: f32): f32 { return x * 2.; }
export class Acc {
  v: f32;
  constructor(v: f32) { this.v = v; }
  get twice(): f32 { return broken(this.v); }
  step(x: f32): f32 { return broken(x) + this.v; }
  plain(x: f32): f32 { return x + this.v; }
}
export class Whole {
  v: f32;
  constructor(v: f32) { this.v = broken(v); }
}
declare const ys: storage<array<f32>, "read_write">;
@compute([1])
export function lost(gid: builtin<"global_invocation_id">) { ys[gid.x] = broken(1.); }
@compute([1])
export function kept(gid: builtin<"global_invocation_id">) { ys[gid.x] = 2.; }
`;

  it('is declared never for a function, with the reason', () => {
    const all = exportsOf(SOURCE);
    expect(named(all, 'viaBroken')).toMatchObject({ kind: 'never', reason: FALLBACK });
    expect(named(all, 'direct').kind).toBe('function');
  });

  it('is declared never for the members of a class that reach it, and for no other', () => {
    const view = viewOf(SOURCE);
    const acc = declaration(view, 'Acc');
    expect(acc).toMatch(/\bstep: never;/);
    expect(acc).toMatch(/\btwice: never;/);
    expect(acc).toMatch(/\bplain\(x: f32\): f32;/);
    expect(acc.split(FALLBACK)).toHaveLength(3);
  });

  it('is declared never for the constructor of a class', () => {
    const whole = declaration(viewOf(SOURCE), 'Whole');
    expect(whole).toContain('protected constructor();');
    expect(whole).toContain(FALLBACK);
  });

  it('leaves an entry on the GPU, with no CPU tier', () => {
    const all = exportsOf(SOURCE);
    const lost = named(all, 'lost');
    const kept = named(all, 'kept');
    if (lost.kind !== 'compute' || kept.kind !== 'compute') throw new Error('both are entries');
    expect(lost.entry.noCpu).toBe(FALLBACK);
    expect(kept.entry.noCpu).toBeUndefined();
  });
});
