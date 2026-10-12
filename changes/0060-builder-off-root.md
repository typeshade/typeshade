---
id: '0060'
title: An author writes a program in `"use typeshade"` alone; the package root no longer exports the IR builder, which stays at `typeshade/core/ir` for engines and tests
status: accepted
rules:
  - '11.19'
surface:
  - 45
exports:
  - uniformStruct
  - ioStruct
  - structDecl
  - storageBuffer
  - resource
  - hostUniform
  - hostBlock
  - arrayOf
  - constDecl
  - builtin
  - location
  - WGSL_BUILTIN_NAMES
  - WGSL_BUILTIN_TYPES
exports-removed:
  - abs
  - acos
  - acosh
  - add
  - arrayLit
  - arrayOf
  - arrayT
  - asin
  - asinh
  - ASSEMBLED_AS
  - atan
  - atan2
  - atanh
  - atomicI32T
  - atomicU32T
  - bindingRef
  - bitcastF32
  - bitcastU32
  - bool
  - boolT
  - Break
  - Builder
  - builtin
  - Call
  - CAS_RESULT_STRUCTS
  - casResultT
  - ceil
  - clamp
  - condExpr
  - constDecl
  - constExpr
  - constRef
  - construct
  - Continue
  - cos
  - cosh
  - cross
  - degrees
  - Discard
  - distance
  - div
  - dot
  - dpdx
  - dpdy
  - enumU32
  - exp
  - exp2
  - externFn
  - externRef
  - externVar
  - f32
  - f32T
  - f64
  - f64FromParts
  - f64GuardOne
  - f64Parts
  - f64T
  - floor
  - fma
  - fn
  - fract
  - fwidth
  - hostBlock
  - hostUniform
  - i32
  - i32T
  - If
  - IfChain
  - ifExpr
  - insideRange
  - installStmtSink
  - inverseSqrt
  - ioStruct
  - isNodeValue
  - length
  - Let
  - lift
  - location
  - log
  - log2
  - Loop
  - madd
  - mat2f64
  - mat2f64T
  - mat3f64
  - mat3f64T
  - mat4f64
  - mat4f64T
  - mat4x4fT
  - matchEnum
  - matchExpr
  - matT
  - max
  - member
  - min
  - mix
  - mod
  - module
  - mul
  - mulMat64
  - Node
  - NODE_BRAND
  - normalize
  - optBarrier
  - outsideRange
  - overrideConst
  - overrideRef
  - pack2x16float
  - pack2x16snorm
  - pack2x16unorm
  - pack4x8unorm
  - param
  - pow
  - radians
  - rawStmt
  - ReadonlyNode
  - reduce
  - resource
  - Return
  - ReturnIf
  - round
  - samplerComparisonT
  - samplerT
  - saturate
  - select
  - sign
  - sin
  - sinh
  - smoothstep
  - sqrt
  - step
  - storageBuffer
  - storageTexel
  - storageTextureLayoutAccess
  - structDecl
  - structT
  - sub
  - Switch
  - SwitchChain
  - tan
  - tanh
  - texture1dfT
  - texture2dArrayfT
  - texture2dArrayiT
  - texture2dArrayuT
  - texture2dfT
  - texture2diT
  - texture2dMsfT
  - texture2duT
  - texture3dfT
  - textureCubeArrayfT
  - textureCubefT
  - textureDepth2dArrayT
  - textureDepth2dT
  - textureDepthCubeArrayT
  - textureDepthCubeT
  - textureDepthMultisampled2dT
  - textureDimensions
  - textureLoad
  - textureNumLayers
  - textureSample
  - textureSampleLevel
  - toF32
  - toF64
  - toI32
  - toU32
  - transformMat4
  - transformMat64
  - transpose64
  - trunc
  - u32
  - u32T
  - uniformStruct
  - unpack2x16float
  - unpack2x16snorm
  - unpack2x16unorm
  - unpack4x8unorm
  - Var
  - vec2
  - vec2bT
  - vec2f64
  - vec2f64T
  - vec2fT
  - vec2i
  - vec2iT
  - vec2u
  - vec2uT
  - vec3
  - vec3bT
  - vec3f64
  - vec3f64T
  - vec3fT
  - vec3i
  - vec3iT
  - vec3u
  - vec3uT
  - vec4
  - vec4bT
  - vec4f64
  - vec4f64T
  - vec4fT
  - vec4i
  - vec4iT
  - vec4u
  - vec4uT
  - voidT
  - WGSL_BUILTIN_NAMES
  - WGSL_BUILTIN_TYPES
  - when
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Every page stops teaching the IR builder. The front page's hero and the quick start show a `"use typeshade"` file; the examples page, the example pages, the Playground picker and the stills show the `"use typeshade"` twin of each registry example and drop the registry corpus; the Korean guide pages that translate AUTHORING.md's builder sections are translated again from the rewritten sections; the API reference lists the removed names under `typeshade/core/ir` only; compiler-changes.md records 0060 when the pin moves.
  - repo: vscode-typeshade
    what: The packages import `stageOf` and `typeKey` from the root, which stay; nothing the editor names is removed. The skill's SKILL.md and references/host.md are read for any builder spelling; compiler-changes.md records 0060 when the pin moves.
---

<!-- doc-refs: skip-file — a proposal names the rule and the document it will add, which this tree does not have yet, and files of the downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal `0060`, `status: accepted`. The front matter is the lifecycle authority. Seungup approved it in the project conversation on 2026-10-12, Asia/Seoul ("승인", approved); the merge of PR #572 is the acceptance record.                                                                                                                |
| Date and attribution          | Written 2026-10-12, Asia/Seoul. The date is the authorship context, not an approval. Claude Code, an AI assistant, drafted it at Seungup's request in the project conversation of that day: "TypeShade should no longer expose e-DSL syntax such as `fn`." Seungup chose a site change and a compiler proposal. Attribution is not approval.  |
| Applicability / effectivity   | `src/index.ts` (the root export), `src/core/ir/index.ts` (the `typeshade/core/ir` subpath), `src/__api__/surface.md`, `docs/language-design.md` (Rule 11.19), `AUTHORING.md`, `README.md`, the files in `examples/`, `src/` and `scripts/` that import the builder from the root. No release version is assigned; `package.json` is at 0.0.1. |
| Review baseline               | `main` at `f144f26d1f6a8b6056dbab75b803a5e4862041fc` (#570).                                                                                                                                                                                                                                                                                  |
| Review and revision authority | [PR #572](https://github.com/typeshade/typeshade/pull/572), the proposal-only pull request. Git records revisions. Its review and merge records establish decisions.                                                                                                                                                                          |

## What changes

### Today

`src/index.ts` re-exports the IR builder from the package root: `export * from './core/ir/index.js'` and `export * from './core/sot.js'`. They give 291 of the root's 475 exports (`src/__api__/surface.md`): 226 values and 65 types. The values are the builder (`fn`, `module`, `Let`, `If`, `Loop`), the node classes (`Node`, `Builder`), a function per WGSL builtin (`sin`, `mix`, `vec4`), a type token per type (`f32T`, `vec4fT`), and the struct and resource declarators (`uniformStruct`, `storageBuffer`, `ioStruct`).

`AUTHORING.md` opens with "Author from the package root. It re-exports the whole authoring and emit surface" and teaches the builder in twelve sections, from "Your first shader" to "Migrating a GLSL shader". The site translates those sections into its Korean guide. A reader therefore meets two languages for one program: `"use typeshade"`, which the README and the site call the language, and `fn()`, which the authoring guide teaches.

`typeshade/core/ir` already exports the 267 names of `src/core/ir/index.ts`. It does not export the 24 names of `src/core/sot.ts`.

### After this change

The package root exports what a host and a tool need around a `"use typeshade"` program, and no builder:

- The compiler and the pipeline that reads its result stay: `compile`, `emitModule`, `emitGlslModule`, `reflect`, `packModule`, `compileModule`, `validate`, `grad` and the other functions that take a `ModuleDecl`. `compile()` returns a `ModuleDecl`, so these read the language's output, not the builder's.
- The IR types stay as types: `ModuleDecl`, `FuncDecl`, `StructDecl`, `Expr`, `Stmt`, `ShaderType`, `Capability` and the other 63 type-only names. A tool that reads a compiled module names them.
- Seventeen readers over a compiled module stay: `typeKey`, `typeEq`, `stageOf`, `workgroupSizeOf`, `workgroupShapeOf`, `sourceSpanOf`, `isScalar`, `isVec`, `isMat`, `isVec64`, `isMat64`, `isF64`, `ALL_CAPABILITIES`, `ALL_STORAGE_TEXTURE_FORMATS`, `READ_WRITE_STORAGE_FORMATS`, `WRITE_ONLY_STORAGE_FORMATS`, `storageFormatFeature`. The editor imports `stageOf` and `typeKey` from the root today.
- The other 209 values leave the root. The front matter lists them under `exports-removed`.

`typeshade/core/ir` keeps all 267 names and gains the 24 names of `src/core/sot.ts`, so every removed name has one home. Code that builds IR (an engine's generated shaders, the compiler's own tests, the registry examples) imports from there:

```ts
// before
import { fn, module, uniformStruct, vec4 } from 'typeshade';
// after
import { fn, module, uniformStruct, vec4 } from 'typeshade/core/ir';
```

**Rule 11.19 (new).** The package root exports no IR builder. An author writes a program in `"use typeshade"`; the builder, its node classes and its declarators are `typeshade/core/ir`, a subpath for engines, tools and the compiler's tests, with no stability promise before 1.0. The root keeps the IR's types and the readers a tool needs to inspect what `compile()` returns.

`AUTHORING.md` teaches `"use typeshade"` alone. Each of its builder sections is rewritten in `"use typeshade"` where `docs/use-typeshade-surface.md` covers the topic, and moved to a new document, `docs/ir-builder.md`, where the topic is the builder itself (assembling a module by hand, raw statements, the node API). `README.md`'s two sentences that keep `fn()` for "product-facing" use change to name the subpath.

### What stays as it is

- The builder's behavior. No node, no pass and no backend changes.
- `typeshade/examples`. The registry's 36 entries keep their builder source and import it from `typeshade/core/ir`. Which corpus a reader sees is the site's choice (downstream).
- The `"use typeshade"` surface. No section of `docs/use-typeshade-surface.md` changes.

## Why

The owner's direction: TypeShade's language is `"use typeshade"`, and the builder is not part of what an author is shown. The root export is where a reader looks first (`import { … } from 'typeshade'`, the editor's completion list, the API reference's first page), and 61% of it is the builder today. As long as it is there, the authoring guide, the site and every completion list keep teaching it.

The builder still has users that need it: the compiler's tests compare IR built both ways (the twins, `shade-twins.test.ts`), the registry examples are golden-test machinery, and an engine may generate a shader it cannot write as a file. A subpath serves them without putting the builder in front of an author. `docs/roadmap.md` row 24 already plans "the IR authoring layer marked unstable" for 1.0; this proposal does it now, by location.

### Alternatives

- **Hide the builder on the site only.** No compiler change. Rejected by the owner: the root export, the editor's completion list and `AUTHORING.md` would keep teaching it.
- **Remove the builder from the package.** Rejected: the compiler's own tests and the twins need it, and an engine that generates IR has no other door.
- **Keep the names at the root and mark them `@deprecated`.** A softer break. Rejected as the proposed answer because no version is released (0.0.1), so there is no user to give a deprecation period to; listed as decision 3.
- **Move the types too.** A cleaner root. Rejected: `compile()` returns a `ModuleDecl`, and a tool that reads it would import its own result's type from a subpath marked unstable.

### Assumptions

- `scripts/changes.ts` compares export names across all subpaths together. A name that moves from the root to `typeshade/core/ir` may not show as removed in its diff. The front matter declares the 209 names anyway, because `scripts/downstream-impact.ts` reads `exports-removed` to find downstream code that still imports them from the root. Whether `scripts/changes.ts` needs to compare per subpath is confirmed at step 1.
- No downstream repository imports a builder value from the root: the site's `src/` and `scripts/` import none (its Korean guide Markdown shows them in code blocks), the editor imports `stageOf` and `typeKey`, Radiance imports none, X-GIS vendors its own copy. TypeNN pins tarball `946b0ea` and composes IR by hand (typenn PR #6); it is not a declared downstream repository, and its owner is told separately.

### Decisions

Each item was open in the draft. Seungup accepted the proposed answer of each on 2026-10-12, in the project conversation, by approving the proposal as a whole.

1. **The readers that stay.** The seventeen listed above.
2. **The types.** All 65 type-only names stay at the root.
3. **Deprecation.** The 209 values leave the root at once, with no `@deprecated` period. No version is released.
4. **AUTHORING.md.** Each builder section is rewritten in `"use typeshade"` where the surface document covers its topic; the builder's own topics move to `docs/ir-builder.md`.

## What it touches

- **Rule 11.19:** new, as written above.
- **Exports removed:** the 209 values listed, from the root `.` only. Each stays at `typeshade/core/ir`.
- **Exports:** the 13 values of `src/core/sot.ts` (and its 11 types) join `typeshade/core/ir`.
- **Surface section §45:** its code block that shows how the builder's `dot` and `abs` are typed imports them from `'typeshade'`, which step 2 makes untrue. The import line names `typeshade/core/ir`; the prose does not change. Added by amendment on 2026-10-12, after the step 2 implementation found the block.
- **Codes, examples:** none.
- **`AUTHORING.md`, `README.md`, `docs/ir-builder.md` (new):** as above.
- **The compiler's own files:** about 53 files in `examples/`, `src/core` and `docs` import a builder value from the root or from `src/index.ts`; each imports `src/core/ir/index.ts` instead. JSDoc examples in `src/core/sot.ts` and `src/core/ir/builder.ts` name the subpath.

### Implementation steps

1. `typeshade/core/ir` gains `src/core/sot.ts`'s names. The compiler's own imports move to the subpath. The root still exports everything. No downstream effect.
2. The root drops the 209 values; `src/__api__/surface.md` is re-baked (Rule 11.6); Rule 11.19 is added and `bun run reqs:sync` run.
3. `AUTHORING.md` is rewritten and `docs/ir-builder.md` written; `README.md` changes.

Each step is its own pull request with `Change: 0060`.

### Required validation

- `bun run bake:api-surface`, then `src/api-surface.test.ts` and `src/api-doc-coverage.test.ts`: the root lists none of the 209 names, and `typeshade/core/ir` lists all 291.
- The whole unit suite, `gate:compile` and `gate:journeys`: nothing an author writes changes, and the packed tarball still runs every journey.
- `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and `doorstop -C` for Rule 11.19.
- A search of `AUTHORING.md` for `from 'typeshade'` with a builder name: none after step 3.
- `scripts/downstream-impact.ts` run against each declared downstream repository at its pin.

### Draft impact estimate

- **Compiler code:** an export line moves and about 53 import lines change. Known work; small.
- **Documents:** `AUTHORING.md` is 3,189 lines and teaches the builder in twelve sections. Rewriting them is the largest part. Unestimated.
- **Compatibility:** a breaking change for any code that imports a builder value from `typeshade`. No version is released.
- **Dependencies, tools:** none added.
- **Downstream:** the site's guide, front page, examples and Playground (below). The editor: a read of its skill.
- **Effort and date:** unestimated. No milestone is set.

### Approval and plan record

Seungup approved the proposal in the project conversation on 2026-10-12, Asia/Seoul, after the draft of the same day. The approved revision is the one PR #572 merges. The approved scope is the three implementation steps above with the decisions recorded above. A Claude Code session implements and reviews. Each step is its own pull request with `Change: 0060` and merges under the approved-in-advance rule of `CLAUDE.md` when every required check is green, with no conflict and no open thread. No milestone date and no effort estimate were set.

### Configuration and validation record

The three implementation steps are delivered as three commits with `Change: 0060`. None is merged to `main` at the time of this record. The proposal stays `status: accepted` because deviation D1 below is open.

| Step | Configuration item                                                                                              | Delivered                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [PR #575](https://github.com/typeshade/typeshade/pull/575), branch `feat/0060-step1-core-ir`, commit `3dc545a8` | `typeshade/core/ir` exports the 24 names of `src/core/sot.ts`. The compiler's own files import the builder from `src/core/ir/index.ts`. The root still exports everything.                                                                        |
| 2    | branch `feat/0060-step2-root`, commit `688115f4`, on step 1                                                     | The root drops the 209 values of `exports-removed`. `src/__api__/surface.md` is re-baked: `.` goes from 475 to 266 exports. Rule 11.19 is added to `docs/language-design.md`, `reqs/` is synced, and `src/api-surface.test.ts` verifies the rule. |
| 3    | branch `feat/0060-step3-authoring`, on step 2                                                                   | `AUTHORING.md` teaches `"use typeshade"` alone. `docs/ir-builder.md` is new. `README.md`, `AGENTS.md` and `CHANGELOG.md` name the subpath and the new document.                                                                                   |

**Step 3, `AUTHORING.md`.** Each builder section is rewritten in `"use typeshade"`, with host code that uses only the root and its published subpaths: Your first shader, Values and mutation, Functions and entry points, Control flow, Layouts and resources, Emitting and reflection, The CPU oracle, Diagnostics, Conditional programs, Capabilities & extensions, fp64, Production emit and Migrating a GLSL shader. GLSL float precision had host code only and is unchanged. Topics that are the builder itself moved to `docs/ir-builder.md`: the section Raw statements whole, and the subsections Statement slots with composeModule and Declarations the host owns. Every `##` heading but Raw statements keeps its text and its order. Nine `###` headings were renamed: `type-tokens` to `types`, `let-and-var` to `let-and-const`, `mutation-with-assign` to `mutation-and-compound-assignment`, `operator-methods` to `operators`, `if-elif-and-else` to `if-else-if-and-else`, `loop` to `for-and-while`, `choosing-a-value-with-when` to `choosing-a-value`, `exhaustive-dispatch-with-enumu32` to `dispatch-on-an-enum`, and `a-builder-parameter-and-a-plain-if` to `one-file-per-variant`.

**Step 3, validation** (2026-10-12, on the step 3 working tree over `688115f4`, bun 1.4.2, TypeScript 5.6.3):

- A search of `AUTHORING.md` for `from 'typeshade'` with a builder name finds none.
- `src/compiler/ts/doc-snippets.test.ts` compiles each of the 39 `"use typeshade"` fences of `AUTHORING.md` and reads each in the language service: no error in either half.
- `AUTHORING.md` has 58 other TypeScript fences. The 16 shader fragments among them were compiled inside scratch `"use typeshade"` files. Of the 42 host fences, 39 were run against the step 3 tree from scratch scripts, the `splitF64` fence without its write into a host buffer. Three were not run: the WebGL2 and WebGPU boot checks of Capabilities & extensions, which need a GPU context, and the Vite import of Calling a module's helpers from host code, which needs the plugin. The 11 fences of `docs/ir-builder.md` that import the package were run.
- `bun run build`: passed. `bun run test`: 416 files, 9136 tests passed, 4 skipped, 1 todo. `bun run format:check` and `bun run lint`: clean. `bun run docs:refs`: 0 dead references in 1076 files. `bun run docs:impact`: no must-fix item. `bun scripts/changes.ts`: passed. `bun run reqs:sync`: no file changed. `doorstop -C` (Doorstop 3.2): passed.

Step 3 changes no rule text. `gate:compile`, `gate:journeys` and `scripts/downstream-impact.ts` against each downstream repository were not run at step 3: step 3 changes no source file.

**Deviations.**

- D1, open. `docs/use-typeshade-surface.md` §45 shows `import { fn, dot, abs, vec3iT, vec3uT } from 'typeshade';`. Step 2 made that import false: the names are at `typeshade/core/ir` only. This proposal declares `surface: []`, so the fix needs an amendment that names §45. The section is unchanged here.
- D2, closed. The proposal says the README has "two sentences" that keep `fn()` for product-facing use; step 3 changed those two and added one bullet to its documentation list, which names `docs/ir-builder.md`.
- D3, closed. Step 3 also edits `AGENTS.md` (the purpose paragraph, the key-files table and the reading note) and `CHANGELOG.md`, which the applicability row does not list, because both described the builder as the authoring surface.

## What it owes downstream

- `typeshade.github.io`: the front page's hero (`src/lib/hero-shader.ts`, `src/lib/examples.ts`) and the quick start stop reading `gradient-pass.ts`'s `fn()` source and read a `"use typeshade"` file; the examples page, the example pages, the Playground picker and the stills show `"use typeshade"` sources only; 13 registry examples have no `"use typeshade"` twin today and leave the site until one exists; the Korean guide pages under `content/guide/ko/` that translate the builder sections are translated again from the rewritten `AUTHORING.md`; the API reference shows the 209 names under `typeshade/core/ir` only; `compiler-changes.md` records 0060. The site can hide the builder from its pages before this proposal is implemented; the guide follows step 3.
- `vscode-typeshade`: its packages import `stageOf` and `typeKey`, which stay. The skill's `SKILL.md` and `references/host.md` are read for any builder spelling; `compiler-changes.md` records 0060 when the pin moves.
