---
id: '0138'
title: A host imports a shader module and uses each export as TypeScript does, calls GPU work as nodes, joins nodes into graphs with fuse, keeps uniform and storage data in typed-array views of one memory region with dirty tracking, and runs host CPU code as WebAssembly
status: draft
rules:
  - '6.1'
  - '6.6'
  - '8.20'
  - '8.21'
  - '8.22'
  - '8.23'
  - '8.24'
  - '11.7'
  - '11.8'
  - '11.11'
  - '11.13'
  - '11.17'
surface:
  - 64
  - 67
  - 71
exports:
  - zeros
  - array
  - uniform
  - texture
  - show
  - device
  - node
  - inspect
  - fuse
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Every page and Playground starter that shows host code (an entry called as fs(canvas, bindings) or entry(bindings, workgroups), createRuntime, rt.load, frame().pass) is written again in the host forms of this proposal, in English and in Korean, when the compiler pin reaches each milestone; compiler-changes.md records 0138.
  - repo: vscode-typeshade
    what: The skill's references for host calls, fuse and the runtime name the host forms of this proposal; a snippet that calls an entry with a bindings object changes; compiler-changes.md records 0138 when the pin moves.
  - repo: radiance
    what: The path tracer's host code (packages/radiance/src/renderers/PathTracer.ts) moves to the host forms of this proposal before the release that removes the old forms; compiler-changes.md records 0138.
  - repo: typenn
    what: Kernel calls that await each result move to calls that return resources and one read at the end; fuse scopes move to fuse(fn) nodes; compiler-changes.md records 0138 when the pin moves.
  - repo: typecv
    what: The same migration as typenn; compiler-changes.md records 0138 when the pin moves.
  - repo: typeaudio
    what: The same migration as typenn; compiler-changes.md records 0138 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files, functions and options that its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0138, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction, from a design conversation with the owner in the same session. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Request source                | The owner (Seungup), in the Claude Code session of 2026-11-09. Shown the host code that proposal 0120 would give, the owner judged it scattered ("너무 중구난방이예요"), stopped the work of 0120 ("모두 멈춤"), and asked to design from the start how an imported `.shade.ts` is used. The owner's decisions in that conversation are recorded under Owner's decisions. No GitHub issue is recorded.                                                                                                                                                                                                                                                                                                                                                                                        |
| Applicability / effectivity   | Expected: the host face and host view (`src/compiler/ts/host-face.ts` and its view writer), the call layer (`src/core/host-*.ts`, `resident.ts`, `owner.ts`), `typeshade/fuse` (`src/core/compute/`, the planner), the program runtime (`src/runtime/`), the render hardware interface of 0120 (`src/rhi/`), the Vite plugin and `tshc` (`src/vite.ts`, the host transform of R12, the WebAssembly emit of R16), `docs/language-design.md` Rules 6.1, 6.6, 8.20 to 8.24, 11.7, 11.8, 11.11, 11.13 and 11.17, `docs/use-typeshade-surface.md` §64, §67 and §71, `examples/hosts/`, `src/__api__/surface.md`, and the downstream repositories. The emitted WGSL and GLSL of a shader module do not change except where R10 and R11 generate new entry variants. No release version is assigned. |
| Review baseline               | `main` at `8635663c` (merge of pull request #1115), read on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file. The review and the merge of its pull request with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## What changes

### Today

A host that imports a `.shade.ts` uses each export by a different rule (`main` at `8635663c`):

| Export                      | What the host receives                     | How it is used                                     | Rule       |
| --------------------------- | ------------------------------------------ | -------------------------------------------------- | ---------- |
| A helper function           | A function that runs on the CPU tier       | `add(a, b)`                                        | 8.20       |
| A kernel function           | A function that runs on the first GPU tier | `await scale(xs, 2)`, each call awaited            | 8.22, 8.23 |
| A `@compute` entry          | A function of a bindings object            | `await sum({ xs, out }, [n])`                      | 8.24       |
| A full-screen `@fragment`   | A function of a canvas and bindings        | `await fs(canvas, { frame })`                      | 8.24       |
| A `@vertex`                 | Nothing usable (`never`)                   | —                                                  | 8.24       |
| A `class`                   | A CPU class                                | `new Particle(…)`                                  | 8.21, 8.29 |
| An `enum`                   | Its members' numbers                       | `Mode.Add`                                         | 8.21       |
| A binding (`declare const`) | Not an export; a key of a bindings object  | `{ frame: { time } }`                              | 6.1        |
| The default export          | The manifest                               | `createRuntime()`, `rt.load(m)`, `frame().pass(…)` | 11.10      |

A vertex and fragment pair can only be drawn through the program runtime, with the manifest, a
pipeline, a frame and a pass. A `fuse` scope (Rule 11.13) records kernel calls and runs them
once; it is not reusable and takes `scope.scratch()` and output arrays.

Proposal 0120 (accepted) adds `device.draw({ vertex, fragment }, options)` beside these forms.
The owner judged the result scattered: five ways to run GPU work from one import.

### Proposed

One principle: **an imported `.shade.ts` is a TypeScript module, and each export means in the
host what it means in TypeScript.** The host learns five concepts and four layers.

**The five concepts.**

| Concept  | What it is                                                                                                 | Where it is made                       |
| -------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Node     | Each exported function of a `"use typeshade"` file: a helper, a kernel, `@compute`, `@vertex`, `@fragment` | The shader file                        |
| Graph    | A TypeScript function whose node calls are recorded and planned as one node                                | `fuse(fn)` in host code                |
| Resource | Data typed by a shader `class`: a storage array, a uniform, a texture                                      | `zeros`, `array`, `uniform`, `texture` |
| Device   | Where work runs: WebGPU, WebGL2 or the CPU tier                                                            | The default, or `device(…)`            |
| Target   | Where an image goes: a canvas or a texture                                                                 | `show(image, canvas)`                  |

**The four layers.**

1. Nodes: call an imported function. typenn and typecv stop here.
2. Graphs: `fuse(fn)` joins nodes into a larger node, which nests.
3. Modules: an ordinary TypeScript class owns resources and graphs (as PyTorch's `nn.Module`).
4. Encoder: WebGPU's command encoder, with what the compiler knows left out, for full control.
   `node((encoder, …) => …)` wraps such code back into a node.

### The rules

- **R1. Every exported function is a node.** Called with values, it runs. Called inside a
  graph, it is recorded. Its parameters are its inputs and its return value its outputs; a
  returned struct gives one output for each field.
- **R2. A GPU node returns a resource and does not block.** A call of a kernel, a `@compute`
  entry or a render composition records and submits, and returns a resource at once. The host
  awaits only `x.read()`. A helper that runs on the CPU tier returns its value as today
  (Rule 8.21).
- **R3. Data decides the device.** A resource belongs to one device. A node runs on the device
  of its input resources. With plain JavaScript values alone it runs on the default device. A
  call that mixes devices is a `TypeError`. `using _ = device('cpu')` (ECMAScript explicit
  resource management) sets the default device for a block.
- **R4. A graph is `fuse(fn)`.** `fuse` takes a TypeScript function and returns a node. The
  function's parameters are the graph's inputs and its return value the outputs. A graph called
  inside another graph is inlined, and the planner plans across the boundary. Intermediate data
  is the planner's (no `scratch`, no output arrays). Today's immediate form stays as
  `await fuse(fn)()`.
- **R5. Rendering is composition.** Inside a graph or outside it, `fs(vs(vertices))` draws: the
  vertex node runs for each vertex, the fragment node for each pixel. The result is a texture of
  the fragment's output type; a struct output gives one texture for each field (`g.color`,
  `g.normal`). A fragment node called on textures alone draws the full screen. Render state the
  compiler cannot know is an option of the composition: `{ depth, blend, cull, samples, size,
over }`.
- **R6. An image reaches a canvas through `show(image, canvas)`.** The planner sees the call
  before submission and draws into the canvas directly where it can.
- **R7. Uniform and storage data live in typed-array views.** For each resource, the compiler
  generates one `ArrayBuffer` laid out by Rule 6.8 and one typed-array view for each field
  (`Float32Array`, `Int32Array`, `Uint32Array`), made once. A field is set with `set` and read
  with `get`, as three.js sets a `Vector3`: `camera.pos.set(0, 2, 5)`, `camera.view.set(m)`,
  `camera.set({ view, proj })`. `set` allocates nothing and writes into the view.
- **R8. Dirty tracking.** `set` compares, writes only a changed value, raises the resource's
  dirty flag and widens its dirty byte range. At submission, only dirty resources upload, and
  only their dirty range (`writeBuffer` on WebGPU, `bufferSubData` on WebGL2; the CPU tier reads
  the same `ArrayBuffer`). `get` returns the field's view as `Readonly`; a host that writes
  through it on purpose sets `needsUpdate = true`, as in three.js.
- **R9. Storage arrays use the same views.** `zeros(Particle, n)` and `array(Particle, data)`
  give a `Buffer<Particle>` whose element `i` is set as `ps.at(i).pos.set(…)`, with dirty ranges
  for each element. `ps.read()` returns `Particle[]`.
- **R10. An exported binding is a resource.** `export declare const camera: uniform<Camera>` is
  imported by the host as a resource with R7's `set` and `get`. There is no `=` assignment: an
  import is a read-only binding in JavaScript, and an assigned field would hide the generated
  accessor. Every node that reads the declaration sees the value. A graph uses the value at the
  moment of its call.
- **R11. A class parameter of an entry is a uniform.** A `@vertex` or `@fragment` parameter of
  a class type that carries no `location` or `builtin` is a uniform the caller passes:
  `pbr(v, brick)` binds `brick`. `uniform(PbrParams, { … })` makes such a value. The compiler
  groups bindings by how often they change (a declaration once a frame, an argument once a
  draw) and, in an instanced draw, packs per-object uniforms into one storage array that
  `instance_index` reads. The author writes no group.
- **R12. Control flow in a graph is ordinary TypeScript.** An `if`, `switch` or `for` on a host
  value runs when the graph is built: only the taken branch enters the graph, and each graph
  shape is planned once and cached. An `if` whose condition is a GPU value (`Node<bool>`) is
  rewritten by the Vite plugin and `tshc` into a condition node that the GPU decides, with no
  read back. A count that changes from frame to frame stays on the GPU (indirect dispatch and
  draw) and does not change the graph's shape.
- **R13. State across calls is a module field.** A graph that assigns a resource to a field of
  the module that owns it (`this.history = aa`) gives the next call that resource. A texture read
  and written by the same graph is held as two textures used in turn.
- **R14. A functional update runs in place.** `ps = integrate(ps, dt)` reads as a new value. When
  nothing reads the old value afterwards, the planner writes in place. The planner's report
  names each copy it could not avoid.
- **R15. The encoder layer.** `device.createCommandEncoder()`, `beginRenderPass`,
  `beginComputePass`, `end`, `finish` and `queue.submit` have WebGPU's names and order.
  `device.createRenderPipeline({ vertex: vs, fragment: fs, blend, depth })` takes nodes, not
  shader modules. A pass `setPipeline(p)` returns a pass typed by `p`, so `tsc` checks
  `setVertexBuffer`, `setBindings` and `draw` against it. Bind group layouts, pipeline layouts,
  vertex buffer layouts, padding and `getCurrentTexture()` do not appear.
- **R16. What runs on the CPU is WebAssembly where it can be.** The code a host runs on the CPU
  from an import (a helper of Rule 8.20, the CPU tier of a node, the CPU tier of a graph and of
  a render composition) is compiled to a WebAssembly module at build time by the Vite plugin and
  `tshc`, beside today's generated JavaScript. `f32` arithmetic is WebAssembly's own `f32`, and a
  vector may use SIMD128 where the runtime has it. Where WebAssembly cannot run, the generated
  JavaScript runs, and both give the CPU oracle's bits (Rule 11.7). The runtime instantiates the
  module; it builds no code at run time (no `new Function`, Rule 11.7).
- **R17. Memory comes from one serialized region.** Every resource of R7 to R9 (a uniform, a
  storage array, a staging copy) is allocated from one global region: the linear memory of the
  WebAssembly module of R16, or one `ArrayBuffer` where WebAssembly cannot run. Each resource
  is a byte range of that region, laid out by Rule 6.8, and its typed-array views are views of
  the region. So the CPU tier reads and writes a resource where it lies, with no copy; an upload
  to a GPU device is a `writeBuffer` or `bufferSubData` of the resource's dirty range of the
  region; and a read back lands in the same range. The runtime's allocator places, frees and
  compacts ranges; a resource is freed by `dispose()`, by `using`, or when the garbage collector
  reclaims its owner (`FinalizationRegistry`).

### One example, before and after

The same program: particles that move on the GPU and are drawn with a glow, then bloom.

Before (`main` at `8635663c`; the program runtime for the draw, the call layer for the
compute):

```ts
import { createRuntime } from 'typeshade/runtime';
import program from './particles.shade.ts';
import { step } from './particles.shade.ts';

const rt = await createRuntime({ device: canvas.getContext('webgpu') ? undefined : undefined });
const draw = await rt.load(program).render({ targets: ['bgra8unorm'] });
const bloomPipe = await rt.load(program).render({ targets: ['bgra8unorm'] });
let ps = new Float32Array(N * 8);

async function tick() {
  ps = await step(ps, 1 / 60);                            // awaited, read back each frame
  const frame = rt.frame();
  const tmp = rt.texture({ size: [w, h], format: 'rgba16float' });
  frame.pass({ color: [tmp] }, (p) => p.draw(draw, { ps, frame: { time } }, { count: 4, instances: N }));
  frame.pass({ color: [canvas] }, (p) => p.draw(bloomPipe, { src: tmp, strength: 0.6 }, { count: 3 }));
  await frame.submit();
  requestAnimationFrame(tick);
}
```

After:

```ts
import * as ts from 'typeshade/runtime';
import { Particle, step, dot, glow, frame } from './particles.shade.ts';
import { bloom } from './post.shade.ts';

let ps = ts.zeros(Particle, N);

const render = ts.fuse((ps: ts.Buffer<Particle>, dt: number) => {
  const next = step(ps, dt);
  return [next, bloom(glow(dot(next), { blend: 'add' }), 0.6)] as const;
});

function tick(now: number) {
  frame.time.set(now / 1000);
  let image;
  [ps, image] = render(ps, 1 / 60);
  ts.show(image, canvas);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

### Exclusions

- The shader side does not change its spelling. `@vertex`, `@fragment` and `@compute` are as
  proposal 0130 restores them (OD-2). R10 adds `export` to a binding declaration, and R11 gives a
  class parameter a meaning; neither adds a name.
- A frame loop is the application's (`requestAnimationFrame`, a timer, an event, a worker). The
  runtime adds none.
- A scene, a mesh loader, a camera controller and a material library are libraries above layer
  3, not this proposal.

## Why

**The problem.** Five rules for the exports of one import (the table of Today), and a sixth from
proposal 0120. The kinds of GPU work an author writes in one file (a compute entry, a kernel,
a fragment, a vertex) are used by four different calling forms, and a vertex is not usable at
all. A uniform is a key of a bindings object, so the shader file does not tell the host what to
pass. Every frame re-sends the uniform values, and every GPU call is awaited.

**What the owner asked.** That importing and calling functions stays ("일단 import해서 함수를
쓰는 방식은 적절해보임"), that `@vertex`, `@fragment`, `@compute`, classes and enums get a
coherent use, and that the design serves a language used from TypeScript, not a game engine
("typeshade는 언어란 말이지 typescript 에서 쓸 수 있도록 하는게 목표인데").

**Alternatives weighed in the conversation**, with the reason each was not kept:

| Alternative                                                         | Why not kept                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `device.draw({ vertex, fragment }, options)` (proposal 0120 item 3) | A fifth calling form beside the four of Today; the owner judged the set scattered.                                              |
| A game-engine model (material class, `Mesh`, `View`, scene)         | It fits rendering only; typecv, typenn and typeplot are not scenes. Kept as a possible library above layer 3.                   |
| A separate graph file edited as nodes                               | The owner asked for graphs in TypeScript code alone ("파일로 말고, ts 코드 자체만으로").                                        |
| Node arithmetic in host code (`add(a, b)` nodes, as three.js TSL)   | Arithmetic belongs in the shader functions; host code only connects them, so no operator nodes are needed.                      |
| `device.loop`, `device.run`                                         | A loop is the application's; a node is called, not run through a method ("Device.loop 함수가 좀 그렇네여", "device.run 도 좀"). |
| `=` assignment to uniform fields                                    | An import is read-only in JavaScript, and an assigned field hides the accessor; the owner chose `set`/`get`.                    |
| `ts.cond(pred, a, b)` for a GPU-value branch                        | The owner chose the ordinary `if` ("일반 if로 하는게 자연스러울 것 같아요").                                                    |

**Assumptions.** The planner of `typeshade/fuse` can be extended from kernel calls to render
compositions, condition nodes and state (R4, R5, R12, R13). The RHI and the program runtime of
proposal 0120 (milestones M1 to M3, and M4 parts 1 to 2b, merged) are the execution base of
every layer.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md` and reverses none of them:

- **OD-1** (a language of its own that borrows TypeScript's syntax): the host transform of R12
  rewrites an `if` on a GPU value; tool support for that is the project's work.
- **OD-2** (`@vertex`, `@fragment`, `@compute`): the shader side keeps these spellings.
- **OD-3** (the language stays small; the compiler's work is not pushed onto the author): the
  author writes no layout, group, padding, workgroup count, intermediate buffer or barrier
  (R4, R7, R11, R14, R15). No author-facing name is added.
- **OD-4** (show the owner what changes): the example before and after is above.

Decisions the owner took in the conversation of 2026-11-09, in the owner's words:

1. Import and call stays: "일단 import해서 함수를 쓰는 방식은 적절해보임."
2. The encoder layer keeps WebGPU's shape: "그냥 인코더를 그대로 가져오는게 맞지 않나 싶은데" (R15).
3. Every export is a node, and `fuse` makes nodes into larger nodes: "use typeshade 안에서 만든
   모든 export된 함수들는 노드이고, 노드를 ts코드 안에서 다시 fuse로 노드 가상화를 해서 다시
   큰 노드로" (R1, R4).
4. Graphs in TypeScript code alone: "파일로 말고, ts 코드 자체만으로" (R4).
5. No `device.loop`, no `device.run` (R2, R3).
6. Python-like brevity: "좀 더 파이토닉하게" (`zeros`, `array`, `using`, `show`).
7. A GPU-value branch is an ordinary `if`: "일반 if로 하는게 자연스러울 것 같아요" (R12).
8. Uniforms in typed-array views, a dirty flag, `set`/`get` as three.js, no `=`: "유니폼으로
   만들어지는건 모두 배열 뷰 기준으로 직렬화해서 속도를 높혀주시고, 더티 플레그를 넣어주세요.
   그리고 유니폼 import하는거에서 = 대입은 없애고, js니까 override되어버림. set, get 처럼
   직관적으로 사용하도록 하세요. Threejs 처럼 쓰도록." (R7, R8, R10).
9. Storage the same way: "네, storage도 같은 방식으로" (R9).
10. The work of proposal 0120 stops while this design is decided: "모두 멈춤".
11. What an import runs on the CPU is WebAssembly where possible: "저런식으로 import된건 가능하면
    wasm으로 나오는게 나을 것 같은데 성능적으로" (R16).
12. Memory from one global, serialized region: "각 메모리는 전역 메모리로 가능하면 직렬화된
    영역에서 할당받아서 사용하게하고" (R17).

## Why the compiler cannot do it

Not applicable as a new author-facing name: the proposal adds no name to
`src/__api__/author-names.md`. It changes rules and adds host exports. What the author must
still write, and why the compiler cannot decide it:

- **Which vertex node feeds which fragment node** (`fs(vs(…))`): two entries of one module may
  pair in several ways; the program does not say which pairs a host draws.
- **Render state** (`depth`, `blend`, `cull`, `samples`, `size`, `over`): a choice of the image
  the host wants, not a fact of the program.
- **Where an image goes** (`show`): the canvas is the host's.
- **Which data a node runs on** (its arguments): the host's data.

Everything else the host wrote before (layouts, groups, padding, workgroup counts, intermediate
buffers, barriers, uploads) the compiler and the runtime decide (OD-3).

## What it touches

- **Rule 6.1.** A binding declaration may be exported; an exported one is a host resource (R10).
- **Rule 6.6.** An entry's class parameter with no attribute is a uniform the caller passes (R11).
- **Rule 8.20.** A helper stays a CPU function; the rule names the node meaning (R1).
- **Rule 8.21.** A GPU node returns a resource; a resource is a host value; R7 to R9 give the
  views and their dirty tracking.
- **Rules 8.22 and 8.23.** A kernel function returns its result as a resource and may still
  write a parameter in place; R14 states when a functional update is in place.
- **Rule 8.24.** An entry is a node; the bindings-object call and the canvas call are replaced
  by R1, R5 and R6.
- **Rule 11.7.** The CPU tier runs graphs, render compositions and the views of R7 to R9.
- **Rule 11.8.** The device of a call is decided by its data (R3); `configure` and `using`.
- **Rule 11.11.** The program runtime becomes the executor of nodes and graphs; the manifest is
  an internal artifact, not the host's entry point.
- **Rule 11.13.** `fuse(fn)` defines a node; graphs nest; render compositions, condition nodes
  and state join the planner (R4, R5, R12, R13, R14).
- **Rule 11.17.** The escape hatches become the encoder layer and `node((encoder, …) => …)`.
- **Surface §64, §67, §71.** Calling a module, calling an entry and `fuse` are written again.
- **Exports.** `zeros`, `array`, `uniform`, `texture`, `show`, `device`, `node`, `inspect` are
  new in `typeshade/runtime`; `fuse` is reshaped. The removals (`createRuntime`, `runtime`, the
  bindings-object and canvas calls) are left to a later proposal after a deprecation release.

**Relation to proposal 0120.** 0120's RHI, its three backends and the program runtime on them
(M1 to M3), and the call layer through `Program` objects (M4 parts 1 to 2b) stay and are this
proposal's base. 0120's item 3 (`Device` with `draw`, `DrawOptions`, `VertexEntry`,
`FragmentEntry`), item 4, item 6 (a host file for each example in the forms of item 3) and
milestones M4 part 2c onward are replaced by this proposal. If this proposal is accepted, an
amendment to 0120 withdraws them in its own pull request.

**Relation to proposal 0130.** The examples use `@vertex`, `@fragment` and `@compute`. This
proposal depends on 0130 for the spelling and changes nothing 0130 decides.

### Draft impact estimate

Known:

- The host view grows: each GPU node gets a value overload and a node overload, and each
  resource class gets generated view classes. The size of a generated host view is not measured.
- `typeshade/runtime`'s bundle grows by the graph executor and the view classes. Not measured.
- Every host example, every host page of the site, and the downstream repositories change
  their host code (What it owes downstream).

Estimated, in milestones that each leave `main` green:

1. **Resources.** `zeros`, `array`, `uniform`, `texture`; R7 to R10 (views, dirty ranges,
   `set`/`get`, exported bindings) on the one region of R17, an `ArrayBuffer` at first. No call
   changes yet.
2. **WebAssembly CPU tier.** R16: the Vite plugin and `tshc` emit a WebAssembly module for the
   CPU code of an import; the region of R17 becomes its linear memory.
3. **Non-blocking calls.** R2 and R3: GPU nodes return resources; `read()`; the device of the
   data; `using device(…)`.
4. **Graphs for compute.** R4 and R14 on kernels and `@compute`: `fuse(fn)` as a node, nesting,
   return values, in-place updates.
5. **Rendering.** R5, R6 and R11: compositions, texture outputs, render-state options, `show`,
   class parameters as uniforms.
6. **Control flow.** R12: build-time branches and shape caching; the host transform for GPU
   conditions; indirect counts.
7. **State and anti-aliasing.** R13: module fields as state, textures used in turn, MSAA and its
   resolve, several resolutions.
8. **Encoder layer.** R15 and `node((encoder, …) => …)` on the RHI of 0120.
9. **Migration.** A deprecation release for the old forms; host files for the examples; the site.

Unknown: duration and cost; the planner's reach on WebGL2 and the CPU tier for indirect
execution and MSAA (they lack both; refusal or a slower path is open item Q7).

Decisions that must be resolved before acceptance:

- **Q1.** Whether `fuse(fn)` returning a node replaces the immediate scope, with `await fuse(fn)()`
  for today's use, or whether the two take different names.
- **Q2.** Whether a kernel's result is its return value only, or its return value and today's
  in-place parameter (Rule 8.23).
- **Q3.** The rule that tells an entry's class parameter that is a uniform (R11) from one that is
  per-vertex data.
- **Q4.** When a recorded call is submitted: at the end of the current microtask, at `read()`,
  at `show`, or at each.
- **Q5.** Whether `show(image, canvas)` is the one way to a canvas, or whether a canvas is also a
  resource that a graph writes.
- **Q6.** Whether the host transform of R12 may rewrite an `if` in host code, outside a
  `"use typeshade"` file, and how the editor shows that the condition is a GPU value.
- **Q7.** On WebGL2 and the CPU tier, a refusal with the reason or a slower path for indirect
  execution, MSAA and a GPU-value condition.
- **Q8.** The names of the new exports (`zeros`, `array`, `uniform`, `texture`, `show`, `device`,
  `node`, `inspect`). They are host exports, not author-facing names of a shader file.
- **Q9.** How the views of R17 survive a growth of the region. A WebAssembly `memory.grow` gives
  a new `ArrayBuffer` and detaches every view of the old one. Options: a region sized up front
  with a stated limit; views re-made on growth behind each field's accessor; or a resizable
  `ArrayBuffer` where the runtime has one.
- **Q10.** Whether a WebAssembly CPU tier (R16) replaces the generated JavaScript or stands
  beside it, how the CPU oracle's bits are held on both (Rule 11.7, Rule 11.8), and what the
  bundle and the build cost.

### Independent review record

Not yet reviewed. Before the owner decides, an agent or a person that did not write this
proposal reviews it against `README.md` (Independent review), and this section records the
reviewer, the date, the revision reviewed, each finding and the answer to it.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision in the
conversation, or a review, and the merge of this file with `status: accepted`; the answers to
Q1 to Q10; the approved scope and milestones; and the amendment to proposal 0120 named under
What it touches.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each milestone: the implementing
pull requests and their commits that say `Change: 0138`; the delivered configuration; both
halves of each host form tested on the same source (`compile()` and the language service,
CLAUDE.md "A test reads both halves"); the user journeys on WebGPU, WebGL2 and the CPU tier;
the planner's reports for the graphs of the examples; the bundle sizes; the document
validation; each deviation with its disposition; and the pending work.

## What it owes downstream

- **typeshade.github.io** (`typeshade/web`, `apps/typeshade`). Every host page and Playground
  starter: the `host.ts` tab, the starter of `src/scripts/playground-host-default.ts`, the API
  entries that name `createRuntime`, `runtime`, `Runtime`, `RuntimeOptions`, an entry call with
  a bindings object or a canvas, and the concept pages of fuse and the runtime. In English and
  in Korean. The site's own renderer, which proposal 0120 planned to remove, is removed against
  the forms of this proposal instead. `compiler-changes.md` records 0138.
- **vscode-typeshade.** The skill's references for host calls, `fuse` and the runtime; any
  snippet that calls an entry with a bindings object. `compiler-changes.md` records 0138.
- **radiance.** `packages/radiance/src/renderers/PathTracer.ts` and the design records that name
  `createRuntime` (found by a code search on 2026-11-03 for proposal 0120). `compiler-changes.md`
  records 0138.
- **typenn, typecv, typeaudio.** Kernel calls that await each result, and `fuse` scopes with
  `scratch` and output arrays. Each searches its tree for `await` on a kernel call, `fuse(`,
  `scratch(` and `createRuntime`. `compiler-changes.md` records 0138 in each.

Expected work is described; responsibilities are recorded at acceptance; actual downstream
changes, pins and records are tracked apart after compiler implementation.
