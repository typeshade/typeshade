// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
// A whole retained target still has the alias's host identity and only its public exports.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { typeshade } from '../../vite.js';
import { runCli, type CliHost } from '../../cli/run.js';

const dir = mkdtempSync(join(tmpdir(), 'typeshade-pure-alias-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, 'new'));
const D = '"use typeshade";\n';
const target = join(dir, 'new/body.shade.ts');
const alias = join(dir, 'alias.shade.ts');
const chain = join(dir, 'chain.shade.ts');
const source =
  D +
  `
interface Params { gain: f32; }
declare const unused: uniform<Params>;
declare const live: uniform<Params>;
function uncalled(): f32 { return 9.; }
const hidden = compute([1], function hidden(): void {});
export const fs = fragment(function fs(): vec4 { return vec4(live.gain); });
export function answer(): f32 { return 7.; }
export function scale(xs: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) { xs[i] *= 2.; }
}
`;
const files: Record<string, string> = {
  [target]: source,
  [alias]: D + 'export * from "./new/body.shade.ts";',
  [chain]: D + 'export * from "./alias.shade.ts";',
};
for (const [file, text] of Object.entries(files)) writeFileSync(file, text);
const readDocument = (file: string) => files[file];
const runtime = resolve(__dirname, '../../core/host-runtime.ts');
const origins = (code: string) =>
  [...code.matchAll(/"fuse":\{"origin":("(?:\\.|[^"\\])*")/g)].map(
    (m) => JSON.parse(m[1]!) as string,
  );
function face(file: string, options: { origin?: string; fuse?: boolean } = {}) {
  const result = hostFace(files[file]!, { fileName: file, readDocument, runtime, ...options });
  expect(result.diagnostics).toEqual([]);
  expect(result.code).toBeDefined();
  expect(result.view).toBeDefined();
  return result as Required<typeof result>;
}

async function load(file: string) {
  const generated = join(
    dir,
    `${file === target ? 'direct' : file === alias ? 'alias' : 'chain'}.mjs`,
  );
  writeFileSync(generated, face(file, { fuse: false }).code);
  return import(/* @vite-ignore */ pathToFileURL(generated).href);
}

describe('pure aliases through the host paths', () => {
  it('preserves the manifest inventory while keeping private names and unused bindings off host calls', async () => {
    for (const file of [target, alias, chain]) {
      const f = face(file);
      expect(f.exports.map((e) => e.name)).toEqual(['fs', 'answer', 'scale']);
      const entry = f.exports.find((e) => e.name === 'fs');
      expect(entry?.kind).toBe('fragment');
      if (entry?.kind !== 'fragment') throw new Error('missing fragment');
      expect(entry.entry.bindings.map((b) => b.name)).toEqual(['live']);
      const loaded = await load(file);
      expect(Object.keys(loaded).sort()).toEqual(['answer', 'default', 'fs', 'scale']);
      expect(loaded.answer()).toBe(7);
      expect(
        loaded.default.bindings.map((b: { name: string; group: number; binding: number }) => [
          b.name,
          b.group,
          b.binding,
        ]),
      ).toEqual([
        ['unused', 0, 0],
        ['live', 0, 1],
      ]);
      expect(loaded.default.entries.map((e: { name: string }) => e.name)).toEqual(['hidden', 'fs']);
    }
  });

  it('keeps requested headers, dependency files and exact fusion origins', () => {
    const direct = face(target);
    for (const file of [alias, chain]) {
      const f = face(file);
      expect(f.code.split('\n')[0]).toContain(file.split('/').pop());
      expect(f.view.split('\n')[0]).toContain(file.split('/').pop());
      expect(f.code).not.toBe(direct.code);
      expect(origins(f.code)).toEqual([file]);
      expect(f.files).toEqual(file === alias ? [alias, target] : [chain, alias, target]);
      for (const origin of ['', 'shared/origin'])
        expect(origins(face(file, { origin }).code)).toEqual([origin]);
      expect(origins(face(file, { fuse: false }).code)).toEqual([]);
    }
    expect(origins(direct.code)).toEqual([target]);
  });

  it('keeps required and empty entry typing in host tsc and the host language service', async () => {
    const emptyTarget = join(dir, 'empty-body.shade.ts');
    const emptyAlias = join(dir, 'empty-alias.shade.ts');
    files[emptyTarget] =
      D +
      'declare const unused: uniform<f32>; export const free = fragment(function free(): vec4 { return vec4(1.); });';
    files[emptyAlias] = D + 'export * from "./empty-body.shade.ts";';
    writeFileSync(join(dir, 'view.ts'), face(alias).view);
    writeFileSync(join(dir, 'empty-view.ts'), face(emptyAlias).view);
    const app = join(dir, 'app.ts');
    writeFileSync(
      app,
      `import { fs, answer, scale } from './view';
import { uncalled, unused, hidden } from './view';
import manifest from './view';
import { free } from './empty-view';
declare const canvas: HTMLCanvasElement;
fs(canvas);
fs(canvas, {});
fs(canvas, { live: { gain: 1 } });
free(canvas);
free(canvas, undefined);
free(canvas, {});
answer();
scale(new Float32Array(2));
void manifest;
`,
    );
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    };
    const expected = [2614, 2614, 2614, 2554, 2345];
    expect((await tscDiagnostics([app], options)).map((d) => d.code)).toEqual(expected);
    const editor = ts.createLanguageService({
      getScriptFileNames: () => [app],
      getScriptVersion: () => '0',
      getScriptSnapshot: (file) => {
        const text = ts.sys.readFile(file);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => dir,
      getCompilationSettings: () => options,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
    });
    try {
      expect(
        [...editor.getSyntacticDiagnostics(app), ...editor.getSemanticDiagnostics(app)].map(
          (d) => d.code,
        ),
      ).toEqual(expected);
    } finally {
      editor.dispose();
    }
  });

  it('writes the alias view and watches the full chain with portable Vite identity', async () => {
    for (const originNamespace of [undefined, '@acme/aliases']) {
      const watched: string[] = [];
      const plugin = typeshade({ originNamespace });
      plugin.configResolved({ command: 'build', root: dir });
      const out = await plugin.transform.call(
        { addWatchFile: (file: string) => watched.push(file) } as never,
        files[chain]!,
        chain,
      );
      expect(watched).toEqual([alias, target]);
      expect(origins(out!.code)).toEqual([
        originNamespace === undefined ? chain : JSON.stringify([originNamespace, 'chain.shade.ts']),
      ]);
      expect(readFileSync(chain.replace(/\.ts$/, '.typeshade.ts'), 'utf8')).toBe(
        hostFace(files[chain]!, { fileName: chain, readDocument }).view,
      );
      expect(out!.code).toContain('"binding":1');
    }
  });

  it('lets CLI check and sync keep the requested view while reporting private target errors there', () => {
    const outputs: string[] = [];
    const errors: string[] = [];
    const memory: Record<string, string> = { ...files };
    const host: CliHost = {
      cwd: dir,
      readFile: (file) => memory[file],
      writeFile: (file, text) => {
        memory[file] = text;
      },
      kind: (path) =>
        memory[path] === undefined
          ? Object.keys(memory).some((file) => file.startsWith(`${path}/`))
            ? 'directory'
            : undefined
          : 'file',
      list: (path) => [
        ...new Set(
          Object.keys(memory)
            .filter((file) => file.startsWith(`${path}/`))
            .map((file) => file.slice(path.length + 1).split('/')[0]!),
        ),
      ],
      stdout: (text) => outputs.push(text),
      stderr: (text) => errors.push(text),
    };
    expect(runCli(['check', chain], host, { version: 'test' })).toBe(0);
    expect(runCli(['sync', chain], host, { version: 'test' })).toBe(0);
    expect(memory[chain.replace(/\.ts$/, '.typeshade.ts')]).toBe(
      hostFace(files[chain]!, { fileName: chain, readDocument }).view,
    );
    memory[target] = source.replace('return 9.;', 'return missing;');
    expect(runCli(['check', '--format', 'short', chain], host, { version: 'test' })).toBe(1);
    expect([...outputs, ...errors].join('')).toContain('TS8022');
    expect([...outputs, ...errors].join('')).toContain('new/body.shade.ts');
  });
});
