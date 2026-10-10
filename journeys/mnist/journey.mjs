import { fixture, initialize, reference, referenceUpdate, buffers } from './reference.mjs';

const data = fixture(11),
  model = initialize();
const count = 7,
  offset = 3,
  rate = 0.17;
const expected = reference(data, model, offset, count);
const host = buffers(data, model, count);
const batch = { count, offset, rate };
const updated = referenceUpdate(model, expected, rate);

// Each journey runs one entry in isolation. Seed only its actual input dependencies;
// never seed the output being asserted from its expected answer. Otherwise a no-op
// shader would pass the packed-package gate without writing anything.
function bindingsFor(entry) {
  const bindings = Object.fromEntries(
    Object.entries(host).map(([name, value]) => [name, [...value]]),
  );
  bindings.batch = batch;
  if (entry === 'objective' || entry === 'reduce') bindings.logits = [...expected.logits];
  if (entry === 'reduce') bindings.losses = [...expected.losses];
  if (entry === 'backward') bindings.delta = [...expected.delta];
  if (entry === 'update') {
    bindings.gradW = [...expected.gradW];
    bindings.gradB = [...expected.gradB];
  }
  return bindings;
}

export default {
  title: 'MNIST softmax regression: forward, stable cross-entropy, explicit backward and SGD',
  runs: [
    ...[
      ['forward', 'logits'],
      ['objective', 'losses'],
      ['objective', 'delta'],
      ['reduce', 'stats'],
      ['backward', 'gradW'],
      ['backward', 'gradB'],
    ].map(([entry, read]) => ({
      kind: 'compute',
      shader: 'softmax.shade.ts',
      entry,
      workgroups: [entry === 'backward' ? Math.ceil(7840 / 64) : 1, 1, 1],
      bindings: bindingsFor(entry),
      read,
      expected: () => [...expected[read]],
      tolerance: 2e-5,
    })),
    ...['weights', 'bias'].map((read) => ({
      kind: 'compute',
      shader: 'softmax.shade.ts',
      entry: 'update',
      workgroups: [Math.ceil(7840 / 64), 1, 1],
      bindings: bindingsFor('update'),
      read,
      expected: () => [...updated[read]],
      tolerance: 2e-5,
    })),
  ],
};
