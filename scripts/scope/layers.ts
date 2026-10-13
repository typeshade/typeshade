// ═══ Layers: where a path sits in the compiler, and what each layer owes ═══
//
// The context pack (`bun run scope`, step 4) names the compiler layers that a set of files reaches.
// A layer is a part of the compiler with its own rule about what a change there owes: a proposal,
// the goldens, the language service, the differential gate. This file maps a repository path to
// its layer, lists the layers in pipeline order, and turns a set of layers into the obligations
// that the repository states for them.
//
// The mapping is one ordered table. The first rule that matches a path gives its layer, so a
// specific rule sits above the general one it refines (`src/core/backends/wgsl` above
// `src/core/backends/`, and `src/core/backends/` above `src/core/`).
//
// A test file takes the layer of the module it tests: the `.test.` marker is removed from the file
// name before the table is read. A test whose module has no row of its own takes the layer of its
// directory, as the directory rows say.
//
// The obligations are the rows of the table in section 7.1 of the pack specification. Each row
// cites the file that states the rule. A row appears only when its condition holds.
//
// This is a report, not a gate. CI does not run it.
//
// Usage, from the repository root:
//   import { layerOf, obligations } from './scope/layers.js';

export type Layer =
  | 'rules'
  | 'surface'
  | 'exports'
  | 'proposals'
  | 'traceability'
  | 'diagnostics'
  | 'front-end'
  | 'language-service'
  | 'ir'
  | 'passes'
  | 'intrinsics'
  | 'emit'
  | 'wgsl'
  | 'glsl'
  | 'oracle'
  | 'runtime'
  | 'fuse'
  | 'debug'
  | 'cli'
  | 'examples'
  | 'goldens'
  | 'journeys'
  | 'guide'
  | 'docs'
  | 'tooling'
  | 'ci'
  | 'other';

// Every layer, in the order of the `Layer` union.
export const LAYERS: readonly Layer[] = [
  'rules',
  'surface',
  'exports',
  'proposals',
  'traceability',
  'diagnostics',
  'front-end',
  'language-service',
  'ir',
  'passes',
  'intrinsics',
  'emit',
  'wgsl',
  'glsl',
  'oracle',
  'runtime',
  'fuse',
  'debug',
  'cli',
  'examples',
  'goldens',
  'journeys',
  'guide',
  'docs',
  'tooling',
  'ci',
  'other',
];

// The layers a change passes through, from authoring to execution.
export const PIPELINE: readonly Layer[] = [
  'front-end',
  'ir',
  'passes',
  'intrinsics',
  'emit',
  'wgsl',
  'glsl',
  'oracle',
  'runtime',
];

export interface Obligation {
  readonly id: string;
  readonly when: string; // the condition, as the table writes it: 'ir or passes', 'always'
  readonly owe: string;
  readonly source: string;
}

// A pattern names a directory when it ends in `/`, a set of names when it holds `*` (one `*`
// matches any text inside one path segment), and one file otherwise. A file pattern also matches
// the file with a further extension (`src/core/backends/wgsl` matches `wgsl.ts`).
interface LayerRule {
  readonly pattern: string;
  readonly layer: Layer;
}

// Order matters: the first match wins.
const LAYER_RULES: readonly LayerRule[] = [
  { pattern: 'docs/language-design.md', layer: 'rules' },
  { pattern: 'docs/use-typeshade-surface.md', layer: 'surface' },
  { pattern: 'src/__api__/', layer: 'exports' },
  { pattern: 'changes/', layer: 'proposals' },
  { pattern: 'reqs/', layer: 'traceability' },
  { pattern: 'src/compiler/ts/codes.ts', layer: 'diagnostics' },
  { pattern: 'src/core/diagnostics/', layer: 'diagnostics' },
  { pattern: 'src/compiler/', layer: 'front-end' },
  { pattern: 'src/language-service/', layer: 'language-service' },
  { pattern: 'src/language-service.ts', layer: 'language-service' },
  { pattern: 'src/core/ir/', layer: 'ir' },
  { pattern: 'src/core/sot.ts', layer: 'ir' },
  { pattern: 'src/core/passes/', layer: 'passes' },
  { pattern: 'src/core/intrinsics.ts', layer: 'intrinsics' },
  { pattern: 'src/core/builtins/', layer: 'intrinsics' },
  { pattern: 'src/core/builtin-ids.ts', layer: 'intrinsics' },
  { pattern: 'src/core/spec-conformance/', layer: 'intrinsics' },
  { pattern: 'src/core/backends/wgsl', layer: 'wgsl' },
  { pattern: 'src/core/backends/wgsl-*', layer: 'wgsl' },
  { pattern: 'src/core/backends/glsl', layer: 'glsl' },
  { pattern: 'src/core/backends/glsl-*', layer: 'glsl' },
  { pattern: 'src/core/glsl-*', layer: 'glsl' },
  { pattern: 'src/core/gl-*', layer: 'glsl' },
  { pattern: 'src/core/oracle.ts', layer: 'oracle' },
  { pattern: 'src/core/cpu-*', layer: 'oracle' },
  { pattern: 'src/core/fp64/', layer: 'oracle' },
  { pattern: 'src/core/scalar-arith.ts', layer: 'oracle' },
  { pattern: 'src/core/fuse-*', layer: 'fuse' },
  { pattern: 'src/fuse.ts', layer: 'fuse' },
  { pattern: 'src/core/debug/', layer: 'debug' },
  { pattern: 'src/debug.ts', layer: 'debug' },
  { pattern: 'src/runtime/', layer: 'runtime' },
  { pattern: 'src/runtime*.ts', layer: 'runtime' },
  { pattern: 'src/core/host-*', layer: 'runtime' },
  { pattern: 'src/core/manifest*', layer: 'runtime' },
  { pattern: 'src/core/resident.ts', layer: 'runtime' },
  { pattern: 'src/compute.ts', layer: 'runtime' },
  { pattern: 'src/core/compute/', layer: 'runtime' },
  { pattern: 'src/core/emit*', layer: 'emit' },
  { pattern: 'src/core/backends/', layer: 'emit' },
  { pattern: 'src/core/reflect.ts', layer: 'emit' },
  { pattern: 'src/core/std140.ts', layer: 'emit' },
  { pattern: 'src/core/vertex-layout.ts', layer: 'emit' },
  { pattern: 'src/core/fragment.ts', layer: 'emit' },
  { pattern: 'src/emit*.ts', layer: 'emit' },
  { pattern: 'src/cli/', layer: 'cli' },
  { pattern: 'examples/__emit-goldens__/', layer: 'goldens' },
  { pattern: 'scripts/__render-goldens__/', layer: 'goldens' },
  { pattern: 'examples/', layer: 'examples' },
  { pattern: 'journeys/', layer: 'journeys' },
  { pattern: 'AUTHORING.md', layer: 'guide' },
  { pattern: 'docs/', layer: 'docs' },
  { pattern: '*.md', layer: 'docs' },
  { pattern: 'scripts/', layer: 'tooling' },
  { pattern: '.github/', layer: 'ci' },
  { pattern: 'src/core/', layer: 'emit' },
  { pattern: 'src/', layer: 'emit' },
];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcherFor(pattern: string): (path: string) => boolean {
  if (pattern.endsWith('/')) {
    return (path) => path.startsWith(pattern);
  }
  if (pattern.includes('*')) {
    const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
    return (path) => re.test(path);
  }
  return (path) => path === pattern || path.startsWith(`${pattern}.`);
}

const COMPILED: ReadonlyArray<{
  readonly match: (path: string) => boolean;
  readonly layer: Layer;
}> = LAYER_RULES.map((rule) => ({ match: matcherFor(rule.pattern), layer: rule.layer }));

// True when the file name carries the `.test.` marker (`src/szz.test.ts`).
export function isTest(path: string): boolean {
  return path.slice(path.lastIndexOf('/') + 1).includes('.test.');
}

// The path of the module a file tests, or the path itself for any other file.
function moduleOf(path: string): string {
  if (!isTest(path)) return path;
  const cut = path.lastIndexOf('/') + 1;
  return path.slice(0, cut) + path.slice(cut).replace('.test.', '.');
}

// The layer of a repository path, relative to the root and with `/` separators.
export function layerOf(path: string): Layer {
  const module = moduleOf(path);
  for (const { match, layer } of COMPILED) {
    if (match(module)) return layer;
  }
  return 'other';
}

interface ObligationRule {
  readonly id: string;
  readonly when: readonly Layer[] | 'always';
  readonly owe: string;
  readonly source: string;
}

// One row per rule of section 7.1. Each row cites the file that states the rule.
const OBLIGATION_RULES: readonly ObligationRule[] = [
  {
    id: 'one-ir',
    when: ['ir', 'passes'],
    owe: 'The WGSL writer, the GLSL writer and the CPU oracle follow: one IR, three backends, one tree walk.',
    source: 'AGENTS.md#patterns',
  },
  {
    id: 'both-halves',
    when: ['front-end', 'intrinsics'],
    owe: "The language service's ambient library agrees; a test asserts `compile()` and the language service on the same source.",
    source: 'CLAUDE.md (A test reads both halves), Rule 12.7',
  },
  {
    id: 'proposal',
    when: ['rules', 'surface', 'exports', 'diagnostics', 'examples'],
    owe: 'An accepted proposal in `changes/` before the implementation.',
    source: 'changes/README.md#when-a-change-needs-one',
  },
  {
    id: 'reqs',
    when: ['rules'],
    owe: '`bun run reqs:sync`, then `python scripts/doorstop-check.py -C`.',
    source: 'CLAUDE.md (The prose follows the code)',
  },
  {
    id: 'api-surface',
    when: ['exports'],
    owe: '`bun run bake:api-surface`.',
    source: 'src/AGENTS.md',
  },
  {
    id: 'goldens',
    when: ['emit', 'wgsl', 'glsl', 'examples'],
    owe: '`bun run bake:goldens` after an intended emit change; `bun run gate:compile`.',
    source: 'AGENTS.md#tests',
  },
  {
    id: 'differential',
    when: ['fuse', 'runtime', 'oracle'],
    owe: '`bun run gate:differential`; `bun run gate:boundary` for the runtime.',
    source: 'AGENTS.md#tests',
  },
  {
    id: 'journeys',
    when: ['front-end', 'language-service', 'runtime'],
    owe: '`bun run gate:journeys` after `bun run build`; a new journey when an author can write more.',
    source: 'AGENTS.md#tests',
  },
  {
    id: 'guide',
    when: ['guide'],
    owe: "The Korean guide pages that typeshade.github.io's `check:guide` script lists.",
    source: "typeshade.github.io's CLAUDE.md",
  },
  {
    id: 'docs-impact',
    when: 'always',
    owe: '`bun run docs:impact` before the commit.',
    source: 'AGENTS.md#docs-follow-the-code',
  },
];

// The condition as text: 'ir or passes', 'rules, surface, exports, diagnostics or examples'.
function conditionText(when: readonly Layer[] | 'always'): string {
  if (when === 'always') return 'always';
  if (when.length === 1) return when[0];
  return `${when.slice(0, -1).join(', ')} or ${when[when.length - 1]}`;
}

// The obligations that hold for a set of layers, in the order of section 7.1.
export function obligations(layers: ReadonlySet<Layer>): Obligation[] {
  const out: Obligation[] = [];
  for (const rule of OBLIGATION_RULES) {
    const holds = rule.when === 'always' || rule.when.some((layer) => layers.has(layer));
    if (holds) {
      out.push({
        id: rule.id,
        when: conditionText(rule.when),
        owe: rule.owe,
        source: rule.source,
      });
    }
  }
  return out;
}
