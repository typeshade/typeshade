// ═══ The compile gate's entry-call leg, the half that runs in Node (Rule 8.24, change 0016) ═══
//
// For each `.shade.ts` example, `hostFace` writes the module the Vite plugin would generate for
// a host file that imports it. Every `@compute` and full-screen `@fragment` entry that module
// exports is listed, and all of it is bundled, with `typeshade/runtime` and the page half
// (`scripts/entry-calls-page.ts`), into one browser script. The compile gate serves that script
// to its Chromium page, which calls each entry on every tier and compares the results.
//
// The bundle is built from `src/`, not `dist/`: the gate checks what this tree calls, as the
// rest of the compile gate checks what this tree emits.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hostFace, type HostExport } from '../src/compiler/ts/host-face.js';

const ROOT = resolve(import.meta.dir, '..');
const RUNTIME = join(ROOT, 'src/core/host-runtime.ts');
const PAGE = join(ROOT, 'scripts/entry-calls-page.ts');

/** The bundle, and how many entries of each kind it calls. */
export interface EntryBundle {
  readonly js: string;
  readonly compute: number;
  readonly fragment: number;
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
    files.forEach((file, i) => {
      const path = join(examples, file);
      const face = hostFace(readFileSync(path, 'utf8'), { fileName: path, runtime: RUNTIME });
      if (face.code === undefined) return;
      const entries = (face.exports ?? []).filter(
        (e): e is Extract<HostExport, { kind: 'compute' | 'fragment' }> =>
          e.kind === 'compute' || e.kind === 'fragment',
      );
      if (entries.length === 0) return;
      writeFileSync(join(dir, `m${i}.mjs`), face.code);
      imports.push(`import * as m${i} from './m${i}.mjs';`);
      const id = file.replace(/\.shade\.ts$/, '');
      for (const e of entries) {
        if (e.kind === 'compute') compute++;
        else fragment++;
        const noCpu =
          e.kind === 'compute' && e.entry.barrier !== undefined
            ? `it reaches ${e.entry.barrier}, and a barrier has no CPU tier`
            : e.entry.noCpu;
        const noGl = e.kind === 'fragment' ? e.entry.noGl : undefined;
        cases.push(
          `{ id: ${JSON.stringify(id)}, kind: ${JSON.stringify(e.kind)}, name: ${JSON.stringify(e.name)}, ` +
            `bindings: ${JSON.stringify(e.entry.bindings)}, ` +
            (noCpu !== undefined ? `noCpu: ${JSON.stringify(noCpu)}, ` : '') +
            (noGl !== undefined ? `noGl: ${JSON.stringify(noGl)}, ` : '') +
            `call: m${i}[${JSON.stringify(e.name)}] }`,
        );
      }
    });
    const main = join(dir, 'main.ts');
    writeFileSync(
      main,
      [
        `import { runEntries } from ${JSON.stringify(PAGE)};`,
        ...imports,
        `const cases = [\n  ${cases.join(',\n  ')},\n];`,
        `(globalThis as Record<string, unknown>)['__runEntries'] = () => runEntries(cases);`,
        '',
      ].join('\n'),
    );
    const built = await Bun.build({ entrypoints: [main], target: 'browser', format: 'esm' });
    if (!built.success)
      throw new Error(`the entry bundle did not build: ${built.logs.map(String).join('\n')}`);
    return { js: await built.outputs[0]!.text(), compute, fragment };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
