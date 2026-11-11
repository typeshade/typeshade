---
id: '0138'
title: A host imports a shader module and uses each export as TypeScript does, calls GPU work as nodes, joins nodes into graphs with fuse, keeps uniform and storage data in typed-array views of one memory region with dirty tracking, and runs host CPU code as WebAssembly
status: accepted
rules:
  - '6.1'
  - '6.6'
  - '8.20'
  - '8.21'
  - '8.22'
  - '8.23'
  - '8.24'
  - '8.25'
  - '8.29'
  - '11.7'
  - '11.8'
  - '11.11'
  - '11.13'
  - '11.17'
surface:
  - 26
  - 64
  - 65
  - 67
  - 69
  - 70
  - 71
  - 72
exports:
  - zeros
  - array
  - uniform
  - texture
  - show
  - node
  - inspect
  - fuse
  - Buffer
  - Texture
  - Uniform
  - Device
  - HostExport
  - FuseReport
  - abs
  - add
  - argMaxAxis
  - argMinAxis
  - ceil
  - clip
  - compact
  - copy
  - cos
  - div
  - exclusiveScan
  - exp
  - expm1
  - fill
  - floor
  - histogram
  - inclusiveScan
  - log
  - log1p
  - max
  - maxAxis
  - meanAxis
  - min
  - minAxis
  - mul
  - neg
  - prodAxis
  - relu
  - round
  - rsqrt
  - scale
  - sequence
  - sigmoid
  - sign
  - sin
  - sqrt
  - sub
  - sum
  - sumAxis
  - tan
  - tanh
  - fillUniform
  - fillWords
  - Geometry
exports-removed:
  - resident
  - configure
  - FuseScope
  - Resident
codes:
  - TS8079
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Every page and Playground starter that shows host code (an entry called as fs(canvas, bindings) or entry(bindings, workgroups), createRuntime, rt.load, frame().pass) is written again in the host forms of this proposal, in English and in Korean, when the compiler pin reaches each milestone; the fuse pages, Resident and kernels that write an array change with milestone 4 (Amendment A10); a Resident's write and destroy become a Buffer's set and dispose, a resident of a non-array value becomes uniform(Class, …) or a plain value, and an array of plain objects of a struct that is not a class becomes array(Class, data) or plain data (Amendment A11); compiler-changes.md records 0138.
  - repo: vscode-typeshade
    what: The skill's references for host calls, fuse and the runtime name the host forms of this proposal (fuse(fn) nodes, Buffer in place of Resident, @inout on a kernel that writes an array; Amendment A10; set and dispose in place of write and destroy, uniform(Class, …) for a non-array value, array(Class, data) or plain data for an array of plain objects of a non-class struct; Amendment A11); a snippet that calls an entry with a bindings object changes; compiler-changes.md records 0138 when the pin moves.
  - repo: radiance
    what: The path tracer's host code (packages/radiance/src/renderers/PathTracer.ts) moves to the host forms of this proposal before the release that removes the old forms; any Resident moves to Buffer and any kernel that writes an array parameter adds @inout or @out (Amendment A10; radiance not yet searched for either); write and destroy become set and dispose, a non-array Resident becomes uniform(Class, …) or a plain value, and an array of plain objects of a non-class struct becomes array(Class, data) or plain data (Amendment A11); compiler-changes.md records 0138.
  - repo: typenn
    what: Kernel calls that await each result move to calls that return resources and one read at the end; fuse scopes (device.fuse with scratch and chunk) move to fuse(fn) nodes; Resident and resident() move to Buffer, write and destroy to set and dispose, a non-array value to uniform(Class, …) or a plain value, and an array of plain objects of a non-class struct to array(Class, data) or plain data (Amendment A11); kernels that write an array parameter add @inout or @out, or return it (Amendment A10); compiler-changes.md records 0138 when the pin moves.
  - repo: typecv
    what: The same migration as typenn; compiler-changes.md records 0138 when the pin moves.
  - repo: typeaudio
    what: The same migration as typenn; compiler-changes.md records 0138 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files, functions and options that its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0138, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
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
- **R2. A GPU node called on a resource returns a resource and does not block.** A call of a
  kernel, a `@compute` entry or a render composition whose arguments include a resource, or that
  is made inside a graph, records and submits, and returns a resource at once. The host awaits
  only `x.read()`. A call with plain data only (numbers, arrays, typed arrays, objects; Rule
  8.21) keeps today's meaning: it is awaited, writes its in-place arguments (Rule 8.23) and
  returns plain data. Resources are the primary path (owner's decision 15, which amends
  `docs/dx.md` principle 1); the plain-data call stays so that today's host code keeps working
  while the new forms arrive. A helper that runs on the CPU
  tier returns its value as today. A non-blocking call that fails records its call site when it
  is made, and the error thrown at the next `read()`, `show` or call names that line
  (`docs/dx.md` principle 3).
- **R3. Data decides the device.** A resource belongs to one device. A node runs on the device
  of its input resources. With plain JavaScript values alone it runs on the default device. A
  call that mixes devices is a `TypeError`. `using _ = (await createDevice({ prefer: ['cpu'] })).use()` (ECMAScript explicit
  resource management) sets the default device for a block. An exported binding (R10) belongs to
  no one device: its value lies once in the region of R17, and each device that runs a node that
  reads it uploads the same dirty range.
- **R4. A graph is `fuse(fn)`.** `fuse` takes a TypeScript function and returns a node. The
  function's parameters are the graph's inputs and its return value the outputs. A graph called
  inside another graph is inlined, and the planner plans across the boundary. Intermediate data
  is the planner's (no `scratch`, no output arrays). Tracing: `fn` runs once for each new graph
  shape, with node placeholders for its resource parameters, and again only when the shape key
  changes. The shape key is the graph's parameter types, the host values its control flow
  reads (R12) and the resource classes; a host number captured by `fn`'s closure or passed as a
  scalar parameter is read at each call and bound as a uniform, never fixed at trace time. A
  side effect of `fn` other than node calls runs only when it is traced, and the planner's
  report warns of one. Today's `fuse((scope) => …)`, which runs once and returns a report,
  stays until the deprecation of milestone 9 (Q1).
- **R5. Rendering is composition.** Inside a graph or outside it, `fs(vs(vertices))` draws: the
  vertex node runs for each vertex, the fragment node for each pixel. The result is a texture of
  the fragment's output type; a struct output gives one texture for each field (`g.color`,
  `g.normal`). A fragment node called on textures and scalars alone draws the full screen. What
  the draw covers is an option of the vertex call: `vs(vertices, { count, instances, indices,
topology })`; with a `Buffer<T>` argument and no `count`, one vertex for each element. Render
  state the compiler cannot know is an option of the fragment call: `{ depth, blend, cull,
samples, size, over }`.
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
  shape is planned once and cached. A graph whose control flow depends on a GPU value
  (`Node<bool>`) is written in a `"use typeshade"` file, as an exported function that calls
  other nodes; there the compiler turns its `if` into a condition node that the GPU decides,
  with no read back (owner's decision 13, OD-1). Host code imports such a graph as a node and
  calls it. A count that changes from frame to frame stays on the GPU (indirect dispatch and
  draw) and does not change the graph's shape. In a host `fuse(fn)`, a `Node<bool>` used as a
  condition throws from its `valueOf` and `Symbol.toPrimitive`, with a message that names the
  line and says to move the graph into a `"use typeshade"` file, so it is never silently truthy.
- **R13. State across calls is a module field.** A graph that assigns a resource to a field of
  the module that owns it (`this.history = aa`) gives the next call that resource. A texture read
  and written by the same graph is held as two textures used in turn.
- **R14. A functional update runs in place.** `ps = integrate(ps, dt)` reads as a new value. When
  nothing reads the old value afterwards, and the planner's facts show that each invocation
  reads only the elements it writes (Rule 11.13), the planner writes in place. Otherwise it
  writes a new resource. The planner's report names each copy it could not avoid.
- **R15. The encoder layer.** `device.createCommandEncoder()`, `beginRenderPass`,
  `beginComputePass`, `end`, `finish` and `queue.submit` have WebGPU's names and order.
  `device.createRenderPipeline({ vertex: vs, fragment: fs, blend, depth })` takes nodes, not
  shader modules. A pass `setPipeline(p)` returns a pass typed by `p`, so `tsc` checks
  `setVertexBuffer`, `setBindings` and `draw` against it. Bind group layouts, pipeline layouts,
  vertex buffer layouts, padding and `getCurrentTexture()` do not appear.
- **R16. The CPU tier is the oracle compiled to WebAssembly.** The code a host runs on the CPU
  from an import (a helper of Rule 8.20, the CPU tier of a node, of a graph and of a render
  composition) is the oracle's meaning compiled to a WebAssembly module at build time by the
  Vite plugin and `tshc`, in place of today's generated JavaScript (owner's decision 14). It
  stays one implementation (Rule 11.7): the WebAssembly module is the oracle's executable form,
  not a fourth tier. `f32` arithmetic is WebAssembly's own `f32`; a vector may use SIMD128. To
  give the oracle's bits: relaxed SIMD is not used; a NaN result is made canonical where WGSL
  leaves its bits open; `sin`, `exp`, `pow` and the other functions WebAssembly has no
  instruction for are routines the same lowering writes. The runtime instantiates a module the
  build wrote; it builds no code at run time. A page whose Content Security Policy refuses
  WebAssembly (`'wasm-unsafe-eval'` absent) needs a path: open question Q12. Amendment A4
  (2026-11-10) changes this rule: the WebAssembly tier stands beside the generated JavaScript,
  which stays for the synchronous helper call and for a page that refuses WebAssembly.
- **R17. Memory comes from one serialized region.** Every resource of R7 to R9 (a uniform, a
  storage array, a staging copy) is allocated from one global region: the linear memory of the
  WebAssembly module of R16, or one `ArrayBuffer` where WebAssembly cannot run. Each resource
  is a byte range of that region, laid out by Rule 6.8, and its typed-array views are views of
  the region. So the CPU tier reads and writes a resource where it lies, with no copy; an upload
  to a GPU device is a `writeBuffer` or `bufferSubData` of the resource's dirty range of the
  region; and a read back lands in the same range. The runtime's allocator places, frees and
  compacts ranges; a resource is freed by `dispose()`, by `using`, or when the garbage collector
  reclaims its owner (`FinalizationRegistry`). A view is reached only through its field's
  accessor (`get`, `set`), which re-reads the region after a growth or a compaction; a raw view
  is never kept by the host, and an accessor of a freed resource throws a `TypeError` that
  names it. So a freed range given to another resource cannot be written through a stale view.
  A resource that lives only on a GPU device (an intermediate of a graph, today's `Resident`
  with no host read) takes no range of the region.

### One example, before and after

The same program: particles that move on the GPU and are drawn with a glow, then bloom.

Before (`main` at `8635663c`). The compute runs through the call layer with a `Resident`
(`examples/hosts/loop-fuse/host.ts`); the draw runs through the program runtime
(`examples/hosts/host-program/host.ts`); each module is loaded as a manifest:

```ts
import { runtime, resident } from 'typeshade/runtime';
import particles, { step } from './particles.shade.ts';   // default export: the manifest
import post from './post.shade.ts';

const rt = await runtime();                                // WebGPU, or WebGL2
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const glow = await rt.load(particles).render({ targets: [{ format: 'rgba16float', blend: ADD }] });
const bloom = await rt.load(post).render({ targets: ['bgra8unorm'] });
const ps = resident(new Float32Array(N * 8));              // stays on the device
const tmp = rt.texture({ size: [canvas.width, canvas.height], format: 'rgba16float' });

async function tick(now: number) {
  await step(ps, 1 / 60);                                  // in place (Rule 8.23), awaited
  const frame = rt.frame();
  frame.pass({ color: [tmp] }, (p) =>
    p.draw(glow, { ps, frame: { time: now / 1000 } }, { count: 4, instances: N }));
  frame.pass({ color: [canvas] }, (p) =>
    p.draw(bloom, { src: tmp, strength: 0.6 }, { count: 3 }));
  await frame.submit();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

After:

```ts
import * as ts from 'typeshade/runtime';
import { Particle, step, dot, glow, frame } from './particles.shade.ts';
import { bloom } from './post.shade.ts';

let ps = ts.zeros(Particle, N);

const render = ts.fuse((ps: ts.Buffer<Particle>, dt: number) => {
  const next = step(ps, dt);
  return [next, bloom(glow(dot(next, { count: 4, instances: N }), { blend: 'add' }), 0.6)] as const;
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

- The shader side keeps its spelling. `@vertex`, `@fragment` and `@compute` are as proposal
  0130 restores them (OD-2). No name is added. The shader side does change in meaning, and the
  rules the front matter lists record it: R10 lets a binding declaration be exported (Rule
  6.1); R11 lets an entry parameter of a class type carry no attribute (Rule 6.6); a full-screen
  fragment node takes texture and scalar parameters (R5, Rule 6.6); a kernel may return a
  `Buffer<T>` as well as a scalar (R2, R14, Rule 8.22).
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
13. On Q11, asked whether a GPU-value `if` may be rewritten in host code: "그래프는 shade 파일에".
    A graph that branches on a GPU value is written in a `"use typeshade"` file (R12). Rule 1.6
    does not change.
14. On Q12, asked how a WebAssembly CPU tier fits Rule 11.7: "WASM을 오라클 형태로". The
    WebAssembly module is the oracle's executable form, in place of the generated JavaScript, so
    the CPU tier stays one implementation (R16).
15. On Q13, asked whether resources on the primary path conflict with `docs/dx.md` principle 1:
    "원칙 1을 고침". Principle 1 is amended: resources (`zeros`, `array`, `uniform`, `texture`,
    `Buffer<T>`) are on the primary path (R2).

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
- **Rule 11.7.** The CPU tier runs graphs, render compositions and the views of R7 to R9, as the
  oracle compiled to WebAssembly (R16, decision 14).
- **`docs/dx.md` principle 1.** Amended: resources are on the primary path (decision 15).
- **Rule 11.8.** The device of a call is decided by its data (R3); `configure` and `using`.
- **Rule 11.11.** The program runtime becomes the executor of nodes and graphs; the manifest is
  an internal artifact, not the host's entry point.
- **Rule 11.13.** `fuse(fn)` defines a node; graphs nest; render compositions, condition nodes
  and state join the planner (R4, R5, R12, R13, R14).
- **Rule 11.17.** The escape hatches become the encoder layer and `node((encoder, …) => …)`.
- **Surface §64, §67, §71.** Calling a module, calling an entry and `fuse` are written again.
- **Surface §65 and §69.** The manifest and `rt.load` stop being the host's entry point for a
  draw.
- **Exports.** `zeros`, `uniform`, `texture`, `show`, `device`, `node`, `inspect` and the types
  `Buffer`, `Uniform` and `Node` are new in `typeshade/runtime`. `Texture` is an existing export,
  which `texture()` returns (Amendment A5, D5). `HostExport` gains a kind for a host resource (A5,
  D6). `array` is reshaped:
  it is a type export of `typeshade/runtime` today (`src/runtime.ts`) and becomes also a
  function. `fuse` is reshaped and is exported by `typeshade/runtime` as well as `typeshade/fuse`. The removals (`createRuntime`, `runtime`, the
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

Decisions resolved before the milestone that needs each one (the owner's choice at acceptance; Approval and plan record):

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
- **Q6.** Resolved by decision 13: a graph that branches on a GPU value is written in a
  `"use typeshade"` file, so no host code is rewritten (R12).
- **Q7.** On WebGL2 and the CPU tier, a refusal with the reason or a slower path for indirect
  execution, MSAA and a GPU-value condition.
- **Q8.** The names of the new exports (`zeros`, `array`, `uniform`, `texture`, `show`, `device`,
  `node`, `inspect`). They are host exports, not author-facing names of a shader file. The
  overlaps to settle: `device()` beside `createDevice()`, `Device` and `configure`; `uniform()`
  beside `resident()`; the host function `uniform` beside the shader type `uniform<T>`.
- **Q9.** How the views of R17 survive a growth of the region. A WebAssembly `memory.grow` gives
  a new `ArrayBuffer` and detaches every view of the old one. Options: a region sized up front
  with a stated limit; views re-made on growth behind each field's accessor; or a resizable
  `ArrayBuffer` where the runtime has one. Also: a region shared with a worker (a
  `SharedArrayBuffer` needs cross-origin isolation), a second realm, and wasm32's 4 GiB limit.
- **Q10.** What the WebAssembly CPU tier (R16) costs the bundle and the build, and how the
  differential gate holds its bits to the oracle's tree walk (Rule 11.7, Rule 11.8). `scripts/bundle-boundary.ts` admits only local JavaScript assets
  today and must admit a `.wasm` asset.
- **Q11.** Decided by the owner on 2026-11-09 (decision 13): a GPU-value graph is written in a
  `"use typeshade"` file.
- **Q12.** Decided by the owner on 2026-11-09 (decision 14): WebAssembly is the oracle's
  executable form. Left open: the path for a page whose Content Security Policy refuses
  WebAssembly (a refusal with the reason, or a JavaScript form written by the same lowering),
  and the conversion of today's generated JavaScript and its tests.
- **Q13.** Decided by the owner on 2026-11-09 (decision 15): `docs/dx.md` principle 1 is
  amended; its new text is written with milestone 1.
- **Q14.** Back-pressure: a non-blocking submit in a `requestAnimationFrame` loop can queue
  frames faster than the GPU runs them. Whether `show` waits for the previous frame of its
  canvas, or the runtime drops frames, or the host decides.
- **Q15.** A canvas keeps the first context it hands out (Rule 8.24). What `show(image, canvas)`
  does when the image is on another device than the canvas's first context.
- **Q16.** The bit-equality baseline for the new graph features (Rule 11.13 holds a fused plan
  to the same calls run apart): what "run apart" means for a composition, a condition node,
  `show` into a canvas and an in-place update.

### Independent review record

- **Reviewer.** An AI agent (Claude Code) that did not write this proposal, started by the
  author's session on 2026-11-09 with the documents `README.md` (Independent review) names.
- **Revision reviewed.** `501b32ba` (R16, R17, Q9 and Q10 included).
- **Findings and answers.**

| #   | Severity   | Finding                                                                                                                                                                                                              | Answer                                                                                                                                                                                                                                        |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocking   | R16 conflicts with Rule 11.7 ("not a fourth implementation") and with a strict CSP; WebAssembly lacks `sin`/`exp`/`pow`, NaN bits are open, relaxed SIMD is not deterministic.                                       | Partly fixed in R16: no relaxed SIMD, canonical NaN, shared routines, the differential gate bit for bit, a JavaScript fallback under CSP. The owner decided the conflict with Rule 11.7: WebAssembly is the oracle's form (decision 14, R16). |
| 2   | Blocking   | R17 can alias a freed range through a stale view; growth and compaction detach views; GPU-only intermediates would take a CPU copy.                                                                                  | Fixed in R17: views only through accessors that re-read the region; an accessor of a freed resource throws; device-only resources take no range. Workers, realms and the 4 GiB limit join Q9.                                                 |
| 3   | Blocking   | The `if` rewrite of R12 reaches host code, which OD-1 does not cover and Rule 1.6 keeps as TypeScript; without the plugin a `Node<bool>` is silently truthy.                                                         | The owner decided: such a graph is written in a `"use typeshade"` file (decision 13, R12). A `Node<bool>` in a host `fuse` throws from `valueOf`.                                                                                             |
| 4   | Blocking   | Milestone 3 changes today's results (`await exposure(…)`), yet nothing is removed and no coexistence rule is stated.                                                                                                 | Fixed in R2: a call with plain data keeps today's meaning; a call on a resource or in a graph takes the new one. Removal stays for a later proposal after the deprecation of milestone 9.                                                     |
| 5   | Should-fix | The Before is not today's API (a no-op `createRuntime` argument, one module loaded twice, a kernel that returns an array, no `resident`, undefined names).                                                           | Fixed: the Before uses `runtime()`, two loaded modules, `resident`, an in-place `step` and defined names.                                                                                                                                     |
| 6   | Should-fix | R5 has no vertex count, instances, indices or topology; `dot(next)` cannot be drawn as written.                                                                                                                      | Fixed in R5: `vs(vertices, { count, instances, indices, topology })`; the After passes them.                                                                                                                                                  |
| 7   | Should-fix | The shader side changes in meaning (Rule 6.6, Rule 8.22, texture and scalar fragment parameters), against Exclusions; §65 and §69 are missing.                                                                       | Fixed: Exclusions declares each change; §65 and §69 are in `surface`.                                                                                                                                                                         |
| 8   | Should-fix | Exports incomplete: `array` exists as a type, `fuse` moves, `Buffer`/`Node`/resource types missing; overlaps of `device`/`createDevice`/`configure`/`resident`; `uniform` names a host function and the shader type. | Fixed in the front matter and What it touches. The overlaps are kept for Q8, which now names them.                                                                                                                                            |
| 9   | Should-fix | The tracing of `fuse(fn)` is not stated (when `fn` runs, captured numbers, cache key); helpers on node inputs amount to host arithmetic.                                                                             | Fixed in R4: shape key, captured numbers read at each call, side effects warned. A helper called inside a graph is a node like any export (R1); its arithmetic is in the shader file.                                                         |
| 10  | Should-fix | The determinism guarantee of Rule 11.13 is not extended; R14 in place is exact only when each invocation reads what it writes.                                                                                       | Fixed in R14 (the planner's facts decide). The baseline for the new features is Q16.                                                                                                                                                          |
| 11  | Should-fix | Unrecorded conflicts: R10 against R3; `docs/dx.md` principles 1 and 3; R4's "`await fuse(fn)()` stays" is not today's `fuse`.                                                                                        | Fixed: R3 states an exported binding's devices; R2 keeps errors at the author's line; R4 keeps today's `fuse` until milestone 9. The owner amended principle 1 (decision 15).                                                                 |
| 12  | Note       | Q1 to Q10 miss items: draw count, coexistence, the device of exported bindings, back-pressure, error timing, tracing, the bit baseline, CSP, freeing, a canvas fixed by its first context.                           | Fixed: each is answered in a rule above or added as Q11 to Q16.                                                                                                                                                                               |

The owner decided the three conflicts on 2026-11-09 (decisions 13 to 15). No finding is open.

### Approval and plan record

- **Decision.** The owner accepted this proposal on 2026-11-09 in the Claude Code session
  ("승인"). Asked how to treat the open questions, the owner chose "방향 수락, 질문은 단계에서":
  the direction is accepted now, and each open question is decided by the owner before the
  milestone that needs it starts. The merge of pull request
  [#1126](https://github.com/typeshade/typeshade/pull/1126) with `status: accepted` records the
  acceptance.
- **Approved scope.** R1 to R17, the owner's decisions 1 to 15, and the front matter as it
  stands. Proposal 0120's item 3, item 4, item 6 and its milestones from M4 part 2c onward are
  replaced; an amendment to 0120 withdraws them in its own pull request before milestone 1 of
  this proposal is implemented.
- **Open questions by milestone.** Each is asked of the owner before its milestone starts:

| Milestone                      | Questions           |
| ------------------------------ | ------------------- |
| 1. Resources                   | Q8, Q9, Q13's text  |
| 2. WebAssembly CPU tier        | Q10, Q12 (CSP path) |
| 3. Non-blocking calls          | Q4, Q14             |
| 4. Graphs for compute          | Q1, Q2, Q16         |
| 5. Rendering                   | Q3, Q5, Q15         |
| 6. Control flow                | Q16 (conditions)    |
| 7. State and anti-aliasing     | Q7                  |
| 8. Encoder layer, 9. Migration | none open           |

- **Responsibilities.** Implementation is not yet assigned. Each implementing pull request
  carries `Change: 0138`. A pull request that adds or renames a host-facing form an author
  writes shows one example before and after, and waits for the owner's "merge" (CLAUDE.md,
  Merging).
- **Milestones.** 1 to 9 in the order of the Draft impact estimate. Duration and cost are not
  estimated.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each milestone: the implementing
pull requests and their commits that say `Change: 0138`; the delivered configuration; both
halves of each host form tested on the same source (`compile()` and the language service,
CLAUDE.md "A test reads both halves"); the user journeys on WebGPU, WebGL2 and the CPU tier;
the planner's reports for the graphs of the examples; the bundle sizes; the document
validation; each deviation with its disposition; and the pending work.

## Amendments

An amendment changes the accepted text. Its pull request is proposal-only, and its merge is its
acceptance. Git holds the earlier text. The decided text stays in place, and an amendment record
sits under it.

### A1. The answers to Q8, Q9 and Q13 before milestone 1 (2026-11-09)

- [decision, owner, 2026-11-09] Q8, the device names: "createDevice 하나". A device is opened
  only by `createDevice()`. A block's default device is `using _ = device.use()`. `device()` is
  withdrawn from the exports, and `configure()` is deprecated and then removed.
- [decision, owner, 2026-11-09] Q8, the data names: "resident를 대체". `resident(xs)` is replaced
  by `array(xs)`, deprecated with a warning and then removed. The names that make data are
  `zeros`, `array`, `uniform` and `texture`. The host's `uniform()` keeps the name of the shader
  type `uniform<T>`, since both mean a uniform of `T`.
- [decision, owner, 2026-11-09] Q9: "접근자가 다시 만듦". Each field's accessor detects a growth of
  the region and makes its views again; where the runtime has a resizable `ArrayBuffer`, the
  region uses it. The host does not see the growth. Workers, a second realm and wasm32's 4 GiB
  limit stay to be stated with milestone 2.
- [decision, owner, 2026-11-09] Q13, the new text of `docs/dx.md` principle 1: "이 문구로". The
  text is: "The unit is the function call. Data is a resource typed by the shader's own
  declarations (a class, a uniform, a storage array, a texture), laid out by the compiler, set
  and read through typed views. Plain data is accepted and uploaded." Milestone 1 writes it.
- Affects: the front matter (`exports` loses `device`; `exports-removed` lists `resident` and
  `configure`, removed after a deprecation release), R3's example, Q8, Q9 and Q13.
- Status: `status: accepted` does not change.

### A2. `Device` gains `use()`; `Device` is listed among the exports (2026-11-09)

- [fact] Why. Amendment A1 decided that a block's default device is `using _ = device.use()`.
  `Device` is an existing export of `typeshade/runtime`, and `use()` reshapes it, but the front
  matter did not list `Device`. So milestone 1a (pull request #1145, merged at `cbe559a3`) could
  not export `Device.use()` or the public `texture()`: `scripts/changes.ts` refused the reshape.
- [decision, owner, 2026-11-09] "승인", on the agent's recommendation to add `Device` to the
  exports. `Device` joins `exports` as a reshaped export: it gains `use()`, which returns a
  disposable that makes the device the default for the block (ECMAScript `using`).
- Affects: the front matter `exports`. No rule, decision or milestone changes.
- Status: `status: accepted` does not change.

### A3. An exported storage array with no size is sized by the host (2026-11-09)

- [fact] Why. Milestone 1b (pull request #1152, merged at `edc7a45a`) made an exported
  `uniform<T>` of a class and an exported `storage<array<T, N>>` host resources. R10 gave no
  length for `export declare const ps: storage<array<T>>`, so the host view declares it `never`
  (deviation D8 of #1152).
- [decision, owner, 2026-11-09] "host가 크기를 정함". An exported storage array with no size is a
  `Buffer<T>` whose length the host sets: `ps.resize(n)` gives it `n` zeroed elements, and
  `ps.set(data)` gives it the length of `data`. An accessor, a `read()` or a call that takes the
  buffer before its length is set throws a `TypeError` that names the binding and says to call
  `resize` or `set`. The shader file does not state the size. `resize` keeps the elements that
  fit and marks the whole range dirty.
- [fact] Deviations of milestone 1 that stay open, recorded on #1145 and #1152: D1 (a scalar
  field's `get()` returns a number), D2 (one dirty byte range for each resource, also for a
  `Buffer`; R9 says for each element), D3 (a field named `set`, `needsUpdate` or `dispose` is
  refused), D4 (the types do not declare `[Symbol.dispose]`), D5 (`Texture` is an existing
  export), D6 (`HostFace.exports` reports an exported binding as `never`), D7 (an exported
  binding refuses `dispose()`, since it lives as long as its module). Next action for each: a
  decision with milestone 3, when calls take resources.
- Affects: R10 (the sized-by-the-host case). No front-matter entry changes.
- Status: `status: accepted` does not change.

### A4. The WebAssembly tier stands beside the JavaScript CPU tier; one global region (2026-11-10)

- [fact] Why. Before milestone 2, the author's session read draft proposal 0042
  (`changes/0042-wasm-tier.md`, a WebAssembly tier, with the measurements of issue #459) and
  `docs/typeshade-plan.md` (unit R2). They conflict with decision 14 and with R16, which put
  WebAssembly "in place of today's generated JavaScript":
  - 0042 keeps the JavaScript CPU tier and rejects replacing it. A synchronous helper call
    (Rule 8.21) cannot wait for a module: a browser's main thread refuses the synchronous
    compilation of a module over 4 KB, and for a small call the boundary costs what the
    arithmetic costs (#459, D2). A page whose Content Security Policy lacks `'wasm-unsafe-eval'`
    falls to the JavaScript tier and loses speed only.
  - Unit R2 of the plan gives each device owner its own `WebAssembly.Memory`; R17 gives one
    global region.
- [decision, owner, 2026-11-10] Asked which holds, with one host example under each: "JS 옆에
  병행". Decision 14 and R16 are amended. The WebAssembly tier stands beside the JavaScript CPU
  tier, as proposal 0042 designs it: the asynchronous work (a kernel function, a `@compute`
  entry, a full-screen draw, and the graphs and render compositions of this proposal) runs on
  WebAssembly where it can, and the synchronous helper call and a page that refuses WebAssembly
  run on the generated JavaScript. Both are the oracle's generated code and give its bits
  (Rule 11.7); the differential gate holds each to the oracle. This also answers Q12's
  remainder: the path under such a Content Security Policy is the JavaScript tier.
- [decision, owner, 2026-11-10] On the region: "전역 하나". R17 stands: one global region, the
  linear memory of the WebAssembly tier, shared by every device. Unit R2 of
  `docs/typeshade-plan.md` is written again to say so when milestone 2 is implemented. Cost
  recorded: every device of a page shares wasm32's 4 GiB.
- [fact] Milestone 2 is carried out under proposal 0042, which is a draft with seven open
  questions of its own (#459) and no independent review record. It must be reviewed, revised
  against this proposal (the region of R17 as its memory; the resources of R7 to R9 as its
  arrays) and accepted by the owner before any implementation. This proposal does not repeat
  its design. Q10 (the bundle and build cost) moves to 0042.
- Affects: R16, decision 14, Q10, Q12, milestone 2. No front-matter entry changes.
- Status: `status: accepted` does not change.

### A5. Before milestone 3: Q4, Q14, the order of milestones 2 and 3, and D1 to D7 (2026-11-10)

- [fact] Why. Milestone 3 (non-blocking calls) needs Q4 and Q14 (the table of the approval
  record). Amendment A3 leaves D1 to D7 of milestone 1 for it.
- [fact] Milestone 2 is carried out under proposal 0042 (Amendment A4). At `main` `25103b0b`, its
  milestone 1a is not finished, and its milestones 1b to 1h are not started.
- [fact] Two independent reviews read the drafts of this amendment. The first found that the
  answers to Q4 and Q14 contradicted each other for a `show` whose canvas has a frame in flight.
  It also listed thirteen open questions. The second found three more conflicts. The owner
  answered them on 2026-11-10, below.

**Q4, submission.**

- [decision, owner, 2026-11-10] Asked when a recorded call is submitted, the owner chose
  "둘 다: 마이크로태스크 끝 + read/show에서 즉시". The runtime submits the calls recorded in a
  microtask when the current microtask checkpoint ends. A `read()` submits at once every call
  recorded before it. A `show` does the same, except where the Q14 decisions make it wait. The
  author writes no submit (OD-3). The alternatives were the checkpoint only, or `read()` and
  `show` only. Cost recorded: calls separated by an `await` that ends the task (a `read()`, a
  timer, an event) go in separate submissions.

**Q14, back-pressure.**

- [decision, owner, 2026-11-10] Asked how a `requestAnimationFrame` loop is kept from queuing
  frames, the owner chose "show가 같은 캔버스의 이전 프레임을 기다림". At most one submission waits
  for each canvas. A submission that waits for its canvas is a held submission. The alternatives
  were a runtime that drops frames, or a host that decides. Cost recorded: when the GPU is slow,
  the canvas updates at the GPU's rate.
- [decision, owner, 2026-11-10] Asked what waits, the owner chose "그 프레임의 호출 전체가 함께
  기다림". The calls recorded before the `show` are held with it, so the loop's computation is
  held too. A `read()` or a plain-data call releases them (below). The alternative was to hold the
  write to the canvas only.
- [decision, owner, 2026-11-10] Asked what a second `show` on a canvas with a held submission
  does, the owner chose "계산은 모두 실행, 표시는 최신 것만". The calls of both frames run, in
  order. The canvas shows only the newer image. No computation is dropped. The alternatives were
  to hold both, or to throw. Cost recorded: the older image may never reach the canvas.
- [decision, owner, 2026-11-10] Asked how a `read()` relates to a held submission, the owner
  chose "read()가 대기 호출을 풀어 바로 제출". A `read()` submits the held submission at once,
  with every other call recorded before it. Only the write to the canvas still waits for the
  previous frame. The write to the canvas stays the held submission. A call with plain data only
  does the same. The alternative was a `read()` that
  waits for the canvas. Cost recorded: a loop that reads every frame has no back-pressure on its
  computation.
- [decision, owner, 2026-11-10] Asked what happens when the GPU stays slower than the loop, the
  owner chose "대기 프레임에 합침". A further `show` adds its calls to the held submission and
  replaces the image to show. Unless a `read()` or a plain-data call releases it, the GPU receives
  one frame at a time. The alternatives were to
  submit the oldest frame's calls, or a `show` that returns a promise. Cost recorded: while the
  GPU stays slower, the list of held calls grows in the host's memory.
- [decision, owner, 2026-11-10] Asked about three details together, the owner chose "추천 기본값
  채택":
  1. A canvas's previous frame is done when the GPU work of its submission completes. A `show`
     on a canvas with no previous frame submits at once.
  2. A graph that writes two canvases is submitted when neither canvas has a frame in flight.
  3. On WebGL2, each frame places a `fenceSync`. The runtime polls it before it submits the held
     submission.
- [decision, owner, 2026-11-10] Asked about a `show` after a `read()` released the calls, and
  about the CPU tier, the owner chose "합침 + CPU는 그리기가 끝난 때". A further `show` joins the
  held submission that the canvas write left. On the CPU tier, a canvas's previous frame is done
  when its draw (the pixels and the write to the canvas) ends. The alternative was a second held
  submission for the canvas.

**The defaults of the first review.**

- [decision, owner, 2026-11-10] Asked about nine defaults together, the owner chose "추천 기본값을
  모두 채택":
  1. `show` returns at once, with no value.
  2. A `read()` submits every call recorded before it, not only the calls it depends on.
  3. A `set()` between two calls of one submission is taken as a snapshot at each call. Each
     call sees the value at its own call (R10). R8's upload "at submission" becomes an upload for
     each call that sees a new value.
  4. "The end of the microtask" is the end of the current microtask checkpoint.
  5. On the CPU tier, a submission runs the calls.
  6. On WebGL2, a submission flushes, and a `read()` waits on a fence.
  7. An error of a submission is thrown at the next `read()`, `show` or call, with the call site
     of the failed call (R2).
  8. One submission is not made one fused plan; only `fuse` fuses (Rule 11.13).
  9. A call with plain data only first submits the calls recorded and not yet submitted, a held
     submission included.

**Order of milestones 2 and 3.**

- [decision, owner, 2026-11-10] Asked for the order, the owner chose "마일스톤 3을 먼저".
  Milestone 3 is implemented before milestone 2. Cost recorded: the WebAssembly tier comes later.
- [proposal] The approval record's order holds for the other milestones. The owner was not asked
  about them.
- [inference] Milestone 3 needs only the JavaScript CPU tier, WebGPU and WebGL2. Its uploads and
  read backs use the region of R17 as it is today, an `ArrayBuffer`.
- [fact] Proposal 0042 at `main` `25103b0b` assumes the earlier order. Its row "Today" (line 117)
  and its note at lines 391 to 394 put milestone 3 of this proposal after its stage 1. Its
  milestones 1f and 1g name no `Buffer<T>` or `Uniform<T>`. Open: 0042 must say how its tier takes
  the resources of milestone 3. Next action: an amendment of 0042 before its milestone 1b starts.
- [fact] Amendment A4 calls proposal 0042 a draft. It was accepted by
  [#1162](https://github.com/typeshade/typeshade/pull/1162).

**D1 to D7 of milestone 1.**

- [decision, owner, 2026-11-10] D1: "숫자 유지, R7을 개정". R8 is amended, since `get` is in R8 (the
  option named R7): `get` returns a
  scalar field's number, and the view of a vector or an array field as `Readonly`. An `f64` scalar
  field returns its joined number. Cost recorded: a scalar and a vector field return different
  kinds.
- [decision, owner, 2026-11-10] D2: "범위 여러 개를 두되 개수에 상한". Milestone 3 keeps a dirty
  range for each element written. It joins them into one range when their count passes a limit.
  R9 stands. Cost recorded: more code and tests than one widened range.
- [decision, owner, 2026-11-10] D3: "거부 유지, 컴파일 시점에도 진단". For its code, the owner
  chose "새 코드 + 호스트 쪽은 편집기". A field named `set` stays refused. A field named
  `needsUpdate` or `dispose` stays refused in a uniform's struct. The new code `TS8079` reports
  each on the struct of an exported binding, in the compiler and the editor. On a host's
  `uniform(Class, …)` or `zeros(Class, n)`, the editor reports `TS8079`, and the runtime keeps its
  `TypeError`. R7, R8 and R17 name the reserved names. Cost recorded: these names cannot be fields
  of such a struct.
- [decision, owner, 2026-11-10] D4 to D7: "네 가지 모두 추천대로". D4: the types of `Uniform` and
  `Buffer` declare `[Symbol.dispose]`, so `using` works. D5: `texture()` returns the existing
  `Texture` export; the section "What it touches" no longer calls `Texture` new. D6: `HostExport`
  gains a kind for a host resource, so `HostFace.exports` and the compiler agree (Rule 12.7). D7:
  the type of an exported binding has no `dispose()`; the runtime still throws a `TypeError`.
- [fact] This amendment adds `TS8079` to `codes` and `HostExport` to `exports` in the front
  matter. Milestone 3's first pull request carries D1 to D7 out.

**Open.**

- [fact] Open for milestone 4: a `read()` or a `show` inside a `fuse(fn)` trace. Open for
  milestone 5: a `show` into a texture.
- Affects: Q4, Q14, R7, R8, R9, the approval record's Milestones line (milestones 2 and 3 change
  places), D1 to D7, the section "What it touches" (Exports), and the front matter's `codes` and
  `exports`.
- Status: `status: accepted` does not change.

### A6. The deviations of milestone 3's first pull request (2026-11-11)

- [fact] Pull request [#1231](https://github.com/typeshade/typeshade/pull/1231) carries out D1 to
  D7 of Amendment A5. Its independent review found three differences from A5's words.
- [decision, owner, 2026-11-11] D3 on the host side. A5 says the editor reports `TS8079` on a
  host's `uniform(Class, …)` or `zeros(Class, n)`. A host file is TypeScript, so the editor
  reports TypeScript's `TS2345` (`TS2769` for `array`), and the second line of its text names
  `TS8079` and the field. Asked which holds, the owner chose "TS2345 안의 TS8079 문구로 수용".
  The alternatives were a plugin that reports `TS8079` itself, or a runtime error only. Cost
  recorded: a generic wrapper that passes any class to `uniform` no longer type-checks.
- [decision, owner, 2026-11-11] D3's reach and place. #1231 refuses the names on `array(…)` too,
  and refuses `set` at any depth of a struct, as the runtime does. It placed the diagnostic on the
  binding. Asked which holds, the owner chose "범위는 수용, 위치는 필드로 옮김": the wider reach
  stands, and `TS8079` stands on the field's declaration. The alternatives were to keep both, or
  to narrow the reach to A5's words.
- [fact] The text of Rules 6.1 and 8.21 for D3 and for calls on resources goes in its own pull
  request. Its Doorstop items are reviewed by a person after the owner reads the text.
- Affects: D3. No front-matter entry changes.
- Status: `status: accepted` does not change.

### A7. Milestone 3's slices, the window and a failed call, and the deviations of slice 2a (2026-11-11)

- [fact] Why. Pull request [#1236](https://github.com/typeshade/typeshade/pull/1236), merged as
  `76b66224`, carries out slice 2a of milestone 3. Its body records a plan of slices, two
  decisions of the owner, five deferred questions and deviations D-a to D-g. Amendment A6 records
  none of them.
- [fact] Two independent reviews read #1236, at `becee199` and at `ab2247ef`. The first found
  the blocking findings B1 to B3. The owner's decisions (a) and (b) answer B1 and B3.

**The slices of milestone 3.**

| Slice | Content                                                                                                                                                                                                                                                                                            | Status                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2a    | A kernel function that returns nothing, and a `@compute` entry, take a `Buffer` or a `Uniform`. The call is checked, recorded and submitted later (R2, R8, R10, R17; A5, Q4 and defaults 2, 3, 4, 7 and 9). The tiers are the CPU tier and WebGPU. A WebGL2 entry call reads back inside the call. | done: #1236, merged as `76b66224`                    |
| 2b    | R3, the device of the data. A call follows `using _ = device.use()`, and a call that mixes devices is a `TypeError`. An exported binding uploads its dirty range on each device that reads it. WebGL2 flushes at a submission and waits on a fence at a `read()` (A5, default 6).                  | not started                                          |
| 2c    | `show(image, canvas)` and the held submission of Q14, as A5 records it, on WebGPU, WebGL2 (`fenceSync`) and the CPU tier.                                                                                                                                                                          | not started                                          |
| Text  | Rules 6.1, 8.21, 8.23, 8.24, 11.8 and 11.13 and surface §64, §65 and §67 say what slice 2a delivered. The test of slice 2a gains its `Verifies:` tags.                                                                                                                                             | in progress: its Doorstop review waits for the owner |

- [proposal] The plan above is the agent's. The owner approved the merge of #1236, whose body
  carries it. The owner was not asked about the slices as a separate question.

**Decision (a): the window between a writing call and its `read()`.**

- The window: the time from a call that writes a `Buffer` to that `Buffer`'s `read()`.
- [fact] B1 was observed on the CPU tier at `becee199`. A writing call ran, and then `set()` wrote
  one field. The element's other fields went back to their values from before the call.
- [fact] The cause is A5 D2: a `Buffer` keeps one dirty range for each element. While the device
  holds the newer values, the region holds stale bytes beside the field that `set()` writes.
- [decision, owner, 2026-11-11] "그 구간의 set()을 거부". Between a call that writes a `Buffer`
  and its `read()`, `set()` on that `Buffer` throws a `TypeError`, as `get()` does. A5 D2 stands.
- [fact] #1236 applies the same refusal to `set(data)`, `resize()` and `needsUpdate` in the
  window (review finding S1). Each would drop or overwrite what the call wrote. The owner approved
  the merge with that text.
- Alternative: a dirty range exact to the field while the device holds the newer values. Cost of
  the alternative: ranges below one element, a deviation from A5 D2.
- Cost recorded: a host cannot set a field of a written `Buffer` until it awaits `read()`.
- [fact] The error says: "…: a call wrote Buffer<Particle>, and its values are on the device
  until `await Buffer<Particle>.read()` brings them back; await it first."

**Decision (b): a writing call that fails.**

- [fact] B3, observed at `becee199`: after a writing call failed, every later call on its `Buffer`
  failed. Neither `set(data)` nor `resize()` restored the `Buffer`; only `dispose()` ended it.
- [decision, owner, 2026-11-11] "set(data)나 resize()로 복구". After a writing call fails, each
  later call that takes that `Buffer`, and its `read()`, throw the original error with the call
  site. This holds until `set(data)` or `resize()` gives the `Buffer` new values.
- Alternative: only the next `read()` or call throws the error, which are A5 default 7's words
  alone. Cost of the alternative: a later call reads values that a failed call left unknown.
- Cost recorded: to recover, the host gives the whole `Buffer` new values. The failed call leaves
  the window, so `get()` reads the region again.
- [fact] The region then holds what it held before the writing calls not yet read back. After two
  writing calls with no `read()` between them, where the second fails, `get()` gives the values
  from before the first.
- [fact] The pending copy of the error (A5, default 7) is still thrown once. It is thrown at the
  next `read()` or call, wherever it is, a call with plain data and a draw among them. So a
  recovery runs in this order, as #1236 delivers it:
  1. A call that writes the `Buffer` fails when it is submitted.
  2. The `Buffer` leaves the window, and `get()` gives the region's values, as the fact above says.
  3. `set(data)` or `resize()` gives the `Buffer` new values.
  4. The next `read()` or call throws the error once, unless one threw it since the failure.
  5. The call after it works.

**The five deferred questions.**

- [decision, owner, 2026-11-11] "다섯 모두 지금 동작 유지, 나중에 결정". Today's behavior stays for
  each question, and each question stays open.
- [inference, agent] Decision (a) refuses `get()` in the window too, so it agrees with question 2's
  current behavior. The owner may close question 2; the owner has not closed it.

| No. | Question                                                                                                                | Behavior at `76b66224`                                                                                        | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | What resource does a kernel function return when it returns a value and takes a resource? R2 says "returns a resource". | A `TypeError` at the call, and `TS2345` in the host's editor. Q2 is milestone 4.                              | open   |
| 2   | What does `get()` give between a call that writes a `Buffer` and its `read()`?                                          | It throws a `TypeError`.                                                                                      | open   |
| 3   | Is a call whose only resource is a `Resident` (`array(xs)`) a call on a resource under R2?                              | No. It stays today's queued or awaited call (Rule 11.8).                                                      | open   |
| 4   | A plain array, `Map` or `Set` that a call on a resource writes: refuse, or allow?                                       | A `TypeError` at the call, and `TS2769`. The host passes `array(xs)` or a `Buffer`.                           | open   |
| 5   | May an entry call take a `Buffer` of `N` elements for a sized storage binding (`storage<array<T, N>>`)?                 | No. The call refuses it with a `TypeError`, and the view's overload that only queues takes no `Buffer` there. | open   |

- Next action for questions 1, 3, 4 and 5: ask the owner again before a slice that changes the
  behavior. No slice and no date are set.

**The deviations of slice 2a.**

Each is a difference between the accepted text (with A5 and A6) and `76b66224`.

| ID  | Deviation                                                                                                                                                                                                                                 | Disposition | Next action                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| D-a | A recorded call runs in order from its submission, but on WebGPU each call makes its own `GPUQueue.submit`. One `GPUQueue.submit` for each submission is not done.                                                                        | open        | One `GPUQueue.submit` for each submission. No slice is assigned yet.                                   |
| D-b | A `Uniform` argument is passed as its value at the call and packed again at each call. R8's dirty-range economy does not reach a uniform yet.                                                                                             | open        | Upload a uniform's dirty range, as a `Buffer` does. No slice is assigned yet.                          |
| D-c | WebGL2 (A5, default 6): an entry call's pass program reads back inside the call, so no flush and no fence is placed. A kernel function on a `Buffer` of structs has no WebGL2 tier (Rule 11.8).                                           | open        | Slice 2b.                                                                                              |
| D-d | A recorded call runs on the default owner (`configure`), as a `Resident` of `array()` does. R3 is not carried out.                                                                                                                        | open        | Slice 2b.                                                                                              |
| D-e | Rules 8.21 and 8.24 and surface §64 and §67 still said "No call takes a resource yet" at `76b66224`. The test carried no `Verifies:` tag.                                                                                                 | open        | The text pull request, with the Doorstop review that the owner approves.                               |
| D-f | A5 Q4 submits "when the current microtask checkpoint ends". JavaScript cannot see that point, so the submission comes in the next task. Calls that tasks before it record join the same submission. The order and the snapshots are kept. | open        | The owner decides whether A5 Q4 is read as "the next task", by an amendment, or whether it stays open. |
| D-g | The host view's overload that only queues still types a held length `{ array, length }` beside a `Buffer`. `tsc` accepts it, and the runtime refuses it with a `TypeError` at the call.                                                   | open        | A separate overload for a call on a resource, in slice 2b or later.                                    |

- [fact] Open beside them: proposal 0042's row "A resource on a CPU tier" describes `main` at
  `9c7b1899`, before milestone 3. Its amendment stays open (A5; 0042, Amendment A6).
- Affects: milestone 3's plan, R2 (the window and a failed call), A5 default 7 and A5 Q4 (D-f).
  It also affects the deferred questions. No front-matter entry changes.
- Status: `status: accepted` does not change.

### A8. Slice 2b, the owner's decisions on it, R3 for a `Uniform`, and the deviations after it (2026-11-11)

- [fact] Why. Pull request [#1238](https://github.com/typeshade/typeshade/pull/1238), merged as
  `75f114cb`, carries out slice 2b of milestone 3. Its body records three questions with the
  owner's answers and the dispositions of D-c, D-d and D-e. It also records a new deviation, D-h.
  Amendment A7 records none of them.
- [fact] Two independent reviews read #1238, at `fbdb6cef` and at `1fda2689`. The first found no
  blocking finding and the should-fix findings S1 to S6. Its finding S5 asks for the dispositions
  in this record (`CLAUDE.md`, Deviations). The second found nothing blocking. It found the
  should-fix findings R-s1 and R-s2, and it left notes.
- [fact] An independent review read this amendment at `e8e9fee7`. Its blocking finding B1: the
  exemption of a `Uniform` (Q-a) differed from R3's text and had no disposition. The owner's
  decision on B1 is below. This amendment amends R3.

**The slices of milestone 3, after slice 2b.**

This table states the status of each slice at `main` `75f114cb`. It replaces the Status column of
A7's table. A7's text stays as it is.

| Slice   | Content                                                                                                                               | Status                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 2a      | As in A7.                                                                                                                             | done: #1236, merged as `76b66224` |
| Text 2a | As A7's row "Text": Rules 6.1, 8.21, 8.23, 8.24, 11.8 and 11.13 and surface §64, §65 and §67 say what slice 2a delivered.             | done: #1240, merged as `6d6a979b` |
| 2b      | As in A7, with the owner's answers to Q-a, Q-b and Q-c below. D-c stays open, narrowed.                                               | done: #1238, merged as `75f114cb` |
| Text 2b | The rules and the surface say what slice 2b delivered: the sentences of D-e below. The tests of slice 2b gain their `Verifies:` tags. | not started                       |
| 2c      | As in A7: `show(image, canvas)` and the held submission of Q14.                                                                       | not started                       |

- [fact] #1240 closed D-e for slice 2a. Its Doorstop review was approved by the owner, and the
  owner said "merge" on 2026-11-11 (commit `6d6a979b`).
- [fact] Pull request [#1241](https://github.com/typeshade/typeshade/pull/1241) is a bug fix, not a
  slice. It was merged as `d61fbca2`, after CI passed 26 of 26 checks on its head `0b35d546`.

**The owner's decisions on #1238 (2026-11-11).**

- [decision, owner, 2026-11-11] On the first review:
  "Fix S1-S4, then re-review".
  The description of the option the owner chose also said:
  "S5 goes to a separate A8 amendment PR".
  - [fact] Commit `1fda2689` fixes S1 to S4 and S6. The second review read that commit.
  - [fact] This amendment is the pull request of S5.
- [decision, owner, 2026-11-11] Q-a, the device of a resource:
  "Keep the rule, exempt Uniform".
  - A resource belongs to the device in use when it is made. With no device in use, it belongs to
    the default owner.
  - A `Uniform` takes no part in choosing a call's device. Its value is copied at each call (D-b),
    so it joins a call on any device.
  - [fact] At `75f114cb`, `Core.owner` is set on a `Uniform` (`src/runtime/resource.ts:156`).
    `resourceOf` gives the `Uniform` argument no owner (`src/runtime/resource.ts:1668-1672`).
  - The alternative was to let a `Uniform` take part in the choice too. Cost of the alternative: a
    `Uniform` made at module top is refused beside a `Buffer` made in a `use()` block (review
    finding S6).
  - Cost recorded: when D-b is fixed, a `Uniform` gets a device copy. It then needs one copy for
    each device, as an exported storage array has.
- [decision, owner, 2026-11-11] On B1 of the review of this amendment, in Korean:
  "R3 개정으로 기록"
  (record it as an amendment of R3). This amendment replaces three sentences of R3.
  - Before:
    > A node runs on the device of its input resources. With plain JavaScript values alone it
    > runs on the default device. A call that mixes devices is a `TypeError`.
  - After:
    > A node runs on the device of its input resources. A `Uniform` takes no part in choosing
    > that device. With plain JavaScript values alone it runs on the default device. A call that
    > mixes devices among the resources that take part in the choice is a `TypeError`.
  - Reason, at `75f114cb`: a `Uniform`'s value is copied at each call (D-b). The reason is not
    part of R3.
  - The other sentences of R3 stay as they are.
  - An exported binding also takes no part in the choice, since it belongs to no one device (R3).
    A node whose only resources are `Uniform`s and exported bindings runs on the device in use,
    else on the default owner. The agent inferred this clause from R3's order and Q-a. Asked on
    2026-11-11 to merge A8, the owner chose the option:
    "추론 구절도 승인, CI 녹색이면 머지 (추천)"
    (approve the inferred clause too, merge when CI is green; recommended).
  - [decision, owner, 2026-11-11] The clause is part of the decided text, beside the amended R3.
  - Cost: as recorded under Q-a above. [proposal, agent] R3 is revisited when D-b is fixed.
  - [inference, agent] R3's "A resource belongs to one device" holds for a `Uniform` in name only:
    no code reads its owner at `75f114cb`. When D-b gives a `Uniform` one copy for each device, it
    belongs to no one device, as an exported binding does.
- [decision, owner, 2026-11-11] Asked Q-b and Q-c together, the owner chose one option:
  "Keep both as the PR does (Recommended)".
  - The description of that option:
    "Q-b keeps the refusal, and the stuck state on dispose is fixed as S2. Q-c is kept, and the error text is fixed as S1. Cost: none beyond those fixes."
  - Q-b. A call on one device writes an exported binding. Until that binding's `read()`, a call on
    another device that takes it is refused with a `TypeError`.
  - The alternative to Q-b was a hidden read back that blocks inside the call. R2 says a call does
    not block. Cost recorded: the host awaits `read()` before it calls on another device.
  - Q-c. `array(xs)` and `array(n, el)` inside a `use()` block make that device's `Resident`. The
    deprecated `resident(xs)` stays the default owner's.
  - The alternative to Q-c was the default owner. Cost of the alternative: `array(xs)` beside
    `zeros()` in one block is a call that mixes devices. Cost recorded: the `Resident` comes from
    the device's pool.
- [decision, owner, 2026-11-11] On the merge:
  "Merge, then A8 + text PR".
  #1238 was merged as `75f114cb`. This amendment is the A8 of that decision. The text pull request
  is the row "Text 2b" above.
- [decision, owner, 2026-11-11] On a call on a resource in a `fuse` body:
  "Separate bug-fix PR: throw".
  - [fact] At `75f114cb`, such a call returns a rejected promise. The host view types the call
    `void`, so the author gets an unhandled rejection.
  - [fact] #1241 makes the call throw the `TypeError` at the call. It changes the words of Rules
    8.24 and 11.13 and surface §64 to match.
- [decision, owner, 2026-11-11] On the Doorstop review of #1241:
  "Approve, merge when green".
  - [fact] #1241 was merged as `d61fbca2`.
- [decision, owner, 2026-11-11] On the scope of D-h, in Korean:
  "D-h에 fuse()도 포함"
  (include `fuse()` in D-h). A draw and a default `fuse()` keep the default owner, even inside a
  `use()` block. Both stay open.
  - The option the owner chose also said:
    "fuse()는 마일스톤 4에서 다룹니다"
    (`fuse()` is handled in milestone 4).
  - [proposal, agent] The next action for a draw is milestone 5.
- [decision, owner, 2026-11-11] On the stack of `use()` (first review, N1), the owner chose the
  option in Korean:
  "주의로만 기술 (추천)"
  (describe it as a caution only; recommended).
  - [fact] The option's description, in Korean, said: describe the current behavior as a fact,
    and put "do not await inside the block" in as a caution, not as a norm.
  - [fact] `use()` is one stack for each module instance (`src/runtime/default-device.ts`).
  - [agent wording of the owner's caution] The rule text first states the effect. While a task
    awaits inside a `use()` block, a resource that another task makes, or a call with no owned
    resource that it makes, takes that block's device. Then it gives the caution: do not await
    inside a `use()` block while other tasks may make resources or calls. An `await` of `read()`
    with no such task is not refused.
  - The caution is not a normative promise. A stack for each task may come later. N1 stays an
    open item.

**The deviations after slice 2b.**

Each was or is a difference between the accepted text (with A5 to A8) and `75f114cb`.

| ID  | Deviation                                                                                                                                                                                                                                                                                                                                                                                   | Disposition                                                | Next action                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-a | As in A7.                                                                                                                                                                                                                                                                                                                                                                                   | open, unchanged                                            | As in A7.                                                                                                                                                                   |
| D-b | As in A7.                                                                                                                                                                                                                                                                                                                                                                                   | open, unchanged                                            | As in A7. Then a `Uniform` needs one copy for each device (the cost under Q-a), and R3 is revisited ([proposal, agent]).                                                    |
| D-c | A submission of recorded calls flushes, and `read()` waits on a fence (A5, default 6). The WebGL2 pass program and the WebGL2 kernel path still read back inside the call. So the flush has no work pending, and the fence waits on work whose results are on the host. The fence is made at `read()`. A kernel function on a `Buffer` of structs has no WebGL2 tier (Rule 11.8), as in A7. | open (narrowed by #1238)                                   | Move the WebGL2 read back out of the call to `read()`. [proposal, agent; first review of #1238, N3] Place the fence at the end of the submission. No slice is assigned yet. |
| D-d | A recorded call runs on the default owner. R3 is not carried out.                                                                                                                                                                                                                                                                                                                           | closed by #1238                                            | None.                                                                                                                                                                       |
| D-e | The rule and surface sentences listed below are no longer true at `75f114cb`. The tests of slice 2b carry no `Verifies:` tag.                                                                                                                                                                                                                                                               | open (closed for slice 2a by #1240; opened again by #1238) | The text pull request of slice 2b, with the Doorstop review that the owner approves.                                                                                        |
| D-f | As in A7.                                                                                                                                                                                                                                                                                                                                                                                   | open, unchanged                                            | As in A7.                                                                                                                                                                   |
| D-g | As in A7. Slice 2b did not add the separate overload.                                                                                                                                                                                                                                                                                                                                       | open, unchanged                                            | A separate overload for a call on a resource. No slice is assigned yet.                                                                                                     |
| D-h | A draw (`callDraw`) and a default `fuse()` with no owned resource run on the default owner. This holds inside a `use()` block too.                                                                                                                                                                                                                                                          | open (new; scope by the owner's decision above)            | `fuse()`: milestone 4 (the owner's option). A draw: milestone 5 ([proposal, agent]).                                                                                        |

- [fact] The sentences of D-e, at `main` `75f114cb`. #1238's body lists them, and the second
  review's R-s1 adds four of them:
  1. `docs/language-design.md:1432` (Rule 11.8): "A recorded call runs on the default owner's
     tiers, …". The same paragraph says that a WebGL2 entry call has no flush and no fence (D-c).
  2. `docs/language-design.md:1436` (Rule 11.8): "Plain host values select no owner, so a call
     with none uses the default owner."
  3. `docs/language-design.md:1436` (Rule 11.8): "creates no global current device". `use()` is
     now one stack for each module instance, read by every kernel and entry call (R-s1).
  4. `docs/language-design.md:1439` (Rule 11.8): "The owner of a call does not follow
     `device.use()` yet".
  5. `docs/language-design.md:1439` (Rule 11.8): `array()` makes "the `Resident` that
     `resident()` makes". In a `use()` block it makes that device's `Resident` (Q-c; R-s1).
  6. `docs/use-typeshade-surface.md:8403-8406` (§64): a recorded call runs on the default owner's
     tiers, and a WebGL2 entry call has no flush and no fence.
  7. `docs/use-typeshade-surface.md:8491-8492` (§64): "The calls of a kernel function or an entry
     do not follow `device.use()`".
  8. `docs/use-typeshade-surface.md:10362-10364` (§69): a kernel or entry call with no owned
     resource uses the default owner (R-s1).
  9. Optional (R-s1): §69's `dispose()` text (`docs/use-typeshade-surface.md:10357-10358`) and the
     `Device.dispose()` JSDoc do not say that `dispose()` lands what the device wrote into an
     exported binding.
- [proposal, agent] The first review's note N1 goes in the same text, as a caution only (the
  owner's decision above). `use()` is one stack for each module instance. A resource made in another
  async task, while one task awaits inside a `use()` block, belongs to that block's device.
- [proposal, agent] The text of slice 2b also states R3 as amended above, in Rule 11.8.

**Open items from the reviews of #1238.**

| Item                                                                                                                                                                                                                                                                                                                      | Source                                       | Next action                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| S3 has no unit test. Only the WebGL2 resource arm of `gate:differential` holds it.                                                                                                                                                                                                                                        | Second review, N-r1                          | A Node test with a WebGL2 stand-in tier. No pull request is assigned.                                                             |
| A plain `Buffer` written on a WebGPU device and not read before `dispose()` of that device loses the write. Its `read()` then fails with an unclear error. This is code reading; it was not run on WebGPU.                                                                                                                | Second review, N-r2                          | Land owned `Buffer`s too, with a weak registry per owner. No pull request is assigned.                                            |
| The module-level `exported` set of `src/runtime/resource.ts` holds every exported binding strongly. A module reload keeps old bindings alive.                                                                                                                                                                             | Second review, N-r3                          | None assigned. The review calls it minor.                                                                                         |
| `use()` is one stack for each module instance, not one for each async task.                                                                                                                                                                                                                                               | First review, N1; the owner's decision above | The text pull request of slice 2b states it as a caution only. A stack for each task may come later; no pull request is assigned. |
| Inside `use()` of a disposed device, `zeros()` succeeds, and each call on that `Buffer` fails later. `uniform()` also succeeds, and a call on the disposed device fails later. `array()` and `texture()` throw at once. #1238 did not fix it. Observed at `fbdb6cef`; the `uniform()` case at `75f114cb` is code reading. | First review, N2                             | Check that the device in use is usable when a resource takes its owner. No pull request is assigned.                              |
| The `core/gl-fence.ts` row of `src/AGENTS.md` says that `read()` waits on `gpuDone`. The header of `src/core/gl-fence.ts` does not name `readFence` or its rule for a lost context. `read()` uses `readFence`, which ends the wait on a lost context.                                                                     | Second review, R-s2                          | A documentation fix, in the text pull request of slice 2b or in its own pull request.                                             |
| The first sentence of the `CHANGELOG.md` entry of #1238 still lists `uniform()` among what belongs to the device in use.                                                                                                                                                                                                  | Second review, N-r4                          | A documentation fix, with the item above.                                                                                         |
| The refusal table of surface §71 (`fuse`) has no row for the refusal of a call on a resource.                                                                                                                                                                                                                             | #1241, Open items                            | The owner decides whether a follow-up adds a row.                                                                                 |

- [fact] Unchanged and open:
  1. A7's five deferred questions.
  2. A7's open item on proposal 0042's row "A resource on a CPU tier".
  3. The first review's N4: one extra queue step for each submission. The review calls it
     harmless.
- Affects: milestone 3's plan (the slice table of A7) and R3. Under R3: Q-a and B1, a `Uniform`;
  Q-b, an exported binding; Q-c, `array()` in a `use()` block. It also affects D-b, D-c, D-d, D-e,
  D-g and D-h. No front-matter entry changes.
- Status: `status: accepted` does not change.

### A9. Slice 2c moves to milestone 5; the slices of milestone 3; what comes next; Q1, Q2 and Q16 (2026-11-11)

- [fact] Why. Pull request [#1247](https://github.com/typeshade/typeshade/pull/1247), merged as
  `42550b11`, is the text pull request of slice 2b. After it, the only slice of milestone 3 not
  started was 2c. The owner decided where 2c goes and what comes next, and answered Q1, Q2
  and Q16 for milestone 4. Amendment A8 records none of them.

**Decision: slice 2c moves to milestone 5.**

- [decision, owner, 2026-11-11] Asked where slice 2c (`show` and the held submission of Q14) goes, the owner chose:
  "2c를 마일스톤 5로 (추천)"
  (move slice 2c to milestone 5; recommended).
- [fact] The facts behind the decision, at `main` `42550b11`:
  1. `show` does not exist in the code. No module of `src/` exports it.
  2. The image that `show` puts on a canvas comes from R5 (rendering), which is milestone 5.
  3. Q5 and Q15 are questions of milestone 5 (the approval record's table).
  4. Slice 2c in milestone 3 was the agent's plan. A7 records that the owner was not asked about
     the slices as a separate question.
  5. The Draft impact estimate already lists `show` under milestone 5 (Rendering).
- Cost recorded: no back-pressure until milestone 5.
- [inference, agent] Until then, a `requestAnimationFrame` loop of calls on resources can queue
  frames faster than the GPU runs them (Q14).
- [fact] The owner's decisions on Q4 and Q14 in A5 stay as they are. This decision moves only
  the slice that carries out Q14 and the `show` part of Q4.
- [inference, agent] Milestone 5 carries out the held submission of Q14 and the submission at
  `show` (A5, Q4). The submission at `read()` and at the end of the microtask checkpoint is
  delivered by slice 2a, with deviation D-f.

**The questions of slice 2c, for milestone 5.**

The agent found these questions while it planned slice 2c. [proposal, agent] Ask each of the owner
before milestone 5 starts, with Q3, Q5 and Q15. Q-3 is near Q15, and Q-4 is near Q5.

| No. | Question                                                                                                                                   | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Q-1 | What is the image that `show` takes: a `Texture`, a `Buffer`, or the result of a full-screen fragment call on the canvas (`fs(canvas)`)?   | open   |
| Q-2 | What does `show` do when the image's size or format differs from the canvas's?                                                             | open   |
| Q-3 | What does `show` do when the image is on another device than the canvas? (Near Q15.)                                                       | open   |
| Q-4 | Do `fs(canvas)` and the passes of the program runtime count as writes to the canvas, so that they take part in the held submission of Q14? | open   |
| Q-5 | Which moment of the image does `show` show: its value at the `show`, or its value when the held submission is written to the canvas?       | open   |

**The status of milestone 3.**

This table states the status of each slice at `main` `42550b11`. It replaces the Status column of
A8's table. A7's and A8's text stays as it is.

| Slice   | Content                                                                                                  | Status                                             |
| ------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 2a      | As in A7.                                                                                                | done: #1236, merged as `76b66224`                  |
| Text 2a | As in A8.                                                                                                | done: #1240, merged as `6d6a979b`                  |
| 2b      | As in A8.                                                                                                | done: #1238, merged as `75f114cb`                  |
| Text 2b | As in A8: the rules and the surface say what slice 2b delivered. The tests of slice 2b gain `Verifies:`. | done: #1247, merged as `42550b11`                  |
| 2c      | As in A7: `show(image, canvas)` and the held submission of Q14.                                          | moved to milestone 5 by the owner's decision above |

- [fact] Pull request [#1241](https://github.com/typeshade/typeshade/pull/1241), merged as
  `d61fbca2`, is a bug fix, not a slice (A8). A call on a resource in a `fuse` body throws at the
  call.
- [fact] At `main` `42550b11`, every slice of A7's plan is done or moved (the owner's option).
  The option called milestone 3 done.
- [fact] R2's "GPU nodes return resources", which the Draft impact estimate lists under
  milestone 3, is not carried out for a kernel that returns a value. That gap is deviation D-i
  below. The deviations and the open items below stay open.
- [fact] #1247's body records its checks and quotes the owner's approval of its Doorstop review:
  "승인, PR 열고 A8 뒤 머지 질문". The owner said "merge" in the conversation on 2026-11-11. CI
  passed 26 of 26 checks on its head `b3440465`.

**The deviations at `42550b11`.**

Each is a difference between the accepted text (with A5 to A9) and `42550b11`.

| ID  | Deviation                                                                                                                                                                                                                                                                                       | Disposition                                            | Next action                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-a | As in A7: one `GPUQueue.submit` for each call on WebGPU.                                                                                                                                                                                                                                        | open, unchanged                                        | One `GPUQueue.submit` for each submission. No slice is assigned.                                                                                      |
| D-b | As in A7: a `Uniform` is packed again at each call.                                                                                                                                                                                                                                             | open, unchanged                                        | Upload a uniform's dirty range, as a `Buffer` does. Then a `Uniform` needs one copy for each device (A8, Q-a). [proposal, agent, A8] R3 is revisited. |
| D-c | As in A8: the WebGL2 read back is inside the call, and the fence is made at `read()`.                                                                                                                                                                                                           | open, the remainder that A8 records                    | Move the WebGL2 read back out of the call to `read()`. [proposal, agent] Place the fence at the end of the submission. No slice.                      |
| D-d | As in A7.                                                                                                                                                                                                                                                                                       | closed by #1238 (A8)                                   | None.                                                                                                                                                 |
| D-e | Rule and surface sentences that #1238 made false. A8's list is fixed by #1247. The remainder: `docs/use-typeshade-surface.md:9044` (§65), "Plain host values select no owner; a call without an owned resource uses the default owner." Since #1238 such a call runs on the device in use (R3). | open (narrowed by #1247; closed for slice 2a by #1240) | The next text pull request. No pull request is assigned.                                                                                              |
| D-f | As in A7: the submission comes in the next task.                                                                                                                                                                                                                                                | open, unchanged                                        | The owner decides whether A5 Q4 is read as "the next task", by an amendment, or whether it stays open.                                                |
| D-g | As in A7: the overload that only queues types a held length beside a `Buffer`.                                                                                                                                                                                                                  | open, unchanged                                        | A separate overload for a call on a resource. No slice is assigned.                                                                                   |
| D-h | As in A8: a draw and a default `fuse()` keep the default owner.                                                                                                                                                                                                                                 | open, unchanged                                        | `fuse()`: milestone 4 (the owner's option, A8). A draw: milestone 5 ([proposal, agent], A8).                                                          |
| D-i | R2: a kernel function called on a resource that returns a value does not return a resource. The call throws a `TypeError` (`src/core/host-kernel.ts:738`).                                                                                                                                      | open (new)                                             | Milestone 4, under Q2 and A7's deferred question 1. [inference, agent] This follows from A7's "Q2 is milestone 4".                                    |

**Open items at `42550b11`.**

| Item                                                                                                                                                                                                                                 | Source                       | Next action                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| The deprecation warning of `resident()` in `src/core/resident.ts` says that `array()` "makes the same Resident". Inside a `use()` block that is false: `array()` makes that device's (Q-c).                                          | #1247, Open items            | A later bug fix. No pull request is assigned.                                                  |
| The error text at `src/core/host-kernel.ts:738` (D-i) says the call is "not available yet (change 0138, milestone 3)". The milestone is stale.                                                                                       | Review of A9                 | A later bug fix changes the text. No pull request is assigned.                                 |
| N-r2, as in A8: a `Buffer` that is not exported, written on a WebGPU device and not read before `dispose()` of that device, loses the write. Code reading; not run on WebGPU.                                                        | Second review of #1238       | Land owned `Buffer`s too (A8). No pull request is assigned.                                    |
| N2, as in A8: inside `use()` of a disposed device, `zeros()` and `uniform()` succeed, and the call fails later. `array()` and `texture()` throw at once. Observed at `fbdb6cef`; the `uniform()` case at `75f114cb` is code reading. | First review of #1238        | Check that the device in use is usable (A8). No pull request is assigned.                      |
| N1: `use()` is one stack for each module instance, not one for each async task. #1247 states it as a caution only.                                                                                                                   | First review of #1238; A8    | A stack for each task may come later. No pull request is assigned.                             |
| N-r4: the first sentence of the `CHANGELOG.md` entry of #1238 still lists `uniform()` among what the device in use makes. #1247 edited the entry and left the sentence.                                                              | Second review of #1238       | A documentation fix. No pull request is assigned.                                              |
| The refusal table of surface §71 (`fuse`) has no row for the refusal of a call on a resource.                                                                                                                                        | #1241, Open items; A8        | The owner decides whether a follow-up adds a row.                                              |
| A7's five deferred questions.                                                                                                                                                                                                        | A7                           | As in A7: ask the owner again before a slice that changes the behavior. Question 1 is near Q2. |
| S3 of #1238 has no unit test. Only the WebGL2 resource arm of `gate:differential` holds it.                                                                                                                                          | Second review of #1238, N-r1 | A Node test with a WebGL2 stand-in tier. No pull request is assigned.                          |
| A `read()` or a `show` inside a `fuse(fn)` trace.                                                                                                                                                                                    | A5, Open (milestone 4)       | Ask the owner before milestone 4 starts.                                                       |
| A `show` into a texture.                                                                                                                                                                                                             | A5, Open (milestone 5)       | Ask the owner before milestone 5 starts.                                                       |

- [fact] #1247 closed A8's item R-s2: the `core/gl-fence.ts` row of `src/AGENTS.md` and the
  header of `src/core/gl-fence.ts` now name `readFence` and its rule for a lost context.
- [fact] These stay open, as in A8: N-r3 and the first review's N4. A7's open item on proposal
  0042's row "A resource on a CPU tier" stays open too.
- [fact] N-r4 stays open with a new next action, in the table above. #1247 edited the
  `CHANGELOG.md` entry and left its first sentence.

**Decision: what comes next.**

- [decision, owner, 2026-11-11] Asked what comes after milestone 3, the owner chose:
  "A9 + 사이트 핀 이동 + M4 질문 (추천)"
  (A9, the site pin move and the milestone 4 questions; recommended).
  - [fact] The option's description named three parts: this amendment, the site pin, and Q1, Q2
    and Q16 for milestone 4. The label gives no order.
  - The description of the site pin part, in Korean:
    "'마일스톤마다 핀 이동'대로 사이트 핀을 42550b11로 옮깁니다(web PR, 머지·배포는 여쭘)."
    (English translation: as "move the pin at each milestone" says, move the site pin to
    `42550b11`; a web pull request, and the merge and deploy are asked of the owner.)
  - [fact] The site is the repository `typeshade/web`.
- The parts, with their status at this amendment:

| Part        | What it is                                                                                      | Status                                           |
| ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A9          | This amendment.                                                                                 | in progress: #1248                               |
| Site pin    | Move the compiler pin of `typeshade/web` to `42550b11`. The owner is asked to merge and deploy. | in progress: typeshade/web#61                    |
| Q1, Q2, Q16 | The questions of milestone 4 (the approval record's table).                                     | decided: the owner answered on 2026-11-11, below |

**Before milestone 4: Q1, Q2 and Q16.**

- [decision, owner, 2026-11-11] Q1, asked whether `fuse(fn)` returning a node replaces the
  immediate scope or whether the two take different names, the owner chose:
  "하나의 fuse (추천)"
  (one `fuse`; recommended).
  - `fuse(fn)` returns a node (R4). Today's immediate use is written `await fuse(fn)()`.
  - Cost recorded: existing `fuse` code changes, downstream in typenn, typecv and typeaudio too.
  - Open, a separate question: whether today's shape `fuse((scope) => …)` stays until the
    deprecation of milestone 9, as R4 says. The owner has not decided it.
- [decision, owner, 2026-11-11] Q2, asked whether a kernel's result is its return value only, or
  its return value and today's in-place parameter (Rule 8.23), the owner chose:
  "반환값 + in-place (추천)"
  (the return value and in-place; recommended).
  - A kernel's result is its return value and its in-place parameter (Rule 8.23).
  - The option's description, in Korean:
    "지금처럼 파라미터를 제자리에서 쓸 수 있고, 결과를 리소스로 돌려줄 수도 있습니다. Rule 8.23과 기존 코드가 그대로입니다."
    (English translation: a parameter can be written in place as today, and a result can also be
    returned as a resource. Rule 8.23 and the existing code stay as they are.)
  - Cost recorded: two ways to give an output, and the graph tracks both.
  - [inference, agent] The decided words set the direction of A7's deferred question 1. A kernel
    function that returns a value and takes a resource returns a resource (R2). Question 1 stays
    open until the owner closes it.
- [decision, owner, 2026-11-11] Q16, asked what "run apart" means for the new graph features of
  milestone 4, the owner chose:
  "호출 순서대로 하나씩 (추천)"
  (one by one, in call order; recommended).
  - A composed node gives the bits that its inner calls give when they run one by one, in program
    order, as plain kernel calls (Rule 11.13).
  - An in-place update (R14) gives the bits of a copy first, then the write.
  - Cost recorded: the planner may not make an optimization that breaks this baseline.
  - Open under Q16: the condition node (milestone 6) and `show` into a canvas (milestone 5).
- [fact] The questions of milestone 4 in the approval record's table (Q1, Q2 and Q16) are
  decided. A5's open item for milestone 4 stays open: a `read()` or a `show` inside a `fuse(fn)`
  trace. The parts of Q1 and Q16 named above stay open too.
- Affects: milestone 3's plan (the slice tables of A7 and A8) and milestone 5's scope (slice 2c,
  Q-1 to Q-5, and the delivery of Q14). It also affects D-e, D-i, R-s2, Q1, Q2, Q16, R4 and R14.
  It sets the direction of A7's deferred question 1. No rule and no front-matter entry changes.
- Status: `status: accepted` does not change.

### A10. Milestone 4: the owner's decisions on Q-A to Q-J (Q-G follows from Q-D), conflicts C1 to C3, R2 and R4 amended, and the slice plan (2026-11-11)

- [fact] Why. Before milestone 4, the agent wrote a plan for it, and an independent review read the
  plan. The plan named ten questions, Q-A to Q-J.
- [fact] Three questions set two decided texts against each other: the conflicts C1, C2 and C3
  below.
- [fact] The owner answered nine of the ten questions on 2026-11-11, in the conversation. Q-G follows
  from Q-D; the owner gave it no separate answer.
- [fact] After an independent review of this amendment, the owner answered four more questions on
  2026-11-11. They are recorded under Q-A, Q-E and Q-H, and under "Answers after the review".
- [fact] After a second review, the owner answered four more items on 2026-11-11: the `async` node and
  its types, a set of the agent's readings and proposals, the held length, and A7's deferred question 4. They are recorded under "Confirmations after the re-review".
- [fact] Amendment A9 records none of these answers.
- [fact] The plan and its reviews are the agent's working notes. They are not in the repository.
  This amendment records each question with its options, its costs and the owner's words.
- [fact] Baseline: `main` at `0975a3d8` (the merge of #1248, Amendment A9).
- [fact] This amendment changes the front matter (below). It amends R2 and R4. It changes no rule
  text of `docs/language-design.md` and no code. Each slice below changes its rule text in its own
  pull request.

**The three conflicts.**

| Conflict | Side 1                                                                                                                                                                                             | Side 2                                                                                                                             | Question |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1       | A9 Q2's meaning, "its in-place parameter (Rule 8.23)", and its option description, "Rule 8.23과 기존 코드가 그대로입니다" (English translation: Rule 8.23 and the existing code stay as they are). | R14: `ps = integrate(ps, dt)` "reads as a new value". A9 Q16: an in-place update "gives the bits of a copy first, then the write". | Q-A      |
| C2       | A9 Q1: "하나의 fuse" (English translation: one `fuse`).                                                                                                                                            | R4: "Today's `fuse((scope) => …)` … stays until the deprecation of milestone 9 (Q1)."                                              | Q-D      |
| C3       | R4: a captured host number "is read at each call … never fixed at trace time".                                                                                                                     | R4: "`fn` runs once for each new graph shape"; a side effect of `fn` "runs only when it is traced".                                | Q-H      |

- [inference, agent; the independent review's N4] C1 is also OD-5 against Rule 8.23. OD-5 says that
  every parameter is passed by value unless it carries `@inout` or `@out`. By Precedence rule 2 of
  `docs/owner-decisions.md`, the entry holds. The owner's answer to Q-A follows the entry.

**Q-A. A kernel that returns an array; what an array parameter is (C1).**

- [fact] The question, with one example:
  - The shader file has `step(ps: array<Particle>, dt: f32): array<Particle> { …; return ps; }`.
  - The host writes `const next = step(old, 1 / 60)`.
  - Under side 1, `old` is written in place, and `next` is `old`.
  - Under side 2, `next` is a new value, and `old` keeps its values.
- The options of the first round, as the plan listed them:

| Option           | What it is                                                                   | Costs                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| (a) new value    | A returned parameter gives a new resource; the argument keeps its old value. | Changes Rule 8.23 (C1). Adding `return ps` to a kernel stops `step(ps, dt);` from updating `ps`, with no type error. One copy per call. |
| (d) alias        | `return p` returns the same resource, written in place. No copy.             | R14's "otherwise it writes a new resource" and Q16's baseline do not hold for a reader of the old value (C1).                           |
| (b) `@out` array | `@out out: array<T>`; the host call omits it and gets it back.               | No source for the length; the host's arity differs from the shader's; changes Rule 8.25.                                                |
| (c) none         | No array returns in milestone 4.                                             | Against R4 ("no scratch, no output arrays") and the Exclusions.                                                                         |
| (e) fresh array  | The kernel makes a new array of a length it computes.                        | A name the ambient library does not declare (§2.1, §9); OD-3.                                                                           |

- [decision, owner, 2026-11-11] The owner first wrote, in Korean:
  "프리미티브 타입인 경우 기본적으로 C, Rust와 같이 복사 반환이지만, @out 같이 포인터를 명시한 경우는 포인터 반환, class로 따지면 인스턴스? 개인 의견일 뿐이고, 적절한건 C, rust같은 언어 기준으로"
  (English translation: for a primitive type, by default a copy is returned, as in C and Rust; where
  a pointer is stated, as with `@out`, a pointer is returned, an instance in class terms? This is
  only a personal opinion; what is right is the standard of languages such as C and Rust.)
- [fact] The second round asked again in those terms. The chosen option's description said:
  - an array parameter with no mark is a value;
  - an author writes `return ps` or `@inout ps`;
  - costs: Rule 8.23 changes; `@inout` on the kernels that write an array; one copy for each call
    that returns an array, until the in-place slice.
- [fact] This record has the chosen option of the second round only. The other options of that
  round are not recorded here.
- [decision, owner, 2026-11-11] The owner chose:
  "Rust식: 기본 값, @inout만 제자리 (추천)"
  (English translation: Rust style: a value by default, in place only with `@inout`; recommended).
- [decision, owner, 2026-11-11] Asked about the scope of the change, after the independent review,
  the owner chose:
  "배열에만, @inout과 @out 모두 허용 (추천)"
  (English translation: only for arrays; both `@inout` and `@out` are allowed; recommended).
- What the decisions mean, as the chosen options described them:
  1. A kernel's parameter of an array with no size (`array<T>`) and no qualifier is a value.
  2. `return ps` gives a new value. The call copies the argument first, then writes the copy. The
     caller's `ps` keeps its old value.
  3. `@inout ps: array<T>` is the caller's storage. The call reads it and updates it in place.
  4. `@out ps: array<T>` is allowed, as OD-5's second qualifier.
  5. [inference, agent, from "배열에만"] A texture parameter, a storage texture parameter, a `Map` and
     a `Set` stay the caller's, passed by reference, as Rule 8.23 says today.
  6. [inference, agent, from OD-5 and Rule 8.25] An `@out` array is the caller's storage that the call
     writes. The call does not read its old value.
- Added by the agent:
  - [inference, agent] A parameter that the body only reads needs no copy. The value meaning changes
    nothing for it.
  - [decision, owner, 2026-11-11; confirmation item (4)] A pushed array parameter (Rule 8.23, change 0078) carries `@inout`. The reason: without a held length, the pushed array starts empty in the
    function, and the call leaves the elements past the pushed count as they were (Rule 8.23). An
    `@out` parameter must be written whole (`TS8075`, Rule 8.25), so `@out` does not fit.
  - [inference, agent] A kernel that writes an array parameter with no qualifier and does not return
    it writes only its own copy. Unless a diagnostic reports it, an unmigrated kernel loses its
    writes with no error.
- [decision, owner, 2026-11-11] This settles C1.
- [decision, owner, 2026-11-11; confirmation item (1)] It supersedes, by the owner's later choice, two
  texts of A9 Q2. The agent first read this; the owner confirmed it:
  1. A9 Q2's meaning bullet: "A kernel's result is its return value and its in-place parameter (Rule
     8.23)". "In-place" there means today's unmarked parameter. After A10, a kernel's result is its
     return value and its `@inout` and `@out` parameters.
  2. The part of A9 Q2's option description that said "Rule 8.23과 기존 코드가 그대로입니다".
- [inference, agent] The owner's choice agrees with OD-5, with R14 and with A9 Q16.
- Costs recorded:
  1. Rule 8.23 changes. Its text "passed by reference: the body reads and writes its elements in
     place" holds only for an `@inout` or `@out` array, a texture, a `Map` and a `Set`. The rule keeps
     a list of exceptions.
  2. Every existing kernel that writes an array parameter adds `@inout` or `@out`: the examples, the
     kernels of `typeshade/algorithms` and `typeshade/random`, the tests, the downstream
     repositories and the site.
  3. One copy for each call that returns an array parameter, until slice 6 removes the copies it can
     prove dead (R14).
  4. OD-3: today the compiler infers an array's access from the writes of the body (Rule 8.23). After
     A10, the author writes `@inout` or `@out`. This extra mark is in tension with OD-3. It is
     recorded as a cost of OD-5 (Precedence rule 4).
- Open under Q-A, not decided:
  - How `TS8075` ("written, whole, before the body reads it") applies to an `@out` array.
- [fact] The held length is decided under "Confirmations after the re-review" (item 3).

**R2, amended.**

- Before (R2, one sentence):
  > A call with plain data only (numbers, arrays, typed arrays, objects; Rule 8.21) keeps today's
  > meaning: it is awaited, writes its in-place arguments (Rule 8.23) and returns plain data.
- After:
  > A call with plain data only (numbers, arrays, typed arrays, objects; Rule 8.21) keeps today's
  > meaning: it is awaited, writes its `@inout` and `@out` array arguments and the textures, `Map`s
  > and `Set`s it writes (Rule 8.23 as amended by Amendment A10, Q-A), and returns plain data.
- [decision, owner, 2026-11-11; confirmation item 1] A second sentence, after "returns a resource at
  once": "A node whose `fn` contains a `read()` returns a promise of its outputs (Amendment A10,
  Q-E)."
- [decision, owner, 2026-11-11; confirmation item 4] A third sentence, after it: "A call that takes a
  resource and writes a plain array is awaited; it returns a promise and fills the plain array when
  it is done (Amendment A10, A7's deferred question 4)."
- [fact] The other sentences of R2 stay as they are.

**Q-D. Today's `fuse((scope) => …)` and `device.fuse` (C2).**

- [inference, agent] One name cannot keep both meanings at run time. `fuse(fn)` must decide at once
  whether to run `fn`, and a function does not show which shape it is.
- The options, as the plan listed them:

| Option                | What it is                                                                                       | Costs                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| (a) split by receiver | Top-level `fuse` switches in milestone 4; `device.fuse` keeps the scope shape until milestone 9. | A second meaning of `fuse` that Q1 did not choose. Two recorders. `chunk` has no node form. `FuseScope` and `scratch` stay. |
| (b) one switch        | Both switch in milestone 4. `chunk` becomes `device.fuse(fn, { chunk })`.                        | R4's milestone-9 sentence changes. typenn, typecv and typeaudio break at their next pin move.                               |
| (c) another name      | The scope shape stays under another import.                                                      | Two meanings of one name; against Q1.                                                                                       |
| (d) thenable node     | `await fuse(body)` runs the old shape; `fuse(fn)()` the new one.                                 | An `async` function that returns a node runs it; a trap.                                                                    |

- [decision, owner, 2026-11-11] The owner chose:
  "둘 다 M4에서 전환 (Q1 우선)"
  (English translation: both switch in milestone 4; Q1 first).
- What the decision means, as option (b) described it:
  1. The top-level `fuse` and `device.fuse` both return a node in milestone 4.
  2. Today's chunked plan is written `device.fuse(fn, { chunk })`.
  3. `FuseScope`, `scope.scratch()` and `scope.recorded` are removed. `exports-removed` gains
     `FuseScope`.
  4. R4's sentence below is amended. This settles C2, and it closes the open part of A9 Q1.
- Proposed by the agent and confirmed by the owner (confirmation item (7)):
  - [decision, owner, 2026-11-11] Each call of a chunked node runs alone, fenced and timed, as today's
    chunk plan does. `inspect(node).chunk` gives `elapsedMs`. `device.chunkRates` stays.
  - [decision, owner, 2026-11-11] `typeshade/fuse` keeps exporting `fuse`, as "What it touches" says.
- [fact] `scratch` and `recorded` are members of `FuseScope`, not exports.
- Costs recorded:
  1. typenn, typecv and typeaudio break at their next pin move. All three call `device.fuse`. The
     plan read their default branches on 2026-11-11: typenn `3a7d66c`, typecv `4189b3c`, typeaudio
     `5b95ded`. The review could not verify these citations.
  2. `.github/workflows/downstream.yml` builds typenn at a fixed commit. Its pin moves in step with
     the switch (Q-G).
  3. OD-6: no warning release is owed (Rules 13.9 and 13.10). The accepted text changes all the
     same.

**R4, amended.**

- Before (R4's last sentence):
  > Today's `fuse((scope) => …)`, which runs once and returns a report, stays until the deprecation
  > of milestone 9 (Q1).
- After:
  > Today's `fuse((scope) => …)` and `device.fuse((scope) => …)`, which run once and return a
  > report, are replaced in milestone 4: both `fuse(fn)` and `device.fuse(fn)` return a node, and
  > `FuseScope` is removed (Amendment A10, Q-D).
- [fact] R4's sentence on captured numbers stays as it is. Q-H below records the deviation from it.
- [fact] The other sentences of R4 stay as they are.

**Q-H. Numbers, lengths and side effects in a trace (C3).**

- [inference, agent] Take `let s = 2; const g = fuse((x) => k(x, s)); g(a); s = 3; g(a);`. If `fn`
  does not run again, the runtime cannot see `s = 3`. Only a run of `fn` at each call, or the host
  transform of R12 (milestone 6), can read it. So R4's two sentences of C3 cannot both hold in
  milestone 4.
- [fact] Planner fact F2 compares the actual trip counts of two calls (`src/core/fuse-group.ts:23`).
  A plan cached without lengths cannot keep today's grouping.
- The options of the first round, as the plan listed them:

| Option                      | What it is                                                                             | Costs                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| (a) trace once              | `fn` runs once for each shape; a captured number is fixed at the trace.                | A deviation from R4 until milestone 6. A placeholder's `.length` throws.     |
| (b) run `fn` at every call  | `fn` runs at each call with real values; the plan is cached by the recorded structure. | Against R4's "runs only when it is traced": a side effect runs at each call. |
| (c) host transform now      | Bring R12's host transform forward.                                                    | Milestone 6 work in milestone 4.                                             |
| (d) refuse captured numbers | —                                                                                      | Not detectable at run time.                                                  |

- [decision, owner, 2026-11-11] The owner first answered:
  "모르겠음"
  (English translation: I do not know).
- [fact] The second round asked again, with the example above, and numbered its options. Its option
  2 is option (a) of the table. This record has the chosen option only.
- [decision, owner, 2026-11-11] The owner chose:
  "2: trace 때 값 고정, M6에서 다시 (추천)"
  (English translation: 2: the value is fixed at the trace, revisited at milestone 6; recommended).
- [decision, owner, 2026-11-11] Asked after the independent review what a number argument and a
  `.length` do inside `fn`, the owner chose:
  "TypeError, 커널 안에서 계산 (추천)"
  (English translation: a `TypeError`; compute it inside the kernel; recommended).
- What the decisions mean, in the owner's words and the chosen options:
  1. `fn` is traced once for each shape.
  2. A number that `fn` captures is fixed at the trace. A later change of the variable does not reach
     the graph until `fn` is traced again.
  3. The `.length` of an argument, or JavaScript arithmetic on a number argument inside `fn`, is a
     `TypeError`. The author passes the value to a kernel and computes it there.
- Proposed by the agent:
  - [decision, owner, 2026-11-11; confirmation item (3)] The `TypeError` lasts until milestone 6, and
    its message names the line.
  - [fact] A run-time `TypeError` carries no `TS` code at `0975a3d8` (compare the `TypeError`s of
    `src/core/host-kernel.ts`). The owner's words name no code.
  - [proposal, agent; the plan's item (iii)] Trip counts join the plan key. A new length plans again
    without a new trace.
  - [inference, agent] A number argument of `fn` is a placeholder bound at each call. So
    `fuse((a) => k(a, a.length))` and `fuse((a, n) => k(a, n * 2))` throw.
- This settles C3. The difference from R4 is the open deviation D-j (below).

**Q-J. What a node call with plain data only gives.**

- [fact] A9 Q1: "Today's immediate use is written `await fuse(fn)()`." Today `await fuse(body)`
  waits until the plan has run, and it resolves to a `FuseReport`.
- The options, as the plan listed them:
  - (1) The call returns a promise that resolves after the plan has run, to `fn`'s outputs read back
    as plain data. The report is `inspect(g)` after the await.
  - (1') As (1), but the promise resolves to the report when `fn` returns nothing.
  - (2) A separate wait, which is a new name.
  - (3) The call never waits. This is a deviation from A9 Q1.
- [decision, owner, 2026-11-11] The owner chose:
  "평범한 데이터 호출은 기다림 (추천)"
  (English translation: a plain-data call waits; recommended).
- What the decision means: a node called with plain data only (no resource argument, zero arguments
  included) returns a promise. The promise resolves after its plan has run. The report comes from
  `inspect` (Q-B).
- [fact] The plan's option (1) also said "to `fn`'s outputs read back as plain data".
- [decision, owner, 2026-11-11; confirmation item 1] A call with plain data only returns a promise of
  plain data.
- Cost recorded: two return kinds by argument kind. `const report = await fuse(…)` becomes
  `await g(); inspect(g)`.

**Q-I. One kind of GPU array: `Buffer`.**

- [fact] At `0975a3d8`, a `Buffer<T>` is made only for a class `T`. `zeros`
  (`src/runtime/resource.ts:1358`) and `array(cls, data)` (`src/runtime/resource.ts:1377-1386`) take
  a class. The host view's `Buffer` overload exists only for a struct element
  (`src/compiler/ts/host-face.ts:2922`).
- [fact] At `0975a3d8`, `array(xs)` of scalars gives a `Resident` (`src/core/resident.ts`). A7's
  deferred question 3 asks whether a call whose only resource is a `Resident` is a call on a
  resource.
- [decision, owner, 2026-11-11] The owner first wrote, in Korean:
  "중복이라면, 또는 인지적으로 이해가 안된가면 제거히소 새 형태로 통합"
  (English translation: if it is a duplicate, or if it is hard to understand, remove it and unify it
  in the new form).
- [fact] This record has the chosen option of the second round only.
- [decision, owner, 2026-11-11] The owner chose:
  "Buffer 하나로 (추천)"
  (English translation: one `Buffer`; recommended).
- What the decision means:
  1. `array(xs)` of scalars returns a `Buffer` of that element: `Buffer<f32>` for a `Float32Array`,
     and so on.
  2. The type `Resident` and the function `resident()` are removed. Every GPU array is a `Buffer`,
     under one set of rules (R2, R3, R7 to R9, R17, A7's decisions (a) and (b)).
  3. `exports-removed` gains `Resident`. It already lists `resident` (A1).
- [decision, owner, 2026-11-11; confirmation item (2)] A7's deferred question 3 is closed: a call on a
  `Buffer` is a call on a resource. The agent first read this from "Buffer 하나로"; the owner
  confirmed it.
- Costs recorded:
  1. Existing `Resident` code migrates: the examples, the journeys, the scripts, the tests, the
     downstream repositories and the site.
  2. More work early in milestone 4 (slice 1 below).
  3. [fact] At `0975a3d8`, `src/__api__/surface.md` gives a `Resident` in the shapes of 44 exports: 41
     of `typeshade/algorithms`, `fillUniform` and `fillWords` of `typeshade/random`, and `Geometry`.
     `Device` also names it. Slice 1 reshapes them. [decision, owner, 2026-11-11; confirmation item
     (5)] This amendment adds the 44 to `exports`, with the cost of bare-name matching (front matter,
     below).
  4. [inference, agent; with Q-C] A kernel call on `array(xs)` that returns a value gives a `Buffer`
     of length 1, not a number. So `await sum(x)` becomes `const [s] = await sum(x).read()`.

**Q-C. The result of a kernel called on a resource.**

- The sub-questions of the first round, as the plan listed them:
  - the type of a node: as `fn`, with an overload for Q-J's plain-data call; or a branded type;
  - a scalar result: `Node<T>`; a value type or a `Buffer` of length 1; or a promise;
  - a struct result: one output for each field, or one output;
  - a result as another call's argument: accepted, or refused until a later slice.
- [decision, owner, 2026-11-11] The owner first chose:
  "추천안, 단 다른 이름"
  (English translation: the recommendation, but with another name).
- [fact] The second round asked which name. This record has the chosen option only.
- [decision, owner, 2026-11-11] The owner chose:
  "길이 1인 Buffer (새 이름 없음, 추천)"
  (English translation: a `Buffer` of length 1, no new name; recommended).
- What the decision means:
  1. `fuse(fn)` is typed as `fn` itself, with a second overload for a call with plain data only
     (confirmation item 1).
  2. A scalar result is a `Buffer` of length 1 of the result's type. Its `read()` gives a
     one-element array. No new name is added.
  3. A struct result gives one `Buffer` for each field (R1).
  4. A node's result is accepted as another call's argument.
  5. `Node` is dropped from `exports`. No `Node` type is exported.
- [decision, owner, 2026-11-11; confirmation item (2)] This closes D-i's question of what the call
  returns. It also closes A7's deferred question 1. The agent first read this; the owner confirmed it.
- Costs recorded: one read back for each field of a struct result, unless the runtime joins them; a
  scalar parameter that the lowering binds from a device value (slice 1).
- [fact] R12 calls a GPU value `Node<bool>`. That is a description, not an export. Milestone 6 names
  its type.

**Q-B. The report of a graph.**

- The options: (a) `inspect(node)`, with a nested graph shown flat; (b) group names qualified by the
  graph's path; (c) a node call that returns `{ value, report }`.
- [decision, owner, 2026-11-11] The owner chose:
  "inspect(node), 중첩은 펼쳐서 (추천)"
  (English translation: `inspect(node)`, a nested graph shown flat; recommended).
- What the decision means, as option (a) described it:
  1. `inspect(g)` gives the `FuseReport` of `g`'s last plan that ran. It gives `undefined` before the
     first plan has run.
  2. A nested graph appears flat, in program order. Its groups keep the author's lines.
  3. `FuseReport` gains a member for warnings (a side effect at the trace, a copy kept). So it is a
     reshaped export, and it joins `exports`.
- [proposal, agent] Slice 5 checks whether `mergeReports` needs the same.
- Cost recorded: two inner graphs that call one kernel are told apart only by line.

**Q-E. A `read()` inside `fn`.**

- The options of the first round: (a) a `read()` inside a trace throws; (b) a `read()` ends the plan,
  and the trace continues, so `fn` is `async`; (c) the read is a hidden output.
- [decision, owner, 2026-11-11] The owner chose:
  "read()에서 계획을 나눔"
  (English translation: split the plan at `read()`).
- [fact] The second round asked how this meets Q-H. This record has the chosen option only.
- [decision, owner, 2026-11-11] The owner chose:
  "나누되, 읽은 값으로 분기는 M6 (추천)"
  (English translation: split, but branching on a read value is milestone 6; recommended).
- [decision, owner, 2026-11-11] Asked after the independent review what a `read()` gives inside an
  `fn` that is traced once, the owner chose:
  "자리표시자: 매 호출 실제 값 (추천)"
  (English translation: a placeholder: the actual value at each call; recommended).
- What the decisions mean:
  1. `fn` may be `async`. Rule 11.13's synchronous body changes.
  2. A `read()` inside `fn` ends a plan, and the next calls start the next plan.
  3. At the trace, a `read()` gives a placeholder.
  4. At each call, the runtime binds the value actually read, as an argument of later calls.
  5. JavaScript control flow on a read value is a `TypeError` until milestone 6 (condition nodes,
     R12). This is the open deviation D-k.
  6. A new diagnostic code needs the owner's approval. These decisions approve none.
- [fact] A5's open item for milestone 4 ("a `read()` … inside a `fuse(fn)` trace") is closed for
  `read()`. A `show` inside `fn` stays open for milestone 5.

**Answers after the review: an `async` `fn` and R2.**

- [fact] The independent review found that Q-E meets R2. An `async` `fn` that awaits a `read()` cannot
  reach its later calls before the read. So a call of its node cannot return its outputs at once, as
  R2 says.
- [decision, owner, 2026-11-11] Asked which holds, the owner wrote:
  "그러면 실제 사용하는 개발자 입장에서 편의성 우선"
  (English translation: then put first the convenience of the developer who actually uses it).
- [decision, owner, 2026-11-11] The principle is the owner's: the developer's convenience comes first.
  The owner named no mechanism.
- [proposal, agent] The mechanism that the principle suggests (confirmed under "Confirmations after the
  re-review", item 1):
  1. A node whose `fn` is `async` (it contains a `read()`) returns a promise of its outputs, exactly
     as an `async` JavaScript function does.
  2. A node whose `fn` has no `read()` returns resources at once (R2).
  3. The node keeps `fn`'s own type. This also settles Q-C's "typed as `fn`".
  4. R2 needs a one-line exception (R2, amended, above).
  5. A node whose `fn` is not `async`, called with plain data only, returns a promise (Q-J). For that
     call the node's type is an overload beside `fn`'s type, as the plan's Q-C option wrote it.
- [inference, agent] Items 3 and 5 differ for a plain-data call of a node whose `fn` is not `async`.
  The owner settled both together (confirmation item 1).

**Confirmations after the re-review.**

- [fact] A second independent review read A10 at `05c95e89`. It listed what the owner had to confirm.
  The owner answered on 2026-11-11.
- Item 1, the `async` node and its types.
  - [decision, owner, 2026-11-11] The owner chose:
    "제안 승인 + 오버로드 (추천)"
    (English translation: approve the proposal, plus an overload; recommended).
  - What it means:
    1. A node whose `fn` has a `read()` returns a promise of its outputs.
    2. A node whose `fn` has none returns resources at once (R2).
    3. The editor shows two overloads. A call with plain data only returns `Promise<plain data>`. A
       call with resources keeps `fn`'s type. Kernel calls are typed the same way today.
    4. R2's exception sentence is decided (R2, amended, above).
- Item 2, the agent's readings and proposals.
  - [decision, owner, 2026-11-11] The owner chose:
    "모두 승인 (추천)"
    (English translation: approve all; recommended).
  - It covers:
    1. A9 Q2's "in-place" now means `@inout` and `@out` (Q-A).
    2. A7's deferred questions 1 and 3 are closed (Q-C, Q-I).
    3. The `TypeError` on a `.length` or arithmetic in `fn` lasts until milestone 6 and names the line
       (Q-H).
    4. A pushed array parameter carries `@inout` (Q-A).
    5. The 44 exports, with the cost of bare-name matching (front matter).
    6. The slice order 0 to 6 (slice plan).
    7. The smaller proposals: the chunked node's behaviour and `typeshade/fuse` keeping `fuse` (Q-D),
       and destructuring a read placeholder (Example 5).
  - Each is relabelled in this amendment as the owner's decision. Each keeps its cost.
- Item 3, the held length (change 0094).
  - [decision, owner, 2026-11-11] The owner chose:
    "Buffer<u32> (추천)"
    (English translation: `Buffer<u32>`; recommended).
  - What it means: a held length is `{ array, length: Buffer<u32>, offset? }`. It replaces today's
    `Resident<Uint32Array>` `length`.
- Item 4, A7's deferred question 4 (a plain array that a call on a resource writes).
  - [decision, owner, 2026-11-11] The owner chose:
    "허용: 기다리는 호출로 (추천)"
    (English translation: allow it, as a call that waits; recommended).
  - What it means:
    1. A call that writes a plain array beside `Buffer` inputs is allowed.
    2. It returns a promise and fills the plain array when it is done, as Q-J's plain-data call does.
    3. This adds one exception to R2's rule for calls on resources (R2, amended, above).
  - A7's deferred question 4 is closed.

**Q-F. A returned array's length, class and device.**

- The options: (a) the argument's length and class, on the call's device; (b) a length the host passes
  at the call.
- [decision, owner, 2026-11-11] The owner chose:
  "인자와 같은 길이·종류, 호출의 디바이스 (추천)"
  (English translation: the same length and kind (class) as the argument, on the call's device;
  recommended).
- What the decision means:
  1. A returned array has its argument's length and class.
  2. It belongs to the call's device (R3 as amended by A8).
  3. An array that a loop pushes onto cannot be returned in milestone 4.
- Cost recorded: no output of another length. A refusal needs a code the owner approves.

**Q-G. The downstream repositories.**

- [inference, agent, from Q-D] The owner gave Q-G no separate answer. The plan said "follows Q-D". Under
  Q-D (b), the plan's option for Q-G is: migrate typenn first, then typecv and typeaudio, at their pin
  moves.
- [fact] The site (`typeshade/web`) and vscode-typeshade update their `fuse` pages and references when
  their pins pass the switch (front matter `downstream`).
- [inference, agent] Slices 1 and 2 also change what typenn uses (`Resident`, kernels that write an
  array). So `downstream.yml` can turn red at slices 1 and 2, not only at the switch. It is not a
  required check.

**The front matter, changed by this amendment.**

- `rules`: Rules 8.25 (`@inout` and `@out` on a kernel array, Q-A) and 8.29 (its paragraph names a
  `Resident`, Q-I) are added.
- `surface`: §26 and §72 (they name `Resident`, Q-I) and §70 (parameter qualifiers, Q-A) are added.
- `exports`:
  - `Node` is dropped (Q-C).
  - `FuseReport` is added, as a reshaped export (Q-B).
  - The 44 exports that slice 1 reshapes are added (Q-I): the 41 of `typeshade/algorithms`,
    `fillUniform`, `fillWords` and `Geometry`.
  - [fact] `scripts/changes.ts` matches an export by its bare name. So listing `add`, `min`, `max`,
    `copy` and `fill` also admits a reshape of another export with the same name.
- `exports-removed`: `FuseScope` (Q-D) and `Resident` (Q-I) are added. `resident` is already listed
  (A1). `scratch` is a member of `FuseScope`, not an export.
- `downstream`: the entries name the `Buffer` and `@inout` migration.
- [fact] The radiance entry gains the same migration. Nobody has searched radiance for `Resident` or
  for kernels that write an array.

**Author examples, before and after.**

1. Today's `fuse(scope => …)` chain becomes a `fuse(fn)` node.

   Before (`main` `0975a3d8`; surface §71, with `array(xs)` in place of the deprecated
   `resident(xs)`):

   ```ts
   // ops.shade.ts
   export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
     for (let i: u32 = 0; i < out.length; i++) { out[i] = a[i] + b[i]; }
   }
   // mul(out, a, b) and relu(out, x) have the same shape.

   // host.ts
   import { array } from 'typeshade/runtime';
   import { fuse } from 'typeshade/fuse';
   import { add, mul, relu } from './ops.shade.ts';

   const [a, b, c] = [xs, ys, zs].map((v) => array(v));
   const out = array(new Float32Array(n));
   const report = await fuse((scope) => {
     const t = scope.scratch(n);
     const u = scope.scratch(n);
     add(t, a, b);
     mul(u, t, c);
     relu(out, u);
   });
   report.dispatches; // 1
   const y = await out.read();
   ```

   After:

   ```ts
   // ops.shade.ts
   export function add(a: array<f32>, b: array<f32>): array<f32> {
     for (let i: u32 = 0; i < a.length; i++) { a[i] = a[i] + b[i]; }
     return a; // a new value: the caller's a keeps its values (Q-A)
   }
   // mul(a, b) and relu(x) the same way.

   // host.ts
   import { array, fuse, inspect, type Buffer, type f32 } from 'typeshade/runtime';
   import { add, mul, relu } from './ops.shade.ts';

   type F = Buffer<f32>;
   const chain = fuse((a: F, b: F, c: F) => relu(mul(add(a, b), c)));
   const [a, b, c] = [xs, ys, zs].map((v) => array(v)); // Buffer<f32> each (Q-I)
   const out = chain(a, b, c); // Buffer<f32>, at once (R2)
   const y = await out.read();
   inspect(chain)?.dispatches; // the last plan's report (Q-B)
   ```

   A chunked plan on a device: `await dev.fuse((scope) => { … }, { chunk })` becomes
   `const g = dev.fuse(fn, { chunk })`, then `g(…)` and, after its plan has run,
   `inspect(g)?.chunk` (Q-D).

2. A kernel that writes an array: `@inout`, or a `return ps` form.

   Before (`main` `0975a3d8`):

   ```ts
   // particles.shade.ts
   export function step(ps: array<Particle>, dt: f32): void {
     for (let i: u32 = 0; i < ps.length; i++) { ps[i].pos += ps[i].vel * dt; }
   }

   // host.ts
   const ps = zeros(Particle, n);
   step(ps, 1 / 60); // writes ps in place (Rule 8.23)
   ```

   After, in place:

   ```ts
   // particles.shade.ts
   export function step(@inout ps: array<Particle>, dt: f32): void {
     for (let i: u32 = 0; i < ps.length; i++) { ps[i].pos += ps[i].vel * dt; }
   }

   // host.ts
   const ps = zeros(Particle, n);
   step(ps, 1 / 60); // writes ps in place (@inout)
   ```

   After, as a new value:

   ```ts
   // particles.shade.ts
   export function step(ps: array<Particle>, dt: f32): array<Particle> {
     for (let i: u32 = 0; i < ps.length; i++) { ps[i].pos += ps[i].vel * dt; }
     return ps;
   }

   // host.ts
   let ps = zeros(Particle, n);
   const old = ps;
   ps = step(ps, 1 / 60); // a new Buffer<Particle>; old keeps its values (copy first, then write)
   ```

   [inference, agent] The Before kernel, left unchanged after slice 2, writes only its own copy. The
   host's `ps` does not change.

3. `array(xs)` gives a `Buffer<f32>`, not a `Resident`.

   Before (`main` `0975a3d8`):

   ```ts
   import { array } from 'typeshade/runtime';
   import { sum } from 'typeshade/algorithms';
   const xs = array(new Float32Array([1, 2, 3])); // Resident<Float32Array>
   const s = await sum(xs); // 6
   ```

   After:

   ```ts
   import { array } from 'typeshade/runtime';
   import { sum } from 'typeshade/algorithms';
   const xs = array(new Float32Array([1, 2, 3])); // Buffer<f32>
   const [s] = await sum(xs).read(); // sum gives a Buffer<f32> of length 1 (Q-C); s is 6
   ```

   [proposal, agent] Whether `read()` of a `Buffer<f32>` gives a `Float32Array` or a `number[]` is set
   by slice 1 and shown to the owner before its merge.

4. A scalar result is a `Buffer` of length 1.

   Before (`main` `0975a3d8`):

   ```ts
   // particles.shade.ts
   export function energy(ps: array<Particle>): f32 {
     let s: f32 = 0;
     for (let i: u32 = 0; i < ps.length; i++) { s += dot(ps[i].vel, ps[i].vel); }
     return s;
   }

   // host.ts
   const e = energy(ps); // TypeError (src/core/host-kernel.ts:738); TS2345 in the editor (D-i)
   ```

   After:

   ```ts
   const e = energy(ps); // Buffer<f32> of length 1, at once (Q-C)
   const slower = damp(ps, e); // damp(ps: array<Particle>, k: f32): array<Particle>; a result is an argument (Q-C)
   const [total] = await e.read(); // a one-element array
   ```

5. The plain-data wait (Q-J) and an `async` `fn` (Q-E).

   Before (`main` `0975a3d8`):

   ```ts
   const report = await fuse((scope) => {
     relu(out, x); // out and x are Residents
   });
   report.dispatches;
   ```

   After, the two overloads of one node (confirmation item 1):

   ```ts
   const g = fuse((x: Buffer<f32>) => relu(x));
   const out = g(array(xs)); // a call with resources: Buffer<f32>, at once (fn's type)
   const y = await g(xs); // a call with plain data only: Promise<plain data>, after the plan has run (Q-J)
   inspect(g)?.dispatches; // the report (Q-B)
   ```

   After, an `async` `fn` (confirmation item 1):

   ```ts
   const settle = fuse(async (ps: Buffer<Particle>) => {
     const [total] = await energy(ps).read(); // ends the first plan; a placeholder at the trace
     return damp(ps, total); // the value read at each call is bound as an argument
     // if (total > 1) { … } here is a TypeError until milestone 6 (D-k)
   });
   const next = await settle(ps); // a promise of the outputs, as an async function gives
   ```

   [decision, owner, 2026-11-11; confirmation item (7)] Destructuring a placeholder of a one-element
   read is allowed, as shown here.

**The slices of milestone 4.**

[decision, owner, 2026-11-11; confirmation item (6)] The plan below adjusts the plan's slices to the
decisions above. The owner approved the order. The order keeps `main` working between slices:

- Slice 1 joins one `Buffer` (Q-I) and D-i (Q-C). Alone, the `Buffer` change would make two things
  throw until later slices:
  1. A call on a resource inside today's `fuse` body throws (`src/core/host-kernel.ts:640-645`,
     #1241).
  2. A call on a resource that returns a value throws (`src/core/host-kernel.ts:736-738`, D-i). Today
     `sum`, `min` and `max` of `typeshade/algorithms` on `array(xs)` resolve to a number.
- So slice 1 also keeps today's `fuse` working until the switch of slice 5. Today's recorder records a
  call on a scalar `Buffer`, as it records a `Resident` today. `FuseScope.scratch` returns a `Buffer`.
  A call on a `Buffer` of structs inside today's body stays refused.
- Two more calls would break in slice 1 without the owner's answers after the re-review. With them,
  slice 1 breaks neither:
  1. A held length's `length` is a `Resident<Uint32Array>` today, and slice 1 removes `Resident`. Its
     `length` becomes a `Buffer<u32>` (item 3), and a call on a resource records it.
  2. A plain array written beside `array(xs)` inputs is a plain-data call today. After slice 1 the
     inputs are `Buffer`s. The call stays allowed, and it waits (item 4).
- Slice 2 adds `@inout` and `@out` to every in-tree kernel that writes an array in the same pull
  request that changes Rule 8.23. So no in-tree kernel loses its writes.
- Slices 3 and 4 add forms. They take nothing away.
- Slice 5 switches `fuse` and migrates every caller in the same pull request.

Each slice carries `Change: 0138` and changes its rule and surface text in the same pull request. A
slice that changes rule text or `Verifies:` tags waits for the owner's reading before a person runs
`doorstop review`. Each slice that changes an author-facing form waits for the owner's "merge" after
its example before and after (`CLAUDE.md`, Merging).

| Slice | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Author-facing form                 | Status             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------ |
| 0     | This amendment (proposal-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                  | in progress: #1251 |
| 1     | One `Buffer` and D-i (Q-I, Q-C). `array(xs)` of scalars gives a `Buffer`; `Resident` and `resident()` are removed; `typeshade/algorithms`, `typeshade/random`, `Device` and `Geometry` take a `Buffer`. A kernel called on a resource that returns a scalar gives a `Buffer` of length 1; a struct gives one `Buffer` for each field; a result is accepted as another call's argument. The stale text at `src/core/host-kernel.ts:738` and D-g's overload are fixed. Today's `fuse` takes a scalar `Buffer`. A held length takes a `Buffer<u32>` `length`; a call that writes a plain array beside `Buffer` inputs waits (A7's deferred question 4). Rules 8.21, 8.22, 8.23, 8.24, 8.29, 11.8, 11.11 and 11.13 and surface §26, §64, §65, §67, §69, §71 and §72 are amended. [proposal, agent; re-review] Check `storageBuffer` if the constraint of `Buffer<T>` changes. | yes: waits for the owner's "merge" | not started        |
| 2     | Parameters (Q-A). An `array<T>` parameter with no qualifier is a value; `@inout` and `@out` are the caller's storage; textures, `Map` and `Set` stay by reference. `@inout` or `@out` is added to every kernel that writes an array (examples, `typeshade/algorithms`, `typeshade/random`, tests). Rules 8.23 and 8.25 and surface §65 and §70 are amended. [inference, agent; the review's N10] Rule 8.22 sends a loop over a range the device holds that writes through an `@inout` argument to the CPU; a kernel's own `@inout` array must not trigger that clause.                                                                                                                                                                                                                                                                                                    | yes: waits for the owner's "merge" | not started        |
| 3     | Array returns (Q-A, Q-F). `return ps` of an array parameter; copy first, then write; the result has the argument's length and class, on the call's device; a pushed array is refused. Rule 8.22 is amended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes: waits for the owner's "merge" | not started        |
| 4     | The graph executor, internal (Q-H, Q-E, Q-J). A trace once for each shape; trip counts in the plan key; kernel and `@compute` calls on resources recorded; an `async` `fn` split at `read()`, with placeholders bound at each call; the `TypeError`s of D-k and of Q-H; the plain-data path that waits; R3's device (D-h). No public change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | no                                 | not started        |
| 5     | The public switch (Q-D, Q-B, Q-E, Q-H, Q-J, Q-G). `fuse(fn)` and `device.fuse(fn[, { chunk }])` return a node; `inspect`; `fuse` from `typeshade/runtime` and `typeshade/fuse`; `FuseScope` removed. Rule 11.13 and surface §71 are amended: an `async` `fn`, the split at `read()`, the placeholders and their `TypeError`s, the plain-data wait, `inspect`, the refusal table. Every in-tree caller migrates. typenn migrates first, and the `downstream.yml` pin moves to a migrated typenn commit.                                                                                                                                                                                                                                                                                                                                                                    | yes: waits for the owner's "merge" | not started        |
| 6     | Nesting and in place (R4, R14, Q-B). A graph called in a graph is inlined; in place where nothing reads the old value and the planner's facts allow; the copies of slices 2 and 3 removed where proven dead; the report names each copy kept and shows nested graphs flat. Rule 11.13 and §71 are amended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [proposal, agent] no new form      | not started        |

- [decision, owner, 2026-11-11; confirmation item (6)] Order: 0, 1, 2, 3, 4, 5, 6. [proposal, agent]
  Slice 4 can run beside slices 1 to 3.
- [fact] Out of milestone 4: rendering and `show` (milestone 5, with slice 2c of A9), condition nodes and
  the host transform (milestone 6), module-field state (milestone 7).

**New open deviations.**

| ID  | Deviation                                                                                                                                                                                              | Disposition | Next action                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| D-j | R4: a host number captured by `fn` "is read at each call … never fixed at trace time". After Q-H, a captured number is fixed at the trace. A number argument and a `.length` throw inside `fn`.        | open (new)  | At milestone 6, R12's host transform reads a captured number at each call. Ask the owner again then (Q-H: "M6에서 다시"). |
| D-k | A value read inside `fn` (Q-E) is a placeholder, bound at each call as an argument of later calls. JavaScript control flow on it is a `TypeError`. R12 would run such a branch as ordinary TypeScript. | open (new)  | The condition nodes of R12, at milestone 6. Ask the owner again then.                                                     |

- [fact] D-a, D-b, D-c, D-e, D-f, D-g, D-h and D-i stay open as A9 records them. Slice 1 is the next
  action for D-i and D-g. Slice 4 is the next action for D-h's `fuse()` part.

**Open, owner must settle.**

- [fact] Nothing. The owner settled each point that the first and second revisions listed here: the
  type of a node and the `async` mechanism (confirmation item 1), and a `read()` in a traced `fn`
  (Q-E).

**Open items for the owner (not conflicts).**

| Item                                                                                                                                                                                                                                                                                                             | Source   | Next action                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| New diagnostic codes. Candidates ([proposal, agent]): a kernel that writes an array parameter with no qualifier and does not return it (Q-A); a returned array that is not a parameter; a returned pushed array (Q-F); two parameters returned on different paths. The front matter `codes` lists only `TS8079`. | Q-A, Q-F | Ask the owner for each code before slice 2 or 3. An amendment adds each approved code. |
| `TS8075` on an `@out` array (Q-A, "Open under Q-A").                                                                                                                                                                                                                                                             | Q-A      | Ask the owner before slice 2.                                                          |

**Independent review record of A10.**

- [fact] Reviewer: an AI agent (Claude Code) that did not write A10, on 2026-11-11. Revision reviewed:
  `7ce1e887`. It found 2 blocking findings, 14 should-fix findings and 12 notes.

| Finding                                                  | Answer                                                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| B1. Q-G is recorded as an owner decision.                | Fixed: labelled [inference, agent, from Q-D]; the heading and the opening say nine of ten.                                                   |
| B2. The new reading of A9 Q2 is labelled as the owner's. | Fixed: labelled [inference, agent]; A9 Q2's meaning bullet is superseded too.                                                                |
| S1. The real conflict is Q-E against R2.                 | The owner gave a principle (answer 1). The mechanism is the agent's proposal, to confirm at merge.                                           |
| S2. Q-E's meanings and D-k assume one answer.            | The owner answered: a placeholder, the actual value at each call.                                                                            |
| S3. The scope of "a value".                              | The owner answered: arrays only; `@inout` and `@out`. Pushed arrays: [inference] `@inout`. `TS8075` on `@out` and the held length stay open. |
| S4. R2's plain-data sentence becomes false.              | Fixed: R2 is amended.                                                                                                                        |
| S5. Slice 1 breaks today's code.                         | Fixed: one `Buffer` and D-i are one slice, and today's `fuse` takes a scalar `Buffer` until the switch.                                      |
| S6. `await sum(array(xs))` changes.                      | Fixed: cost 4 of Q-I, and Example 3.                                                                                                         |
| S7. The front matter is incomplete.                      | Fixed: the 44 exports, Rules 8.25 and 8.29 and surface §26, §70 and §72 are added.                                                           |
| S8. Unlabelled additions.                                | Fixed: each list names its source, and the agent's additions are labelled.                                                                   |
| S9. Number arguments in `fn`.                            | The owner answered: a `TypeError`, computed inside the kernel. In slices 4 and 5.                                                            |
| S10. Slice 5 omits Rule 11.13 and §71.                   | Fixed. `typeshade/fuse` keeps `fuse` ([proposal, agent]).                                                                                    |
| S11. Example 4's `read()`.                               | Fixed: a one-element array.                                                                                                                  |
| S12. No example of Q-J or Q-E.                           | Fixed: Example 5.                                                                                                                            |
| S13. D-j and D-k need an action.                         | Fixed.                                                                                                                                       |
| S14. The second-round options.                           | Fixed where known: the chosen options are recorded; the other options of the second round are not in this record.                            |
| N1 to N12.                                               | Applied where cheap: N2, N3, N4 (the OD-3 cost), N5, N6 (radiance), N7, N8, N9, N10, N11. N1 and N12 need no change.                         |

- [fact] A second review read `05c95e89` on 2026-11-11. It found 1 blocking finding, 3 should-fix
  findings and 3 notes.

| Finding                                                                                   | Answer                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-2. Q-H: additions presented as the owner's; the claim that the owner asked for a code. | Fixed: the claim is removed; the additions are labelled; the owner then approved them (confirmation item (3)). A run-time `TypeError` has no `TS` code. |
| R2-1. The reason for `@inout` on a pushed array is false.                                 | Fixed: the call leaves the elements past the pushed count unchanged, and `@out` must be written whole.                                                  |
| R2-3. Slice 1 breaks held lengths and plain arrays beside `array(xs)`.                    | The owner answered: a `Buffer<u32>` length (item 3) and a call that waits (item 4). Slice 1 says so.                                                    |
| R2-4. Example 5's plain-data half has no decided typing.                                  | Fixed: it shows the two overloads of confirmation item 1.                                                                                               |
| R2-5. Q-A meanings 4 and 5 lack a quoted source.                                          | Fixed: labelled [inference, agent].                                                                                                                     |
| R2-6. Rule 8.22's CPU fallback is wider in the text.                                      | Fixed: "a loop over a range the device holds".                                                                                                          |
| Note: slice 1's list of rules and sections.                                               | Fixed: Rules 8.23, 8.24, 11.8, 11.11 and 11.13 and surface §67, §69 and §71 are added.                                                                  |

- [fact] No review has read the revision that answers these findings.
- Affects: the front matter (`rules`, `surface`, `exports`, `exports-removed`, `downstream`); R2 (its
  plain-data sentence, and a proposed exception); R4 (the milestone-9 sentence; D-j); R12 (D-k); R14;
  Rules 8.21, 8.22, 8.23, 8.25, 8.29 and 11.13 and surface §26, §64, §65, §70, §71 and §72 (by the
  slices).
- Affects also: A9 Q1 (its open part is closed); A9 Q2 (its meaning and its option description are
  superseded in part); A9 Q16; A5's open item for milestone 4 (closed for `read()`); A7's deferred
  questions 1, 3 and 4 (closed); the held length of change 0094; D-g, D-h and D-i (their next
  actions).
- Status: `status: accepted` does not change.

### A11. Slice 1: the owner's answers to Q1 to Q7 on one `Buffer` (2026-11-11)

- [fact] Why. Slice 1 of A10's slice table is draft pull request #1257. Its first commit, `86b5de3d`,
  marks slice 1 `in progress`. It changes no code.
- [fact] A10 decides the name `Buffer` and the removal of `Resident` and `resident()` (Q-I). A10 does
  not decide seven points of slice 1 that change what an author writes. #1257 asks them as Q1 to Q7,
  with options and costs.
- [fact] The owner answered Q1 to Q7 on 2026-11-11, in the conversation. The agent asked each question
  again in the conversation, with options. For each question, this amendment records the options of
  #1257, the options of the conversation where they differ, the owner's chosen label and what it
  means.
- [fact] After an independent review of A11, the owner answered four more questions on 2026-11-11:
  the element view of a scalar `Buffer` (under Q1), a `Buffer` of vectors (under Q5), the program
  runtime's bindings, and its vertices and indices (both under Q3).
- [fact] Each chosen label is quoted in Korean, as the owner chose it, with an English translation.
- [fact] Baseline: `main` at `937147b8` (the merge of #1251, Amendment A10).
- [fact] This amendment changes the front matter (`downstream` only, below). It amends R2's third
  sentence (Q7). It changes no rule text of `docs/language-design.md` and no code. Slice 1 changes
  its rule and surface text in #1257.

**Q1. The members of a scalar `Buffer`.**

- [fact] At `937147b8`, a `Resident` has `read()`, `write(value)` and `destroy()`
  (`src/core/resident.ts:73-97`). A `Buffer<T>` has `length`, `read()`, `set(data)`, `resize(n)`,
  `at(i)`, `needsUpdate`, `dispose()` and `[Symbol.dispose]` (`src/runtime/resource.ts:895-920`).
- [fact] #1257 gives two options: (a) one member set, and (b) two member sets under one name. For (a),
  its cost says that `at(i)` needs either the region of R17 for a scalar array ("large runtime work")
  or a `TypeError` while the device holds newer values.
- [fact] The option that the owner chose in the conversation said, in Korean:

  "모든 Buffer가 Buffer의 멤버를 씁니다: write→set, destroy→dispose. '하나의 규칙'과 일치. 비용: 저장소 안 write 약 50곳, destroy 약 82곳과 다운스트림 이전. at(i)는 디바이스가 더 새 값을 가진 동안 TypeError(작은 구현)."

  (English translation: every `Buffer` uses the members of `Buffer`: `write`→`set`,
  `destroy`→`dispose`. It agrees with "one set of rules". Cost: about 50 `write` and about 82
  `destroy` sites in the repository, and the downstream migration. `at(i)` is a `TypeError` while the
  device holds newer values (a small implementation).)

- [fact] The other option of the conversation was #1257's (b): a scalar `Buffer` keeps `read`, `write`
  and `destroy`. Its cost: against "one set of rules" (Q-I, meaning 2).
- [decision, owner, 2026-11-11] The owner chose:

  "하나의 멤버 집합 (추천)"

  (English translation: one member set; recommended.)

- What the decision means, as the chosen option describes it:
  1. Every `Buffer`, of scalars, vectors or structs, has the members of `Buffer<T>`.
  2. `write(value)` becomes `set(data)`. `destroy()` becomes `dispose()`.
  3. While the device holds newer values than the host's copy, the element is a `TypeError`.
- [fact] A struct `Buffer` refuses the same way today. Its `at(i)` returns an accessor. The accessor's
  `get` and `set` throw while the device holds newer values (`src/runtime/resource.ts:30-32`,
  `:1010-1021`). This is the owner's decision of 2026-11-11, "그 구간의 set()을 거부".
- [fact] The counts 50 and 82 come from #1257. Its basis is not recorded. At `937147b8`, `git grep`
  finds 152 `.write(` and 163 `.destroy()` in `*.ts`, `*.mjs` and `*.js`. Those counts include
  receivers that are not a `Resident`.
- [fact] The chosen option does not choose the region of R17 for a scalar array. A `TypeError` covers
  the time when the device holds newer values.
- [inference, agent] `set`, `at(i)` and `needsUpdate` still need a host copy of a scalar `Buffer`.
  R17's last sentence says that today's `Resident` with no host read takes no range of the region.
  When a scalar `Buffer` takes its range is open (below).
- [proposal, agent] `Device.release(array)` takes a `Buffer` in place of a `Resident`. `Device` is in
  `exports` already (A10).
- Costs recorded:
  1. The `write` and `destroy` call sites migrate: the tests, the journeys, the scripts, the examples,
     the site and the downstream repositories.
  2. A scalar `Buffer` gains `at(i)`, `resize(n)` and `needsUpdate`. Slice 1 implements them for a
     scalar element.

**Q1, the element view of a scalar `Buffer` (after the review).**

- [fact] The review found that A11 did not say what `at(i)` of a scalar `Buffer` returns.
- [decision, owner, 2026-11-11] The owner chose:

  "원소 뷰 (get/set) (추천)"

  (English translation: an element view, with `get` and `set`; recommended.)

- What the decision means:
  1. `at(i)` of a scalar `Buffer` returns an element view, as `at(i)` of a struct `Buffer` does.
  2. `xs.at(3).get()` reads element 3. `xs.at(3).set(1.5)` writes it.
  3. Q1's `TypeError` applies to the view's `get` and `set` while the device holds newer values.

**Q2. What `read()` of a `Buffer<f32>` gives.**

- [fact] A10 Example 3 leaves this to slice 1. At `937147b8`, `read()` of a `Resident<Float32Array>`
  gives a `Float32Array`. `read()` of a `Buffer<T>` of structs gives `T[]` (R9).
- [fact] The options of #1257 and of the conversation: a `Float32Array` (proposed: today's
  `Resident`, no copy into numbers, `const [s] = …` works), or a `number[]`.
- [decision, owner, 2026-11-11] The owner chose:

  "Float32Array (추천)"

  (English translation: `Float32Array`; recommended.)

- What the decision means:
  1. `read()` of a `Buffer<f32>` gives a `Float32Array`.
  2. `read()` of a `Buffer` of structs gives `T[]`, as R9 says.
- [inference, agent] The same reason, "as a `Resident` gives today", gives an `Int32Array` for
  `Buffer<i32>` and a `Uint32Array` for `Buffer<u32>`. Each is what `Resident.read()` gives at
  `937147b8`.
- [inference, agent] A10 Q-C meaning 2 says that a scalar result's `read()` gives "a one-element
  array". A one-element `Float32Array` is one. The two agree.
- Open, not decided: `f64`. Rule 8.21 gives an `f64` a `Float64Array` (`docs/language-design.md:1017`).
  Whether `read()` of a `Buffer<f64>` gives one is not decided.

**Q3. A `Resident` of a value that is not an array.**

- [fact] At `937147b8`, `journeys/engine/engine.mjs:57-59` holds three non-array `Resident`s:
  `camera = resident({ viewProj: CAMERA, time: 0 })`, `light = resident({ viewProj: LIGHT })` and
  `lights = resident(LIGHTS)`. `LIGHTS` is an object `{ key, fill }` (`:36-39`).
- [fact] A `Uniform` needs a class that a compiled shader module lays out (`uniform(cls, init?)`,
  `src/runtime/resource.ts`).
- [fact] The options of #1257 and of the conversation:
  - (a) `array()` takes only an array. The author writes `uniform(Class, …)`, or passes the plain
    value at each draw.
  - (b) A `Buffer` of length 1 of the object.
  - Either option changes what an author writes.
- [decision, owner, 2026-11-11] The owner chose:

  "array()는 배열만, uniform()으로 (추천)"

  (English translation: `array()` takes arrays only; use `uniform()`; recommended.)

- What the decision means, as option (a) describes it:
  1. `array(value)` takes an array. A value that is not an array is a `TypeError` at the call.
  2. A uniform value that the host keeps is `uniform(Class, init)`.
  3. A value that the host does not keep is passed as plain data at each draw or call.
- [inference, agent] `device.array(value)` follows `array(value)`. The zeroed form `array(length,
element)` stays (`src/runtime/resource.ts:1382-1385`).
- [fact] The run-time refusal is a `TypeError` with no `TS` code, as the other refusals of slice 1 are
  (#1257, "New diagnostic codes: none expected").
- [inference, agent] In the editor, TypeScript's own type error refuses the call, since `array()` has
  no overload for a non-array value.

**Q3, the program runtime (after the review).**

- [fact] The review found two facts at `937147b8`:
  1. The program runtime binds a `Texture`, a `Sampler`, a `Resident`, a plain host value or a host GPU
     object (`src/runtime/program.ts:55-56`). It does not bind a `Uniform`.
  2. `journeys/engine` may import only the runtime's public exports (`journeys/engine/engine.mjs:1-5`).
     It cannot import a class of a shader module, so it cannot make a `Uniform`.
- [decision, owner, 2026-11-11] The owner chose:

  "평범한 값으로 매 프레임 전달 (추천)"

  (English translation: pass them as plain values each frame; recommended.)

- What the decision means:
  1. `camera`, `light` and `lights` of `journeys/engine` become plain values passed each frame.
  2. The program runtime already takes plain values.
  3. Slice 1 does not extend the program runtime to bind a `Uniform` or a `Buffer` as a binding.
- [fact] The program runtime takes a `Resident` for vertices and indices today
  (`src/runtime/program.ts:346-358`). The answer below decides what takes its place there.

**Q3, vertices and indices in the program runtime.**

- [fact] The option that the owner chose in the conversation said, in Korean:

  "정점·인덱스에 한해 Buffer<f32>/Buffer<u32>를 받게 함(Resident가 하던 일을 그대로). 비용: 슬라이스 1이 조금 커짐(바인딩 전체가 아니라 정점·인덱스만)."

  (English translation: take a `Buffer<f32>` or a `Buffer<u32>` for vertices and indices only, doing
  what a `Resident` did. Cost: slice 1 grows a little, for vertices and indices only, not for every
  binding.)

- [decision, owner, 2026-11-11] The owner chose:

  "프로그램 런타임이 Buffer를 받음 (추천)"

  (English translation: the program runtime takes a `Buffer`; recommended.)

- What the decision means:
  1. The program runtime takes a `Buffer` for a geometry's vertices and indices, in place of today's
     `Resident`: a `Buffer<f32>` or a `Buffer<u32>`.
  2. The data stays on the device, as a `Resident`'s did.
  3. For every other binding, the program runtime takes no `Buffer` and no `Uniform` in slice 1. Those
     stay plain values passed each frame (Q3, the program runtime).
- [fact] This is part of slice 1's scope. It closes the open item on vertices and indices.
- Cost recorded: slice 1 grows a little, for vertices and indices only.
- Costs recorded:
  1. Code that keeps a non-array `Resident` migrates: `journeys/engine`, and tests in
     `src/runtime/runtime.test.ts` and `src/compiler/ts/typed-bindings.test.ts`. Change 0025's record
     is history and stays.
  2. A plain value is uploaded at each draw. `journeys/engine` loses the one shared buffer of a
     `Resident`.
  3. In tension with OD-3: to keep a value on the device, an author now declares a class. Before,
     `resident(value)` took the plain value. Recorded as a cost (Precedence rule 4).

**Q4. An array of plain objects of a struct that is not a class.**

- [fact] At `937147b8`, `array([{ … }])` of a struct that is not a class gives a `Resident<S[]>`. Its
  host type is `readonly S[] | Resident<S[]>` (Rule 8.21).
- [fact] The options of #1257 and of the conversation:
  - (a) `Buffer<S>`, with `at(i)` refused until a call gives it a layout.
  - (b) Only `array(Class, data)` makes a `Buffer` of structs. A plain object array is passed as
    plain data.
- [decision, owner, 2026-11-11] The owner chose:

  "array(Class, data)만 구조체 Buffer (추천)"

  (English translation: only `array(Class, data)` makes a struct `Buffer`; recommended.)

- What the decision means, as option (b) describes it:
  1. A `Buffer` of structs comes from `array(Class, data)` or `zeros(Class, n)` (R9).
  2. An array of plain objects is passed to a call as plain data. The call is a plain-data call (R2).
- [inference, agent] A kernel parameter of a struct that is not a class takes `readonly S[]` only. An
  entry's storage binding of such a struct also loses "a `Resident` of it" (Rule 8.21,
  `docs/language-design.md:1017`).
- [proposal, agent] `array([{ … }])` with no class is a `TypeError` at the call. Its message says to
  write `array(Class, data)` or to pass the array itself. In the editor, TypeScript's own type error
  refuses it.
- Costs recorded:
  1. Code that passes `array([{ … }])` or `resident([{ … }])` of a non-class struct migrates to a
     class or to plain data.
  2. A plain-data call uploads its arrays and reads them back at each call. Code that kept a
     non-class array on the device loses that.
  3. In tension with OD-3: to keep an array of structs on the device, an author now declares a class.
     Recorded as a cost (Precedence rule 4).

**Q5. A vector element.**

- [fact] `array(Float32Array)` gives a `Buffer<f32>` (A10 Q-I). A struct result's `vec3` field gives a
  `Buffer<vec3<f32>>` (A10 Q-C, meaning 3). At `937147b8`, a `'vec4f'` scratch array is a
  `Resident<Float32Array>` that a call takes where it takes an `array<vec4f>` (Rule 11.13).
- [fact] #1257 and the conversation give one option: a kernel parameter `array<vec3<f32>>` takes both,
  so today's code keeps compiling.
- [decision, owner, 2026-11-11] The owner chose:

  "Buffer<f32>와 Buffer<vec3<f32>> 둘 다 (추천)"

  (English translation: both `Buffer<f32>` and `Buffer<vec3<f32>>`; recommended.)

- What the decision means:
  1. A kernel parameter `array<vec3<f32>>` takes a `Buffer<f32>` and a `Buffer<vec3<f32>>`.
  2. The host view gives both in the parameter's type.
- [inference, agent] The same reason extends meaning 1 to every vector element: `array<vecN<T>>` takes
  a `Buffer<T>` and a `Buffer<vecN<T>>`. Slice 1 states the extension in Rule 8.21 and shows it to the
  owner.

**Q5, a `Buffer` of vectors (after the review).**

- [fact] The review found three open points: what `read()` of a `Buffer<vecN<T>>` gives, what its
  `length` counts, and how a `Buffer<f32>` maps to `array<vec3<f32>>`.
- [decision, owner, 2026-11-11] The owner chose:

  "Float32Array(성분 이어서), length는 벡터 수 (추천)"

  (English translation: a `Float32Array` with the components one after another; `length` is the
  number of vectors; recommended.)

- What the decision means:
  1. `read()` of a `Buffer<vecN<f32>>` gives a `Float32Array` of the components one after another,
     with no padding.
  2. `length` of a `Buffer<vecN<f32>>` counts vectors. So it matches the kernel's `.length`, which
     counts elements (Rule 8.23, `docs/language-design.md:1068`).
  3. A `Buffer<f32>` passed as `array<vec3<f32>>` must have a length that is a multiple of 3.
- [fact] WGSL's storage layout, which Rule 6.8 adopts, gives `array<vec3<f32>>` a 16-byte stride.
- [fact] Rule 8.21 says, for an entry's runtime-sized storage binding (Rule 8.24), that the vector's
  components lie "one after another, which the call pads to the element's stride"
  (`docs/language-design.md:1017`). For a kernel's array with no size, it says only "a vector's
  components one after another" (`:1020`). It does not state the padding.
- [inference, agent] For a kernel's array, the call pads the components to the element's stride, as
  it does for an entry's binding. This stays open until slice 1 states it.
- [inference, agent] A `Buffer<f32>` whose length is not a multiple of 3 is a `TypeError` at the call.
  It has no `TS` code.

**Q6. A struct result's field that is a struct or a sized array.**

- [fact] R1 says "a returned struct gives one output for each field". A10 Q-C meaning 3 says "A struct
  result gives one `Buffer` for each field (R1)".
- [fact] #1257 gives one option: a sized-array field gives a `Buffer` of its length, and a nested
  struct field is refused with a `TypeError` at the call (no `TS` code) until a later slice.
- [fact] The conversation asked again. This record has the chosen option of the conversation only.
- [decision, owner, 2026-11-11] The owner chose:

  "중첩도 재귀적으로 펼침"

  (English translation: flatten nested structs too, recursively.)

- [fact] This is not the option that #1257 recommended.
- What the decision means:
  1. A sized-array field `array<T, N>` of a struct result gives a `Buffer<T>` of length `N`.
  2. A nested struct field is flattened recursively, down to its leaf fields.
  3. No nested struct field is refused.
- [fact] The first text of this amendment (`4ff0a11a`) listed a conflict. R1 and A10 Q-C give one
  output for each field. Meaning 2 gives one `Buffer` for each leaf field.
- [fact] The conversation then asked how a nested struct field meets R1. The options:
  - (a) "중첩은 Buffer들의 객체 (R1 유지, 추천)": a nested struct field gives one output, an object of
    `Buffer`s. R1 stays.
  - (b) "잎 필드마다 평탄하게 (R1 개정)" (English translation: flat, one for each leaf field; R1
    amended): R1 and A10 Q-C are amended to "each leaf field". It needs a naming rule, such as
    `pos_p`.
- [decision, owner, 2026-11-11] The owner chose:

  "중첩은 Buffer들의 객체 (R1 유지, 추천)"

  (English translation: a nested struct is an object of `Buffer`s; R1 is kept; recommended.)

- What the decision means:
  1. R1 stays as it is: one output for each field.
  2. A nested struct field gives one output. The output is an object with the same shape as the
     struct. Its leaves are `Buffer`s.
  3. Example: `motion(ps)` returns `interface Motion { energy: f32; pos: Pv }`, with
     `interface Pv { p: vec3<f32>; v: vec3<f32> }`. For `const r = motion(ps)`, `r.energy` is a
     `Buffer<f32>`, and `r.pos.p` and `r.pos.v` are each a `Buffer<vec3<f32>>`.
  4. A nested output is named by the struct's own field path. This settles the names of nested
     outputs.
- [inference, agent] So the answer "중첩도 재귀적으로 펼침" is carried out within R1. The recursion makes
  one `Buffer` for each leaf. The leaves keep the struct's shape.
- [inference, agent] A10 Q-C meaning 3 is refined, not kept word for word. It reads: one output for
  each field; a nested struct field's output is an object of `Buffer`s (A11, Q6).
- Open under Q6, not decided: a sized array of structs as a field (`array<S, N>`). It may give one
  `Buffer<S>`, or an object of `Buffer`s of length `N`, one for each leaf field.
- Costs recorded:
  1. A larger implementation in slice 1 than the recommended option.
  2. One read back for each leaf field, unless the runtime joins them. This is A10 Q-C's cost, now
     for each leaf.

**Q7. The result of a call that waits.**

- [fact] A10 confirmation item 4: a call that writes a plain array beside `Buffer` inputs is allowed.
  It returns a promise and fills the plain array when it is done, as Q-J's plain-data call does. A10
  does not say what the promise gives for a value-returning call.
- [fact] The options of #1257 and of the conversation: the promise gives plain data (a number for a
  scalar, as Q-J), or a `Buffer` of length 1. #1257 proposes plain data, since the call waits.
- [decision, owner, 2026-11-11] The owner chose:

  "평범한 데이터 (추천)"

  (English translation: plain data; recommended.)

- What the decision means:
  1. A value-returning call with `Buffer` inputs that also writes a plain array waits.
  2. Its promise gives the result as plain data: a number for a scalar.
- [inference, agent] For a struct result, the plain data is an object of plain fields.
- [inference, agent] A10 Q-C meaning 2 gives a `Buffer` of length 1 for a call on a resource. Q7 is
  the one call on a resource that waits. A10 item 4 already makes it a call "as Q-J's plain-data call
  does". So a call that does not wait gives a `Buffer`, and a call that waits gives plain data.
- Open, not decided: the editor's type of the mixed call. A10 confirmation item 1 gives two overloads.
  A call with plain data only returns a promise, and a call with resources keeps `fn`'s type. Q7's
  call has a resource argument and returns a promise.

**R2, amended (Q7).**

- Before (R2's third sentence, from A10):
  > A call that takes a resource and writes a plain array is awaited; it returns a promise and fills
  > the plain array when it is done (Amendment A10, A7's deferred question 4).
- After:
  > A call that takes a resource and writes a plain array is awaited; it returns a promise, fills the
  > plain array when it is done, and gives its result as plain data (Amendment A10, A7's deferred
  > question 4; Amendment A11, Q7).
- [fact] The other sentences of R2 stay as they are.

**The front matter, changed by this amendment.**

- [fact] `downstream`: the entries of `typeshade.github.io`, `vscode-typeshade`, `radiance` and `typenn`
  add three migrations. `typecv` and `typeaudio` follow `typenn`.
  1. `set` and `dispose` in place of `write` and `destroy` (Q1).
  2. `uniform(Class, …)` or a plain value in place of a non-array `Resident` (Q3).
  3. `array(Class, data)` or plain data in place of an array of plain objects of a non-class struct
     (Q4).
- [fact] `rules`, `surface`, `exports` and `exports-removed` do not change:
  1. Q1 reshapes `Buffer`, `Device` and the 44 exports, which A10 lists in `exports`. `write` and
     `destroy` are members of `Resident`, which A10 lists in `exports-removed`.
  2. Q3 and Q4 reshape `array` and `uniform`, which `exports` lists.
  3. The rules and sections that Q1 to Q7 touch are in slice 1's list (A10's slice table). Each of
     them is in the front matter.
- [fact] At `937147b8`, the rules of `docs/language-design.md` that name `Resident` or `resident(` are
  8.21, 8.23, 8.24, 8.29, 11.8, 11.11 and 11.13. The surface sections that name `Resident`,
  `resident(`, `.write(` or `.destroy()` are §26, §64, §65, §67, §69, §71 and §72. Each is in the front
  matter.

**Author examples, before and after.**

1. Q1: the members of a scalar `Buffer`.

   Before (`main` `937147b8`):

   ```ts
   const xs = array(new Float32Array(n)); // Resident<Float32Array>
   xs.write(values);
   xs.destroy();
   ```

   After:

   ```ts
   const xs = array(new Float32Array(n)); // Buffer<f32>
   xs.set(values);
   xs.at(3).set(1.5); // the element view (Q1, after the review)
   xs.at(3).get(); // a TypeError while the device holds newer values (Q1)
   xs.dispose();
   ```

2. Q2: `read()` of a `Buffer<f32>`. What an author writes does not change.

   ```ts
   const v = await xs.read(); // Before: Float32Array (Resident). After: Float32Array (Buffer<f32>)
   ```

3. Q3: a value that is not an array.

   Before (`journeys/engine/engine.mjs:57-59`):

   ```ts
   const camera = resident({ viewProj: CAMERA, time: 0 });
   camera.write({ viewProj: CAMERA, time: t });
   ```

   After, in `journeys/engine` (the owner's answer on the program runtime):

   ```ts
   const camera = { viewProj: CAMERA, time: t }; // a plain value, passed as the draw's binding each frame
   ```

   After, a uniform the host keeps, where a host imports a class of a shader module (R11):

   ```ts
   // shade: export class Camera { viewProj: mat4x4<f32>; time: f32 }
   const camera = uniform(Camera, { viewProj: CAMERA, time: 0 });
   camera.time.set(t);
   ```

   [fact] The program runtime does not bind a `Uniform` in slice 1 (Q3, the program runtime). It takes
   a `Buffer` for vertices and indices only (Q3, vertices and indices). The
   uniform form is for a node call (R11).

4. Q4: an array of plain objects of a struct that is not a class.

   Before (`main` `937147b8`):

   ```ts
   // shade: interface Particle { pos: vec3<f32>; vel: vec3<f32> }
   const ps = array([{ pos: [0, 0, 0], vel: [1, 0, 0] }]); // Resident<Particle[]>
   ```

   After, with a class:

   ```ts
   // shade: export class Particle { pos: vec3<f32>; vel: vec3<f32> }
   const ps = array(Particle, [{ pos: [0, 0, 0], vel: [1, 0, 0] }]); // Buffer<Particle>
   ```

   After, as plain data:

   ```ts
   const ps = [{ pos: [0, 0, 0], vel: [1, 0, 0] }]; // passed to each call as plain data (R2)
   ```

5. Q5: a vector element.

   ```ts
   // shade: export function spread(vs: array<vec3<f32>>): f32 { … }
   const flat = array(new Float32Array(data)); // Before: Resident<Float32Array>. After: Buffer<f32>
   spread(flat); // accepted before and after; after, flat.length must be a multiple of 3
   const [p] = await motion(ps).pos.p.read(); // after: a Buffer<vec3<f32>>; read() gives a Float32Array
   ```

6. Q6: a struct result with a sized array and a nested struct.

   Before (`main` `937147b8`):

   ```ts
   // shade: interface Box { min: vec3<f32>; max: vec3<f32> }
   //        interface Stats { box: Box; hist: array<u32, 8>; count: u32 }
   //        export function stats(ps: array<Particle>): Stats { … }
   const s = stats(ps); // TypeError (src/core/host-kernel.ts:738); TS2345 in the editor (D-i)
   ```

   After (Q6: the struct's own field path):

   ```ts
   const s = stats(ps);
   s.hist; // Buffer<u32> of length 8
   s.count; // Buffer<u32> of length 1
   s.box.min; // Buffer<vec3<f32>> of length 1; s.box is an object of Buffers (R1 kept)
   ```

7. Q7: a call that waits. What an author writes does not change.

   ```ts
   // shade: export function mark(xs: array<f32>, flags: array<u32>): u32 { … }  // writes flags
   const flags = new Uint32Array(n); // a plain array
   const count = await mark(array(data), flags); // Before and after: a number; flags is filled
   ```

   [fact] Before, `array(data)` is a `Resident`. The call returns `Promise<u32>` and reads `flags`
   back (Rule 8.21, `docs/language-design.md:1020`). After, the call waits (A10 item 4) and gives a
   number (Q7). Slice 2 adds `@inout` to `flags`.

**The slices of milestone 4, status.**

- [fact] This statement updates A10's slice table. A10's text stays as it is.

| Slice  | Status                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0      | done: #1251, merged as `937147b8`.                                                                                                                                                                                             |
| 1      | in progress: #1257 (draft), head `86b5de3d`. Blocked on this amendment. After its merge, #1257 implements Q1 to Q7, except the open points. Its scope includes a `Buffer` for the program runtime's vertices and indices (Q3). |
| 2 to 6 | not started.                                                                                                                                                                                                                   |

**Open, owner must settle.**

- [fact] Nothing. The first text (`4ff0a11a`) listed one conflict, Q6 against R1 and A10 Q-C. The
  owner settled it on 2026-11-11 (Q6).
- [fact] No answer of Q1 to Q7 conflicts with an entry of `docs/owner-decisions.md` (OD-1 to OD-8). Q3
  and Q4 are in tension with OD-3. They record it as a cost.

**Open items for the owner (not conflicts).**

| Item                                                                                                                                | Source         | Next action                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| A sized array of structs as a field.                                                                                                | Q6             | Ask the owner before #1257 implements Q6.               |
| The padding of a kernel's array of vectors to the element's stride ([inference, agent]: the call pads, as for an entry's binding).  | Q5             | #1257 states it in Rule 8.21 and shows it to the owner. |
| The result's class under A10 Q-F when a `Buffer<f32>` is the argument for `array<vec3<f32>>`: `Buffer<f32>` or `Buffer<vec3<f32>>`. | Q5, A10 Q-F    | Ask the owner before slice 3.                           |
| `f64`: whether `read()` of a `Buffer<f64>` gives a `Float64Array`.                                                                  | Q2, Rule 8.21  | #1257 states it and shows it to the owner.              |
| The editor's type of Q7's mixed call (a resource argument, a promise result).                                                       | Q7, A10 item 1 | #1257 states the overload and shows it to the owner.    |
| When a scalar `Buffer` takes a range of the region (R17's last sentence).                                                           | Q1             | #1257 states it and shows it to the owner.              |

**Independent review record of A11.**

- [fact] Reviewer: an AI agent (Claude Code) that did not write A11, on 2026-11-11. Revision reviewed:
  `4f70e94b`. It found 1 blocking finding, 12 should-fix findings and 8 notes.

| Finding                                                   | Answer                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B1. Q6 records an option that #1257 does not give.        | Fixed: #1257's one option and the conversation's chosen option are told apart; the R1 follow-up records both options of the conversation.      |
| S1. Q1's option text is not the text the owner saw.       | Fixed: the chosen option is quoted as the owner saw it; the region of R17 is not part of it and stays an open item.                            |
| S2. The Rule 8.21 quote is about an entry's binding.      | Fixed: the citation is `docs/language-design.md:1017` for an entry's binding; the padding of a kernel's array is an open inference.            |
| S3. Example 5's Before type.                              | Fixed: `Resident<Float32Array>`.                                                                                                               |
| S4. Example 6 uses WGSL syntax.                           | Fixed: `interface` declarations.                                                                                                               |
| S5. Q3 misses `lights`.                                   | Fixed: `engine.mjs:57-59`, with `camera`, `light` and `lights`.                                                                                |
| S6. The uniform form does not work for `journeys/engine`. | The owner answered: plain values each frame; the program runtime binds no `Uniform` in slice 1. Example 3 shows both forms with the condition. |
| S7. `downstream` omits Q4.                                | Fixed.                                                                                                                                         |
| S8. A10 Q-C is refined, not kept.                         | Fixed: Q6 records the refinement, and Affects lists it.                                                                                        |
| S9. The OD-3 cost of Q3 and Q4.                           | Fixed: recorded as a cost of each (Precedence rule 4), with the upload at each plain-data call.                                                |
| S10. Agent extensions inside decision meanings.           | Fixed: each extension is a separate [inference, agent] bullet.                                                                                 |
| S11. Missing open items.                                  | The owner answered the element view, the `read()` and `length` of a `Buffer` of vectors, and the program runtime. The rest are in the table.   |
| S12. Affects disagrees with the front-matter statement.   | Fixed: Affects lists the same rules and sections.                                                                                              |
| N1. The count basis.                                      | Fixed: "basis not recorded", with the `git grep` counts.                                                                                       |
| N2. Rule 6.8 does not state 16 bytes.                     | Fixed: WGSL's storage layout, which Rule 6.8 adopts.                                                                                           |
| N3. Example 7's citation.                                 | Fixed: Rule 8.21, `docs/language-design.md:1020`.                                                                                              |
| N4. Example 4's class form needs a shader change.         | Fixed: the shader line is shown.                                                                                                               |
| N5. `step` in Q6.                                         | Fixed: `motion`, with its struct declared.                                                                                                     |
| N6. Q3's zeroed form.                                     | Fixed: the zeroed form stays.                                                                                                                  |
| N7. Long sentences.                                       | Fixed: split.                                                                                                                                  |
| N8. The review record.                                    | Fixed: this record.                                                                                                                            |

- [fact] No review has read the revision that answers these findings.

- Affects: the front matter (`downstream`); R2 (its third sentence); R1 (kept, Q6); R9 (a scalar
  `Buffer` beside the struct one); R17 (its last sentence, by Q1); A10 Q-C meaning 3 (refined, Q6); A10
  Example 3 (Q2 settles its open point); A10's slice table (the status statement above).
- Affects also, by slice 1: Rules 8.21, 8.22, 8.23, 8.24, 8.29, 11.8, 11.11 and 11.13, and surface §26,
  §64, §65, §67, §69, §71 and §72.
- Status: `status: accepted` does not change.

### A12. Slice 1: the owner's decisions during #1257, its deviations, and the result kinds that A11 left open (2026-11-11)

- [fact] Why. Slice 1 of A10's slice table is draft pull request #1257. Its head was `51f5bf8c` when
  this amendment was first written, and it is `b14f2373` now. While it was in progress, the owner
  made four decisions on 2026-11-11, in the conversation. #1257's body also lists deviations from the
  accepted text. This amendment records both in the proposal.
- [fact] Baseline: `main` at `8923b2d0`. The last change to this file on `main` is `5711b9ac`
  (#1258, Amendment A11).
- [fact] This amendment changes no front matter, no rule text of `docs/language-design.md` and no
  code. #1257 changes its rule and surface text in its own commits.
- [fact] Decision 4 asks for a design that A10 and A11 do not give. This amendment proposes it and
  lists the points with more than one reasonable answer as questions Q1 to Q7. The owner answered
  each on 2026-11-11, in the conversation, with the recommended option ("The owner's answers to Q1
  to Q7", below).
- [fact] An independent review read A12 at `0ec970d3` after those answers. It found 2 blocking
  findings, 8 should-fix findings and 5 notes ("Independent review record of A12", below). The owner
  answered three points of it on 2026-11-11: decision 3 against OD-7, and B2-1 and B2-2. Decision 3's
  answer opened questions Q8 to Q11, which the owner answered on 2026-11-11 (below).

**Decision 1. The program runtime keeps a scalar `Buffer` for a storage array with no size (D-l).**

- [fact] A11, "Q3, the program runtime": the program runtime's bindings take plain values each frame,
  and slice 1 does not extend it to bind a `Buffer` (A11, meaning 3).
- [fact] At `51f5bf8c`, the program runtime keeps a scalar `Buffer` for a binding of a storage array
  with no size (`src/runtime/program.ts`). It is the only read-back path of a compute dispatch. Four
  users need it: `journeys/mnist`, `journeys/_harness.mjs`, `journeys/limits` and
  `scripts/compile-gate.ts`.
- [fact] #1257's body at `51f5bf8c` says that a sized binding takes no `Buffer`. Finding S7 of the
  review of #1257 shows that this is not so. At `b14f2373`, the program runtime binds a scalar
  `Buffer` to any buffer binding: a uniform, a sized storage binding, and a storage array with no size
  (`src/runtime/program.ts`; commit `d903a35c`). The reason: the journey harness reads sized compute
  outputs back through a `Buffer`.
- [decision, owner, 2026-11-11] The owner picked the recommended option in the question UI: an open
  deviation, closed in milestone 5 when the read-back path is built. The record has no other words.
  It is deviation D-l (below).
- [decision, owner, 2026-11-11] The owner picked the recommended option in the question UI for S7: it
  is part of D-l. It stays open and is closed in milestone 5.

**Decision 2. The bundle budgets of slice 1.**

- [fact] `scripts/bundle-budget.json` at `51f5bf8c` takes the measured gzip bytes. The growth over
  `5711b9ac`:

| Bundle                 | Before  | After   | Growth (gzip bytes) |
| ---------------------- | ------- | ------- | ------------------- |
| `typeshade/runtime`    | 167,177 | 168,413 | +1,236              |
| `typeshade/fuse`       | 113,898 | 114,063 | +165                |
| `typeshade/algorithms` | 64,878  | 68,217  | +3,339              |
| `typeshade/random`     | 46,200  | 49,724  | +3,524              |

- [decision, owner, 2026-11-11] The owner picked the recommended option in the question UI: the growth
  is accepted. The record has no other words.
- [fact] The bundle sizes are part of the configuration and validation record of each milestone.
  Decision 4 adds code to slice 1, so the sizes move again before its merge. #1257 records the
  sizes at its last head.

**Decision 3. `array()` of a `number[]` makes a `Buffer` whose element its use decides (OD-7).**

- [fact] A11 Q3, meaning 1: "`array(value)` takes an array." At `51f5bf8c`, #1257 reads "an array" as
  a typed array for scalars. `array()` of a `number[]` is a `TypeError`. Its Rule 8.21 text refuses
  "an array that is no typed array".
- [decision, owner, 2026-11-11] The owner first picked the recommended option in the question UI:
  `array(number[])` is accepted, and it makes a `Buffer<f32>`. The record has no other words. It
  reads A11 Q3 literally: `array()` takes an array.
- [fact] #1257 implements that first text in `268c4cd2` (head `b14f2373`).
- [fact] The independent review of A12 (finding S2) found a conflict. OD-7 says: "An author writes a
  number as a number. The compiler gives it the type its uses need." Decision 3 as first drafted fixes
  `f32` whatever the use. Example: `scan(array([1, 2, 3]))` into an `array<u32>` parameter is refused,
  while the same `number[]` passed as plain data takes `u32`.
- [fact] The agent's recommendation of the first text did not check it against OD-7. The first text of
  A12 checked OD-3 only.
- [decision, owner, 2026-11-11] Asked which holds, the owner chose, in Korean:

  "OD-7 적용: 첫 쓰임이 타입 결정"

  (English translation: apply OD-7: the first use decides the type.)

- What the decision means:
  1. `array(xs)` of a `readonly number[]` gives a `Buffer` whose element type is not fixed when it is
     made.
  2. The call that takes it decides the element type. The first use fixes it.
  3. Where nothing decides, the element type is `f32` (OD-7, its second bullet).
  4. The first text, "makes a `Buffer<f32>`", is superseded. `268c4cd2` changes to follow OD-7 before
     #1257's merge.
- [inference, agent] A use that decides is a call that takes the `Buffer` where an array with no size
  of scalars or vectors is taken (the scalar decides: `array<u32>` and `array<vec3<u32>>` give `u32`),
  a number or vector parameter (A10 Q-C), a held length (`u32`), an indirect workgroup count (`u32`),
  and a program runtime's vertex or index buffer (the attribute's scalar, or `u32` for indices).
  [Added after the delta review, D1] Three more takers decide: a matrix parameter (`f32`, Q3), an
  `array<matCxR>` parameter (`f32`, B2-1), and a program runtime's buffer binding that takes a scalar
  `Buffer` (the binding's scalar, D-l). [inference, agent] The binding is an extension of D-l that the
  owner's D3 answer does not name. Milestone 5 removes D-l, and with it this taker.
- [inference, agent] At the use that fixes the type, each number is checked as a plain argument of that
  type is checked (Rule 8.21): a number that does not fit (`1.5` or `-1` for a `u32`) is a `TypeError`
  that names its index, and the call changes nothing.
- [inference, agent] An array of plain objects stays a `TypeError` (A11 Q4). An element that is not a
  number is a `TypeError` that names its index. `array([])` gives a `Buffer` of 0 elements whose
  element is not fixed.
- [inference, agent] Rule 12.7 needs the editor to agree. The type of `array` gains an overload for a
  `readonly number[]`. What it returns is Q8.
- The design points with more than one reasonable answer are Q8 to Q11 below. The owner answered
  them on 2026-11-11 ("The owner's answers to Q8 to Q11", below). Each option is checked against
  every entry of `docs/owner-decisions.md`. OD-1 (a
  language of its own), OD-2 (stage attributes), OD-5 (parameter qualifiers), OD-6 (no release) and
  OD-8 (library decorators) do not touch an element type. The column "OD check" names only OD-3,
  OD-4 and OD-7. No option reverses an entry.

**Q8. The editor's type of `array(number[])`.**

| Option                                                         | What it is                                                                                                                                                                                                                                                                                                   | Costs                                                                                                                                                                                                               | OD check                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `Buffer<number>`, an element not yet fixed (recommended)   | `array(xs: readonly number[])` returns `Buffer<number>`. Each parameter that takes a `Buffer<f32>`, `Buffer<i32>` or `Buffer<u32>` also takes a `Buffer<number>`. `read()` is typed `Float32Array \| Int32Array \| Uint32Array`. The type does not change after the first use: `tsc` cannot see a later use. | The read type is a union; the host narrows it. `number` is ECMAScript's name, not a new one. The host view's parameter types grow by one member.                                                                    | OD-7: agrees; the type is not fixed by the author. OD-3: no new name. OD-4: shown here.                                                                           |
| (b) inferred where the call is an argument, else `Buffer<f32>` | `array<E extends f32 \| i32 \| u32 = f32>(xs: readonly number[]): Buffer<E>`. `scan(array([1, 2]))` infers `Buffer<u32>` from the parameter. `const xs = array([1, 2])` is `Buffer<f32>`.                                                                                                                    | The editor refuses `const xs = array([1, 2]); scan(xs)` into `array<u32>`, which the runtime accepts: the two halves disagree (Rule 12.7). The author can write `array<u32>([1, 2])`, a type the use already gives. | OD-7: in tension: for a variable, the author states a type the use decides. It does not reverse OD-7, since the runtime still follows the use. OD-3: no new name. |
| (c) `Buffer<f32>` in the editor, the use decides at run time   | The type says `f32`. The host view lets a parameter of `i32` or `u32` take a `Buffer<f32>` made by `array(number[])`.                                                                                                                                                                                        | After a `u32` use, `read()` is typed `Float32Array` and gives a `Uint32Array`. The editor's type is false (Rule 12.7).                                                                                              | OD-7: the runtime agrees; the editor shows a default that OD-7 says the author does not learn.                                                                    |

**Q9. What `read()` and `at(i)` give before a use fixes the type.**

| Option                                                       | What it is                                                                                                                                                                                                          | Costs                                                                                                                                                                                | OD check                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| (a) the `f32` values, with the type still open (recommended) | `read()` gives a `Float32Array` of the numbers rounded to `f32`, and `at(i).get()` one of them. Neither fixes the type: a read decides nothing. The runtime keeps the numbers as given until a call fixes the type. | The runtime holds the given numbers beside the `f32` view until the first use. A value read before a `u32` use and after it can differ (`1.5` reads `1.5`, then the use refuses it). | OD-7: agrees: where nothing decides, `f32`; a later use still decides. OD-3: no new form.                             |
| (b) a read fixes `f32`                                       | `read()` and `at(i)` are a use where nothing decides. They fix `f32`.                                                                                                                                               | The order matters: a read before `scan(xs)` into `array<u32>` makes the call refuse (Q10). A debug read changes behaviour.                                                           | OD-7: agrees with its second bullet; a read decides `f32`. OD-3: no new form.                                         |
| (c) refused until a use                                      | `read()` and `at(i)` throw a `TypeError` that says to pass the `Buffer` to a call first.                                                                                                                            | A `Buffer` that no call takes cannot be read.                                                                                                                                        | OD-7: in tension with its second bullet (nothing decides, yet no `f32`). It does not reverse OD-7: no type is chosen. |

**Q10. A second use that needs another element type.**

| Option                                                 | What it is                                                                                                                                                                   | Costs                                                                                                                     | OD check                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) a `TypeError` at the call (recommended)            | `xs` fixed as `u32` by `scan(xs)`; then `blur(xs)` into `array<f32>` throws a `TypeError` that names the fixed type and the line of the first use. The call changes nothing. | The author makes two `Buffer`s, or passes a typed array to `array()` to state the type.                                   | OD-7: agrees with its third bullet's direction: a use that conflicts is refused, not converted in silence. OD-3: no new form.                           |
| (b) convert at the call                                | The call converts the words to its element type, in a copy, and the `Buffer` keeps its type.                                                                                 | A silent conversion (`f32` to `u32` truncates). The second call does not see the first call's writes as the same numbers. | OD-7: in tension with its third bullet (a value is refused, not silently changed). It does not reverse it: the bullet is about `/` on an integer value. |
| (c) the type stays open until the first call that runs | The type is fixed when the first call runs, not when it is made. A later recorded call of another type is refused when it runs.                                              | The refusal comes at the next `read()` or call (A5 default 7), not at the line that made it.                              | OD-7: agrees. OD-3: no new form.                                                                                                                        |

**Q11. `set()`, `resize()` and `at(i).set()` before the type is fixed.**

| Option                                                                | What it is                                                                                                                                                                                                     | Costs                                                                                             | OD check                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| (a) they keep the type open (recommended)                             | `set(data)` of numbers replaces the numbers. `resize(n)` keeps them and adds zeros. `at(i).set(x)` writes one number. None fixes the type. After the type is fixed, each checks against it, as today (A11 Q1). | The runtime keeps the given numbers until a use, as Q9 (a).                                       | OD-7: agrees: only a use decides. OD-3: no new form.            |
| (b) they fix `f32`                                                    | A write is a use where nothing decides.                                                                                                                                                                        | `xs.set([1, 2]); scan(xs)` into `array<u32>` is refused. The order of a write and a call matters. | OD-7: agrees with its second bullet. OD-3: no new form.         |
| (c) `set(data)` of a typed array fixes its type, numbers keep it open | `set(new Uint32Array(…))` fixes `u32`; `set([…])` keeps the type open.                                                                                                                                         | Two meanings of `set` by its argument.                                                            | OD-7: agrees: a typed array states the type. OD-3: no new form. |

- Cost recorded under each option: OD-7 asks the runtime to keep a `Buffer` whose element is open. A
  `Buffer<f32>`, `Buffer<i32>` or `Buffer<u32>` made from a typed array is fixed when it is made, as
  today.

**The owner's answers to Q8 to Q11.**

- [decision, owner, 2026-11-11] The owner picked the recommended option (a) of each question in the
  question UI. The chosen labels, in Korean, with English translations:
  - Q8: "Buffer<number> (추천)" (English translation: `Buffer<number>`; recommended).
  - Q9: "f32로 반올림한 값, 타입은 열린 채 (추천)" (English translation: the values rounded to `f32`,
    with the type still open; recommended).
  - Q10: "그 호출에서 TypeError (추천)" (English translation: a `TypeError` at that call;
    recommended).
  - Q11: "타입을 열어 둠 (추천)" (English translation: keep the type open; recommended).
- What the answers mean:
  1. Q8: `array(xs: readonly number[])` returns `Buffer<number>`. Each parameter that takes a
     `Buffer<f32>`, `Buffer<i32>` or `Buffer<u32>` also takes a `Buffer<number>`. `read()` is typed
     `Float32Array | Int32Array | Uint32Array`. The type does not change after the first use.
  2. Q9: before a use fixes the type, `read()` gives a `Float32Array` of the numbers rounded to `f32`,
     and `at(i).get()` one of them. Neither fixes the type. The runtime keeps the numbers as given
     until a call fixes it.
  3. Q10: a call that needs another element type than the fixed one throws a `TypeError` at that call.
     It names the fixed type and the line of the first use, and changes nothing.
  4. Q11: before the type is fixed, `set(data)` of numbers, `resize(n)` and `at(i).set(x)` keep it
     open. After it is fixed, each checks against it (A11 Q1).
- [fact] No answer reverses an entry of `docs/owner-decisions.md`. The OD check of each chosen option
  is in its table above.

**After the delta review: D2, D3 and D5.**

- [fact] The delta review of A12 at `ee976421` asked three more points. The owner picked the
  recommended option of each in the question UI on 2026-11-11.
- D2. A refused first use.
  - [decision, owner, 2026-11-11] The owner chose, in Korean:

    "고정하지 않음 (추천)"

    (English translation: it does not fix it; recommended.)

  - What it means: a first use that the call refuses (for example `1.5` into a `u32`) does not fix the
    element type. The element stays open. [inference, agent] A call that the check at the call
    refuses is not recorded (R2), so it changes nothing.
- D3. The places that are not parameters.
  - [decision, owner, 2026-11-11] The owner chose, in Korean:

    "받음, 그 자리가 타입을 고정 (추천)"

    (English translation: accept it, and that place fixes the type; recommended.)

  - What it means: a held length's `length`, an indirect workgroup count, and a geometry's vertices
    and indices also take a `Buffer<number>`. That place fixes the type: `u32` for a held length, an
    indirect count and indices, and for vertices the element type that the geometry needs.
- D5. A `Buffer` that the pool hands out again.
  - [decision, owner, 2026-11-11] The owner chose, in Korean:

    "재사용하면 다시 열린 타입 (추천)"

    (English translation: when reused, the type is open again; recommended.)

  - What it means: a `Buffer` that `device.array()`'s pool hands out again starts with an open element
    type, as a new one does.
- [fact] Rule 12.7, the editor half of decision 3 (Q8 and D3). The host view and the runtime types
  change so:
  1. `array(xs: readonly number[]): Buffer<number>`, and the same overload of `device.array()`.
  2. `Buffer<number>` joins each parameter type that takes a `Buffer<f32>`, `Buffer<i32>` or
     `Buffer<u32>`: an array with no size of scalars or vectors, a number or vector parameter, a matrix
     parameter and an `array<matCxR>` parameter.
  3. `Buffer<number>` joins the type of a held length's `length`, of an indirect workgroup count, of a
     geometry's vertices and indices, and of a program runtime's buffer binding (the last one an
     [inference, agent] extension of D-l, above).
  4. `read()` of a `Buffer<number>` is typed `Float32Array | Int32Array | Uint32Array`.
  5. Slice 1 tests each place on both halves on the same source: the runtime value and the `tsc` type.

**Decision 4. The result kinds that A11 left open are implemented in slice 1.**

- [fact] At `51f5bf8c`, a call on a resource refuses, with a `TypeError` at the call, a result that no
  `Buffer` holds: a `bool`, a key, a matrix, a `Record`, an array of structs, and a struct that holds
  one (`resultPlan` in `src/core/host-kernel.ts`). The host view omits the overload of a call on a
  resource for such a result (`bufferResult` in `src/compiler/ts/host-face.ts`). A11's open items
  list a sized array of structs as a field (Q6).
- [decision, owner, 2026-11-11] The owner decided, in Korean:

  "지금 구현"

  (English translation: implement now.)

- What the decision means:
  1. Slice 1 holds these results in `Buffer`s. It does not refuse them.
  2. The kinds: a sized array of structs `array<S, N>` as a result or as a struct's field (A11's open
     item); a `bool`, a matrix, a key and a `Record` result; and a struct that holds any of them.
- [inference, agent] A matrix of `f64` has no host value (Rule 8.21). A call with plain data refuses
  it too. Decision 4 does not reach it, and it stays refused.
- [inference, agent] Two more kinds stay refused in slice 1, with the `TypeError` at the call of
  `51f5bf8c`. Decision 4 does not name them:
  1. `array<Record<K, T>, N>`. Under frame item 2 it would be a `Buffer<Record<K, T>>`, which is Q5
     option (c). The owner did not choose (c).
  2. `array<array<T, M>, N>`, a nested sized array.
- [fact] At `b14f2373`, `resultPlan` (`src/core/host-kernel.ts`) refuses both, and `array<K, N>` too.
- [inference, agent] `array<K, N>`, `array<bool, N>` and `array<matCxR, N>` follow from frame item 2.
  Slice 1 implements them, so they are no longer refused after slice 1.

**Decision 4: the facts that the design rests on (`51f5bf8c`).**

1. [fact] A kernel's result is computed on the host. The CPU tier's tail function gives it from the
   array lengths and what the device folded, and `fromShader` makes it a host value
   (`src/core/host-kernel.ts`). `makeResults` then writes that value into each result `Buffer`. So
   the words of a result `Buffer` are made on the host. They reach a device only when another call
   takes the `Buffer`.
2. [fact] A result `Buffer` today is a `Buffer` of scalars: a typed array of its own and a count of
   components for each element, with no range of the region (`ResidentArrayState` in
   `src/core/resident.ts`). A `Buffer` of structs is a range of the region, laid out by the layouts
   that the generated module puts on the class (`src/runtime/resource.ts`).
3. [fact] The storage layouts (`layoutOf` in `src/core/manifest.ts`): a `bool` and a `vecN<bool>` are
   "not host-shareable"; a matrix of `f32` has a layout with a column stride of 8 bytes for two rows
   and 16 bytes for three or four rows; a key is a `u32` in the shader; a `Record` is a sized array
   of its values in id order.
4. [fact] Rule 8.21, for a plain value: a `bool` is a `boolean`, a matrix a flat column-major array
   of its components, a key one of its members as a string, and a `Record` an object with one
   property for each member. In a binding and in an array with no size, a key is its id, and a
   `Record` the array of its values in id order.
5. [fact] The type `Buffer<T>` (`src/runtime/resource.ts`): `read()` gives the typed array of the
   scalar for a number or a tuple of numbers, and `T[]` for any other `T`. A matrix of the host type
   family is a tuple of numbers, so `Buffer<mat4x4>` already reads a `Float32Array`. `at(i)` gives
   the accessor of a struct for any `T` that is not a number or a tuple of numbers. That is wrong for
   a `bool` and for a key.
6. [fact] A number or vector parameter takes a `Buffer` of one element (A10 Q-C). No other parameter
   takes one (`placeholderOf` in `src/core/host-kernel.ts`).

**Decision 4: the frame of the design.**

- [proposal, agent] Each kind follows the decided rules. Only what differs is asked below.
  1. One `Buffer`, and no new name (A10 Q-I and Q-C).
  2. A value gives a `Buffer` of one element. An `array<T, N>` gives a `Buffer` of `N` elements.
  3. A struct gives an object of `Buffer`s with the struct's own field path (R1; A11 Q6). A nested
     struct is an object of its own.
  4. A result `Buffer` of one element is another call's argument where the parameter takes its element
     (A10 Q-C). A result `Buffer` of `N` elements is an argument of an array with no size of its
     element: `array<S>` (Q6), `array<K>` and `array<matCxR>` (B2-2, below). No `array<bool>`
     parameter exists, since a `bool` has no storage layout (fact 3).
  5. A struct that holds a new kind follows item 3. Its field gives what this design gives for the
     kind.
- [proposal, agent] The table gives the recommended option of each question. [decision, owner,
  2026-11-11] The owner chose each of them (below).

| Kind                    | `Buffer` (recommended)                    | `read()` gives                                                 | `at(i).get()` gives           | As another call's argument                                                              | Question |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- | -------- |
| `bool`, `vecN<bool>`    | `Buffer<bool>`, `Buffer<vec3b>`           | a `boolean[]`, the components one after another                | a `boolean`, or a `boolean[]` | a `bool` or `vecN<bool>` parameter takes one element; no `array<bool>` parameter exists | Q1       |
| `matCxR` (`f32`)        | `Buffer<mat4x4>`                          | a `Float32Array`, the components column-major, with no padding | a `Float32Array`              | a matrix parameter takes one element; `array<matCxR>` takes `N`; the call pads it       | Q2, Q3   |
| key `K`                 | `Buffer<K>`                               | a `K[]`, the member strings                                    | a member string               | a parameter of `K` takes one element; `array<K>` takes `N`, the id words as they are    | Q4       |
| `Record<K, T>`          | an object of `Buffer<T>`, one per member  | each member's `read()`, as `T` gives                           | as `T` gives                  | each member's `Buffer` where `T` is taken                                               | Q5       |
| `array<S, N>`           | one `Buffer<S>` of `N` elements           | an `S[]`: instances of an exported class, or plain objects     | the struct accessor           | an `array<S>` parameter takes it                                                        | Q6, Q7   |
| a struct that holds one | an object of `Buffer`s by field path (R1) | each leaf's `read()`                                           | each leaf's                   | each leaf where its element is taken                                                    | none     |

**Q1. How a `bool` result is held.**

| Option                                              | What it is                                                                                                                                                                       | Costs                                                                                                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) `Buffer<bool>`, reads `boolean[]` (recommended) | One `u32` word for each component, 0 or 1. `read()` gives a `boolean[]`. `at(i).get()` gives a `boolean`, and `set` takes one. The type says `Buffer<bool>`, as the shader does. | `read()` gives an array, not a typed array: a second read kind beside A11 Q2. The types `BufferRead`, `BufferElement` and `BufferData` gain a `bool` branch. `placeholderOf` takes a `bool` parameter. |
| (b) `Buffer<bool>`, reads `Uint32Array`             | The same words. `read()` gives a `Uint32Array` of 0 and 1, as A11 Q2 gives a typed array.                                                                                        | `const [b] = await r.read()` gives 0 or 1, not a `boolean`. `b === true` is false. The type says `bool`, and the value is a number.                                                                    |
| (c) `Buffer<u32>`                                   | The result is typed and held as a `u32`.                                                                                                                                         | The host view says `u32` for a `bool` result. The type no longer follows the shader (Rule 12.7; `docs/dx.md`, principle 2). A `bool` parameter would take a `Buffer<u32>`.                             |

- [inference, agent] Under each option, `array()` makes no `Buffer<bool>`, since no typed array holds
  booleans. Only a result makes one.

**Q2. What `read()` of a matrix result gives.**

| Option                                | What it is                                                                                                                                                                                                                   | Costs                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) packed column-major (recommended) | `read()` gives a `Float32Array` of the `C * R` components of each matrix, column-major, with no padding, one matrix after another. `length` counts matrices. The call pads each column to the column stride when it uploads. | One copy at each upload of a matrix with three rows (12 floats become 16 for `mat4x3`, 9 become 12 for `mat3x3`). It agrees with Rule 8.21's plain value and with A11 Q5 for a vector. [Added after the review, S4] Two matrix shapes in one API: `get()` of a matrix field of a struct `Buffer` gives the padded columns. |
| (b) the device words, padded          | `read()` gives the words as WGSL's storage layout holds them: each column at its stride.                                                                                                                                     | A `mat3x3` reads 12 numbers, where a call with plain data gives 9. Two shapes of one type in host code. It agrees with `get()` of a matrix field of a struct `Buffer`, whose view holds each column at its stride (`src/runtime/resource.ts`).                                                                             |

**Q3. Whether a matrix parameter also takes a `Buffer<f32>`.**

| Option                    | What it is                                                                                                                                     | Costs                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| (a) both (recommended)    | A matrix parameter takes a `Buffer<matCxR>` of one element and a `Buffer<f32>` of `C * R` elements, column-major, as A11 Q5 does for a vector. | `placeholderOf` and the host view's parameter type grow by one case. A host can make a matrix argument with `array()`. |
| (b) only `Buffer<matCxR>` | A matrix parameter takes only a matrix result.                                                                                                 | A host has no way to make a matrix `Buffer` except as a result. It differs from A11 Q5's rule for vectors.             |

**Q4. How a key result is held.**

| Option                                       | What it is                                                                                                                                                                                                         | Costs                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `Buffer<K>`, reads members (recommended) | One `u32` id for each element. `read()` gives a `K[]` of the member strings, as a call with plain data gives a member (Rule 8.21). `at(i).get()` gives the member, and `set` takes one and refuses another string. | `read()` gives an array, not a typed array (as Q1 (a)). The runtime maps each id to its member at `read()`. The result needs the member list, which the face has (`HostType` `key`). [Added after the review, S6] Two host spellings of one key array: `read()` and `set()` use member strings, while a plain `array<K>` argument and a binding use ids (Rule 8.21). |
| (b) `Buffer<K>`, reads ids                   | The same words. `read()` gives a `Uint32Array` of ids, as a binding and an array with no size hold a key (Rule 8.21).                                                                                              | The host maps ids to members itself and must know the id order. The type says `K`, and the value is a number.                                                                                                                                                                                                                                                        |
| (c) `Buffer<u32>`                            | The result is typed and held as a `u32` id.                                                                                                                                                                        | As Q1 (c): the host view no longer follows the shader. A parameter of `K` cannot tell an id from any `u32`.                                                                                                                                                                                                                                                          |

**Q5. How a `Record` result is held.**

| Option                                                   | What it is                                                                                                                                                                                                    | Costs                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) an object of `Buffer`s, one per member (recommended) | `{ readonly red: Buffer<f32>; readonly green: Buffer<f32> }`: a `Record` is treated as a struct with one field for each member, as R1 and A11 Q6 treat a struct. It has the shape of Rule 8.21's plain value. | One `Buffer` and one read back for each member. A whole `Record` is not an argument of a `Record` parameter, as a whole struct result is not one of a struct parameter today. |
| (b) one `Buffer<T>` in id order                          | A `Buffer<T>` of as many elements as members, in id order, as a binding holds a `Record` (Rule 8.21). `read()` gives `T`'s typed array.                                                                       | The type loses the member names. The host must know the id order. It is an argument of an `array<T>` parameter.                                                               |
| (c) a `Buffer<Record<K, T>>` of one element              | `read()` gives `[{ red: …, green: … }]`.                                                                                                                                                                      | A new kind of element: a `Buffer` of objects that is not a class's. `at(i)` needs an accessor of its own.                                                                     |

**Q6. How an `array<S, N>` of structs is held, as a result or as a field.**

| Option                                                               | What it is                                                                                                                                                                                                                                                                                             | Costs                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) one `Buffer<S>` of `N` elements (recommended)                    | A `Buffer` of structs, laid out as a storage array of `S`. `read()` gives an `S[]`: instances of the class where the module exports `S` as a class that is not abstract, and plain objects otherwise (Rule 8.21; R9). `at(i)` gives the struct accessor. It is an argument of an `array<S>` parameter. | A larger implementation. Today a struct `Buffer` comes from a class's layout. For an `interface` `S`, the face must carry `S`'s layout for the result. [inference, agent] A11 Q4 limits what the host makes with `array()`, not what a call returns. A `Buffer<S>` of another class is refused, as today. |
| (b) an object of `Buffer`s, one per leaf field, each of `N` elements | `r.parts.pos` is a `Buffer<vec3>` of `N` elements. It continues A11 Q6's recursion with today's `Buffer`s of scalars.                                                                                                                                                                                  | A small implementation. The shape changes: an array of objects becomes an object of arrays. It is not an argument of an `array<S>` parameter. One read back for each leaf.                                                                                                                                |
| (c) an array of `N` objects of `Buffer`s                             | `r.parts[i].pos` is a `Buffer<vec3>` of one element.                                                                                                                                                                                                                                                   | `N` times as many `Buffer`s and read backs. It is not an argument of an `array<S>` parameter.                                                                                                                                                                                                             |

**Q7. Only under Q6 (a): an `array<S, N>` whose `S` holds a `bool`.**

- [fact] A `bool` has no storage layout (`layoutOf`, fact 3). So `S` has no layout as a storage array,
  and no `array<S>` parameter has a host face.

| Option                                                           | What it is                                                                                                    | Costs                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| (a) a host-only layout, a `bool` as one `u32` word (recommended) | The result `Buffer<S>` lays out each `bool` as Q1 holds it. `read()` and `at(i)` work. No parameter takes it. | A layout that no shader shares. The runtime, not the compiler, decides it for this case. |
| (b) Q6 (b) for such an `S` only                                  | That `S` gives an object of `Buffer`s, one per leaf.                                                          | Two shapes for `array<S, N>`, chosen by the fields of `S`.                               |
| (c) refuse at the call                                           | A `TypeError` with no `TS` code, as today.                                                                    | It narrows decision 4. The owner decides it.                                             |

**The owner's answers to Q1 to Q7.**

- [decision, owner, 2026-11-11] The owner picked the recommended option (a) of each question in the
  question UI. The record has no other words.
- What the answers mean:
  1. Q1: a `bool` result is a `Buffer<bool>`, one `u32` word (0 or 1) for each component. `read()`
     gives a `boolean[]`. A `vecN<bool>` result is a `Buffer` of `vecN<bool>`, read the same way.
  2. Q2: `read()` of a matrix result gives a `Float32Array` of the components, column-major, with no
     padding, one matrix after another. `length` counts matrices. The call pads each column to the
     column stride when it uploads.
  3. Q3: a matrix parameter takes a `Buffer<matCxR>` of one element and a `Buffer<f32>` of `C * R`
     elements, column-major, as option (a) says.
  4. Q4: a key result is a `Buffer<K>` that holds one `u32` id for each element. `read()` gives a
     `K[]` of the member strings.
  5. Q5: a `Record` result is an object of `Buffer`s, one for each member.
  6. Q6: an `array<S, N>` of structs, as a result or as a field, is one `Buffer<S>` of `N` elements.
     `read()` gives an `S[]`. It is an argument of an `array<S>` parameter.
  7. Q7: for an `array<S, N>` whose `S` holds a `bool`, the result `Buffer<S>` has a host-only
     layout, each `bool` one `u32` word. No parameter takes it.
- [inference, agent] Q7's layout is the std430 layout of `S` with each `bool` as a `u32` and each
  `vecN<bool>` as a `vecN<u32>`. It follows from "a `bool` as one `u32` word".
- [inference, agent] Q-F (A10) gives a returned array "its argument's length and class". It does not
  apply to an `array<S, N>` result, whose `N` and `S` come from the type.
- [fact] The review (B2-1) found that A12's first answer text extended Q3 to an array of matrices,
  which no question asked. Asked, the owner chose, in Korean:

  "받음 (추천)"

  (English translation: accept it; recommended.)

- What it means: an `array<matCxR>` parameter takes a `Buffer<f32>` whose length is a multiple of
  `C * R`, column-major, padded at the call, and a `Buffer<matCxR>`. A single matrix parameter keeps
  Q3 item 3: exactly `C * R`.
- [fact] The review (B2-2) found that frame item 4 let an `array<T>` parameter take a result `Buffer`
  of `N` for a key and a matrix, which no question asked. Asked, the owner chose, in Korean:

  "둘 다 받음 (추천)"

  (English translation: accept both; recommended.)

- What it means:
  1. A `Buffer<K>` of `N` elements from an `array<K, N>` result is an argument of an `array<K>`
     parameter. The call passes the id words as they are.
  2. A `Buffer<matCxR>` of `N` elements is an argument of an `array<matCxR>` parameter. The call pads
     each column to the column stride.
  3. [fact] No `array<bool>` parameter exists (fact 3).
- [fact] Rule 12.7 (CLAUDE.md, "A test reads both halves"): slice 1 tests each kind on both halves on
  the same source: the runtime value, and the `tsc` type of the host view. The types that change:
  `BufferRead`, `BufferElement` and `BufferData` for a `bool`, a `vecN<bool>` (flat `boolean[]`, where
  the host type family's `vec3b` is a tuple today) and a key `K`; the parameter types
  `bool | Buffer<bool>`, `matCxR | Buffer<matCxR> | Buffer<f32>` and `K | Buffer<K>`; and the overload
  that `bufferResult` (`src/compiler/ts/host-face.ts`) gives for each kind. A refusal with a `TS`
  code is tested on both halves too.
- [fact] Each answer is part of slice 1's scope (decision 4). #1257 states each in its rule and
  surface text.

**Author examples, before and after.**

1. Decision 3.

   ```ts
   // shade: export function scan(xs: array<u32>): u32 { … }
   const xs = array([1, 2, 3]); // Before (#1257 at 51f5bf8c): TypeError
   // After: a Buffer of 3 whose element is not fixed yet
   const total = scan(xs); // the first use fixes u32 (OD-7)
   const ys = array([0.5, 2]); // no call takes ys: its element is f32
   ```

2. Decision 4, with the owner's answers to Q1 to Q7.

   ```ts
   // shade: export function test(ps: array<Particle>): bool { … }
   //        export function pose(ps: array<Particle>): mat4x4<f32> { … }
   //        export function top(ps: array<Particle>): array<Particle, 4> { … }
   //        export function aim(@inout ps: array<Particle>, m: mat4x4<f32>): void { … }
   //        export function step(@inout ps: array<Particle>, dt: f32): void { … }
   const b = test(ps); // Before: TypeError at the call. After: Buffer<bool> of 1 (Q1)
   const [ok] = await b.read(); // a boolean
   const m = pose(ps); // Buffer<mat4x4> of 1 (Q2)
   aim(ps, m); // the result is an argument of a matrix parameter
   const best = top(ps); // Buffer<Particle> of 4 (Q6)
   step(best, 1 / 60); // an argument of an array<Particle> parameter
   ```

**The deviations of slice 1.**

Each is a difference between the accepted text (with A10 and A11) and #1257 at `51f5bf8c`, as
#1257's body records it, and D-l as `b14f2373` delivers it. D-o is a difference in the process of
this amendment.

| ID  | Deviation                                                                                                                                                                                                                                                                                                                                                                   | Disposition                                                                                                                                                                                                                                                            | Next action                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-l | A11, "Q3, the program runtime": the program runtime's bindings take plain values each frame. At `b14f2373`, the program runtime binds a scalar `Buffer` to any buffer binding: a uniform, a sized storage binding, and a storage array with no size. It is the only read-back path of a compute dispatch (decision 1; finding S7 of the review of #1257).                   | open (new; the owner's disposition, decision 1)                                                                                                                                                                                                                        | Milestone 5 builds the read-back path and closes it.                                                                                                                                                                                                                                                  |
| D-m | A10 Q-C, meaning 2: a scalar result of a call on a resource is a `Buffer` of length 1. Inside today's `fuse()`, which A10 keeps until slice 5, a value-returning call still returns a promise of its value. The host view types it as a `Buffer`. `examples/hosts/loop-fuse/host.ts` casts `total(u)`, and `journeys/_host-import/src/gpu.ts` casts `dsum` and `pushAbove`. | open (new)                                                                                                                                                                                                                                                             | Slice 5 switches `fuse` and removes the difference and the casts.                                                                                                                                                                                                                                     |
| D-n | Change 0129 (`implemented`) keeps a successful write-only recovery. At `51f5bf8c`, a failed `Buffer` is refused at the next call that takes it (A7, Decision (b)). So a write-only call recovers it only when the call was queued before the failure was known. Inside today's `fuse()`, a plan's earlier write-only call still supplies it (0129).                         | closed: made part of the approved text by this amendment, as a consequence of A7, Decision (b)                                                                                                                                                                         | #1257 qualifies the sentence of Rule 11.8 ("proven write-only destinations can recover") and those of surface §65, §67 and §71 on write-only recovery: outside today's `fuse()`, a write-only call recovers a failed `Buffer` only when it was queued before the failure was known. Before its merge. |
| D-o | `changes/README.md`, Independent review: "A proposal whose record has no independent review is not ready for the owner's decision." The owner answered Q1 to Q7 and D-n before an independent review read A12. The owner also answered Q8 to Q11, and D2, D3 and D5, before a review read their text.                                                                       | closed: the review at `0ec970d3` read Q1 to Q7; the delta review at `ee976421` read Q8 to Q11; the review at `ed389599` read the answers to D2, D3 and D5 and approved (findings F1 to F3 fixed in this revision). Each review's findings are answered in this record. | None.                                                                                                                                                                                                                                                                                                 |

- [decision, owner, 2026-11-11] D-n: the owner picked the recommended option in the question UI: made
  part of the approved text, as a consequence of A7, Decision (b). The record has no other words.
- [fact] D-a to D-k stay as A10 and A11 record them. #1257's body says that it closes D-i and D-g.
  Their closure is recorded when #1257 merges.

**Open items of slice 1.**

| Item                                                                                                                                                                                                                                                                                               | Source         | Next action                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| The check `TypeNN candidate (build + CPU)` fails on #1257. TypeNN imports the `Resident` type, which slice 1 removes. The check is not required. [inference, agent] A10 Q-G foresees this: `downstream.yml` can turn red at slices 1 and 2.                                                        | #1257; A10 Q-G | TypeNN migrates when its pin moves (`downstream`). No pull request is assigned.    |
| A11's open items on the padding of a kernel's array of vectors, `read()` of a `Buffer<f64>`, the editor's type of Q7's mixed call, and the region range of a scalar `Buffer`. #1257 states each at `51f5bf8c`: the call pads; a `Float64Array`; a third overload that returns a promise; no range. | A11; #1257     | The owner reads them with #1257's example before and after, before its merge.      |
| What a matrix field of a `Buffer<S>` (Q6) gives in `at(i)` and in `read()`. Today `get()` of a matrix field of a struct `Buffer` gives the padded columns (`src/runtime/resource.ts`).                                                                                                             | Review S4      | #1257 states it and shows it to the owner with its example before and after.       |
| The kinds that stay refused in slice 1: `array<Record<K, T>, N>`, `array<array<T, M>, N>` and a matrix of `f64` ([inference, agent], decision 4).                                                                                                                                                  | Review S5      | The owner reads the list with #1257's example before and after, before its merge.  |
| Which uses decide the element type of a `Buffer` from `array(number[])` (decision 3, [inference, agent]), under the answers to Q8 to Q11.                                                                                                                                                          | Decision 3     | #1257 states the list and shows it to the owner with its example before and after. |
| A11's open item on a sized array of structs as a field.                                                                                                                                                                                                                                            | A11 Q6         | Closed by decision 4 and the owner's answer to Q6.                                 |
| A11's open item on the result's class under A10 Q-F for a `Buffer<f32>` passed as `array<vec3<f32>>`.                                                                                                                                                                                              | A11; A10 Q-F   | Unchanged: ask the owner before slice 3.                                           |

**The slices of milestone 4, status.**

- [fact] This statement updates A11's status table. A11's text stays as it is.

| Slice  | Status                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | done: #1251, merged as `937147b8`.                                                                                                                                                                                                                                                                                                                               |
| 1      | in progress: #1257 (draft), head `b14f2373`. Decisions 1 and 2 are in it (D-l stated in `d903a35c`). Decision 3 as first drafted, a `Buffer<f32>`, is `268c4cd2`; it changes to follow OD-7 and the answers to Q8 to Q11 after this amendment merges. Decision 4, with the answers to Q1 to Q7, B2-1 and B2-2, is implemented in it after this amendment merges. |
| 2 to 6 | not started.                                                                                                                                                                                                                                                                                                                                                     |

**Open, owner must settle.**

- [fact] Nothing for A12's own decisions. The owner answered Q8 to Q11 and D2, D3 and D5 on
  2026-11-11. The open items above that wait on the owner are read with #1257's example before and
  after.
- [fact] Decision 3 as first drafted conflicted with OD-7. The owner resolved it on 2026-11-11 ("OD-7
  적용: 첫 쓰임이 타입 결정").
- [inference, agent] No other decision of this amendment conflicts with an entry of
  `docs/owner-decisions.md` (OD-1 to OD-8). Each option of Q8 to Q11 is checked against them above.

**Independent review record of A12.**

- [fact] Reviewer: an AI agent (Claude Code) that did not write A12, on 2026-11-11. Revision reviewed:
  `0ec970d3`. It found 2 blocking findings, 8 should-fix findings and 5 notes. Verdict: request
  changes.

| Finding                                                                   | Answer                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1. Two false facts on sized bindings; the status row against decision 3. | Fixed: decision 1 cites #1257's body and S7; D-l names any buffer binding; the status row names `b14f2373`, `268c4cd2` and `d903a35c`.                                                           |
| B2-1. Q3 extended to an array of matrices.                                | The owner answered: "받음 (추천)". Q3 item 3 repeats option (a); the array case is recorded as the owner's answer.                                                                               |
| B2-2. Array parameters of key and matrix result `Buffer`s.                | The owner answered: "둘 다 받음 (추천)". Frame item 4 and the table say so; no `array<bool>` parameter exists.                                                                                   |
| B2-3. An unapproved proposal in decision 3.                               | Fixed: relabelled [inference, agent] as what the decision needs.                                                                                                                                 |
| B2-4. Q7's layout is not stated.                                          | Fixed: [inference, agent] std430 of `S`, a `bool` as a `u32` and a `vecN<bool>` as a `vecN<u32>`.                                                                                                |
| S1. The owner's words are not recorded.                                   | Fixed: each decision says that the owner picked the recommended option in the question UI, with no other words, or quotes the words. D-n has a `[decision, owner]` bullet.                       |
| S2. OD-7 is not checked.                                                  | The owner answered: "OD-7 적용: 첫 쓰임이 타입 결정". Decision 3 is revised; the conflict and the missed check are recorded; Q8 to Q11 ask the design, each option checked against OD-1 to OD-8. |
| S3. D-n is closed, but the rule text says the opposite.                   | Fixed: D-n's next action names Rule 11.8 and surface §65, §67 and §71. The source is spelled "A7, Decision (b)".                                                                                 |
| S4. Q2 (a)'s cost.                                                        | Fixed: added to option (a); the matrix field of a `Buffer<S>` is an open item.                                                                                                                   |
| S5. Kinds that stay refused.                                              | Fixed: listed under decision 4 and in the open items.                                                                                                                                            |
| S6. Two host spellings of a key array.                                    | Fixed: added to Q4 (a)'s costs.                                                                                                                                                                  |
| S7. "Nothing" against the open items.                                     | Fixed: "Open, owner must settle" names Q8 to Q11 and points to the open items.                                                                                                                   |
| S8. The editor half of each kind.                                         | Fixed: a Rule 12.7 statement under the owner's answers names the types and the overloads.                                                                                                        |
| N1. A long line.                                                          | Fixed: wrapped.                                                                                                                                                                                  |
| N2. The review record and the process deviation.                          | Fixed: this record, and D-o.                                                                                                                                                                     |
| N3. `array([])`.                                                          | Fixed: a `Buffer` of 0 elements whose element is not fixed.                                                                                                                                      |
| N4. Q-F and `array<S, N>`.                                                | Fixed: Q-F does not apply; `N` and `S` come from the type.                                                                                                                                       |
| N5. `step` is not declared.                                               | Fixed: declared in Example 2.                                                                                                                                                                    |

- [fact] A delta review read A12 at `ee976421` on 2026-11-11, by the same reviewer. Verdict: approve
  with should-fix. It found no blocking finding, 5 should-fix findings and 3 notes.

| Finding                                                 | Answer                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D1. Three takers missing from the uses that decide.     | Fixed: a matrix parameter, an `array<matCxR>` parameter and a program runtime's buffer binding are added. |
| D2. A refused first use.                                | The owner answered: "고정하지 않음 (추천)".                                                               |
| D3. Rule 12.7 does not cover Q8; places not parameters. | The owner answered: "받음, 그 자리가 타입을 고정 (추천)". The editor types of Q8 and D3 are stated.       |
| D4. D-o is closed while the deviation happened again.   | Fixed: D-o names Q8 to Q11 and D2, D3 and D5, and its disposition names the reviews.                      |
| D5. `device.array()` and the pool.                      | The owner answered: "재사용하면 다시 열린 타입 (추천)".                                                   |
| E1. A fact that slice 1 makes true.                     | Fixed: "no longer refused after slice 1", labelled [inference, agent].                                    |
| E2. Affects.                                            | Fixed: A10 Q-I meaning 1 and A11 Q1 and Q2 are added.                                                     |
| E3. Long lines.                                         | Fixed: wrapped.                                                                                           |

- [fact] No review has read the revision that answers the delta review.

- Affects: A11 Q3 (decision 1, D-l; decision 3, the reading of "takes an array", and OD-7); A11's
  open items (the sized array of structs, by decision 4); A10 Q-C meanings 2 and 3 (decision 4
  extends them to new kinds; D-m); A11 Q5 (B2-1 extends its rule to an array of matrices); change
  0129's write-only recovery and Rule 11.8 (D-n, closed); the bundle sizes of the configuration and
  validation record (decision 2); A10 Q-I meaning 1 and A11 Q1 and Q2 (`Buffer<number>`: an element
  kind, a union read type and `set` on an open element); A11's slice status table.
- Status: `status: accepted` does not change.

### A13. Slice 1: an `f64` place, a `Record` in an `array<S, N>` result, and the host view of `Buffer<number>` (2026-11-11)

- [fact] Why. #1257 implements A12. Its head was `da043f1d` when this amendment was written. The
  implementation found three points that A12 does not decide.
- [fact] The owner answered each point on 2026-11-11, in the conversation. This amendment records
  the answers and the deviations they make.
- [fact] Baseline: `main` at `29f62fe7` (#1265, Amendment A12).
- [fact] This amendment changes no front matter, no rule text of `docs/language-design.md` and no
  code. #1257 changes its rule and surface text in its own commits.
- [fact] Names used below. "A12's editor list" is the list under "Rule 12.7, the editor half of
  decision 3 (Q8 and D3)" in A12. "A12's Q8 meaning" is item 1 of "What the answers mean" under
  "The owner's answers to Q8 to Q11".

**The owner's answers.**

- [decision, owner, 2026-11-11] The owner picked the recommended option of each question in the
  question UI. The record has no other words. The chosen labels and the option descriptions the UI
  showed, in Korean, with English translations:
  - Decision 1: "f64 자리가 f64로 고정 (추천)" (English translation: an `f64` place fixes `f64`;
    recommended). Description: "OD-7과 맞습니다. 두 절반이 일치합니다. 비용: read() 타입에
    Float64Array 추가, 런타임 코드와 테스트 추가, A12 결정 3 목록을 넓히는 기록(A13 또는 편차)."
    (English translation: it follows OD-7; the two halves agree; cost: `Float64Array` added to the
    `read()` type, runtime code and tests added, a record that widens A12 decision 3's list.)
  - Decision 2: "거부 유지, 편차로 기록 (추천)" (English translation: keep the refusal, record a
    deviation; recommended). Description: "비용: 작음. 이 결과는 일반 데이터로 호출해야 받습니다.
    편차를 PR과 0138 기록에 남기고 나중 slice에서 닫습니다." (English translation: small cost; the
    author gets this result by a call with plain data; the deviation is recorded on the pull request
    and in 0138, and a later slice closes it.)
  - Decision 3: "적지 않음, 편차로 기록 (추천)" (English translation: do not write it, record a
    deviation; recommended). Description: "동작은 A12와 같습니다. 타입 검사가 더 엄격하게
    남습니다. 비용: 승인 문구와 다름을 편차(닫힘)로 기록합니다." (English translation: the behaviour is
    A12's; the type check stays stricter; cost: the difference from the approved text is recorded as
    a deviation, closed.)

**Decision 1. An `f64` place fixes the element of a `Buffer<number>` to `f64`.**

- [fact] At `da043f1d`, a `Buffer<number>` whose first use is an `f64` place is refused at that call
  with a `TypeError`. The element stays open (`docs/language-design.md:1022` in #1257).
- [fact] The editor accepts the same call, because `number` fits `f64`
  (`src/runtime/host-types.ts:46` in #1257). Example: `sum64(array([1]))`, where `sum64` takes an
  `array<f64>`.
- [fact] A12 decision 3 lists the places that fix the element, and in each the scalar decides. The
  list names no `f64` place. A12's Q8 meaning and A12's editor list, item 4, type `read()` of a
  `Buffer<number>` as `Float32Array | Int32Array | Uint32Array`.
- [fact] OD-7 says that a number's type is inferred from its uses.
- What it means:
  1. [inference, agent] An `f64` place is each place of A12 decision 3 whose scalar is `f64`: an
     array with no size of `f64` numbers or vectors (`array<f64>`, `array<vec3<f64>>`), an `f64`
     number or vector parameter, and an entry's or the program runtime's storage binding of them.
     The checks, Q10, D2 and D5 of A12 apply to it as to every other place.
  2. [fact] A matrix parameter and an `array<matCxR>` parameter of `f32` fix `f32` (A12 decision 3 and
     Q3). A matrix of `f64` as a result of a call on a resource stays refused (A12 decision 4). Rule
     8.21 gives a matrix of `f64` a host value as plain data (`docs/language-design.md:1009`).
  3. [fact] No record says what a `Buffer<number>` does at a parameter of a matrix of `f64`. A12 Q3
     covers a matrix of `f32` only. The owner answered it as Q12 (below): such a parameter takes no `Buffer`.
  4. A12's Q8 meaning and A12's editor list, item 4, become: `read()` of a `Buffer<number>` is typed
     `Float32Array | Int32Array | Uint32Array | Float64Array`.
  5. [fact] A12's answer to Q9 says that the runtime keeps the numbers as given until a call fixes the
     element. So an `f64` use gets the numbers the author wrote.
  6. [fact] Cost: a `read()` before the `f64` use gives the numbers rounded to `f32` (Q9). A `read()`
     after it gives the full numbers. For example, `0.1` reads as `0.10000000149011612` before and
     as `0.1` after.
  7. [fact] On a GPU tier, an `f64` storage binding holds each number as two `f32` values, `hi` and
     `lo` (Rule 8.21). The runtime splits the kept numbers there.
  8. Rule 12.7: #1257 must test the `f64` place on both halves on the same source.

**Decision 2. A `Record` field in the struct of an `array<S, N>` result stays refused (D-p, open).**

- [fact] At `da043f1d`, a call on a resource is refused at the call with a `TypeError` when its result
  is an `array<S, N>` and `S` holds a `Record` field.
- [fact] The refusal is on both halves: `bufferResult` (`src/compiler/ts/host-face.ts:856`) and
  `resultPlan` (`src/core/host-kernel.ts:1062`) in #1257.
- [fact] The approved text is A12 decision 4, item 2: slice 1 holds an `array<S, N>` result and a
  struct that holds a `Record` in `Buffer`s. A12's list of kinds that stay refused does not name this
  case either.
- [fact] Deviation D-p: open. The author calls such a function with plain data and awaits it. A later
  slice closes it. No slice is assigned yet.

**Decision 3. The host view does not write `| Buffer<number>` (D-q).**

- [fact] A12's editor list, item 2, says that `Buffer<number>` joins each parameter type that takes a
  `Buffer<f32>`, `Buffer<i32>` or `Buffer<u32>`. At `da043f1d`, the host view does not write
  `| Buffer<number>` there.
- [fact] A12's editor list, item 3, says the same for a held length's `length`, an indirect workgroup
  count, a geometry's vertices and indices, and a program runtime's buffer binding. At `da043f1d`,
  the host view does not write the union there either (`indirect: Buffer<u32>`,
  `src/compiler/ts/host-face.ts:2856`; `src/runtime/program.ts:350`).
- [observed result] On 2026-11-11, at `29f62fe7`, with `tsc` 5.6.3 on a file that imports
  `src/runtime/resource.ts`, run by the reviewer of A13: a `Buffer<number>` passes where a `Buffer<f32>` is taken. A `Buffer<i32>`
  is refused there (TS2345). A `Buffer<i32>` passes where `Buffer<f32> | Buffer<number>` is taken.
- What it means:
  1. A12's editor list, item 2, becomes: a `Buffer<number>` passes in each of those places, and the
     host view does not write the union.
  2. [inference, agent] The owner's answer covers item 3 too: the same type relation holds there, and
     a `Buffer<number>` passes where a `Buffer<u32>` is taken.
  3. Deviation D-q: item 2 is made part of the approved text by this amendment (A13). Item 3 rests on
     item 2 of this list, an inference. The owner answered Q13 (below): item 3 is made part of the approved text too.

**Deviations.**

| ID  | Approved text                                                                                             | Delivered (#1257 at `da043f1d`)                               | Disposition                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-p | A12 decision 4, item 2: an `array<S, N>` result whose `S` holds a `Record` is held in `Buffer`s.          | Refused at the call on both halves.                           | open: a later slice closes it.                                                                                                                                |
| D-q | A12's editor list, items 2 and 3: the host view writes the union with `Buffer<number>`.                   | Not written; TypeScript accepts a `Buffer<number>` there.     | item 2: made part of the approved text by this amendment (A13). Item 3: made part of the approved text by this amendment (A13), by the owner's answer to Q13. |
| D-r | `changes/README.md`, Independent review: a proposal needs an independent review before the owner decides. | The owner answered the three points before a review read A13. | closed: the review at `c607c4fc` read A13 and approved with should-fix; its record is below.                                                                  |

**Open items.**

| Item                                                                | Source     | Next action                                                              |
| ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| D-p                                                                 | Decision 2 | The agent that plans slices 2 to 6 asks the owner which slice closes it. |
| The `f64` place of decision 1 in #1257's code, tests and rule text. | Decision 1 | #1257 implements it before its merge.                                    |
| D-p and D-q in #1257's body.                                        | Deviations | #1257's body records both before its merge.                              |
| D-l, D-m and the other open items of A12.                           | A12        | Unchanged.                                                               |

**The slices of milestone 4, status.**

- [fact] This statement updates A12's status table. A12's text stays as it is.

| Slice  | Status                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | done: #1251, merged as `937147b8`.                                                                                                                                                                                |
| 1      | in progress: #1257 (draft), head `da043f1d` when this was written. A12 decisions 3 and 4 are implemented (`e2059d12` to `04262eaf`) and its rule text is `da043f1d`. Decision 1 of this amendment is in progress. |
| 2 to 6 | not started.                                                                                                                                                                                                      |

**Open, owner must settle.**

- [fact] Nothing. The owner answered Q12 and Q13 on 2026-11-11 (below).

**The owner's answers to Q12 and Q13.**

- [decision, owner, 2026-11-11] The owner picked the recommended option of each question in the
  question UI. The record has no other words. The chosen labels and the option descriptions, in
  Korean, with English translations:
  - Q12: "Buffer 안 받음, 일반 데이터만 (추천)" (English translation: no `Buffer`, plain data only;
    recommended). Description: "f64 행렬 결과를 거부하는 것과 대칭입니다. 두 절반 모두
    거부합니다. 모든 자료형의 Buffer를 받지 않으므로 OD-7의 타입 추론과 충돌하지 않습니다. 비용: 작음. 작성자는 일반 데이터로 호출하고 await합니다." (English translation: it
    matches the refusal of a matrix of `f64` as a result; both halves refuse; it takes no `Buffer` of any element, so it does not conflict with OD-7's inference; small cost: the author
    calls with plain data and awaits.)
  - Q13: "같이 적용: 적지 않음 (추천)" (English translation: the same answer applies: not written;
    recommended). Description: "항목 2와 같은 이유입니다. 동작은 같고, 타입 검사도 엄격하게
    남습니다. 비용: 항목 3도 승인 문구에 편입된다고 기록합니다." (English translation: the reason of
    item 2; the behaviour is the same and the type check stays strict; cost: item 3 is recorded as
    part of the approved text too.)
- What the answers mean:
  1. Q12: a parameter of a matrix of `f64` takes no `Buffer`, a `Buffer<number>` among them. The call
     refuses it with a `TypeError` at the call, and the host view types no `Buffer` there. The
     element of the `Buffer<number>` stays open (A12 D2). The author passes plain data.
  2. [fact] At `9b78bae7`, #1257 already does so: `placeholderOf` in `src/core/host-kernel.ts`
     refuses it, and the host view gives a `Buffer` type to a matrix parameter of `f32` only
     (`src/compiler/ts/host-face.ts:528`). #1257 must test it on both halves (Rule 12.7).
  3. Q13: A12's editor list, item 3, becomes as item 2 does: a `Buffer<number>` passes there, and the
     host view does not write the union.
- [inference, agent] No decision of this amendment conflicts with an entry of
  `docs/owner-decisions.md` (OD-1 to OD-8). Decision 1 follows OD-7.

**Independent review record of A13.**

- [fact] Reviewer: an AI agent (Claude Code) that did not write A13, on 2026-11-11. Revision reviewed:
  `c607c4fc`. It found no blocking finding, 10 should-fix findings and 4 notes. Verdict: approve with
  should-fix.

| Finding                                         | Answer                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1. No review before the owner decided.          | Fixed: D-r.                                                                               |
| 2. The scope of an `f64` place.                 | Fixed: decision 1, items 1 and 2, labelled [inference, agent] where A12 does not say it.  |
| 3. A12's editor list, item 3.                   | Fixed: decision 3 states it; item 2 labels the coverage [inference, agent].               |
| 4. "Q8 item 2" and "Q8 item 4" are ambiguous.   | Fixed: the lists are named; A12's Q8 meaning is amended too.                              |
| 5. D-p names the wrong approved text.           | Fixed: A12 decision 4, item 2; added to `Affects`.                                        |
| 6. D-q's disposition form.                      | Fixed: "made part of the approved text by this amendment (A13)".                          |
| 7. No translations and no option text.          | Fixed: "The owner's answers".                                                             |
| 8. The measurement is an observed result.       | Fixed: labelled, with the commit, the `tsc` version and the file.                         |
| 9. Decision 1, item 3 is in A12.                | Fixed: item 5 cites A12's answer to Q9; item 6 states the cost.                           |
| 10. Status accounting.                          | Fixed: an open item for #1257's body and the status table.                                |
| Notes: GPU tiers, writing, the D-p actor, OD-4. | Fixed: item 7; sentences split; D-p names the actor. OD-4: the owner has already decided. |

- [fact] A delta review read A13 at `b57b165e` on 2026-11-11, by the same reviewer. Verdict: request
  changes. It found 1 blocking finding, 2 should-fix findings and 3 notes.

| Finding                                                     | Answer                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| B1. A false fact on a matrix of `f64`; an undecided case.   | Fixed: decision 1, items 2 and 3; Q12.                                   |
| S2. D-q's item 3 rests on an inference.                     | Fixed: the D-q row and decision 3, item 3 split items 2 and 3; Q13.      |
| S3. A run with no configuration.                            | Fixed: the observed result names only the reviewer's run.                |
| Notes: the moving head, "Open, owner must settle", the row. | Fixed: "when this was written"; the section names Q12 and Q13; this row. |

- [fact] No review has read the revision that answers the delta review.

- Affects: A12 decision 3 (the places that fix the element); A12's Q8 meaning and A12's editor list,
  items 2 to 4; A12 decision 4, item 2, and A12's open item on the kinds that stay refused (D-p);
  A12's slice status table.
- Status: `status: accepted` does not change.

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
  `createRuntime` (found by a code search on 2026-11-03 for proposal 0120). Amendment A10 adds
  any `Resident` (now `Buffer`) and any kernel that writes an array parameter (now `@inout` or
  `@out`); radiance has not been searched for either. `compiler-changes.md`
  records 0138.
- **typenn, typecv, typeaudio.** Kernel calls that await each result, and `fuse` scopes with
  `scratch` and output arrays. Each searches its tree for `await` on a kernel call, `fuse(`,
  `scratch(` and `createRuntime`. Amendment A10 adds `resident(` and `Resident` (now `Buffer`), and
  each kernel that writes an array parameter (now `@inout` or `@out`, or a returned value). typenn migrates
  first, at its pin move past the switch of milestone 4. `compiler-changes.md` records 0138 in each.

Expected work is described; responsibilities are recorded at acceptance; actual downstream
changes, pins and records are tracked apart after compiler implementation.
