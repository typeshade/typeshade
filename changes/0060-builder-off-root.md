---
id: '0060'
title: An author writes a program in `"use typeshade"` alone; the package root no longer exports the IR builder, which stays at `typeshade/core/ir` for engines and tests
status: draft
rules:
  - '11.19'
surface: []
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
| Identity and status           | Proposal `0060`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                |
| Date and attribution          | Written 2026-10-12, Asia/Seoul. The date is the authorship context, not an approval. Claude Code, an AI assistant, drafted it at Seungup's request in the project conversation of that day: "TypeShade should no longer expose e-DSL syntax such as `fn`." Seungup chose a site change and a compiler proposal. Attribution is not approval.  |
| Applicability / effectivity   | `src/index.ts` (the root export), `src/core/ir/index.ts` (the `typeshade/core/ir` subpath), `src/__api__/surface.md`, `docs/language-design.md` (Rule 11.19), `AUTHORING.md`, `README.md`, the files in `examples/`, `src/` and `scripts/` that import the builder from the root. No release version is assigned; `package.json` is at 0.0.1. |
| Review baseline               | `main` at `f144f26d1f6a8b6056dbab75b803a5e4862041fc` (#570).                                                                                                                                                                                                                                                                                  |
| Review and revision authority | No pull request is assigned yet. Git records revisions. The review and merge records of the proposal-only pull request establish decisions.                                                                                                                                                                                                   |

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

### Unresolved decisions

1. **The readers that stay.** The seventeen above (proposed), or fewer.
2. **The types.** All 65 type-only names stay at the root (proposed), or the builder-only ones (`UniformStruct`, `FieldSpec`, `HandleArray` and similar) move too.
3. **Deprecation.** Remove at once (proposed), or keep the names at the root with `@deprecated` for one pin of each downstream repository.
4. **AUTHORING.md.** Rewrite each builder section in `"use typeshade"` and move the builder's own topics to `docs/ir-builder.md` (proposed), or drop the builder topics from the documents.

## What it touches

- **Rule 11.19:** new, as written above.
- **Exports removed:** the 209 values listed, from the root `.` only. Each stays at `typeshade/core/ir`.
- **Exports:** the 13 values of `src/core/sot.ts` (and its 11 types) join `typeshade/core/ir`.
- **Surface sections, codes, examples:** none.
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

This record does not yet apply. Acceptance requires the owner's decision on the four unresolved decisions and the merge of the proposal-only pull request with `status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementing pull requests with `Change: 0060`, the delivered configuration, the re-baked surface and the observed results of the validation above.

## What it owes downstream

- `typeshade.github.io`: the front page's hero (`src/lib/hero-shader.ts`, `src/lib/examples.ts`) and the quick start stop reading `gradient-pass.ts`'s `fn()` source and read a `"use typeshade"` file; the examples page, the example pages, the Playground picker and the stills show `"use typeshade"` sources only; 13 registry examples have no `"use typeshade"` twin today and leave the site until one exists; the Korean guide pages under `content/guide/ko/` that translate the builder sections are translated again from the rewritten `AUTHORING.md`; the API reference shows the 209 names under `typeshade/core/ir` only; `compiler-changes.md` records 0060. The site can hide the builder from its pages before this proposal is implemented; the guide follows step 3.
- `vscode-typeshade`: its packages import `stageOf` and `typeKey`, which stay. The skill's `SKILL.md` and `references/host.md` are read for any builder spelling; `compiler-changes.md` records 0060 when the pin moves.
