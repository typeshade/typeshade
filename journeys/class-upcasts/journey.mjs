const xs = Array.from({ length: 64 }, (_, i) => i * 0.25);

export default {
  title: 'Read-only class upcasts preserve constructor values and evaluation order',
  runs: [
    {
      kind: 'compute',
      shader: 'classes.shade.ts',
      entry: 'main',
      workgroups: [1, 1, 1],
      bindings: { xs, out: new Array(64).fill(0) },
      read: 'out',
      expected: () =>
        xs.map((x) => {
          class Material {
            constructor(value) {
              this.value = value;
            }
            response() {
              return this.value * 2;
            }
          }
          class LeafMaterial extends Material {
            constructor(value, extra) {
              super(value);
              this.extra = extra;
            }
          }
          class Leaf {
            constructor(material) {
              this.material = material;
            }
          }
          let count = 0;
          const next = () => ++count;
          const factory = (value) => new LeafMaterial(value + ++count, 10);
          const result = (first, material, last) => first + material.response() + last;
          return (
            new Leaf(new LeafMaterial(x, 10)).material.response() +
            result(next(), factory(x), next())
          );
        }),
      tolerance: 0,
    },
  ],
};
