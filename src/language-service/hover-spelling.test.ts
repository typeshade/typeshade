import { describe, expect, it } from 'vitest';
import { bothTake } from '../core/testing/both-halves.js';

const fence = (text: string): string => `\`\`\`ts\n${text}\n\`\`\``;

describe('the hover spells the types the front end gives', () => {
  const source = `"use typeshade";
type Channel = "r" | "g" | "b";
export function pick(x: f32): f32 | null {
  if (x > 0.) { return x; }
  return null;
}
export function t(seen: Set<Channel>, last: Map<Channel, f32>, table: Record<Channel, f32>, m: f32 | null | undefined, c: Channel): f32 {
  return table[c] + (m ?? 0.);
}
`;
  const halves = bothTake(source);

  it('spells an optional result and parameter as TypeScript does', () => {
    expect(halves.hover('pick')).toBe(fence('function pick(x: f32): f32 | null'));
    expect(halves.hover('m:')).toBe(fence('(parameter) m: f32 | null | undefined'));
  });

  it('spells key types, a Record, a Set and a Map by their members', () => {
    expect(halves.hover('seen')).toBe(fence('(parameter) seen: Set<"b" | "g" | "r">'));
    expect(halves.hover('last')).toBe(fence('(parameter) last: Map<"b" | "g" | "r", f32>'));
    expect(halves.hover('c: Channel')).toBe(fence('(parameter) c: "b" | "g" | "r"'));
    expect(halves.hover('table')).toBe(fence('(parameter) table: Record<"b" | "g" | "r", f32>'));
  });
});

describe('the hover of a kernel size attribute', () => {
  it('names the attribute and documents it', () => {
    const halves = bothTake(`"use typeshade";
@workgroup_size([64])
export function k(xs: array<f32>): void { xs[0] = 1.; }
`);
    expect(halves.hover('workgroup_size')).toMatch(/^`@workgroup_size` — Optionally states/);
  });
});

describe('the hover of a local of a function that the callers copy', () => {
  const halves = bothTake(`"use typeshade";
function g() { let k = 0; let n: u32 = 3; k += 1; let w = u32(n); return k + k * k; }
export function a(v: u32): u32 { return v + g(); }
export function b(x: f32): f32 { return x * g(); }
`);

  it('names each type of a local that the copies type apart', () => {
    expect(halves.hover('k = 0')).toBe(fence('let k (u32 or f32 where "g" is called)'));
  });

  it('keeps the one type of a local that every copy types alike', () => {
    expect(halves.hover('n: u32')).toBe(fence('let n: u32'));
    expect(halves.hover('w = u32')).toBe(fence('let w: u32'));
  });
});
