import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { hostFace } from '../../dist/src/compiler/ts/host-face.js';
import { wgslBackend } from '../../dist/src/core/backends/wgsl.js';
import { glslEs300Backend } from '../../dist/src/core/backends/glsl.js';
import { toPortable, fromPortable } from '../../dist/src/core/ir/portable.js';
import { fixpoint, irEqual } from '../../dist/src/core/passes/opt/optimize.js';
import { VERSION } from '../../dist/src/core/version.js';
import { f32T, i32T } from '../../dist/src/core/ir/types.js';
import { expressions, encode, current, packedJs, samePartition, loadWasm } from './adapter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const wasm = await loadWasm(
  join(here, 'target/wasm32-unknown-unknown/release/typeshade_ir_keys_probe.wasm'),
);
const readDocument = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
};
const checked = (nodes) => {
  const reference = current(nodes),
    packet = encode(nodes);
  samePartition(packedJs(packet), reference);
  samePartition(wasm.run(packet), reference);
};

// Distinctions that would change CSE semantics; also prove the equivalence checker sees a fault.
const leaves = [
  { op: 'lit', type: f32T, value: -0 },
  { op: 'lit', type: f32T, value: 0 },
  { op: 'lit', type: i32T, value: 0 },
  { op: 'lit', type: f32T, value: -0 },
  { op: 'lit', type: f32T, value: NaN },
  { op: 'lit', type: f32T, value: Infinity },
];
checked(leaves);
assert.throws(() => samePartition([0, 0, 0, 0, 0, 0], current(leaves)));
assert.throws(() => wasm.run({ words: new Uint32Array([1, 0, 1, 0]), order: [0] }));
let seed = 12345;
const random = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
for (let trial = 0; trial < 100; trial++) {
  const count = random(200),
    words = [count];
  for (let i = 0; i < count; i++) {
    const arity = i ? random(5) : 0;
    words.push(random(9), arity);
    for (let j = 0; j < arity; j++) words.push(random(i));
  }
  const packet = {
    words: Uint32Array.from(words),
    order: Array.from({ length: count }, (_, i) => i),
  };
  samePartition(wasm.run(packet), packedJs(packet));
}

const report = {
  node: process.version,
  cpu: cpus()[0]?.model,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  wasmBytes: wasm.bytes,
  startupMs: wasm.startupMs,
  warmup: 8,
  samples: 31,
  fixtures: [],
};
for (const file of [
  'journeys/loop-fuse/ops.shade.ts',
  'journeys/mnist/batch.shade.ts',
  'examples/path-tracer.shade.ts',
  'examples/fp64-mandelbrot-de-twin.shade.ts',
]) {
  const fileName = join(root, file),
    source = readFileSync(fileName, 'utf8');
  const options = { fileName, readDocument };
  const originalFace = hostFace(source, options);
  assert.equal(typeof originalFace.code, 'string');
  const inputs = [];
  const originals = [wgslBackend.optimize, glslEs300Backend.optimize];
  try {
    for (const [i, backend] of [wgslBackend, glslEs300Backend].entries()) {
      backend.optimize = (m) => {
        if (m.funcs.length) inputs.push(m);
        return originals[i](m);
      };
    }
    const face = hostFace(source, options);
    for (const key of ['code', 'view', 'diagnostics', 'files'])
      assert.deepEqual(face[key], originalFace[key]);
  } finally {
    [wgslBackend.optimize, glslEs300Backend.optimize] = originals;
  }
  assert(inputs.length > 0);
  const captured = inputs.map((m) => ({
    portable: toPortable(m, VERSION),
    nodes: expressions(m).length,
  }));
  for (const { portable } of captured) checked(expressions(fromPortable(portable)));
  // Batch the largest actual optimizer input, not the authored kernel module (whose default
  // emit strips kernel functions and can misleadingly report almost no optimization work).
  const largest = captured.reduce((a, b) => (a.nodes >= b.nodes ? a : b));
  assert(largest.nodes >= 20);
  const times = Object.fromEntries(
    ['currentCold', 'currentWarm', 'packedJsTotal', 'wasmTotal', 'encode', 'wasmPrepared'].map(
      (k) => [k, []],
    ),
  );
  const passes = new Map();
  const profiled = fixpoint(fromPortable(largest.portable), undefined, undefined, (pass, ms) =>
    passes.set(pass, (passes.get(pass) ?? 0) + ms),
  );
  assert(irEqual(profiled, fixpoint(fromPortable(largest.portable))));
  for (let i = 0; i < report.warmup + report.samples; i++) {
    // Fresh identities avoid giving only JS a prewarmed WeakMap. Decoding is common setup,
    // outside the timer: this experiment starts at the compiler's existing JS Expr objects.
    const nodes = expressions(fromPortable(largest.portable));
    const methods = [
      ['currentCold', () => current(nodes)],
      ['packedJsTotal', () => packedJs(encode(nodes))],
      ['wasmTotal', () => wasm.run(encode(nodes))],
    ];
    const answers = {};
    for (const [name, run] of i % 2 ? methods.toReversed() : methods) {
      const start = performance.now();
      answers[name] = run();
      if (i >= report.warmup) times[name].push(performance.now() - start);
    }
    const measure = (name, run) => {
      const start = performance.now();
      const result = run();
      if (i >= report.warmup) times[name].push(performance.now() - start);
      return result;
    };
    measure('currentWarm', () => current(nodes));
    const packet = measure('encode', () => encode(nodes));
    measure('wasmPrepared', () => wasm.run(packet));
    samePartition(answers.packedJsTotal, answers.currentCold);
    samePartition(answers.wasmTotal, answers.currentCold);
  }
  const packet = encode(expressions(fromPortable(largest.portable)));
  const fixture = {
    file,
    optimizerInputsChecked: captured.length,
    nodes: largest.nodes,
    packetBytes: packet.words.byteLength,
    expressionArms: [...new Set(inputs.flatMap((m) => expressions(m).map((e) => e.op)))].sort(),
    passProfileMs: [...passes].sort((a, b) => b[1] - a[1]).slice(0, 5),
    timings: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, summary(v)])),
  };
  report.fixtures.push(fixture);
  console.log(JSON.stringify(fixture));
}
writeFileSync(
  process.argv[2] ?? join(here, 'results.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  'All expression partitions, capture checks, 100 generated graphs and refusal canaries passed.',
);
