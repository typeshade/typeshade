import { describe, expect, it } from 'vitest';
import { bothTake } from '../core/testing/both-halves.js';
import { createTypeshadeLanguageService } from './service.js';

const fence = (text: string): string => `\`\`\`ts\n${text}\n\`\`\``;

const LIB = '/p/lib.shade.ts';
const MAIN = '/p/main.shade.ts';

const LIB_TEXT = `"use typeshade";
export interface Light { power: f32; }
export interface Lightbulb { watts: f32; }
export function g() { return 1; }
export namespace Tone { export const GAMMA: f32 = 2.2; }
`;

const MAIN_TEXT = `"use typeshade";
import * as lib from "./lib.shade.ts";
import { Light as L, Lightbulb } from "./lib.shade.ts";
function f(a: L, b: Lightbulb): f32 { return a.power + b.watts; }
export function first(v: u32): u32 { return v + lib.g(); }
export function second(x: f32): f32 { return x * lib.g() + lib.Tone.GAMMA; }
`;

describe('the hover in a file that imports from another', () => {
  const service = createTypeshadeLanguageService();
  service.openDocument(LIB, LIB_TEXT);
  service.openDocument(MAIN, MAIN_TEXT);
  const hover = (needle: string, skip = 0): string | undefined =>
    service.getHover(MAIN, service.positionAt(MAIN, MAIN_TEXT.indexOf(needle) + skip))?.contents;

  it('reads without error', () => {
    expect(service.getDiagnostics(MAIN)).toEqual([]);
  });

  it('names an imported struct as the file writes it, and a longer name as itself', () => {
    expect(hover('a: L,')).toBe(fence('(parameter) a: L'));
    expect(hover('b: Lightbulb')).toBe(fence('(parameter) b: Lightbulb'));
  });

  it('gives each call of an imported function the result of the copy it takes', () => {
    expect(hover('lib.g()', 4)).toBe(fence('function g(): u32'));
    expect(hover('lib.g() + lib.Tone', 4)).toBe(fence('function g(): f32'));
  });

  it('keeps TypeScript for a typed constant of an imported namespace', () => {
    expect(hover('lib.Tone.GAMMA', 9)).toBe(fence('const Tone.GAMMA: f32'));
  });
});

describe('the hover of a stage attribute and of a getter the callers decide', () => {
  it('documents the attribute under the cursor', () => {
    const halves = bothTake(`"use typeshade";
@vertex
export function vs(i: builtin<"vertex_index">): vec4 { return vec4(f32(i), 0., 0., 1.); }
`);
    expect(halves.hover('vertex')).toMatch(/^`@vertex` — Marks the pipeline's vertex-stage/);
  });

  it('documents an attribute written as a call', () => {
    const halves = bothTake(`"use typeshade";
@compute([64, 1, 1])
export function cs(gid: builtin<"global_invocation_id">): void {}
`);
    expect(halves.hover('compute')).toMatch(/^`@compute` — /);
  });

  it('labels a getter, at its declaration and at a use', () => {
    const halves = bothTake(`"use typeshade";
class C { get g() { return 2; } }
export function t(vi: u32, x: f32): f32 {
  const c = new C();
  return f32(vi + c.g) + x * c.g;
}
`);
    expect(halves.hover('g() {')).toBe(fence('(getter) C.g (u32 or f32 where it is called)'));
    expect(halves.hover('g) + x')).toBe(fence('(getter) C.g: u32'));
  });
});
