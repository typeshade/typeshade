// Version-local research adapter, checked against the compiler's keyOf on actual emit inputs.
// No optimizer calls this. New expression arms fail explicitly instead of getting a fallback.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { typeKey } from '../../dist/src/core/ir/types.js';
import { keyOf } from '../../dist/src/core/passes/opt/expr-utils.js';
import { eachExpr, eachStmtExpr } from '../../dist/src/core/ir/visit.js';

export function expressions(module) {
  const seen = new Set();
  for (const f of module.funcs)
    for (const s of f.body) eachStmtExpr(s, (e) => eachExpr(e, (x) => seen.add(x)));
  return [...seen];
}

function recipe(e) {
  switch (e.op) {
    case 'lit':
      return [['L', typeKey(e.type), Object.is(e.value, -0) ? '-0' : String(e.value)], []];
    case 'constref':
      return [['C', e.name], []];
    case 'externref':
    case 'overrideref':
      return [['O', e.name], []];
    case 'param':
      return [['P', e.name], []];
    case 'varref':
      return [['V', e.name], []];
    case 'binop':
      return [
        ['binary', e.bop],
        [e.a, e.b],
      ];
    case 'compare':
      return [
        ['binary', e.cop],
        [e.a, e.b],
      ];
    case 'logical':
      return [
        ['binary', e.lop],
        [e.a, e.b],
      ];
    case 'unop':
      return [['unary'], [e.a]];
    case 'call':
      return [['call', e.fn], e.args];
    case 'construct':
      return [['construct', typeKey(e.type)], e.args];
    case 'member':
      return [['member', e.field], [e.base]];
    case 'index':
      return [['index'], [e.base, e.idx]];
    case 'select':
      return [['select'], [e.cond, e.ifTrue, e.ifFalse]];
    case 'matchExpr':
      return [
        ['match', ...e.cases.map(([n]) => String(n))],
        [e.scrutinee, ...e.cases.map(([, v]) => v), e.default],
      ];
    default:
      throw new Error(`Unsupported expression: ${e.op}`);
  }
}

export function encode(nodes) {
  const labels = new Map(),
    indices = new Map(),
    words = [0];
  const visit = (e) => {
    if (indices.has(e)) return indices.get(e);
    const [parts, children] = recipe(e);
    const childIds = children.map(visit);
    const label = JSON.stringify(parts);
    if (!labels.has(label)) labels.set(label, labels.size);
    const id = indices.size;
    indices.set(e, id);
    words.push(labels.get(label), childIds.length, ...childIds);
    return id;
  };
  const order = nodes.map(visit);
  words[0] = indices.size;
  return { words: Uint32Array.from(words), order };
}

export function current(nodes) {
  const classes = new Map();
  return nodes.map((e) => {
    const key = keyOf(e);
    if (!classes.has(key)) classes.set(key, classes.size);
    return classes.get(key);
  });
}

export function packedJs(packet) {
  const { words, order } = packet;
  const ids = new Uint32Array(words[0]),
    classes = new Map();
  let cursor = 1;
  for (let i = 0; i < ids.length; i++) {
    const key = [words[cursor++]];
    const arity = words[cursor++];
    for (let j = 0; j < arity; j++) key.push(ids[words[cursor++]]);
    const text = key.join(',');
    if (!classes.has(text)) classes.set(text, classes.size);
    ids[i] = classes.get(text);
  }
  return order.map((i) => ids[i]);
}

export function samePartition(actual, expected) {
  assert.equal(actual.length, expected.length);
  const forward = new Map(),
    backward = new Map();
  for (let i = 0; i < actual.length; i++) {
    if (forward.has(actual[i])) assert.equal(forward.get(actual[i]), expected[i]);
    if (backward.has(expected[i])) assert.equal(backward.get(expected[i]), actual[i]);
    forward.set(actual[i], expected[i]);
    backward.set(expected[i], actual[i]);
  }
}

export async function loadWasm(path) {
  const start = performance.now();
  const bytes = readFileSync(path);
  const { instance } = await WebAssembly.instantiate(bytes);
  const { memory, alloc_words, free_words, intern_batch } = instance.exports;
  return {
    bytes: bytes.length,
    startupMs: performance.now() - start,
    run({ words, order }) {
      const count = Math.max(words[0], 1);
      const input = alloc_words(words.length),
        output = alloc_words(count);
      if (!input || !output) {
        if (input) free_words(input, words.length);
        if (output) free_words(output, count);
        throw new Error('WASM allocation refused');
      }
      try {
        new Uint32Array(memory.buffer, input, words.length).set(words);
        assert.equal(intern_batch(input, words.length, output, count), 0);
        const ids = new Uint32Array(memory.buffer, output, count);
        return order.map((i) => ids[i]);
      } finally {
        free_words(output, count);
        free_words(input, words.length);
      }
    },
  };
}
