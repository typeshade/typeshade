// format:semicolons skip — these sources exercise TypeScript's return-newline ASI.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

describe('a return ended by a newline', () => {
  it.each(['\n', '\r\n', '\u2028', '\u2029'])('names the repair for %j', (newline) => {
    const source = `"use typeshade";\nexport function f(): f32 {\n  return${newline}    0.012 * 2.;\n}`;
    const result = compileTsSource(source);
    const diagnostic = result.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE);
    expect(diagnostic?.message).toContain('The newline after "return" ends the return statement');
    expect(diagnostic?.message).toContain('write "return (" before the newline');
    expect(source.slice(diagnostic!.start, diagnostic!.start + diagnostic!.length)).toBe('return');
    expect(result.wgsl).toBeUndefined();
  });

  it('recognizes a newline in a trailing comment', () => {
    const result = compileTsSource(`"use typeshade";
export function f(): f32 {
  return /* explain
  the calculation */ 0.012 * 2.;
}`);
    expect(result.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE)?.message).toContain(
      'The newline after "return"',
    );
  });

  it('keeps the original diagnostic for an explicit return semicolon', () => {
    const result = compileTsSource(`"use typeshade";
export function f(): f32 {
  return;
  0.012 * 2.;
}`);
    expect(result.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE)?.message).toBe(
      'Function "f" returns f32 but has a bare "return".',
    );
  });

  it('keeps a deliberate void return valid', () => {
    const result = compileTsSource(`"use typeshade";
export function f(): void {
  return;
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('return;');
  });

  it('compiles the parenthesized remedy', () => {
    const result = compileTsSource(`"use typeshade";
export function f(): f32 {
  return (
    0.012 * 2.
  );
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('return 0.024;');
  });
});
