import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { typeshade } from './vite.js';
import type { CacheKeyGenerator, VitestPluginContext } from './vite-cache-key.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const TEMP_ROOT = join(import.meta.dirname, '..', '.vitest');
const tempDir = (): string => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const d = mkdtempSync(join(TEMP_ROOT, 'typeshade-cache-key-'));
  dirs.push(d);
  return d;
};

const libOf = (factor: number): string => `"use typeshade";
export function scale(x: f32): f32 { return x * ${factor}.; }
`;
const APP = `"use typeshade";
import { scale } from './lib.shade.ts';
export function twice(x: f32): f32 { return scale(x) + scale(x); }
`;

const generatorOf = (): CacheKeyGenerator => {
  let generator: CacheKeyGenerator | undefined;
  const plugin = typeshade() as unknown as {
    configureVitest(context: VitestPluginContext): void;
  };
  plugin.configureVitest({ defineCacheKeyGenerator: (callback) => void (generator = callback) });
  return generator!;
};

describe("the plugin's Vitest cache key (Rule 3.9, #1130)", () => {
  it('changes with the content of an imported shader file, and with nothing else', () => {
    const dir = tempDir();
    const lib = join(dir, 'lib.shade.ts');
    const app = join(dir, 'app.shade.ts');
    writeFileSync(app, APP);
    const keyOf = generatorOf();
    writeFileSync(lib, libOf(2));
    const before = keyOf({ id: app, sourceCode: APP });
    expect(before).toEqual(expect.any(String));
    expect(keyOf({ id: `${app}?import`, sourceCode: APP })).toBe(before);
    writeFileSync(lib, libOf(3));
    const after = keyOf({ id: app, sourceCode: APP });
    expect(after).toEqual(expect.any(String));
    expect(after).not.toBe(before);
    writeFileSync(lib, libOf(2));
    expect(keyOf({ id: app, sourceCode: APP })).toBe(before);
  });

  it('adds nothing for a file that is not a shader module', () => {
    expect(generatorOf()({ id: join(tempDir(), 'host.ts'), sourceCode: 'export {};' })).toBe(
      undefined,
    );
  });
});
