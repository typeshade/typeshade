// The device-counts journey (change 0094): `keepAbove`, `gather` and `sumInto`, the three kernel
// functions of the example `kernel-device-counts`, called over `Resident` arrays inside one `fuse`
// scope (`host.mjs`). `keepAbove` pushes after a length that a `Resident` holds (part 2), `gather`
// reads its trip count from that word (part 1), and `sumInto` sums over the word, capped by
// `out.length`, and stores the sum after its loop (parts 1 and 3). On WebGPU each call is a group
// of its own, all in the one submission of the plan, and the device maps no buffer until the
// host's four reads after the scope: nothing is read back between the calls. On WebGL2 `gather`
// draws and the two others run on the CPU tier, and on the CPU tier the three run as written. The
// length, the list, the gathered values and the sum are held to the plain-JavaScript reference
// below on every tier.
//
// The inputs are multiples of 1/16 in [0, 1], so every sum is exact in `f32`, in any order, and
// the tolerance is 0. The list starts with two entries the host put there, so the pushes start at
// index 2. Its capacity holds every index, so no push is past its end.

const N = 1000;
const xs = Array.from({ length: N }, (_, i) => ((i * 37) % 17) / 16);
const t = 0.5;
const held = [3, 7];
const capacity = N + held.length;

/** The chain in plain JavaScript: the list after the pushes, its length, the gathered values and
 *  their sum, as the host reads them back. */
function reference() {
  const list = [...held];
  xs.forEach((x, i) => {
    if (x > t) list.push(i);
  });
  const out = list.map((i) => xs[i]);
  const sum = out.reduce((s, x) => s + x, 0);
  const pad = (a) => [...a, ...Array(capacity - a.length).fill(0)];
  return [list.length, ...pad(list), ...pad(out), sum];
}

const calls = ['keepAbove', 'gather', 'sumInto'];

export default {
  title: 'Counts that stay on the device',
  runs: [
    {
      kind: 'fuse',
      host: 'host.mjs',
      inputs: { xs, t, held, capacity },
      expected: reference,
      tolerance: 0,
      calls,
      // On WebGPU each call is a group of its own, and says why. `keepAbove` is three dispatches
      // (count, scan, store); `gather` a range entry and its loop, dispatched indirectly; `sumInto`
      // a range entry, its loop and one fold level, both indirect, and the entry that stores after
      // the loop. The device maps no buffer but the four the host reads after the scope.
      webgpu: {
        groups: calls.map((c) => [c]),
        why: [
          undefined,
          'keepAbove and gather run as two dispatches because gather reads its trip count from an array',
          'gather and sumInto run as two dispatches because sumInto reads its trip count from an array',
        ],
        dispatches: 9,
        indirect: 3,
        submissions: 1,
        maps: 4,
      },
      // On WebGL2 `gather` draws; `keepAbove` and `sumInto` have no program there and run on the
      // CPU tier, which says nothing of why.
      webgl2: { dispatches: 1, why: [undefined, 'WebGL2 runs the calls apart', undefined] },
      reads: 4,
    },
  ],
};
