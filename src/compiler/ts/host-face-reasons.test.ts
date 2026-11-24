import { describe, expect, it } from 'vitest';
import { hostFace, type HostExport } from './host-face.js';

function exportsOf(source: string): readonly HostExport[] {
  const f = hostFace(source, { fileName: '/app/m.shade.ts' });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f.exports!;
}

function reasonOf(all: readonly HostExport[], name: string): string | undefined {
  const found = all.find((e) => e.name === name);
  expect(found, `the face has ${name}`).toBeDefined();
  return found!.kind === 'never' ? found!.reason : undefined;
}

describe('the reason a function is not callable from a host', () => {
  const SOURCE = `"use typeshade";
declare const frame: uniform<vec4>;
class Cell { v: f32; }
export function writes(c: Cell): void { c.v += 1.; }
export function writesAndReadsBinding(c: Cell): void { c.v += frame.x; }
export function readsBinding(x: f32): f32 { return x + frame.x; }
`;

  it('is the object a function writes when nothing else refuses it', () => {
    expect(reasonOf(exportsOf(SOURCE), 'writes')).toMatch(
      /^parameter "c" is the caller's object, which the function writes/,
    );
  });

  it('is the other reason first, so a function with two reasons is refused with that one', () => {
    const all = exportsOf(SOURCE);
    expect(reasonOf(all, 'writesAndReadsBinding')).toBe(reasonOf(all, 'readsBinding'));
    expect(reasonOf(all, 'writesAndReadsBinding')).toMatch(/^it reaches a resource binding/);
  });
});

describe('a const that holds a function', () => {
  it('is judged as a function and not as a constant', () => {
    const all = exportsOf(`"use typeshade";
export const arrow = (x: f32): f32 => x * 2.;
export const expression = function (x: f32): f32 { return x + 1.; };
export const constant: f32 = 2.;
`);
    const notLowered = 'it was not lowered to one function of the module';
    expect(reasonOf(all, 'arrow')).toBe(notLowered);
    expect(reasonOf(all, 'expression')).toBe(notLowered);
    expect(all.find((e) => e.name === 'constant')?.kind).toBe('const');
  });
});
