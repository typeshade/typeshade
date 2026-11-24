import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from './host-face.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function load(
  source: string,
): Promise<Record<string, new () => Record<string, () => number>>> {
  const host = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(host.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-members-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, host.code!);
  return await import(/* @vite-ignore */ pathToFileURL(file).href);
}

describe('the members of an exported class that extends another', () => {
  const SOURCE = `"use typeshade";
export class Shape {
  r: f32 = 1.;
  area(): f32 { return this.r; }
  scaled(): f32 { return this.r * 5.; }
}
export class Circle extends Shape {
  area(): f32 { return this.r * 3.; }
}
`;

  it('runs the nearest declaration of each name, the class below over the class above', async () => {
    const m = await load(SOURCE);
    expect(new m.Circle!().area!()).toBe(3);
    expect(new m.Shape!().area!()).toBe(1);
    expect(new m.Circle!().scaled!()).toBe(5);
  });

  it('declares each name once in a class, and not again for the class it overrides', () => {
    const host = hostFace(SOURCE, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    const code = host.code!;
    expect(code.match(/"area"\(\)/g)).toHaveLength(2);
    expect(code.match(/n: "Circle\.area"/g)).toHaveLength(1);
  });
});
