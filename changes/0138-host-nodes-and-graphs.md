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
  - HostExport
exports-removed:
  - resident
  - configure
codes:
  - TS8079
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

### A9. Slice 2c moves to milestone 5; milestone 3 is done; what comes next; Q1, Q2 and Q16 (2026-11-11)

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
- Cost recorded: no back-pressure until milestone 5. A `requestAnimationFrame` loop of calls on
  resources can queue frames faster than the GPU runs them until then.
- [fact] The owner's decisions on Q4 and Q14 in A5 stay as they are. This decision moves only
  the slice that carries out Q14 and the `show` part of Q4.
- [inference, agent] Milestone 5 carries out the held submission of Q14 and the submission at
  `show` (A5, Q4). The submission at `read()` and at the end of the microtask checkpoint is
  delivered by slice 2a, with deviation D-f.

**The questions of slice 2c, for milestone 5.**

The agent found these questions while it planned slice 2c. Each is asked of the owner before
milestone 5 starts, with Q3, Q5 and Q15.

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
- [fact] With 2c moved, the implementation of milestone 3 is done at `main` `42550b11`. The
  deviations and the open items below stay open.
- [fact] #1247's body records its checks. The owner approved its Doorstop review and said
  "merge" on 2026-11-11. CI passed 26 of 26 checks on its head `b3440465`.

**The deviations after milestone 3.**

Each is a difference between the accepted text (with A5 to A9) and `42550b11`.

| ID  | Disposition                             | Next action                                                                                                                      |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D-a | open, unchanged                         | One `GPUQueue.submit` for each submission. No slice is assigned.                                                                 |
| D-b | open, unchanged                         | Upload a uniform's dirty range, as a `Buffer` does. Then a `Uniform` needs one copy for each device, and R3 is revisited (A8).   |
| D-c | open, the remainder that A8 records     | Move the WebGL2 read back out of the call to `read()`. [proposal, agent] Place the fence at the end of the submission. No slice. |
| D-d | closed by #1238 (A8)                    | None.                                                                                                                            |
| D-e | closed by #1247 (for slice 2a by #1240) | None.                                                                                                                            |
| D-f | open, unchanged                         | The owner decides whether A5 Q4 is read as "the next task", by an amendment, or whether it stays open.                           |
| D-g | open, unchanged                         | A separate overload for a call on a resource. No slice is assigned.                                                              |
| D-h | open, unchanged                         | `fuse()`: milestone 4 (the owner's option, A8). A draw: milestone 5 ([proposal, agent], A8).                                     |

**Open items after milestone 3.**

| Item                                                                                                                                                                                        | Source                       | Next action                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| The deprecation warning of `resident()` in `src/core/resident.ts` says that `array()` "makes the same Resident". Inside a `use()` block that is false: `array()` makes that device's (Q-c). | #1247, Open items            | A later bug fix. No pull request is assigned.                                                  |
| N-r2: a `Buffer` that is not exported, written on a WebGPU device and not read before `dispose()` of that device, loses the write. Code reading; not run on WebGPU.                         | Second review of #1238       | As in A8. No pull request is assigned.                                                         |
| N2: inside `use()` of a disposed device, `zeros()` and `uniform()` succeed, and the call fails later.                                                                                       | First review of #1238        | As in A8. No pull request is assigned.                                                         |
| N1: `use()` is one stack for each module instance, not one for each async task. #1247 states it as a caution only.                                                                          | First review of #1238; A8    | A stack for each task may come later. No pull request is assigned.                             |
| The refusal table of surface §71 (`fuse`) has no row for the refusal of a call on a resource.                                                                                               | #1241, Open items; A8        | The owner decides whether a follow-up adds a row.                                              |
| A7's five deferred questions.                                                                                                                                                               | A7                           | As in A7: ask the owner again before a slice that changes the behavior. Question 1 is near Q2. |
| S3 of #1238 has no unit test. Only the WebGL2 resource arm of `gate:differential` holds it.                                                                                                 | Second review of #1238, N-r1 | A Node test with a WebGL2 stand-in tier. No pull request is assigned.                          |

- [fact] #1247 closed A8's item R-s2: the `core/gl-fence.ts` row of `src/AGENTS.md` and the
  header of `src/core/gl-fence.ts` now name `readFence` and its rule for a lost context.
- [fact] Unchanged and open, as in A8: N-r3, N-r4, the first review's N4, and A7's open item on
  proposal 0042's row "A resource on a CPU tier". #1247 edited the `CHANGELOG.md` entry of N-r4;
  its first sentence still lists `uniform()` among what the device in use makes.

**Decision: what comes next.**

- [decision, owner, 2026-11-11] Asked what comes after milestone 3, the owner chose:
  "A9 + 사이트 핀 이동 + M4 질문 (추천)"
  (this amendment, then move the site's pin, then the questions before milestone 4; recommended).
- [fact] The order is:
  1. This amendment, A9.
  2. Move the compiler pin of typeshade.github.io. The downstream work of this proposal for that
     repository applies there (What it owes downstream).
  3. Ask the owner Q1, Q2 and Q16, the questions of milestone 4 (the approval record's table),
     before milestone 4 starts.
- [fact] The owner answered Q1, Q2 and Q16 in the conversation on 2026-11-11, below.

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
  - Cost recorded: two ways to give an output, and the graph tracks both.
  - [inference, agent] This sets the direction of A7's deferred question 1: a kernel function
    that returns a value and takes a resource returns a resource (R2). The status of question 1
    stays open until the owner closes it.
- [decision, owner, 2026-11-11] Q16, asked what "run apart" means for the new graph features of
  milestone 4, the owner chose:
  "호출 순서대로 하나씩 (추천)"
  (one by one, in call order; recommended).
  - A composed node gives the bits that its inner calls give when they run one by one, in program
    order, as plain kernel calls (Rule 11.13).
  - An in-place update (R14) gives the bits of a copy first, then the write.
  - Cost recorded: the planner may not make an optimization that breaks this baseline.
  - Open under Q16: the condition node (milestone 6) and `show` into a canvas (milestone 5).
- [fact] With these answers, the questions of milestone 4 in the approval record's table (Q1, Q2
  and Q16) are decided. The parts of Q1 and Q16 named above stay open.
- Affects: milestone 3's plan (the slice tables of A7 and A8), milestone 5's scope (slice 2c and
  questions Q-1 to Q-5), the dispositions of D-e and R-s2, Q1, Q2, Q16 (for milestone 4), R4,
  R14 and A7's deferred question 1 (direction only). No rule and no front-matter entry changes.
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
