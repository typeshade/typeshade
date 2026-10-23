import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runCli, type CliHost } from './run.js';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService } from '../language-service/service.js';

const pkg = JSON.stringify({
  name: 'app',
  type: 'module',
  devDependencies: { vite: '^7' },
  scripts: { build: 'vite build', prepare: 'echo ready', 'type-check': 'tsc --noEmit' },
});
function app(extra: Record<string, string> = {}, root = '/app') {
  const files = Object.fromEntries(
    Object.entries({ 'package.json': pkg, ...extra }).map(([name, text]) => [
      `${root}/${name}`,
      text,
    ]),
  );
  const writes: string[] = [],
    out: string[] = [],
    err: string[] = [];
  const host: CliHost = {
    cwd: root,
    readFile: (p) => files[p],
    writeFile: (p, text) => {
      files[p] = text;
      writes.push(p);
    },
    kind: (p) =>
      Object.hasOwn(files, p)
        ? 'file'
        : Object.keys(files).some((f) => f.startsWith(`${p}/`))
          ? 'directory'
          : undefined,
    list: (p) => [
      ...new Set(
        Object.keys(files)
          .filter((f) => f.startsWith(`${p}/`))
          .map((f) => f.slice(p.length + 1).split('/')[0]!),
      ),
    ],
    stdout: (s) => {
      out.push(s);
    },
    stderr: (s) => {
      err.push(s);
    },
  };
  return {
    files,
    writes,
    out,
    err,
    run: (args: string[] = ['init']) => runCli(args, host, { version: 'test' }),
  };
}
const json = (source: string) =>
  ts.parseConfigFileTextToJson('config.json', source).config as Record<string, unknown>;

describe('explicit project initialization (0085)', () => {
  it('sets up a Vite project once, preserves scripts, and prints every changed file', () => {
    const a = app();
    expect(a.run()).toBe(0);
    expect(a.writes).toHaveLength(5);
    for (const path of a.writes)
      expect(a.out.join('')).toContain(`wrote ${path.slice('/app/'.length)}`);
    const scripts = (
      JSON.parse(a.files['/app/package.json']!) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts.prepare).toBe('tshc sync --allow-empty && echo ready');
    expect(scripts.build).toBe('tshc sync --allow-empty && tshc check --allow-empty && vite build');
    expect(scripts['type-check']).toBe(
      'tshc sync --allow-empty && tshc check --allow-empty && tsc --noEmit',
    );
    expect(a.files['/app/vite.config.ts']).toContain('typeshade()');
    const before = { ...a.files };
    a.writes.length = 0;
    expect(a.run()).toBe(0);
    expect(a.writes).toEqual([]);
    expect(a.files).toEqual(before);
  });

  it('preserves JSONC comments, inherited suffixes/excludes, existing plugins and CRLF', () => {
    const config =
      '{\r\n  // host comment\r\n  "extends": "./base.json",\r\n  "compilerOptions": { "strict": true },\r\n}\r\n';
    const a = app({
      'tsconfig.json': config,
      'base.json':
        '{ "compilerOptions": { "moduleSuffixes": [".native", ""], "noEmit": true }, "exclude": ["cache"] }',
      'vite.config.ts':
        "// license\nimport { defineConfig } from 'vite';\nimport react from 'react-plugin';\nexport default defineConfig({ plugins: [react(), /* keep */], server: {port: 1234} });\n",
      '.gitignore': '# keep\r\ncache',
    });
    expect(a.run()).toBe(0);
    expect(a.files['/app/tsconfig.json']).toContain('// host comment\r\n');
    expect(a.files['/app/base.json']).toContain('".native"');
    const configData = json(a.files['/app/tsconfig.json']!);
    expect((configData.compilerOptions as Record<string, unknown>).moduleSuffixes).toEqual([
      '.typeshade',
      '.native',
      '',
    ]);
    expect(configData.exclude).toEqual(['cache', '**/*.shade.ts']);
    expect(a.files['/app/vite.config.ts']).toContain('react(), /* keep */');
    expect(a.files['/app/vite.config.ts']).toContain('server: {port: 1234}');
    expect(a.files['/app/.gitignore']).toBe('# keep\r\ncache\r\n*.shade.typeshade.ts\r\n');
    expect(a.run()).toBe(0);
  });

  it('selects the app project in the standard referenced Vite configuration', () => {
    const root =
      '{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}';
    const node = '{"compilerOptions":{"noEmit":true},"include":["vite.config.ts"]}';
    const a = app({
      'tsconfig.json': root,
      'tsconfig.app.json': '{"compilerOptions":{"noEmit":true},"include":["src"]}',
      'tsconfig.node.json': node,
    });
    expect(a.run()).toBe(0);
    expect(a.files['/app/tsconfig.json']).toBe(root);
    expect(a.files['/app/tsconfig.node.json']).toBe(node);
    expect(a.files['/app/tsconfig.app.json']).toContain('.typeshade');
  });

  it('selects a custom host project explicitly and retains a Windows drive', () => {
    const manifest = JSON.parse(pkg) as { scripts: Record<string, string> };
    delete manifest.scripts['type-check'];
    const a = app(
      {
        'package.json': JSON.stringify(manifest),
        'client.json': '{"compilerOptions":{"noEmit":true}}',
      },
      'D:/work app',
    );
    expect(a.run(['init', '--project', 'client.json'])).toBe(0);
    expect(a.writes.every((p) => p.startsWith('D:/work app/'))).toBe(true);
    expect(a.files['D:/work app/client.json']).toContain('.typeshade');
    expect(a.files['D:/work app/package.json']).toContain('tsc --noEmit -p ./client.json');
  });

  it.each([
    ['tsconfig.json', '{"compilerOptions":{"noEmit":false}}', 'noEmit'],
    ['tsconfig.json', '{"compilerOptions":{"moduleSuffixes":[1]}}', 'suffix'],
    ['tsconfig.json', '{"compilerOptions":{"moduleSuffixes":["", ".typeshade"]}}', 'first'],
    ['tsconfig.json', '{"compilerOptions":{},"compilerOptions":{}}', 'duplicate'],
    ['tsconfig.json', '{"references":[{"path":"./client.json"}]}', 'ambiguous'],
    ['tsconfig.json', '{broken', 'tsconfig.json:'],
    ['tsconfig.shade.json', '{"compilerOptions":{"lib":["dom"]}}', 'lib'],
    ['tsconfig.shade.json', '{"compilerOptions":{"strict":false}}', 'strict'],
    [
      'vite.config.ts',
      "import {defineConfig} from 'vite'; export default defineConfig(() => ({}));",
      'static',
    ],
    ['vite.config.ts', 'export default {...other};', 'spreads'],
    ['vite.config.ts', 'export default {plugins: makePlugins()};', 'literal array'],
    ['vite.config.ts', 'export default {plugins: [...other]};', 'spread plugin'],
    [
      'package.json',
      JSON.stringify({ devDependencies: { vite: '^7' }, scripts: { build: 42 } }),
      'scripts.build',
    ],
  ])('refuses %s conflicts before writing (%s)', (path, text, reason) => {
    const a = app({ [path]: text }),
      before = { ...a.files };
    expect(a.run()).toBe(2);
    expect(a.err.join('').toLowerCase()).toContain(reason.toLowerCase());
    expect(a.writes).toEqual([]);
    expect(a.files).toEqual(before);
  });

  it('refuses an inherited conflict and names its host configuration', () => {
    const a = app({
      'tsconfig.json': '{"extends":"./base.json"}',
      'base.json': '{"compilerOptions":{"noEmit":false}}',
    });
    expect(a.run()).toBe(2);
    expect(a.err.join('')).toContain('tsconfig.json: compilerOptions.noEmit');
    expect(a.writes).toEqual([]);
  });

  it.each([
    "import {typeshade as shader} from 'typeshade/vite'; export default {plugins:[shader({fuse:false})]};",
    "import * as shader from 'typeshade/vite'; export default {plugins:[shader /*keep*/ . typeshade()]};",
  ])('keeps an existing aliased plugin exactly as written', (config) => {
    const a = app({ 'vite.config.ts': config });
    expect(a.run()).toBe(0);
    expect(a.files['/app/vite.config.ts']).toBe(config);
    expect(a.run()).toBe(0);
  });

  it('avoids a plugin binding collision and uses .mts for a CommonJS package', () => {
    const a = app({
      'vite.config.ts': 'const typeshade = 1; export default {define: {value: typeshade}};',
    });
    expect(a.run()).toBe(0);
    expect(a.files['/app/vite.config.ts']).toContain('typeshade as typeshadePlugin1');
    const b = app({ 'package.json': JSON.stringify({ devDependencies: { vite: '^7' } }) });
    expect(b.run()).toBe(0);
    expect(b.files['/app/vite.config.mts']).toBeDefined();
  });

  it('checks the packed shader fixture with compiler and language service', () => {
    const text = readFileSync(
      new URL('../../journeys/_project-init/src/ops.shade.ts', import.meta.url),
      'utf8',
    );
    expect(compile(text).diagnostics).toEqual([]);
    const editor = createTypeshadeLanguageService();
    editor.openDocument('/app/ops.shade.ts', text);
    expect(editor.getDiagnostics('/app/ops.shade.ts')).toEqual([]);
  });

  it('allows an empty source tree only when the caller explicitly requests it', () => {
    const a = app();
    expect(a.run(['check'])).toBe(2);
    expect(a.run(['check', '--allow-empty'])).toBe(0);
    expect(a.run(['sync', '--allow-empty'])).toBe(0);
    expect(a.run(['check', '--allow-empty', '--format', 'json'])).toBe(0);
    expect(JSON.parse(a.out.at(-1)!).files).toEqual([]);
    expect(a.writes).toEqual([]);
    expect(a.run(['check', '--project', 'tsconfig.json'])).toBe(2);
    expect(a.run(['init', '--project'])).toBe(2);
  });

  it('refuses a package manifest as the host project without overwriting either plan', () => {
    const a = app(),
      before = { ...a.files };
    expect(a.run(['init', '--project=package.json'])).toBe(2);
    expect(a.err.join('')).toContain('host tsconfig');
    expect(a.files).toEqual(before);
    expect(a.writes).toEqual([]);
  });

  it('retains manual setup for a CommonJS Vite configuration', () => {
    const a = app({
      'package.json': JSON.stringify({ devDependencies: { vite: '^7' } }),
      'vite.config.ts': 'export default {};',
    });
    expect(a.run()).toBe(2);
    expect(a.err.join('')).toContain('ESM Vite');
    expect(a.writes).toEqual([]);
  });
});
