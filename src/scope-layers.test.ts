// ═══ The layer map and the obligations of `bun run scope` place each path and owe each change ═══
//
// `scripts/scope/layers.ts` maps a repository path to the compiler layer it belongs to, and maps a
// set of layers to the obligations an implementer owes. This file proves three things on known
// answers:
//
//   1. `layerOf` gives the layer each row of its table names, one path per row, in table order.
//   2. Every tracked file under `src/`, `examples/`, `docs/`, `changes/`, `reqs/` and `scripts/`
//      maps to a layer other than `other`. The tracked list is read from git, and its size is
//      asserted, so an empty list cannot pass.
//   3. `obligations` owes the rows its layers name: `one-ir` and `docs-impact` for the IR,
//      `both-halves` and `journeys` for the front end, and only `docs-impact` for no layer.
//
// The report is a starting point, not a gate. This file pins the mapping it reports.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { layerOf, obligations } from '../scripts/scope/layers.js';
import type { Layer } from '../scripts/scope/layers.js';

// One path per row of the `layerOf` table, in table order. The last two rows are the catch-alls.
const CASES: ReadonlyArray<readonly [string, Layer]> = [
  ['docs/language-design.md', 'rules'],
  ['docs/use-typeshade-surface.md', 'surface'],
  ['src/__api__/surface.md', 'exports'],
  ['changes/README.md', 'proposals'],
  ['reqs/README.md', 'traceability'],
  ['src/compiler/ts/codes.ts', 'diagnostics'],
  ['src/compiler/ts/lower/function.ts', 'front-end'],
  ['src/language-service/index.ts', 'language-service'],
  ['src/core/ir/types.ts', 'ir'],
  ['src/core/passes/validate.ts', 'passes'],
  ['src/core/intrinsics.ts', 'intrinsics'],
  ['src/core/backends/wgsl.ts', 'wgsl'],
  ['src/core/backends/glsl.ts', 'glsl'],
  ['src/core/oracle.ts', 'oracle'],
  ['src/core/fuse-plan.ts', 'fuse'],
  ['src/core/debug/interp.ts', 'debug'],
  ['src/runtime/runtime.ts', 'runtime'],
  ['src/core/emit.ts', 'emit'],
  ['src/cli/index.ts', 'cli'],
  ['examples/__emit-goldens__/x.ts', 'goldens'],
  ['examples/hello.shade.ts', 'examples'],
  ['journeys/hello.ts', 'journeys'],
  ['AUTHORING.md', 'guide'],
  ['README.md', 'docs'],
  ['docs/roadmap.md', 'docs'],
  ['scripts/szz.ts', 'tooling'],
  ['.github/workflows/ci.yml', 'ci'],
  ['src/core/ids.ts', 'emit'],
  ['src/index.ts', 'emit'],
  ['notes/scratch.txt', 'other'],
];

const REPO = join(__dirname, '..');
const TRACKED_DIRS = ['src', 'examples', 'docs', 'changes', 'reqs', 'scripts'];

describe('layerOf maps one path per table row to its layer', () => {
  it.each(CASES)('%s is %s', (path, layer) => {
    expect(layerOf(path)).toBe(layer);
  });
});

describe('every tracked file of the repository maps to a layer', () => {
  it('maps no tracked file under the reviewed directories to other', () => {
    const tracked = execFileSync('git', ['ls-files', '--', ...TRACKED_DIRS], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 256 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .filter((line) => line !== '');
    // The count guards against an empty listing: this tree tracks well over 500 such files.
    expect(tracked.length).toBeGreaterThan(500);
    expect(tracked.filter((path) => layerOf(path) === 'other')).toEqual([]);
  });
});

describe('obligations owes the rows its layers name', () => {
  it('owes one-ir and docs-impact for the IR', () => {
    const ids = obligations(new Set<Layer>(['ir'])).map((o) => o.id);
    expect(ids).toContain('one-ir');
    expect(ids).toContain('docs-impact');
  });

  it('owes both-halves and journeys for the front end', () => {
    const ids = obligations(new Set<Layer>(['front-end'])).map((o) => o.id);
    expect(ids).toContain('both-halves');
    expect(ids).toContain('journeys');
  });

  it('owes only docs-impact for no layer', () => {
    const ids = obligations(new Set<Layer>()).map((o) => o.id);
    expect(ids).toEqual(['docs-impact']);
  });
});
