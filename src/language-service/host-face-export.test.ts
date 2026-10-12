// `hostFace` from the `typeshade/language-service` subpath (change 0062, surface §64). A tool that
// runs host code without Vite, such as a playground in a browser, computes a module's host face
// with the subpath's `hostFace` and an in-memory `readDocument`. What it gets must be what the
// Vite plugin gives an application for the same file: the same generated module and the same
// host view. The plugin writes the view beside the module, so the file is copied into a
// temporary directory and the plugin's transform runs on that copy.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostFace } from './index.js';
import { typeshade } from '../vite.js';

const EXAMPLE = new URL('../../examples/hosts/host-compute/host-compute.shade.ts', import.meta.url);
const SOURCE = readFileSync(EXAMPLE, 'utf8');

const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-face-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('hostFace from typeshade/language-service', () => {
  it('gives the code and the view the Vite plugin gives for examples/hosts/host-compute', async () => {
    const file = join(dir, 'host-compute.shade.ts');
    writeFileSync(file, SOURCE);
    const plugin = await typeshade().transform(SOURCE, file);
    const pluginView = readFileSync(join(dir, 'host-compute.shade.typeshade.ts'), 'utf8');

    // The tool's files live in memory, not on disk.
    const files = new Map([[file, SOURCE]]);
    const face = hostFace(SOURCE, { fileName: file, readDocument: (f) => files.get(f) });

    expect(face.diagnostics).toEqual([]);
    expect(face.code).toBeDefined();
    expect(face.view).toBeDefined();
    expect(face.code).toBe(plugin?.code);
    expect(face.view).toBe(pluginView);
    // The generated module imports the runtime a tool maps to the package's own copy.
    expect(face.code).toContain('typeshade/runtime/internal');
    // The face holds the compute entry the host dispatches.
    expect(face.exports?.find((e) => e.name === 'scale')?.kind).toBe('compute');
  });

  it('reports a module that does not compile through diagnostics, with no code and no view', () => {
    const broken = SOURCE.replace('xs[gid.x] * k', 'xs[gid.x] * kk');
    const face = hostFace(broken, { fileName: 'broken.shade.ts', readDocument: () => undefined });
    expect(face.diagnostics.length).toBeGreaterThan(0);
    expect(face.code).toBeUndefined();
    expect(face.view).toBeUndefined();
  });
});
