# User journeys

Programs written the way a TypeScript developer writes them, checked the way a user meets TypeShade.

```bash
bun run build
bun run gate:journeys
```

`scripts/user-journey.ts` packs the tarball the way the publish workflow does (`dist/`, with the manifest rewritten onto it), and installs it into a fresh `npm init` project. It copies the README's `tsconfig.shade.json` into that project verbatim, copies this directory in, and runs `_harness.mjs` there with Node. The harness imports nothing but `typeshade`. For every journey it checks that:

1. `compile()` accepts every `.shade.ts` with no diagnostic, error or warning;
2. the language service (`typeshade/language-service`) reports nothing on it, which is what the editor shows;
3. `tsc -p tsconfig.shade.json` reports only the error classes the README documents: TS1206 on decorators, and operators on vectors;
4. every run produces, on WebGPU (headless Chromium, SwiftShader), what the journey's plain-JavaScript reference computes;
5. the same run on the CPU oracle (`compileModule`) produces it too.

The unit suite and the compile gate test the compiler from inside the repository. This gate tests what a user installs and runs. It exists because both kinds of failure it catches had already shipped:

- The README's tsconfig loaded no types at all (#211).
- The first loop a TypeScript author writes, `for (let i = 0; i < data.length; i++)`, did not compile (#209).

## A journey

A journey is a directory holding one or more `*.shade.ts` sources and a `journey.mjs` host.

- **The sources** are shader code as their author would write it. Where they spell something a way the author would not, only to get past a gap, the line says so and names the issue. The plasma journey's `const uv: vec2 = …` did, pointing to #162, until the language service learned the type and the annotation came out. A workaround with no issue is not allowed, because the point of the gate is that each one is visible and counted.
- **The host** is plain JavaScript, as the author's own host code would be. TypeShade has no GPU runtime yet, so the host packs its own buffers in the layout WGSL gives them. It also computes, without TypeShade, what the shader should produce. It default-exports `{ title, runs }`. Each run is one of two kinds:

| Field        | `kind: 'compute'`                                                                                                                                                          | `kind: 'render'`                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `shader`     | the `.shade.ts` file                                                                                                                                                       | the `.shade.ts` file                                                                                    |
| entry points | `entry`                                                                                                                                                                    | `vertex`, `fragment`; one fullscreen draw of three vertices                                             |
| size         | `workgroups: [x, y, z]`, run `repeat` times (default 1)                                                                                                                    | `size: [w, h]`, an `rgba8unorm` target                                                                  |
| `bindings`   | `{ name: { gpu: TypedArray, cpu: value } }`: the bytes for WebGPU, the value for the CPU oracle                                                                            | the same                                                                                                |
| result       | the binding named by `read`, as floats; `flattenCpu(value)` turns the CPU value into the same floats                                                                       | every pixel's RGBA; the oracle runs `fragment(...fragmentArgs(x, y))` and reads `fragmentColor(result)` |
| `expected`   | `() => number[]`                                                                                                                                                           | `(x, y) => [r, g, b, a]`                                                                                |
| `tolerance`  | largest relative error allowed                                                                                                                                             | the same, in units of a channel (`1.5 / 255` allows one rounding step)                                  |
| `console`    | optional: `{ capacity, expected: () => lines }`, compiled with `console: 'gpu'`; the lines decoded from WebGPU and the CPU sink's must both equal `expected` (surface §66) | not taken                                                                                               |

## The import path

`journeys/_host-import/` is a different kind of journey, and the harness skips it (a name that starts with `_`). It is a Vite project that imports a `.shade.ts` and calls its functions on the CPU tier (surface §64) and its `@compute` entries on WebGPU (surface §67). `scripts/user-journey.ts` sets it up with the documented lines, from the same tarball, beside `vite` and `typescript`, and `typeshade sync` runs as its `prepare` script. It then checks five things:

1. `tsc` over the host program reports 0 errors, and a wrong-length vector argument is TS2345 at the host line;
2. `vite build` bundles it, and the bundle holds no compiler and no `new Function`;
3. Node runs the bundle;
4. every value the bundle prints matches `reference.mjs`, the same computation in plain JavaScript;
5. a browser bundle of `src/gpu.ts` calls two `@compute` entries through the import in a page with WebGPU (change 0016), one of them through a barrier, which has no CPU tier, and both match the reference; it then draws two full-screen fragment entries of `src/draw.shade.ts` on WebGPU, WebGL2 and the CPU tier, each frame against the reference, and a sampled texture's draw on the CPU is refused with the reason.

A journey belongs with the change that makes it work. A pull request that improves what a user can write adds the journey that shows it, and the gate keeps it working from then on.
