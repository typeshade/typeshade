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
  - '11.7'
  - '11.8'
  - '11.11'
  - '11.13'
  - '11.17'
surface:
  - 64
  - 65
  - 67
  - 69
  - 71
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
  - Node
  - Device
exports-removed:
  - resident
  - configure
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
  `Buffer`, `Texture`, `Uniform` and `Node` are new in `typeshade/runtime`. `array` is reshaped:
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
  record), and Amendment A3 leaves D1 to D7 of milestone 1 for it. Milestone 2 is carried out
  under proposal 0042 (Amendment A4). At `main` `25103b0b`, its milestone 1a is not finished,
  and its milestones 1b to 1h are not started.
- [fact] An independent review of the first draft of this amendment found that the answers to
  Q4 and Q14 contradicted each other for a `show` whose canvas has a frame in flight, and that
  they left nine cases open. The owner answered them on 2026-11-10, below.

**Q4, submission.**

- [decision, owner, 2026-11-10] Asked when a recorded call is submitted, the owner chose
  "둘 다: 마이크로태스크 끝 + read/show에서 즉시". The runtime submits the calls recorded in a
  microtask at the current microtask checkpoint. A `read()` submits at once every call recorded
  before it. A `show` does the same, except where the Q14 decision makes it wait. The author
  writes no submit (OD-3). The alternatives were the checkpoint only, or `read()` and `show`
  only. Cost recorded: calls with an `await` between them go in separate submissions.

**Q14, back-pressure.**

- [decision, owner, 2026-11-10] Asked how a `requestAnimationFrame` loop is kept from queuing
  frames, the owner chose "show가 같은 캔버스의 이전 프레임을 기다림". At most one frame waits
  for each canvas. The alternatives were a runtime that drops frames, or a host that decides.
  Cost recorded: when the GPU is slow, the canvas updates at the GPU's rate.
- [decision, owner, 2026-11-10] Asked what waits, the owner chose "그 프레임의 호출 전체가 함께
  기다림". The calls recorded before the `show` wait with it and are submitted together, so the
  loop's computation is held too. The alternative was to hold the write to the canvas only.
  Cost recorded: a `read()` of a resource that those calls write waits for the canvas.
- [decision, owner, 2026-11-10] Asked what a second `show` on a canvas with a waiting frame
  does, the owner chose "계산은 모두 실행, 표시는 최신 것만". The calls of both frames run, in
  order. The canvas shows only the newer image. No computation is dropped. The alternatives were
  to wait for both, or to throw. Cost recorded: the older image may never reach the canvas.

**The cases the first draft left open.**

- [decision, owner, 2026-11-10] Asked about nine defaults together, the owner chose "추천 기본값을
  모두 채택":
  1. `show` returns at once, with no value.
  2. A `read()` submits every call recorded before it, not only the calls it depends on.
  3. A `set()` between two calls of one submission is taken as a snapshot at each call, so each
     call sees the value at its own call (R10).
  4. "The end of the microtask" is the current microtask checkpoint.
  5. On the CPU tier, a submission runs the calls.
  6. On WebGL2, a submission flushes; a `read()` waits on a fence.
  7. An error of a held submission is thrown at the next `read()`, `show` or call, with the call
     site of the failed call (R2).
  8. One submission is not made one fused plan; only `fuse` fuses (Rule 11.13).
  9. A call with plain data only submits the waiting calls first.

**Order of milestones 2 and 3.**

- [decision, owner, 2026-11-10] Asked for the order, the owner chose "마일스톤 3을 먼저".
  Milestone 3 is implemented before milestone 2. The approval record's order holds for the other
  milestones. Cost recorded: the WebAssembly tier comes later.
- [inference] Milestone 3 needs only the JavaScript CPU tier, WebGPU and WebGL2. Its uploads
  and read backs use the region of R17 as it is today, an `ArrayBuffer`.
- [fact] Proposal 0042 assumes the earlier order: its row "Today" (line 117) and its note that
  milestone 3 of this proposal comes after its stage 1 (lines 391 to 394). Its milestones 1f and
  1g name no `Buffer<T>` or `Uniform<T>`. Open: 0042 must say how its tier takes the resources
  of milestone 3. Next action: an amendment of 0042 before its milestone 1b starts.
- [fact] Amendment A4 calls proposal 0042 a draft. It was accepted by
  [#1162](https://github.com/typeshade/typeshade/pull/1162).

**D1 to D7 of milestone 1.**

- [decision, owner, 2026-11-10] D1: "숫자 유지, R7을 개정". A scalar field's `get()` returns
  its number; a vector or an array field returns its view. R7 reads so. Cost recorded: a scalar
  and a vector field return different kinds.
- [decision, owner, 2026-11-10] D2: "범위 여러 개를 두되 개수에 상한". Milestone 3 keeps a dirty
  range for each element written, and joins them into one when their count passes a limit. R9
  stands. Cost recorded: more code and tests than one widened range.
- [decision, owner, 2026-11-10] D3: "거부 유지, 컴파일 시점에도 진단". A field named `set`, and
  `needsUpdate` or `dispose` in a uniform's struct, stays refused, and the compiler and the
  editor report it on a struct that becomes a host resource. R9 names the reserved names. Cost
  recorded: these names cannot be fields of such a struct.
- [decision, owner, 2026-11-10] D4 to D7: "네 가지 모두 추천대로". D4: the types of `Uniform`
  and `Buffer` declare `[Symbol.dispose]`, so `using` works. D5: `texture()` returns the
  existing `Texture` export, and the front matter is corrected. D6: `HostExport` gains a kind
  for a host resource, so `HostFace.exports` and the compiler agree (Rule 12.7). D7: the type of
  an exported binding has no `dispose()`; the runtime still throws a `TypeError`.
- [fact] Milestone 3's first pull request carries D1 to D7 out. D3 adds a diagnostic, and D6
  changes `HostExport`, a public type.
- Affects: Q4, Q14, R7, R9, the approval record's Milestones line (milestones 2 and 3 change
  places) and D1 to D7. The front matter's `exports` (D5: `Texture` is not new; D6:
  `HostExport`) and the sentence that calls `Texture` new are corrected by milestone 3's first
  pull request. No front-matter entry changes here.
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
  `createRuntime` (found by a code search on 2026-11-03 for proposal 0120). `compiler-changes.md`
  records 0138.
- **typenn, typecv, typeaudio.** Kernel calls that await each result, and `fuse` scopes with
  `scratch` and output arrays. Each searches its tree for `await` on a kernel call, `fuse(`,
  `scratch(` and `createRuntime`. `compiler-changes.md` records 0138 in each.

Expected work is described; responsibilities are recorded at acceptance; actual downstream
changes, pins and records are tracked apart after compiler implementation.
