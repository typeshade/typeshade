// Optional consumer benchmark. Build the compiler first; no production module imports this.
// Timings distinguish fresh Node/Vite startup, actual Rollup watch rebuilds and browser HMR.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const fixtures = [
  'journeys/loop-fuse/ops.shade.ts',
  'journeys/mnist/batch.shade.ts',
  'examples/path-tracer.shade.ts',
];
const hash = (text) => createHash('sha256').update(text).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const now = () => performance.now();
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => abort.abort(new Error(`Received ${signal}`)));
}

async function deadline(promise, label, ms = 60000) {
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
        onAbort = () => reject(abort.signal.reason);
        abort.signal.addEventListener('abort', onAbort, { once: true });
        if (abort.signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) abort.signal.removeEventListener('abort', onAbort);
  }
}

function inbox() {
  const pending = [];
  const buffered = [];
  return {
    push(value) {
      if (pending.length) pending.shift()(value);
      else buffered.push(value);
    },
    take(label) {
      return deadline(
        buffered.length ? Promise.resolve(buffered.shift()) : new Promise((r) => pending.push(r)),
        label,
      );
    },
  };
}

function shader(source, revision) {
  return `${source}\nexport function lifecycleRevision(): u32 { return ${revision}; }\n`;
}

function instrument(plugin) {
  const records = [];
  const transform = plugin.transform;
  plugin.transform = async function (code, id) {
    if (!id.split('?')[0].endsWith('.shade.ts')) return transform.call(this, code, id);
    const start = now();
    let failed = true;
    try {
      const result = await transform.call(this, code, id);
      failed = false;
      return result;
    } finally {
      records.push({ start, end: now(), id, sourceSha256: hash(code), failed });
    }
  };
  return { plugin, records };
}

function sliceHooks(records, start, end) {
  const selected = records.filter((r) => r.start >= start && r.end <= end);
  assert(selected.length > 0, 'The timing window must observe a shader transform');
  assert(
    selected.every((r) => !r.failed),
    'A timed shader transform failed',
  );
  return {
    calls: selected.length,
    totalMs: selected.reduce((sum, r) => sum + r.end - r.start, 0),
    intervals: selected.map((r) => ({
      startMs: r.start - start,
      durationMs: r.end - r.start,
      sourceSha256: r.sourceSha256,
    })),
  };
}

async function checkBundle(project, revision) {
  const file = join(project, 'dist/bundle.mjs');
  // Executing output inside the watch process would retain runtime module instances in its
  // heap and contaminate later compiler samples. Each correctness check gets its own Node.
  const verify = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [file, expected] = process.argv.slice(1);
const bytes = readFileSync(file);
const module = await import(pathToFileURL(file).href);
const revision = module.lifecycleRevision();
assert.equal(revision, Number(expected));
assert.equal(module.default.schema, 2);
assert.equal(typeof module.default.wgsl, 'string');
assert(Object.keys(module).length > 2, 'The workload exports must survive the library build');
const hash = (value) => createHash('sha256').update(value).digest('hex');
process.stdout.write(JSON.stringify({ revision, bundleBytes: bytes.length,
  bundleSha256: hash(bytes), wgslSha256: hash(module.default.wgsl),
  exports: Object.keys(module).sort() }));`;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', verify, file, String(revision)], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

async function child(config) {
  const { project, packageDir, source, mode, warmup } = config;
  const shaderFile = join(project, 'fixture.shade.ts');
  const importsStart = now();
  const [{ build, createServer }, { typeshade }] = await Promise.all([
    import(pathToFileURL(require.resolve('vite')).href),
    import(pathToFileURL(join(packageDir, 'dist/src/vite.js')).href),
  ]);
  const importsMs = now() - importsStart;
  const measured = instrument(typeshade());
  const configFor = (plugin = measured.plugin) => ({
    root: project,
    configFile: false,
    logLevel: 'silent',
    cacheDir: join(project, '.vite-cache'),
    plugins: [plugin],
    build: {
      outDir: join(project, 'dist'),
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: false,
      lib: { entry: join(project, 'entry.mjs'), formats: ['es'], fileName: () => 'bundle.mjs' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  if (mode === 'verify') {
    await build(configFor(typeshade()));
    const plain = await checkBundle(project, 0);
    await build(configFor());
    const wrapped = await checkBundle(project, 0);
    assert.equal(wrapped.bundleSha256, plain.bundleSha256, 'Instrumentation must preserve bytes');
    writeFileSync(shaderFile, shader(source, 1));
    await build(configFor());
    const changed = await checkBundle(project, 1);
    assert.notEqual(changed.bundleSha256, plain.bundleSha256);
    // The real artifact validator must reject an expected revision absent from this build.
    await assert.rejects(checkBundle(project, 999), /1 !== 999/);
    writeFileSync(
      shaderFile,
      `${shader(source, 2)}\nexport function invalid(): f32 { return missing; }\n`,
    );
    const mark = measured.records.length;
    await assert.rejects(build(configFor()), /does not compile/);
    assert(
      measured.records.slice(mark).some((r) => r.failed),
      'The transform must see the fault',
    );
    return { mode, instrumentationPreservesBytes: true, changedOutput: true, invalidShader: true };
  }
  if (mode === 'build') {
    const start = now();
    await build(configFor());
    const end = now();
    process.send({ event: 'build-end' });
    const timing = {
      importsMs,
      buildApiMs: end - start,
      importsAndBuildMs: end - importsStart,
      transform: sliceHooks(measured.records, start, end),
    };
    return { mode, timing, output: await checkBundle(project, 0) };
  }
  if (mode === 'watch') {
    const events = inbox();
    let watcher;
    try {
      const config = configFor();
      config.build.watch = {};
      const initialStart = now();
      watcher = await build(config);
      watcher.on('event', (event) => {
        if (event.code === 'ERROR') events.push({ error: String(event.error) });
        if (event.code === 'END') events.push({ end: now() });
      });
      const initial = await events.take('initial watch build');
      assert(!initial.error, initial.error);
      const initialOutput = await checkBundle(project, 0);
      const edits = [];
      // Revision 1 is an instrument canary, never a measured or warmup sample.
      for (let revision = 1; revision <= warmup + 2; revision++) {
        const start = now();
        const next = events.take(`watch revision ${revision}`);
        writeFileSync(shaderFile, shader(source, revision));
        const event = await next;
        assert(!event.error, event.error);
        const timing = {
          editToBuildEndMs: event.end - start,
          transform: sliceHooks(measured.records, start, event.end),
        };
        const output = await checkBundle(project, revision);
        assert.notEqual(output.bundleSha256, initialOutput.bundleSha256);
        edits.push({
          revision,
          kind: revision === 1 ? 'canary' : revision <= warmup + 1 ? 'warmup' : 'sample',
          timing,
          output,
        });
      }
      return {
        mode,
        importsMs,
        initialBuildMs: initial.end - initialStart,
        initialOutput,
        edits,
      };
    } finally {
      if (watcher) await watcher.close();
    }
  }
  assert.equal(mode, 'dev');
  const { chromium } = await import('playwright');
  const launchStart = now();
  const browser = await chromium.launch({
    executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
    headless: true,
  });
  const browserLaunchMs = now() - launchStart;
  let server;
  try {
    const page = await browser.newPage();
    const messages = inbox();
    const failures = [];
    const reloads = [];
    const navigations = [];
    page.on('pageerror', (error) => failures.push(String(error)));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await page.exposeBinding('lifecycleAck', (_, value) =>
      messages.push({ ...value, received: now() }),
    );
    await page.exposeBinding('lifecycleReload', (_, value) => reloads.push(value));
    const start = now();
    server = await createServer({
      ...configFor(),
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    const listening = now();
    const address = server.httpServer.address();
    assert(address && typeof address === 'object');
    const navigationStart = now();
    const ready = messages.take('initial browser module');
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
    const initial = await ready;
    assert.equal(initial.kind, 'initial');
    assert.equal(initial.revision, 0);
    const initialTiming = {
      serverListenMs: listening - start,
      navigationToAckMs: initial.received - navigationStart,
      serverStartToAckMs: initial.received - start,
      transform: sliceHooks(measured.records, start, initial.received),
    };
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    assert.equal(navigations.length, 1, 'Initial load must not silently reload');
    const browserOutput = async (revision) => {
      const output = await page.evaluate(() => ({
        revision: window.lifecycleModule.lifecycleRevision(),
        schema: window.lifecycleModule.default.schema,
        wgsl: window.lifecycleModule.default.wgsl,
        exports: Object.keys(window.lifecycleModule).sort(),
        timeOrigin: performance.timeOrigin,
      }));
      assert.equal(output.revision, revision);
      assert.equal(output.schema, 2);
      assert.equal(typeof output.wgsl, 'string');
      assert(output.exports.length > 2);
      assert.equal(output.timeOrigin, timeOrigin, 'HMR must keep the same document');
      assert.equal(navigations.length, 1, 'A full-page reload is not HMR');
      assert.deepEqual(reloads, [], 'Vite must not request a full reload');
      assert.deepEqual(failures, [], 'The browser must not have execution errors');
      return { revision, wgslSha256: hash(output.wgsl), exports: output.exports };
    };
    const initialOutput = await browserOutput(0);
    const edits = [];
    for (let revision = 1; revision <= warmup + 2; revision++) {
      const editStart = now();
      const next = messages.take(`HMR revision ${revision}`);
      writeFileSync(shaderFile, shader(source, revision));
      const ack = await next;
      const timing = {
        editToBrowserAckMs: ack.received - editStart,
        transform: sliceHooks(measured.records, editStart, ack.received),
      };
      assert.equal(ack.kind, 'hmr', 'The dependency-accept callback must acknowledge the edit');
      assert.equal(ack.revision, revision);
      const output = await browserOutput(revision);
      edits.push({
        revision,
        kind: revision === 1 ? 'canary' : revision <= warmup + 1 ? 'warmup' : 'sample',
        timing,
        output,
      });
    }
    return {
      mode,
      importsMs,
      browserLaunchMs,
      browserVersion: browser.version(),
      initialTiming,
      initialOutput,
      edits,
      fullReloads: reloads.length,
      documentNavigations: navigations.length,
    };
  } finally {
    const closed = await Promise.allSettled([browser.close(), server?.close()]);
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
  }
}

function prepareProject(dir, source, packageDir) {
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'vite-lifecycle-consumer', private: true, type: 'module' }),
  );
  symlinkSync(packageDir, join(dir, 'node_modules/typeshade'), 'junction');
  writeFileSync(join(dir, 'fixture.shade.ts'), shader(source, 0));
  writeFileSync(
    join(dir, 'entry.mjs'),
    'export * from "./fixture.shade.ts";\nexport { default } from "./fixture.shade.ts";\n',
  );
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><title>Vite lifecycle</title><script type="module" src="/app.mjs"></script>',
  );
  writeFileSync(
    join(dir, 'app.mjs'),
    `import * as initial from './fixture.shade.ts';
function accept(module, kind) {
  window.lifecycleModule = module;
  window.lifecycleAck({ kind, revision: module.lifecycleRevision() });
}
accept(initial, 'initial');
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', (event) => window.lifecycleReload(event));
  import.meta.hot.accept('./fixture.shade.ts', (module) => accept(module, 'hmr'));
}
`,
  );
}

async function runChild(config, configFile) {
  writeFileSync(configFile, JSON.stringify(config));
  const start = now();
  const process = fork(fileURLToPath(import.meta.url), ['--child', configFile], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: platform() !== 'win32',
  });
  let logs = '';
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('data', (data) => {
      logs = (logs + data.toString()).slice(-16000);
    });
  }
  let result;
  let spawnToBuildEndMs;
  let failed = true;
  process.on('message', (message) => {
    if (message.event === 'build-end') spawnToBuildEndMs = now() - start;
    if (message.result) result = message.result;
  });
  const exited = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => {
      if (code === 0 && result) resolve({ ...result, spawnToBuildEndMs });
      else reject(new Error(`Benchmark child failed (${code ?? signal}):\n${logs}`));
    });
  });
  try {
    const value = await deadline(exited, `${config.mode} ${config.fixture}`, 120000);
    failed = false;
    return value;
  } finally {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGTERM');
      const kill = setTimeout(() => {
        try {
          if (platform() === 'win32') process.kill('SIGKILL');
          else globalThis.process.kill(-process.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }, 5000);
      await exited.catch(() => {});
      clearTimeout(kill);
    }
    // The Node child may already have exited while an owned browser/service process remains.
    if (failed && platform() !== 'win32') {
      try {
        globalThis.process.kill(-process.pid, 'SIGKILL');
      } catch {
        /* The owned process group has already exited. */
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      child: { type: 'string' },
      samples: { type: 'string', default: '3' },
      warmup: { type: 'string', default: '2' },
      output: { type: 'string', default: 'artifacts/vite-lifecycle.json' },
      fixture: { type: 'string' },
      verify: { type: 'boolean', default: false },
    },
  });
  if (values.child) {
    const result = await child(json(values.child));
    await new Promise((resolve, reject) =>
      process.send({ result }, (error) => (error ? reject(error) : resolve())),
    );
    process.disconnect();
    return;
  }
  const samples = Number(values.samples),
    warmup = Number(values.warmup);
  assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 50);
  assert(Number.isSafeInteger(warmup) && warmup >= 0 && warmup <= 20);
  const selected = values.fixture ? fixtures.filter((f) => f.includes(values.fixture)) : fixtures;
  assert(selected.length > 0, 'No matching fixture');
  assert(existsSync(join(root, 'dist/src/vite.js')), 'Run bun run build first');
  const staging = mkdtempSync(join(tmpdir(), 'typeshade-vite-lifecycle-'));
  const report = {
    startedAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
    node: process.version,
    bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(),
    harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    lockfileSha256: hash(readFileSync(join(root, 'bun.lock'))),
    cpu: cpus()[0]?.model,
    platform: platform(),
    versions: Object.fromEntries(
      ['vite', 'typescript', 'playwright'].map((name) => [
        name,
        json(require.resolve(`${name}/package.json`)).version,
      ]),
    ),
    samples: values.verify ? 1 : samples,
    warmup: values.verify ? 0 : warmup,
    verificationOnly: values.verify,
    measurement:
      'Fresh Node processes and Vite cache directories, warm OS cache. Hook time includes compiler, filesystem and host-view work. Browser acknowledgements include Playwright binding delivery. No GPU calls are timed.',
    configuration: {
      minify: 'esbuild',
      build: 'ES library retaining all exports and default manifest',
      plugin: 'typeshade() defaults',
      dependencyOptimization: 'Vite defaults including plugin include list',
      packagePreparation:
        'Copied build and source trees with derived publish manifest; installation is outside timing',
    },
    fixtures: [],
  };
  try {
    const packageDir = join(staging, 'package');
    mkdirSync(packageDir);
    for (const directory of ['dist', 'src', 'examples'])
      cpSync(join(root, directory), join(packageDir, directory), { recursive: true });
    mkdirSync(join(packageDir, 'node_modules'));
    symlinkSync(
      dirname(require.resolve('typescript/package.json')),
      join(packageDir, 'node_modules/typescript'),
      'junction',
    );
    const derive = `import { readFileSync } from 'node:fs'; import { derivePublishManifest, verifyTargets } from ${JSON.stringify(join(root, 'scripts/publish-manifest.ts'))}; import { stampBuildInfo } from ${JSON.stringify(join(root, 'scripts/build-info.ts'))}; const p=derivePublishManifest(JSON.parse(readFileSync(${JSON.stringify(join(root, 'package.json'))}, 'utf8'))); const missing=verifyTargets(p,${JSON.stringify(packageDir)}).filter(x=>!x.ok); if(missing.length)throw new Error(JSON.stringify(missing)); const verifiedRevision=stampBuildInfo(${JSON.stringify(root)},${JSON.stringify(packageDir)}); process.stdout.write(JSON.stringify({ manifest:p, verifiedRevision }));`;
    const prepared = JSON.parse(
      execFileSync('bun', ['-e', derive], { cwd: root, encoding: 'utf8' }),
    );
    if (!values.verify) {
      assert.equal(
        prepared.verifiedRevision,
        report.revision,
        'Timed runs require a verified clean-HEAD build: commit changes, then bun run build first',
      );
    }
    const manifest = JSON.stringify(prepared.manifest);
    writeFileSync(join(packageDir, 'package.json'), manifest);
    report.verifiedBuildRevision = prepared.verifiedRevision;
    report.packageManifestSha256 = hash(manifest);
    report.buildReceipt = json(join(root, 'dist/.typeshade-build.json'));
    for (const fixture of selected) {
      const source = readFileSync(join(root, fixture), 'utf8');
      assert(!source.includes('lifecycleRevision'));
      assert(!/^\s*import\s/m.test(source), 'A new fixture import needs explicit staging support');
      const row = { fixture, sourceSha256: hash(source), runs: [] };
      report.fixtures.push(row);
      const modes = [
        'verify',
        ...Array.from({ length: report.samples }, () => ['build', 'watch', 'dev']).flat(),
      ];
      for (const [index, mode] of modes.entries()) {
        const project = join(staging, `project-${report.fixtures.length}-${index}`);
        prepareProject(project, source, packageDir);
        const result = await runChild(
          { project, packageDir, source, fixture, mode, warmup: report.warmup },
          join(staging, 'child.json'),
        );
        row.runs.push(result);
        console.log(
          JSON.stringify({
            fixture,
            mode,
            sample: index ? Math.ceil(index / 3) : null,
            status: 'passed',
          }),
        );
        rmSync(project, { recursive: true, force: true });
      }
    }
    const output = resolve(values.output);
    report.completedAt = new Date().toISOString();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Vite lifecycle checks passed; raw measurements: ${output}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
