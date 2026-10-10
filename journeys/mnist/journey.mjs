import { fixture, initialize, reference, referenceUpdate, buffers } from './reference.mjs';
const data = fixture(11),
  model = initialize();
const count = 7,
  offset = 3,
  rate = 0.17;
const expected = reference(data, model, offset, count);
const host = buffers(data, model, count);
const batch = { count, offset, rate };
const bindings = Object.fromEntries(
  Object.entries(host).map(([name, value]) => [name, [...value]]),
);
Object.assign(bindings, {
  batch,
  logits: [...expected.logits],
  losses: [...expected.losses],
  delta: [...expected.delta],
  gradW: [...expected.gradW],
  gradB: [...expected.gradB],
});
const updated = referenceUpdate(model, expected, rate);
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
      bindings,
      read,
      expected: () => [...expected[read]],
      tolerance: 2e-5,
    })),
    ...['weights', 'bias'].map((read) => ({
      kind: 'compute',
      shader: 'softmax.shade.ts',
      entry: 'update',
      workgroups: [Math.ceil(7840 / 64), 1, 1],
      bindings,
      read,
      expected: () => [...updated[read]],
      tolerance: 2e-5,
    })),
  ],
};
