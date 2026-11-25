import { describe, expect, it } from 'vitest';
import { createContextFromSources } from '../scripts/code-shape/context.js';
import { layer, layerSignal, summariseLayer } from '../scripts/code-shape/layer.js';

const POLICY = {
  mayImport: { core: [], rhi: ['core'], runtime: ['core', 'rhi'] },
  known: ['core/low.ts -> rhi/known.ts'],
};

const SOURCES = {
  'src/core/low.ts': `import { r } from '../rhi/known.js';\nimport { s } from '../rhi/fresh.js';\nimport type { q } from '../runtime/up.js';\nexport const c = [r, s];\nexport type Q = typeof q;\n`,
  'src/core/clean.ts': `export const clean = 1;\n`,
  'src/rhi/known.ts': `export const r = 1;\n`,
  'src/rhi/fresh.ts': `export const s = 1;\n`,
  'src/rhi/ok.ts': `import { clean } from '../core/clean.js';\nexport const ok = clean;\n`,
  'src/runtime/up.ts': `import { r } from '../rhi/known.js';\nexport const q = r;\n`,
  'src/index.ts': `import { clean } from './core/clean.js';\nexport const i = clean;\n`,
};

describe('the layer signal', () => {
  const ctx = createContextFromSources(SOURCES);
  const findings = layerSignal(POLICY)(ctx);

  it('finds a lower layer that imports a higher one, one finding for each file', () => {
    expect(findings.map((finding) => finding.file)).toEqual(['src/core/low.ts']);
    expect(findings[0]).toMatchObject({
      signal: 'layer',
      line: 1,
      remedy: 'move the file',
      kind: 'layer-edge',
      evidence: { edges: 3, knownEdges: 1, newEdges: 2, typeOnlyEdges: 1 },
    });
  });

  it('lists the targets and the edges that are not in KNOWN', () => {
    expect(findings[0]!.evidence.targets).toEqual([
      'rhi/known.ts',
      'rhi/fresh.ts',
      'runtime/up.ts',
    ]);
    expect(findings[0]!.evidence.newEdgeList).toEqual([
      'core/low.ts -> rhi/fresh.ts',
      'core/low.ts -> runtime/up.ts',
    ]);
  });

  it('does not report an allowed edge or an import of a file directly in src', () => {
    const files = findings.map((finding) => finding.file);
    expect(files).not.toContain('src/rhi/ok.ts');
    expect(files).not.toContain('src/runtime/up.ts');
    expect(files).not.toContain('src/index.ts');
  });

  it('reads every file the policy test reads: a testing helper counts, a test file does not', () => {
    const more = createContextFromSources({
      ...SOURCES,
      'src/core/testing/helper.ts': `import { r } from '../../rhi/known.js';\nexport const h = r;\n`,
      'src/core/low.test.ts': `import { r } from '../rhi/known.js';\nexport const t = r;\n`,
      'src/core/fixtures/input.ts': `import { r } from '../../rhi/known.js';\nexport const f = r;\n`,
      'src/core/dynamic.ts': `export const d = import('../rhi/known.js');\n`,
    });
    const files = layerSignal(POLICY)(more).map((finding) => finding.file);
    expect(files.sort()).toEqual([
      'src/core/fixtures/input.ts',
      'src/core/low.ts',
      'src/core/testing/helper.ts',
    ]);
  });

  it('states which files the signal reads', () => {
    const withPolicy = createContextFromSources({
      ...SOURCES,
      'src/layer-policy.test.ts': `const MAY_IMPORT = { core: [] };\nconst KNOWN = [];\n`,
    });
    expect(summariseLayer(withPolicy, []).join('\n')).toContain(
      'every file of src/ except *.test.ts',
    );
  });

  it('reports nothing without a policy', () => {
    expect(layerSignal(undefined)(ctx)).toEqual([]);
  });

  it('reads the policy from the source text of the policy test in the program', () => {
    const withPolicy = createContextFromSources({
      ...SOURCES,
      'src/layer-policy.test.ts': `const MAY_IMPORT = { core: [], rhi: ['core'], runtime: ['core', 'rhi'] };\nconst KNOWN = ['core/low.ts -> rhi/known.ts'];\n`,
    });
    const found = layer(withPolicy);
    expect(found.map((finding) => finding.file)).toEqual(['src/core/low.ts']);
    expect(summariseLayer(withPolicy, found).slice(0, 2)).toEqual([
      '3 edges against MAY_IMPORT, from 1 files.',
      '1 of them are in KNOWN, 2 are not.',
    ]);
  });

  it('says so when the policy was not read', () => {
    expect(summariseLayer(ctx, [])[0]).toContain('was not read');
  });
});
