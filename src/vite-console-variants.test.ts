// Verifies: Rule 11.9, Rule 11.10.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bothTake } from './core/testing/both-halves.js';
import { typeshade } from './vite.js';

const SOURCE = `"use typeshade";
declare const ys: storage<array<f32>, "read_write">;
@compute([1]) export function note(gid: builtin<"global_invocation_id">) { console.log("n", gid.x); ys[0] = 1.; }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function manifestOf(options: Parameters<typeof typeshade>[0], command: 'build' | 'serve') {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-variants-'));
  dirs.push(dir);
  const plugin = typeshade(options);
  plugin.configResolved({ command });
  const code = (await plugin.transform(SOURCE, join(dir, 'note.shade.ts')))!.code;
  return { code, manifest: JSON.parse(/^export default (\{.*\});$/m.exec(code)![1]!) };
}

describe('the plugin retains a console variant in a build (change 0085)', () => {
  it('reads the source in both halves', () => {
    bothTake(SOURCE);
  });

  it('retains a disabled variant without IR and keeps the ordinary WGSL quiet', async () => {
    const { code, manifest } = await manifestOf(undefined, 'build');
    expect(code).not.toContain('__ts_console');
    expect(manifest.console).toBeUndefined();
    expect(manifest.ir).toBeUndefined();
    expect(manifest.wgsl).not.toContain('_console');
    expect(manifest.variants.console.wgsl).toContain('_console');
  });

  it("omits the variant with console: 'never'", async () => {
    const { manifest } = await manifestOf({ console: 'never' }, 'build');
    expect(manifest.variants).toBeUndefined();
    expect(manifest.console).toBeUndefined();
  });

  it('keeps the legacy enabled variant in vite dev', async () => {
    const { manifest } = await manifestOf(undefined, 'serve');
    expect(manifest.console.wgsl).toContain('_console');
    expect(manifest.variants).toBeUndefined();
  });
});
