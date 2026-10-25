import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageGateBrowser } from '../scripts/stage-gate-browser.js';

describe('the Node journey imports the staged shared GPU helper', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('loads as plain JS from an escaped path without TypeScript, Playwright or Bun imports', () => {
    dir = mkdtempSync(join(tmpdir(), 'gate browser #한글 '));
    const url = stageGateBrowser(dir);
    expect(url).toMatch(/^file:\/\//);
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        `
      const helper = await import(${JSON.stringify(url)});
      const settings = helper.gateBrowserSettings({}, 'win32');
      helper.assertNativeGateGpu({webgl: {renderer: 'Intel Iris', unmasked: true, lost: false}},
        {webgpu: false, webgl: true});
      let rejected = false;
      try { helper.assertNativeGateGpu({webgl: {renderer: 'SwiftShader', unmasked: true, lost: false}},
        {webgpu: false, webgl: true}); } catch { rejected = true; }
      console.log(JSON.stringify({backend: settings.backend, flags: settings.launch.args.length, rejected}));
    `,
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ backend: 'software', flags: 5, rejected: true });
  });
});
