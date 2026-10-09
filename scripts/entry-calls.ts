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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME = join(ROOT, 'src/core/host-runtime.ts');
const PAGE = join(ROOT, 'scripts/entry-calls-page.ts');
const RENDER_CASE = join(ROOT, 'scripts/render-case.ts');

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
    ];
    sources.forEach(({ path, id, source }, i) => {
      const face = hostFace(source, { fileName: path, runtime: RUNTIME });
      if (face.code === undefined) return;
      const entries = (face.exports ?? []).filter(
        (e): e is Extract<HostExport, { kind: 'compute' | 'fragment' }> =>
          e.kind === 'compute' || e.kind === 'fragment',
      );
      if (entries.length === 0) return;
      writeFileSync(join(dir, `m${i}.mjs`), face.code);
      imports.push(`import * as m${i} from './m${i}.mjs';`);
      for (const e of entries) {
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
            (noCpu !== undefined ? `noCpu: ${JSON.stringify(noCpu)}, ` : '') +
            (noGl !== undefined ? `noGl: ${JSON.stringify(noGl)}, ` : '') +
            `call: m${i}[${JSON.stringify(e.name)}], manifest: m${i}.default }`,
        );
      }
    });
    const main = join(dir, 'main.ts');
    writeFileSync(
      main,
      [
        `import { runEntries } from ${JSON.stringify(PAGE)};`,
        `import type { Programs } from ${JSON.stringify(RENDER_CASE)};`,
        ...imports,
        `const cases = [\n  ${cases.join(',\n  ')},\n];`,
        `const programs = ${JSON.stringify(renderPrograms())} as Programs;`,
        `const programCases = ${JSON.stringify(programCases())};`,
        `(globalThis as Record<string, unknown>)['__runEntries'] = () => runEntries(cases, programs, programCases);`,
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
