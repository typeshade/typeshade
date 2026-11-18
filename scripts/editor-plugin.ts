// `bun run editor:plugin`: the TypeShade tsserver plugin, built against THIS working tree.
//
// The VS Code extension (`typeshade.vscode-typeshade`) bundles a pinned compiler, so in this
// repository it checks the `.shade.ts` sources with a compiler older than the one beside them,
// and reports what the working tree accepts as errors (`Unknown type "builtin"` and more). This
// script bundles the plugin's own source, from the editor repository at `EDITOR_COMMIT`, with
// the compiler's published specifiers pointed at `src/` here, and writes it to
// `.cache/editor-plugin/node_modules/@typeshade/tsserver-plugin`.
//
// tsserver resolves a global plugin in its probe locations in order, and VS Code puts the
// `js/ts.tsserver.pluginPaths` setting ahead of the extension's own directory. That setting is
// machine-scoped, so VS Code reads it from the user settings only, never from
// `.vscode/settings.json`; a relative entry there resolves against each open workspace folder.
// So the user settings name `./.cache/editor-plugin`, and this build wins over the copy the
// extension carries. The extension still has to be installed: its manifest is what names the
// plugin to tsserver. Rerun after a compiler change you want the editor to see, then run
// "TypeScript: Restart TS Server".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { SHADE_DTS } from '../src/language-service/ambient.js';

/** The editor repository's commit whose plugin source is built. Moved by hand, like a pin. */
const EDITOR_COMMIT = 'db3f4171d6ea4689d6048d2252b6553da4599906';
const EDITOR_REPO = 'https://github.com/typeshade/vscode-typeshade';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = join(root, '.cache/vscode-typeshade');
const editorDir = join(root, '.cache/editor-plugin');
const outDir = join(editorDir, 'node_modules/@typeshade/tsserver-plugin');

/** Runs git with an argument array and throws on a non-zero exit (AGENTS.md#gate-discipline). */
const git = (...args: string[]): string =>
  execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();

if (!existsSync(join(checkout, '.git'))) {
  mkdirSync(checkout, { recursive: true });
  execFileSync('git', ['init', '-q', checkout]);
  git('remote', 'add', 'origin', EDITOR_REPO);
}
if (readFileSync(join(checkout, '.git/HEAD'), 'utf8').trim() !== EDITOR_COMMIT) {
  git('fetch', '-q', '--depth', '1', 'origin', EDITOR_COMMIT);
  git('checkout', '-q', '--detach', EDITOR_COMMIT);
}

/** The specifiers the plugin imports the compiler by, as the editor's own build maps them to
 *  its submodule (`scripts/build.mjs` there), mapped to this working tree instead. */
const compiler: Record<string, string> = {
  typeshade: join(root, 'src/index.ts'),
  'typeshade/language-service': join(root, 'src/language-service/index.ts'),
  'typeshade/debug': join(root, 'src/debug.ts'),
  'typeshade/runtime': join(root, 'src/runtime.ts'),
};

// `typescript` is inlined, for the editor build's reason: the bundled compiler reads its own
// `ts.SyntaxKind`, and the plugin reads tsserver's nodes only through the instance it is handed.
await build({
  entryPoints: [join(checkout, 'packages/tsserver-plugin/src/index.ts')],
  outfile: join(outDir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  alias: compiler,
  logLevel: 'warning',
  // The compiler is ESM source going into a CommonJS bundle, and `core/diagnostics/loc.ts`
  // reads `import.meta.url`.
  define: { 'import.meta.url': '__typeshadeModuleUrl' },
  banner: {
    js: "const __typeshadeModuleUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  // tsserver calls the module object itself, so the export has to be the factory.
  footer: { js: 'module.exports = module.exports.init;' },
});
writeFileSync(
  join(outDir, 'package.json'),
  `${JSON.stringify({ name: '@typeshade/tsserver-plugin', version: '0.0.0-working-tree', main: 'index.js' }, null, 2)}\n`,
);
// The ambient declarations every "use typeshade" file sees, as a file to read: the language
// service loads them only as a virtual library, so go-to-definition on `f32` or `mix` opens
// nothing. Written from `SHADE_DTS` on every run, never kept beside it.
writeFileSync(join(editorDir, 'lib.typeshade.d.ts'), SHADE_DTS);
console.log(
  `Built the tsserver plugin (editor ${EDITOR_COMMIT.slice(0, 7)}) against ${root} into ${outDir}, ` +
    `and the ambient declarations into ${join(editorDir, 'lib.typeshade.d.ts')}.`,
);
