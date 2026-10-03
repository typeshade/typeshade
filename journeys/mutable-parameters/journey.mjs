// An independent host reference: a method and closure rebind a value parameter while
// the caller keeps its original input. Dyadic inputs make every arithmetic step exact.
function expected() {
  const output = [];
  for (let i = 0; i < 4; i++) {
    const col = [i / 8, 0.25, 0.5];
    const original = col.slice();
    let local = col.slice();
    const brighten = () => {
      local = local.map((v) => v + 0.125);
    };
    brighten();
    local = local.map((v) => v * 2);
    output.push(...original.map((v, j) => v + local[j]), col[0]);
  }
  return output;
}

export default {
  title: 'A method reassigns a value parameter and shares it with a closure',
  runs: [
    {
      kind: 'compute',
      shader: 'mutable-parameters.shade.ts',
      entry: 'paint',
      workgroups: [4, 1, 1],
      bindings: { out: new Array(16).fill(0) },
      read: 'out',
      expected,
      tolerance: 0,
    },
  ],
};
