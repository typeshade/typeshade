import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';

const SOURCE =
  '"use typeshade";\n' +
  'class Camera {\n' +
  '  position: vec4\n' +
  '}\n' +
  'const camera = uniform<Camera>(0, 0)\n' +
  'function scale(x: f32, y: f32): f32 {\n' +
  '  return x\n' +
  '}\n' +
  '@vertex\n' +
  'export function vs(@builtin("vertex_index") i: u32): vec4 {\n' +
  '  const s = scale(1.0, )\n' +
  '  return vec4(s, s, s, 1.0)\n' +
  '}\n' +
  '@fragment\n' +
  'export function fs(): vec4 {\n' +
  '  return camera.position\n' +
  '}\n';

describe('getSignatureHelp', () => {
  it("renders the helper's signature with TypeShade type names, at the active parameter", () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const offset = SOURCE.indexOf('scale(1.0, ') + 'scale(1.0, '.length;
    const position = service.positionAt('a.ts', offset);
    const help = service.getSignatureHelp('a.ts', position);
    expect(help).toBeDefined();
    expect(help!.signatures[0]!.label).toBe('scale(x: f32, y: f32): f32');
    expect(help!.signatures[0]!.parameters.map((p) => p.label)).toEqual(['x: f32', 'y: f32']);
    expect(help!.activeSignature).toBe(0);
    expect(help!.activeParameter).toBe(1);
  });

  // A `Math` member is declared from the count of arguments the compiler checks (#186), so its
  // signature help names the parameters the compiler takes: `hypot`'s third is optional, and
  // `atan` has the second form WGSL's `atan2` gives it (Rule 9.2).
  const helpAt = (call: string): ReturnType<typeof service.getSignatureHelp> => {
    const source = `"use typeshade";\nexport function f(x: f32, y: f32): f32 {\n  return ${call}\n}\n`;
    service.openDocument('math.ts', source);
    return service.getSignatureHelp(
      'math.ts',
      service.positionAt('math.ts', source.indexOf(call) + call.length - 1),
    );
  };
  const service = createTypeshadeLanguageService();

  it('shows what a Math member the compiler expands takes', () => {
    const help = helpAt('Math.hypot(x, y, )');
    expect(help!.signatures.map((s) => s.label)).toEqual([
      'hypot(a: number, b: number, c?: number): number',
    ]);
    expect(help!.signatures[0]!.parameters.map((p) => p.label)).toEqual([
      'a: number',
      'b: number',
      'c?: number',
    ]);
    expect(help!.activeParameter).toBe(2);
    expect(helpAt('Math.cbrt()')!.signatures.map((s) => s.label)).toEqual([
      'cbrt(x: number): number',
    ]);
  });

  it('shows both forms of Math.atan, and selects the one the arguments written fit', () => {
    const help = helpAt('Math.atan(y, )');
    expect(help!.signatures.map((s) => s.label)).toEqual([
      'atan(x: number): number',
      'atan(y: number, x: number): number',
    ]);
    expect(help!.activeSignature).toBe(1);
    expect(help!.activeParameter).toBe(1);
  });

  it('returns undefined outside a call expression', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const position = service.positionAt('a.ts', SOURCE.indexOf('class Camera'));
    expect(service.getSignatureHelp('a.ts', position)).toBeUndefined();
  });
});
