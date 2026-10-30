// Copy beside a fresh consumer's package.json, then run with Node. No repository imports.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(root, 'node_modules', 'typeshade');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'typeshade');
const entries = Object.entries(pkg.exports).filter(([, target]) => target.import);
assert(entries.some(([name]) => name === '.'));
assert(entries.some(([name]) => name === './vite'));
for (const [name] of entries) {
  await import(name === '.' ? 'typeshade' : `typeshade/${name.slice(2)}`);
}

const { compile } = await import('typeshade');
const source = '"use typeshade";\nexport function square(x: f32): f32 { return x * x; }\n';
const result = compile(source);
assert.deepEqual(
  result.diagnostics.filter((d) => d.category === 'error'),
  [],
);
assert.match(result.wgsl, /fn square/);
assert.equal(result.eval('square', [3]), 9);

// Spaces exercise CLI and Vite file URL/path handling on every operating system.
const work = mkdtempSync(join(root, 'shader smoke '));
try {
  const shader = join(work, 'square.shade.ts');
  writeFileSync(shader, source);
  const cli = join(packageRoot, pkg.bin.tshc);
  const check = (file) => {
    const run = spawnSync(process.execPath, [cli, 'check', file], { cwd: work, encoding: 'utf8' });
    if (run.error) throw run.error;
    return run;
  };
  const valid = check(shader);
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
  const broken = join(work, 'broken.shade.ts');
  writeFileSync(broken, '"use typeshade";\nexport function broken(): f32 { return missing; }\n');
  const invalid = check(broken);
  assert.equal(
    invalid.status,
    1,
    `CLI must reject a broken shader: ${invalid.stdout}\n${invalid.stderr}`,
  );

  const { build } = await import('vite');
  const { typeshade } = await import('typeshade/vite');
  const entry = join(work, 'host.mjs');
  writeFileSync(entry, 'export { square } from "./square.shade.ts";\n');
  await build({
    configFile: false,
    root: work,
    plugins: [typeshade()],
    build: {
      outDir: join(work, 'dist'),
      lib: { entry, formats: ['es'], fileName: () => 'host.mjs' },
    },
  });
  const host = await import(pathToFileURL(join(work, 'dist', 'host.mjs')).href);
  assert.equal(host.square(3), 9);
  console.log(
    `Package smoke passed: ${entries.length} exports, compile/eval, CLI accept/reject, Vite host import; ${process.platform} ${process.version}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
