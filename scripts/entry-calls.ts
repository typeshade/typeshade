// ═══ The compile gate's entry-call leg, the half that runs in Node (Rule 8.24, change 0016) ═══
//
// For each `.shade.ts` example, `hostFace` writes the module the Vite plugin would generate for
// a host file that imports it. Every `@compute` and full-screen `@fragment` entry that module
// exports is listed, and all of it is bundled, with `typeshade/runtime` and the page half
// (`scripts/entry-calls-page.ts`), into one browser script. The compile gate serves that script
// to its Chromium page, which calls each entry on every tier and compares the results. Each case
// carries the module's default export, its manifest (Rule 11.10), which the page loads into the
// program runtime (`typeshade/runtime`, change 0025) as one more tier of a compute entry. The
// bundle carries the manifests of the render case's three programs too (`scripts/render-case.ts`,
// issue #392), which the page draws through the same runtime.
//
// The bundle is built from `src/`, not `dist/`: the gate checks what this tree calls, as the
// rest of the compile gate checks what this tree emits.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFace, type HostExport } from '../src/compiler/ts/host-face.js';
import { compile, packModule } from '../src/index.js';
import { createTypeshadeLanguageService } from '../src/language-service/index.js';
import type { Pack } from '../src/runtime.js';
import { SOURCES, type Programs } from './render-case.js';
import { COMPUTE_CASES, PROGRAM_CASES } from './compute-case.js';
import { isGuard } from '../src/core/host-entry.js';
import { SAMPLER_CASES, SAMPLER_REFUSALS, type SamplerPairRun } from './sampler-pair-cases.js';
import { KERNEL_LENGTH_SOURCE } from './kernel-length-cases.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME = join(ROOT, 'src/core/host-runtime.ts');
const PAGE = join(ROOT, 'scripts/entry-calls-page.ts');
const RENDER_CASE = join(ROOT, 'scripts/render-case.ts');
const EMPTY_BINDING_FILES = ['empty-bindings', 'empty-bindings-guard'] as const;

/** The six finite host-import fixtures of change 0126. Both halves read every requested path;
 *  actual render GLSL must exist, rather than an absent compute-only result counting as equal. */
function aliasFixtures(dir: string): { imports: string[]; fixtures: string[] } {
  const readDocument = (path: string): string | undefined => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  };
  const service = createTypeshadeLanguageService({ readDocument });
  const imports: string[] = [];
  const fixtures: string[] = [];
  const reference = new Map<string, { wgsl: string; glsl: { vertex: string; fragment: string } }>();
  for (const [name, suffix] of [
    ['direct', 'target'],
    ['alias', 'one'],
    ['chain', 'chain'],
  ] as const) {
    for (const prefix of ['alias', 'alias-empty']) {
      const stem = `${prefix}-${suffix}`;
      const path = join(ROOT, 'journeys/_host-import/src', `${stem}.shade.ts`);
      const source = readDocument(path)!;
      const compiled = compile(source, { fileName: path, readDocument });
      service.openDocument(path, source);
      const diagnostics = [...compiled.diagnostics, ...service.getDiagnostics(path)];
      if (diagnostics.length || !compiled.wgsl || !compiled.glsl?.vertex || !compiled.glsl.fragment)
        throw new Error(
          `${stem}: both halves and actual WGSL/render GLSL must be clean: ` +
            diagnostics.map((d) => d.message).join('; '),
        );
      const direct = reference.get(prefix);
      if (direct === undefined) reference.set(prefix, { wgsl: compiled.wgsl, glsl: compiled.glsl });
      else if (
        compiled.wgsl !== direct.wgsl ||
        JSON.stringify(compiled.glsl) !== JSON.stringify(direct.glsl)
      )
        throw new Error(`${stem}: actual WGSL/render GLSL differs from the direct target`);
      const face = hostFace(source, { fileName: path, readDocument, runtime: RUNTIME });
      if (face.diagnostics.length || face.code === undefined)
        throw new Error(`${stem}: the generated host module is not clean`);
      const local = `${prefix === 'alias' ? 'a' : 'e'}_${name}`;
      writeFileSync(join(dir, `${stem}.mjs`), face.code);
      imports.push(`import * as ${local} from './${stem}.mjs';`);
    }
    fixtures.push(`{ name: '${name}', module: a_${name}, empty: e_${name} }`);
  }
  return { imports, fixtures };
}

/** The part of Bun's bundler this uses. The gate runs under Bun (`bun scripts/compile-gate.ts`),
 *  and the repository's type check has no Bun types, so it is named structurally. */
interface Bundler {
  build(options: { entrypoints: string[]; target: 'browser'; format: 'esm' }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** The bundle, and how many entries of each kind it calls. */
export interface EntryBundle {
  readonly js: string;
  readonly compute: number;
  readonly fragment: number;
}

/** The render case's programs (`scripts/render-case.ts`) as manifests. Each is a program an
 *  author writes, so both halves must read it clean: `compile()` with no diagnostic, and the
 *  language service with none either. */
function renderPrograms(): Programs {
  const service = createTypeshadeLanguageService();
  const out: Record<string, Pack> = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    const fileName = `render-case/${name}.shade.ts`;
    const compiled = compile(source, { fileName });
    service.openDocument(fileName, source);
    const editor = service.getDiagnostics(fileName);
    if (compiled.diagnostics.length > 0 || editor.length > 0 || compiled.module === undefined)
      throw new Error(
        `the render case's ${name} program does not compile clean: ` +
          `${[...compiled.diagnostics, ...editor].map((d) => d.message).join('; ')}`,
      );
    out[name] = packModule(compiled.module);
  }
  return out as Programs;
}

/** The program cases (`scripts/compute-case.ts`), each with its manifest. Each is a program an
 *  author writes, so both halves must read it clean, as the render case's. */
function programCases(): { name: string; case: (typeof PROGRAM_CASES)[string]; manifest: Pack }[] {
  const service = createTypeshadeLanguageService();
  return Object.entries(PROGRAM_CASES).map(([name, c]) => {
    const fileName = `program-case/${name}.shade.ts`;
    const compiled = compile(c.source, { fileName });
    service.openDocument(fileName, c.source);
    const editor = service.getDiagnostics(fileName);
    if (compiled.diagnostics.length > 0 || editor.length > 0)
      throw new Error(
        `the program case ${name} does not compile clean: ` +
          `${[...compiled.diagnostics, ...editor].map((d) => d.message).join('; ')}`,
      );
    return { name, case: c, manifest: packModule(compiled.module) };
  });
}

/** #448: read both halves, require the public GLSL refusal, and pin each stage's sampler map. */
export function samplerCases(): SamplerPairRun[] {
  const service = createTypeshadeLanguageService();
  return Object.entries(SAMPLER_CASES).map(([name, spec]) => {
    const fileName = `sampler-case/${name}.shade.ts`;
    const compiled = compile(spec.source, { fileName });
    service.openDocument(fileName, spec.source);
    const editor = service.getDiagnostics(fileName);
    service.closeDocument(fileName);
    const refused = spec.refusal !== undefined;
    const diagnostics = compiled.diagnostics;
    const expectedDiagnostic = refused
      ? diagnostics.length === 1 &&
        diagnostics[0]!.code === 'TS8015' &&
        diagnostics[0]!.message === `Backend emit failed: glsl-es300: ${SAMPLER_REFUSALS[name]!}`
      : diagnostics.length === 0;
    if (
      !expectedDiagnostic ||
      editor.length !== 0 ||
      !compiled.wgsl ||
      (refused ? compiled.glsl !== undefined : !compiled.glsl?.fragment || !compiled.glsl.vertex)
    )
      throw new Error(
        `sampler ${name}: unexpected compiler/editor result: ${JSON.stringify({ diagnostics, editor })}`,
      );
    const manifest = packModule(compiled.module);
    const v = manifest.gl?.vertices?.vs;
    const f = manifest.gl?.draws?.fs;
    const sorted = (map: Readonly<Record<string, string | null>>): string =>
      JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
    if (v === undefined || 'none' in v || sorted(v.samplers) !== sorted(spec.vertex))
      throw new Error(`sampler ${name}: incorrect vertex sampler metadata`);
    if (
      f === undefined ||
      (spec.refusal === 'stage'
        ? !('none' in f)
        : 'none' in f || sorted(f.samplers) !== sorted(spec.fragment))
    )
      throw new Error(`sampler ${name}: incorrect fragment sampler metadata`);
    return { name, manifest };
  });
}

/** Bundle every callable entry of the `.shade.ts` examples with the page half. */
export async function entryBundle(): Promise<EntryBundle> {
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-entries-'));
  try {
    const examples = join(ROOT, 'examples');
    const imports: string[] = [];
    const cases: string[] = [];
    let compute = 0;
    let fragment = 0;
    const files = readdirSync(examples)
      .filter((f) => f.endsWith('.shade.ts'))
      .sort();
    const service = createTypeshadeLanguageService();
    const sources: { path: string; id: string; source: string }[] = [
      ...files.map((file) => ({
        path: join(examples, file),
        id: file.replace(/\.shade\.ts$/, ''),
        source: readFileSync(join(examples, file), 'utf8'),
      })),
      // The compute cases (`scripts/compute-case.ts`) are programs an author writes, so both
      // halves must read each one clean, as the render case's.
      ...Object.entries(COMPUTE_CASES).map(([name, source]) => {
        const path = `compute-case/${name}.shade.ts`;
        const compiled = compile(source, { fileName: path });
        service.openDocument(path, source);
        const editor = service.getDiagnostics(path);
        if (compiled.diagnostics.length > 0 || editor.length > 0)
          throw new Error(
            `the compute case ${name} does not compile clean: ` +
              `${[...compiled.diagnostics, ...editor].map((d) => d.message).join('; ')}`,
          );
        return { path, id: `case:${name}`, source };
      }),
      // Existing packed-journey fixtures, not registered examples (change 0125). Their
      // independent pixel reference and invocation matrix run only for these two cases.
      ...EMPTY_BINDING_FILES.map((name) => {
        const path = join(ROOT, 'journeys/_host-import/src', `${name}.shade.ts`);
        const source = readFileSync(path, 'utf8');
        const compiled = compile(source, { fileName: path });
        service.openDocument(path, source);
        const diagnostics = [...compiled.diagnostics, ...service.getDiagnostics(path)];
        if (diagnostics.length > 0 || compiled.module.bindings.length !== 0)
          throw new Error(
            `the empty-binding fixture ${name} is not binding-free and clean: ` +
              diagnostics.map((d) => d.message).join('; '),
          );
        return { path, id: `case:${name}`, source };
      }),
    ];
    sources.forEach(({ path, id, source }, i) => {
      const face = hostFace(source, { fileName: path, runtime: RUNTIME });
      const emptyBindings =
        id === 'case:empty-bindings'
          ? 'plain'
          : id === 'case:empty-bindings-guard'
            ? 'guard'
            : undefined;
      if (emptyBindings !== undefined && (face.code === undefined || face.exports?.length !== 1))
        throw new Error(`${id}: expected one callable fragment fixture`);
      if (face.code === undefined) return;
      const entries = (face.exports ?? []).filter(
        (e): e is Extract<HostExport, { kind: 'compute' | 'fragment' }> =>
          e.kind === 'compute' || e.kind === 'fragment',
      );
      if (emptyBindings !== undefined && entries.length !== 1)
        throw new Error(`${id}: the fragment fixture was not callable`);
      if (entries.length === 0) return;
      writeFileSync(join(dir, `m${i}.mjs`), face.code);
      imports.push(`import * as m${i} from './m${i}.mjs';`);
      for (const e of entries) {
        if (
          emptyBindings !== undefined &&
          (e.kind !== 'fragment' ||
            e.entry.bindings.some((b) => !isGuard(b)) ||
            e.entry.bindings.length !== (emptyBindings === 'guard' ? 1 : 0) ||
            e.entry.noGl !== undefined ||
            e.entry.noCpu !== undefined)
        )
          throw new Error(`${id}: expected only the declared runtime guard and all draw tiers`);
        if (e.kind === 'compute') compute++;
        else fragment++;
        const noCpu =
          e.kind === 'compute' && e.entry.barrier !== undefined
            ? `it reaches ${e.entry.barrier}, and a barrier has no CPU tier`
            : e.entry.noCpu;
        const noGl = e.entry.noGl;
        cases.push(
          `{ id: ${JSON.stringify(id)}, kind: ${JSON.stringify(e.kind)}, name: ${JSON.stringify(e.name)}, ` +
            `bindings: ${JSON.stringify(e.entry.bindings)}, ` +
            (emptyBindings !== undefined
              ? `emptyBindings: ${JSON.stringify(emptyBindings)}, `
              : '') +
            (noCpu !== undefined ? `noCpu: ${JSON.stringify(noCpu)}, ` : '') +
            (noGl !== undefined ? `noGl: ${JSON.stringify(noGl)}, ` : '') +
            `call: m${i}[${JSON.stringify(e.name)}], manifest: m${i}.default }`,
        );
      }
    });
    const main = join(dir, 'main.ts');
    const aliases = aliasFixtures(dir);
    const lengthFile = '/kernel-lengths.shade.ts';
    const lengthHost = hostFace(KERNEL_LENGTH_SOURCE, { fileName: lengthFile, runtime: RUNTIME });
    const lengthService = createTypeshadeLanguageService();
    lengthService.openDocument(lengthFile, KERNEL_LENGTH_SOURCE);
    const lengthDiagnostics = [
      ...lengthHost.diagnostics,
      ...lengthService.getDiagnostics(lengthFile),
    ];
    lengthService.closeDocument(lengthFile);
    if (
      lengthDiagnostics.length ||
      lengthHost.code === undefined ||
      lengthHost.exports?.length !== 5 ||
      lengthHost.exports.some((entry) => entry.kind !== 'kernel' || !entry.face.gl)
    )
      throw new Error(
        `kernel lengths: both halves and all five WebGL2 kernels must be present: ${JSON.stringify(lengthDiagnostics)}`,
      );
    writeFileSync(join(dir, 'kernel-lengths.mjs'), lengthHost.code);
    compute += 3;
    fragment += 6;
    writeFileSync(
      main,
      [
        `import { runEntries } from ${JSON.stringify(PAGE)};`,
        `import type { Programs } from ${JSON.stringify(RENDER_CASE)};`,
        ...imports,
        ...aliases.imports,
        `import * as kernelLengths from './kernel-lengths.mjs';`,
        `const cases = [\n  ${cases.join(',\n  ')},\n];`,
        `const programs = ${JSON.stringify(renderPrograms())} as Programs;`,
        `const programCases = ${JSON.stringify(programCases())};`,
        `const aliases = [${aliases.fixtures.join(', ')}];`,
        `const samplerCases = ${JSON.stringify(samplerCases())};`,
        `(globalThis as Record<string, unknown>)['__runEntries'] = () => runEntries(cases, programs, programCases, aliases, samplerCases, kernelLengths);`,
        '',
      ].join('\n'),
    );
    const bun = (globalThis as { Bun?: Bundler }).Bun;
    if (bun === undefined) throw new Error('the entry bundle needs Bun: run the gate with bun');
    const built = await bun.build({ entrypoints: [main], target: 'browser', format: 'esm' });
    if (!built.success)
      throw new Error(`the entry bundle did not build: ${built.logs.map(String).join('\n')}`);
    return { js: await built.outputs[0]!.text(), compute, fragment };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
