import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';
import { packModule, type Pack, type PackOptions } from './pack.js';

const TEXTURE = `"use typeshade";
declare const labelsTex: texture_2d<u32>;
function cachedColor(uv: vec2): vec4 { return bitcast<vec4>(textureLoad(labelsTex, vec2i(uv), 0)); }
function freshColor(uv: vec2): vec4 { return vec4(uv, 0, 1); }
function shade(uv: vec2, cached: bool): vec4 { return cached ? cachedColor(uv) : freshColor(uv); }
@fragment export function drawCached(uv: location<0, vec2>): vec4 { return shade(uv, true); }
@fragment export function drawReference(uv: location<0, vec2>): vec4 { return shade(uv, false); }
`;

const RESOURCES = `"use typeshade";
declare const labelsTex: texture_2d<f32>;
declare const labelsSampler: sampler;
declare const records: storage<array<vec4>>;
function cachedColor(uv: vec2): vec4 { return textureSample(labelsTex, labelsSampler, uv) + records[u32(uv.x)]; }
function freshColor(uv: vec2): vec4 { return vec4(uv, 0, 1); }
function shade(uv: vec2, cached: bool): vec4 { return cached ? cachedColor(uv) : freshColor(uv); }
@fragment export function drawCached(uv: location<0, vec2>): vec4 { return shade(uv, true); }
@fragment export function drawReference(uv: location<0, vec2>): vec4 { return shade(uv, false); }
`;

const ENTRIES = ['drawCached', 'drawReference'] as const;

function pack(source: string, options?: PackOptions): Pack {
  const halves = bothHalves(source);
  expect(halves.compiler).toEqual([]);
  expect(halves.editor).toEqual([]);
  return packModule(halves.result.module, options);
}

function wgslFunctions(wgsl: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of wgsl.matchAll(/^fn (\w+)\([^]*?^\}$/gm)) out.set(m[1]!, m[0]);
  return out;
}

function wgslReads(wgsl: string, entry: string, names: readonly string[]): string[] {
  const fns = wgslFunctions(wgsl);
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const name = todo.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = fns.get(name) ?? '';
    for (const callee of fns.keys())
      if (callee !== name && new RegExp(`\\b${callee}\\(`).test(body)) todo.push(callee);
  }
  const text = [...seen].map((n) => fns.get(n) ?? '').join('\n');
  return names.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
}

function bound(p: Pack, entry: string): string[] {
  return p.entries
    .find((e) => e.name === entry)!
    .bindings.map((b) => b.name)
    .sort();
}

function expectAgreement(p: Pack, names: readonly string[]): void {
  for (const entry of ENTRIES) {
    expect(bound(p, entry)).toEqual(wgslReads(p.wgsl, entry, names).sort());
    const draw = p.gl?.draws?.[entry];
    expect(draw).toBeDefined();
    if (draw === undefined || 'none' in draw) throw new Error(`${entry}: ${JSON.stringify(draw)}`);
    for (const n of names)
      if (!new RegExp(`\\b${n}\\b`).test(draw.fragment))
        expect(draw.samplers).not.toHaveProperty(n);
  }
}

describe('an entry binds what its emitted body reads after a constant branch is dropped (#1337)', () => {
  it('packs both entries of a texture read behind a constant condition, in WGSL and GLSL', () => {
    const p = pack(TEXTURE);
    expect(bound(p, 'drawCached')).toEqual(['labelsTex']);
    expect(bound(p, 'drawReference')).toEqual([]);
    expectAgreement(p, ['labelsTex']);
    const cached = p.gl!.draws!.drawCached!;
    const reference = p.gl!.draws!.drawReference!;
    expect(cached).toMatchObject({ samplers: { labelsTex: null } });
    expect(reference).toMatchObject({ samplers: {}, blocks: {} });
    expect('fragment' in reference && reference.fragment).not.toMatch(/\blabelsTex\b/);
  });

  it('packs both entries when the dropped branch reads a storage buffer and a sampler', () => {
    const p = pack(RESOURCES);
    const names = ['labelsSampler', 'labelsTex', 'records'];
    expect(bound(p, 'drawCached')).toEqual(names);
    expect(bound(p, 'drawReference')).toEqual([]);
    expectAgreement(p, names);
    expect(p.gl!.draws!.drawCached).toMatchObject({
      samplers: { labelsTex: 'labelsSampler' },
      data: ['records'],
    });
    const reference = p.gl!.draws!.drawReference!;
    expect('fragment' in reference && reference.fragment).not.toMatch(
      /\b(labelsTex|labelsSampler|records)\b/,
    );
  });

  it('keeps the WGSL and the GLSL in agreement at every optimization level', () => {
    for (const level of ['O0', 'O1', 'O2'] as const) {
      expectAgreement(pack(TEXTURE, { emit: { level } }), ['labelsTex']);
      expectAgreement(pack(RESOURCES, { emit: { level } }), [
        'labelsSampler',
        'labelsTex',
        'records',
      ]);
    }
  });
});
