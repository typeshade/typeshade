// The textures journey (change 0028, issue #404): a program that reads an r32float texture only
// with textureLoad, beside two textures a sampler reads, run on WebGPU through `typeshade/runtime`
// as the packed tarball ships it. The runtime lays each texture out by the calls that read it
// (Rule 11.10): `unfilterable-float` for the level, which no sampler meets and which WebGPU takes
// an r32float view in, and `float` for the two a filtering sampler reads, one directly and one
// through a const of it. A layout that says `float` for the level, as the runtime's did before,
// makes WebGPU refuse the composition's bind group with the layout named and not the binding; one
// that says `unfilterable-float` for a sampled texture makes it refuse the pipeline.
//
// The reference is plain JavaScript. The level is 16 * (x + 0.5) in the first pass, and the
// composition divides it by 1024, so its red channel is (x + 0.5) / 64, a value an 8-bit or a
// half-float intermediate texture would round; the two sampled textures are cleared to one colour,
// so any filtering of them gives that colour back. The output is an 8-bit target, and 2 steps of
// 1/255 is the room the engine journey gives its own last frame.

const SIZE = 64;

export default {
  title: 'A level in an r32float texture, only loaded, beside two textures a sampler reads',
  runs: [
    {
      kind: 'engine',
      engine: 'engine.mjs',
      programs: { fill: 'fill.shade.ts', compose: 'compose.shade.ts' },
      // Frames after the first make no GPU object, which the harness counts.
      frames: 3,
      size: SIZE,
      expected: () => {
        const out = [];
        for (let y = 0; y < SIZE; y++)
          for (let x = 0; x < SIZE; x++)
            out.push(
              Math.round(((x + 0.5) / 64) * 255) / 255,
              Math.round(0.5 * 255) / 255,
              Math.round(0.25 * 255) / 255,
              1,
            );
        return out;
      },
      tolerance: 2 / 255,
    },
  ],
};
