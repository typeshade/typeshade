import { describe, expect, it } from 'vitest';
import { Capabilities, UnsupportedFeatureError, type CapProfile } from './backend.js';
import { wgslBackend } from './backends/wgsl.js';
import { glslEs300Backend } from './backends/glsl.js';
import { capabilityMatrix } from './backend.js';
import { f32T, vec3fT, structT } from './ir/index.js';
import type { BindingDecl } from './ir/index.js';

describe('Capabilities.fromProfile', () => {
  it('does not count a row whose value is undefined as support', () => {
    const profile = { f16: undefined, storageBuffer: {} } as unknown as CapProfile;
    const caps = Capabilities.fromProfile(profile);
    expect(caps.has('f16')).toBe(false);
    expect(caps.has('storageBuffer')).toBe(true);
    expect(caps.missing(['f16', 'storageBuffer'])).toEqual(['f16']);
  });
});

describe('statement fragments of a backend', () => {
  it.each([
    ['wgsl', wgslBackend],
    ['glsl-es300', glslEs300Backend],
  ] as const)('%s: localLet and localVar carry no indentation and no semicolon', (_id, be) => {
    for (const text of [
      be.localLet('a', f32T, '1.0'),
      be.localVar('b', vec3fT, 'v'),
      be.localVar('c', f32T),
      be.switchHead('x'),
    ]) {
      expect(text).toBe(text.trim());
      expect(text.endsWith(';')).toBe(false);
    }
  });

  it.each([
    ['wgsl', wgslBackend],
    ['glsl-es300', glslEs300Backend],
  ] as const)('%s: constDecl is a whole line that ends with a semicolon', (_id, be) => {
    const line = be.constDecl('K', f32T, '2.0');
    expect(line.endsWith(';')).toBe(true);
    expect(line).toBe(line.trim());
    expect(line).not.toContain('\n');
  });
});

describe('a backend that cannot spell a declaration fails closed', () => {
  const uniformStruct: BindingDecl = {
    group: 0,
    binding: 0,
    name: 'U',
    space: 'uniform',
    type: structT('S'),
  };
  const storage: BindingDecl = { ...uniformStruct, name: 'B', space: 'storage' };

  it('glsl-es300 refuses a bare uniform struct binding and a storage binding', () => {
    expect(() => glslEs300Backend.emitBinding(uniformStruct)).toThrow(UnsupportedFeatureError);
    expect(() => glslEs300Backend.emitBinding(storage)).toThrow(UnsupportedFeatureError);
  });
});

describe('capabilityMatrix declarable column', () => {
  it('is false for a derived capability and true for a declarable one', () => {
    const rows = capabilityMatrix([wgslBackend]);
    const row = (c: string) => rows.find((r) => r.capability === c)!;
    expect(row('storageBuffer').declarable).toBe(false);
    expect(row('f16').declarable).toBe(true);
  });
});
