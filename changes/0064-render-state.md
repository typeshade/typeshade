---
id: '0064'
title: A host sets a render pass's stencil, depth bias, viewport, scissor, blend constant, sample mask, store operations and read-only attachments on WebGPU and WebGL2; a refusal names the portable spelling or says none
status: accepted
rules:
  - '11.11'
surface:
  - 69
exports:
  - RenderState
  - PassTargets
  - RenderPass
  - CompareFunction
  - StencilOperation
  - StencilFaceState
  - StencilState
  - DepthAttachment
  - SamplerOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The Playground render helper (src/lib/render-runtime.ts) passes its scissor through pass.raw.setScissorRect. It loads with the console, which the WebGL2 tier refuses. On WebGPU it may move to the typed pass.setScissorRect. The API reference takes the new names from JSDoc. The test fake of its Playground helper changes with that helper. The WebGPU and WebGL2 concept component (src/components/pages/ConceptsWebgpuPage.astro) serves the English and Korean pages. It gains a short section on pass state and the WebGL2 refusals. compiler-changes.md records 0064 when the pin moves.
  - repo: vscode-typeshade
    what: references/host.md states what RenderState holds (colour targets, depth, topology, culling and multisampling). That sentence gains the new fields. compiler-changes.md records 0064 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal `0064`, `status: accepted` (accepted by PR #646). The front matter is the lifecycle authority. The owner adopted the proposed answer of every question, R1 to R37, and decided R38 to R40, on 2026-10-13 (see Decisions). The owner approved the proposal in the conversation on 2026-10-13, Asia/Seoul ("승인", approved). The owner then chose "둘 다 병합 (권장)" (merge both), which named PR #623 and this pull request. The open items of the Approval and plan record are accepted as open. This is the first of two proposals for gap group 1 (Render state) of proposal 0059's step 3c. The labels 3b and 3c come from PR #615 comment 6135364899. A later proposal holds the other typed cells of the group. This file does not number that proposal. Amendment A1 (2026-10-19) amends F4, R10, R11 and R38. The front matter `status` stays `accepted`.                                                                                                                                                                                                                                                                                                      |
| Date and attribution          | 2026-10-13, Asia/Seoul. This is the drafting date and the date of the owner's decisions, not an approval date. A coding agent (Claude Code session, 2026-10-13) drafted this file at the owner's direction, as step 3c of proposal 0059. An earlier revision of this file was not retained. Sources: #130 comment 5989190584; #204 comment 5989196955; #335; PR #615 comment 6135364899; proposal 0059; `docs/capability-coverage.md`. Attribution is not approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Applicability / effectivity   | Code: `src/runtime/program.ts`, `src/runtime/runtime.ts`, `src/runtime/gl-draw.ts`, `src/runtime/gpu.ts` (the `RenderPassEncoder` slice), `src/runtime/resources.ts` (`SamplerOptions.compare`) and `src/runtime.ts` (the export list). Surface: `src/__api__/surface.md`, `docs/use-typeshade-surface.md` section 69 and `docs/language-design.md` Rule 11.11. Coverage and checks: the group-1 rows of `src/core/coverage/`, `docs/capability-coverage.md`, `journeys/_harness.mjs` (the scissor run and the `WEBGPU_CALL` pattern), `scripts/bundle-budget.json` and `CHANGELOG.md`. Targets: the WebGPU tier and the WebGL2 tier of the program runtime. Dependencies as in proposal 0059: `@webgpu/types` 0.1.74 and TypeScript 5.6.3. No release version is assigned.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review baseline               | `main` at `adf7673e` (2026-10-13; PR #631), the reviewed base. The branch is `claude/0064-render-state`. The line references use this commit. The earlier baselines `4139584` and `196b5d70` are superseded. From `196b5d70` to `adf7673e`, PR #630 (`99ddf9d2`) and PR #631 (`adf7673e`) changed 21 files. Eight of the changed files hold cited lines. A script mapped each cited line through the diff and compared the old text with the new: each moved line holds the same text. The moved lines are re-pointed: in `CHANGELOG.md`, `docs/use-typeshade-surface.md`, `journeys/_harness.mjs`, `src/runtime/runtime.ts` and `src/runtime/runtime.test.ts`. `src/runtime/runtime.ts:385-401` now holds the E1 fix. Of `scripts/compile-gate.ts`, the record cites only `renderVerdicts`, which is at `:1839`. `docs/language-design.md:1249` (Rule 11.11) did not move. Every other cited file is unchanged, so its cited lines hold. The commit of the probe runs E1 to E18 is not recorded (O17). At `adf7673e`, the id `0064` is unused, and Rules 11.21 and 11.22 are not written (R8). <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at adf7673e (R8) --> |
| Review and revision authority | [PR #646](https://github.com/typeshade/typeshade/pull/646), the proposal-only pull request. Git records the revisions. The review and merge of PR #646 record the decision. This document does not name the hash of the commit that carries it. A new proposal merges only when the owner says "merge" in the conversation (`CLAUDE.md`, Merging).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Amendment                     | A1, 2026-10-19 (Asia/Seoul): the owner decided in the conversation that WebGL2 accepts depth bias within a stated bound (see Amendments). A coding agent (Claude Code session, 2026-10-19) drafted the text. The merge of the pull request that carries it is the acceptance. Git holds the earlier text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## What changes

### Today

- [fact] `RenderState` has `depth` (`format`, `compare`, `write`), `primitive` (`topology`, `cullMode`, `frontFace`) and `multisample` (`count`). It has no stencil, depth bias, sample mask or unclipped-depth field (`src/runtime/program.ts:71-107`).
- [fact] The WebGPU pipeline descriptor passes only `format`, `depthCompare` and `depthWriteEnabled` of the depth state (`src/runtime/program.ts:693-704`).
- [fact] `Frame.pass` fixes `storeOp` and `depthStoreOp` to `'store'`. Since PR #631 (the E1 fix), a format with a stencil aspect also gets `stencilLoadOp` from the depth load, `stencilStoreOp: 'store'` and `stencilClearValue: 0`. A depth-only format gets no stencil fields. No option sets the stencil operations (`src/runtime/runtime.ts:370`, `:385-401`).
- [fact] `RenderPass` has `raw` and `draw` only. No typed call sets the viewport, the scissor, the blend constant or the stencil reference (`src/runtime/runtime.ts:105-110`).
- [fact] The WebGL2 `setState` sets depth, cull, front face, blend and colour mask. It sets no stencil, polygon offset, depth range, blend constant or clamp state (`src/runtime/gl-draw.ts:1284-1304`).
- [fact] A WebGL2 pass sets the full viewport and disables the scissor test before its clears (`src/runtime/gl-draw.ts:1444-1445`).
- [fact] Attachment resolution is written twice: for WebGPU at `src/runtime/runtime.ts:364-380`, and for WebGL2 at `src/runtime/gl-draw.ts:1343-1407`.
- [fact] Before a tier builds its objects, `constantOf` and `targetsOf` check the constants and the attachment targets (`src/runtime/program.ts:224-253`, `:375-397`). No check there covers a depth, stencil, bias or multisample field.
- [fact] Before it builds, the WebGL2 tier refuses some render-state values. It refuses an unknown topology, an unknown blend factor or operation, and an unknown compare function. It refuses targets that blend or mask apart, and a multisample count other than 1 (`src/runtime/gl-draw.ts:458-476`, `:795-798`, `:874-897`).
- [fact] The WebGPU tier passes these values to WebGPU. A WebGPU error reaches the host as `The frame did not validate: …`, which names no source (`src/runtime/runtime.ts:424-428`), or as a pipeline creation error (`src/runtime/program.ts:706-713`).
- [fact] Rule 11.11 lists what WebGL2 refuses. It names targets that blend or mask apart (`docs/language-design.md:1249`).
- [fact] WebGL2 draws are recorded and run at `submit()`. The first recorded job starts in a microtask after `submit()` returns (`src/runtime/gl-draw.ts:1309-1323`, `src/core/resident.ts:272-282`).
- [measured] At `196b5d70`, a depth texture of format `depth24plus-stencil8` passed to `Frame.pass` failed at `submit()` on WebGPU. The same call succeeded on WebGL2 (E1). PR #631 fixed it (main `adf7673e`).

### After this change

#### The state fields

```ts
// src/runtime/program.ts: the type names. CompareFunction, StencilOperation, StencilFaceState,
// StencilState and DepthAttachment are exported from src/runtime.ts.
export type CompareFunction =
  | 'never' | 'less' | 'equal' | 'less-equal'
  | 'greater' | 'not-equal' | 'greater-equal' | 'always';
export type StencilOperation =
  | 'keep' | 'zero' | 'replace' | 'invert'
  | 'increment-clamp' | 'decrement-clamp' | 'increment-wrap' | 'decrement-wrap';
export interface StencilFaceState {
  readonly compare?: CompareFunction;      // default 'always'
  readonly failOp?: StencilOperation;      // default 'keep'
  readonly depthFailOp?: StencilOperation; // default 'keep'
  readonly passOp?: StencilOperation;      // default 'keep'
}
/** The stencil test of a pipeline. The four face fields apply to both faces (R16). */
export interface StencilState extends StencilFaceState {
  /** Overrides for the front face. Each field replaces the shared field for that face. */
  readonly front?: StencilFaceState;
  /** Overrides for the back face. Each field replaces the shared field for that face. */
  readonly back?: StencilFaceState;
  /** WebGPU stencilReadMask: 0 to 0xFFFFFFFF, default 0xFFFFFFFF. Both tiers keep the low 8 bits (R15). */
  readonly readMask?: number;
  /** WebGPU stencilWriteMask: 0 to 0xFFFFFFFF, default 0xFFFFFFFF. Both tiers keep the low 8 bits (R15). */
  readonly writeMask?: number;
  /** `setStencilReference`: the reference of each draw of this pipeline, which has `depth.stencil`. A whole number from 0 to 255; a fraction is refused (R23). Unset, the draw sets the pass value. A declared reference overrides `pass.setStencilReference` for its draws (R22). */
  readonly reference?: number;
}
```

```ts
// src/runtime/program.ts: RenderState, additions only (0064)
export interface RenderState {
  /** setBlendConstant. The pipeline field is a TypeShade addition: WebGPU sets the constant on the pass only. Four numbers, each from 0 to 1. Unset, a draw uses the pass value (R32). */
  readonly blendConstant?: ArrayLike<number>;
  readonly depth?: {
    readonly format: string;
    readonly compare?: CompareFunction; // default 'less' (retyped, R18)
    readonly write?: boolean; // unchanged, default true
    /** WebGPU depthBias, depthBiasSlopeScale and depthBiasClamp. Each defaults to 0. */
    readonly bias?: {
      /** WebGPU depthBias. A whole number in the int32 range. On the WebGL2 tier, the size is at least the WebGPU size, and at most 2x it from window depth 0.25 up (F4). Below 0.25 the measured bound of PR-2 applies. The formats are depth24plus and depth32float, and depth24plus-stencil8 once PR-2 measures it (R10, A1). */
      readonly constant?: number;
      /** WebGPU depthBiasSlopeScale. A finite number. The WebGL2 tier gives the same offset (F4, A1). */
      readonly slopeScale?: number;
      /** WebGPU depthBiasClamp. A finite number. The WebGL2 tier refuses a non-zero value when the context lacks EXT_polygon_offset_clamp (F4, A1). */
      readonly clamp?: number;
    };
    /**
     * WebGPU stencil fields of depthStencil. Needs a format with a stencil aspect. The reference
     * comes from pass.setStencilReference, which is 0 at each pass start, or from this pipeline's
     * reference (R22). Lines and points use the front face (E2).
     */
    readonly stencil?: StencilState;
  };
  readonly multisample?: {
    readonly count?: number; // unchanged
    /** WebGPU mask: 0 to 0xFFFFFFFF, default 0xFFFFFFFF. Accepted at count 1 only, where bit 0 counts (R21). */
    readonly mask?: number;
  };
}
```

The names drop WebGPU's prefixes, as `depthCompare` already became `depth.compare`. WebGPU has no nested object for either group. Its `GPUDepthStencilState` is flat (`@webgpu/types` 0.1.74, `dist/index.d.ts:911-960`). This record groups the stencil fields under `depth.stencil` and the bias fields under `depth.bias` (R25). The three bias fields form one object, because the WebGL2 refusals and the point and line check apply to the three together (R10).

The face fields sit on `stencil` and apply to both faces. `front` and `back` each override one face (R16).

Every new field is a literal union, a bounded number or a whole number. The runtime checks each value (F1) and each key (F3). On an inline `render()` argument, `tsc` does not report an extra key. `program.render({ depth: { format, writ: false } })` compiles, because `render` infers its state type ([measured, tsc 5.6.3, a generic stand-in for `Program.render`, probe C19a; R17]). On an annotated `RenderState` variable, `tsc` reports the key (TS2561, probe C19b). `readOnly` and `stencil.readOnly` take `true` and `false`. A boolean variable alone compiles: `{ target, readOnly: b }`, `{ stencil: { readOnly: b } }` and a hoisted `{ target, readOnly: boolean }` all pass ([measured, tsc 5.6.3, probes C1, C2 and C5]). A boolean combined with `clear`, `load` or `store` is an error, with 'Type boolean is not assignable to type false' (probe C3). Today the `object` member of a colour entry accepts `{ target, store: 'discrad' }` and `{ target, store: true }` (`src/runtime/runtime.ts:89-98`, [measured, tsc 5.6.3, probes C7 and C8]). R37 narrows that member, so both fail to compile (R37). The probes are in the session scratchpad, and O17 attaches them.

```ts
// src/runtime/runtime.ts: PassTargets, additions only (0064)
export interface PassTargets {
  readonly color?: readonly (
    | Texture
    | (object & { readonly target?: never })
    | {
        readonly target: Texture | object;
        readonly clear?: readonly [number, number, number, number];
        readonly load?: 'clear' | 'load';
        /** WebGPU storeOp. Default 'store'. 'discard' reads as zero afterwards on both tiers. On WebGL2 it costs one clear at pass end, and the measured cost is written here before acceptance (R6, O1). Not for a canvas. */
        readonly store?: 'store' | 'discard';
      }
  )[];
  readonly depth?: Texture | DepthAttachment;
}

/** A depth attachment: the depth aspect of one texture, and its `stencil` object when the format has a stencil aspect. A depth format with no stencil aspect takes no `stencil`. */
export type DepthAttachment = { readonly target: Texture } & DepthAspect & { readonly stencil?: StencilAspect };

/** Not exported by name. The depth aspect of a depth attachment. `readOnly` takes `true` or `false`. A read-only aspect takes no `clear`, `load` or `store` (R36). */
type DepthAspect =
  | {
      readonly readOnly?: false;
      /** WebGPU depthClearValue, 0 to 1, checked whatever the load (R35). Default 1. */
      readonly clear?: number;
      readonly load?: 'clear' | 'load'; // default 'clear'
      readonly store?: 'store' | 'discard'; // default 'store'
    }
  | {
      /** WebGPU depthReadOnly. A read-only aspect takes no clear, load or store (R36). */
      readonly readOnly: true;
      readonly clear?: never;
      readonly load?: never;
      readonly store?: never;
    };

/** Not exported by name. The stencil object of a depth attachment. Each field it omits follows the depth aspect (R13, R26). */
type StencilAspect =
  | {
      readonly readOnly?: false;
      /** WebGPU stencilClearValue, a whole number from 0 to 255. Default 0. */
      readonly clear?: number;
      readonly load?: 'clear' | 'load';
      readonly store?: 'store' | 'discard';
    }
  | {
      /** WebGPU stencilReadOnly. A read-only stencil object takes no clear, load or store (R36). */
      readonly readOnly: true;
      readonly clear?: never;
      readonly load?: never;
      readonly store?: never;
    };
```

Defaults. A texture alone is a valid `depth` value, as today. A depth attachment keeps today's defaults: `clear` 1, `load` `'clear'` and `store` `'store'`. The `stencil` object follows the depth aspect, field by field (R13): `stencil.load` takes the depth `load`, or `'load'` when `readOnly` is set. `stencil.store` takes the depth `store`, or `'store'` when `readOnly` is set. `stencil.readOnly` takes the depth `readOnly` unless the host sets it. `stencil.clear` is 0. An omitted `stencil` follows the depth aspect as a whole (R26). WebGL2 does the clear and the load this way today (`src/runtime/gl-draw.ts:1401`, `:1453-1456`).

The names of the attachment fields drop WebGPU's suffixes, as `load` and `clear` already do. The WebGPU names are listed in the documentation table (R39). `store` is `storeOp` or `depthStoreOp`. `readOnly` is `depthReadOnly`. `stencil.clear`, `stencil.load`, `stencil.store` and `stencil.readOnly` are `stencilClearValue`, `stencilLoadOp`, `stencilStoreOp` and `stencilReadOnly`. The pipeline keeps its own names: `depth.stencil` holds the test. WebGPU splits the same way: its pipeline holds the test, and its pass attachment holds the operations (cell map, rows G1-33 to G1-44).

```ts
// src/runtime/runtime.ts: RenderPass, additions only (0064)
export interface RenderPass {
  readonly raw: object; // unchanged; WebGL2 throws
  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void; // unchanged
  /** WebGPU setViewport. x and y are whole numbers within the viewport bounds. width and height are whole numbers from 0 to the viewport limit. 0 <= minDepth <= maxDepth <= 1. An omitted `minDepth` is 0, and an omitted `maxDepth` is 1. Default: the whole attachment. */
  setViewport(x: number, y: number, width: number, height: number, minDepth?: number, maxDepth?: number): void;
  /** WebGPU setScissorRect. Whole numbers from 0 up. A fraction is refused (R23). The rectangle is clipped to a Texture or canvas target (R19). Default: the whole attachment. */
  setScissorRect(x: number, y: number, width: number, height: number): void;
  /** WebGPU setBlendConstant. Four numbers, each from 0 to 1. Default [0, 0, 0, 0] at each pass start. The length is checked (F1). A draw whose pipeline declares `blendConstant` uses that value instead (R32). */
  setBlendConstant(color: ArrayLike<number>): void;
  /** WebGPU setStencilReference. A whole number from 0 to 255. A fraction is refused (R23). Default 0 at each pass start. A draw of a pipeline that declares `depth.stencil.reference` uses that value instead (R22). */
  setStencilReference(reference: number): void;
}
```

The four methods keep WebGPU's names. A pass can change them draw by draw. A field on `PassTargets` cannot do that (R3). The JSDoc of `TargetState` (`src/runtime/program.ts:53-55`) gains one sentence. A `constant` factor reads the pipeline's `blendConstant` when it declares one. Otherwise it reads `pass.setBlendConstant`, which sets `[0, 0, 0, 0]` at each pass start (R32).

#### Rules that apply to every field

Each rule has an `F` number. The `F` numbers do not refer to language rules.

- F1. [proposal] One checking function in `src/runtime/program.ts` normalises every render-state field, attachment field and pass call. Each tier builds its descriptor or its GL calls from the normalised record, and the check runs before a tier builds an object. `constantOf` and `targetsOf` already work this way (`src/runtime/program.ts:224-253`, `:375-397`). The same function checks `depth.compare` (R18). Each union and each object key list derives from one `as const` table, and the checker, the key-list sentences and the parity test read that table. The GL tables are typed `Record<CompareFunction, number>` and `Record<StencilOperation, number>`, so a new member is a compile error. Today `compareOf` types its map as `Record<string, number>` (`src/runtime/gl-draw.ts:469`). The `RenderPipeline` key is the normalised state, with `depth.stencil.reference` and `blendConstant` included. The GPU pipeline key is the same state without those two fields. So an identical state returns the identical object, and a state that differs only in them returns a new `RenderPipeline` over one GPU pipeline. Two spellings of one state, with a default written or omitted, return the identical object (Compatibility note). Today the key is the raw state JSON (`src/runtime/program.ts:655`), so the two spellings give two objects. The reference is set per draw, and only for a pipeline with `depth.stencil` (R22).
- F2. [proposal] A refusal is a `TypeError`. Its sentence names the entry, the field, the value and the portable spelling, or `none` and the reason. Each test asserts the whole sentence (Rule 12.5). A thrown sentence carries no rule number and no proposal label. The location is added as the existing refusals add it. The existing `multisample.count` sentence (`src/runtime/gl-draw.ts:795-798`) already names the entry, and it stays as written.
- F3. [proposal] The runtime refuses a key that it does not read, on every object, and it never ignores one (R17 (b)).
  - On a new nested object, the sentence names the key and the keys the object takes.
  - On an existing object (`RenderState`, `primitive`, `depth`, `multisample`, the `targets` entries, `PassTargets`, a colour entry, a depth attachment), an unknown key is a `TypeError`.
  - A key that an object does not take, but that exists one level down, is refused with its path. Examples are `stencil` and `bias` on `depth`, which name `depth.stencil` and `depth.bias`.
  - A WebGPU spelling of a new field gets a sentence that names the TypeShade spelling. The WebGPU spellings are `depthBias`, `depthBiasSlopeScale`, `depthBiasClamp`, `stencilFront`, `stencilBack`, `stencilReadMask`, `stencilWriteMask`, `storeOp`, `depthStoreOp`, `stencilLoadOp`, `stencilStoreOp`, `stencilClearValue` and `depthReadOnly`.
  - The rule for a `clear` with `load` `'load'` is not an F3 rule. It is R35.
- F4. [proposal] The outcome is the same on both tiers: the same pixels, or a `TypeError` on the tier that cannot give them. One exception exists: depth bias (A1, R38). On WebGL2, a bias is lowered to `polygonOffset` and is guaranteed within a bound, not to the same pixels. The bound has three parts, in the bullets below. The other interim exceptions are the WebGL2-only rows for the clamp without its extension, the bias format and the `frag_depth` range. They stand until O3, O4 and O6 report (R20). The same-pass read and count 4 are not interim exceptions: their WebGL2 refusals stand. Every other accepted input gives the same outcome on both tiers.
  - [decision, owner, 2026-10-19] Direction. The depth bias offset has the same direction on WebGL2 as on WebGPU.
  - [decision, owner, 2026-10-19] Constant size, at window depths 0.25 and above. For the same value and format, the WebGL2 constant offset is at least the WebGPU constant offset and at most 2x it. Measured on SwiftShader at window depths 0.25, 0.5 and 0.75.
  - [decision, owner's 'follow the recommendations', 2026-10-19] Constant size, below window depth 0.25. PR-2 measures the ratio of the WebGL2 offset to the WebGPU offset at 0.0625 and 0.125. This record states the measured ratio and its depth range. If the ratio exceeds 2, the JSDoc and surface §69 state the measured bound and its depth range. Below window depth 0.0625 the ratio is not measured. It is expected to grow as the depth falls (inference: it doubles each time the depth halves).
  - [decision, owner, 2026-10-19] Slope. The slope offset is the same on both tiers. O3 measured the same threshold, 0.3125, on both tiers.
  - [decision, owner, 2026-10-19] Clamp. The runtime lowers `clamp` with `EXT_polygon_offset_clamp` when the context exposes it. Without the extension, a non-zero `clamp` is refused with a `TypeError` that names the missing extension. That refusal is the observable fallback (#130, #138).
  - [measured, O3] The bound holds at window depths 0.25, 0.5 and 0.75 on `depth24plus` and `depth32float`. At 0.25 the WebGL2 offset is 2x the WebGPU offset. At 0.5 and 0.75 the two are equal.
  - [inference, not measured] WebGPU treats `depth24plus` like a float depth, with r = 2^(exponent(z) - 23). The WebGL2 driver uses r = 2^-24 below 0.5. WebGPU on hardware also leaves r to the backend. So exact equality is not promised across WebGPU devices either.
  - [decision, owner's 'follow the recommendations', 2026-10-19] `depth24plus-stencil8`. WebGL2 accepts a bias on it once the PR-2 measurement shows that its depth aspect gives the same thresholds as `depth24plus`, at every measured depth, on both tiers. Until that measurement, it is refused.
  - [decision, owner's 'follow the recommendations', 2026-10-19] `depth16unorm` and `depth32float-stencil8` are refused on WebGL2 until a measure on both tiers reports (A1).
- F5. [proposal] The accepted inputs are the intersection of the two tiers. The exceptions are the five WebGL2-only rows of the refusal table: three interim (F4) and two standing (the same-pass read and count 4). Widening a range later is not breaking. Narrowing a published input is breaking (Rule 13.9). A new field has no published program, so its range can still change before publication. WebGPU's wider inputs stay reachable through `RenderPass.raw` (Rule 11.17).
- F6. [proposal] The pipeline and its pass are checked at `pass.draw`, on both tiers (R9). One function, the pass-fit check, runs for `RenderPass.draw` and for `RenderPipeline.draw` into a frame's pass. The checks are these. (a) A pipeline that sets `depth.stencil` needs a pass whose depth attachment has a stencil aspect of the same format. (b) A pipeline that writes depth is refused on a pass whose depth aspect is read-only. A pipeline writes depth when `depth.write` is true, which is its default. (c) A pipeline that writes stencil is refused on a pass whose stencil aspect is read-only. A pipeline writes stencil when its write mask is not 0 and a face that is not culled has an operation other than `keep`. A pipeline sets `depth.write: false` to draw on a read-only pass. The check does not run for `RenderPipeline.draw` into a host's own pass, because the runtime does not know that pass's attachments. Spec basis (spec copy, O13): `setPipeline` requires the render pass layout to equal the pipeline's (line 13203). A depth-writing pipeline needs `depthReadOnly` false (lines 13204 to 13205). A stencil-writing pipeline needs `stencilReadOnly` false (lines 13206 to 13207), and `writesStencil` is defined at lines 8670 to 8682 (E19).
- F7. [proposal] A format with no depth aspect is refused in a pipeline and on an attachment on both tiers. `stencil8` is one such format. WebGL2's `texture()` cannot make it (`src/runtime/gl-draw.ts:89-103`). The refusal names `depth24plus-stencil8`. The defaults of a stencil-only pipeline wait for a host request.
- F8. [proposal] Each new field's JSDoc starts with its WebGPU name (`depthBias`, `stencilFront`, `storeOp`). A search by that name then finds the field. The existing fields with a WebGPU analogue gain that name at the start of their JSDoc. They are `depth.write` (`depthWriteEnabled`), `depth.compare` (`depthCompare`), `load` (`loadOp`), `clear` (`clearValue`) and the depth `clear` (`depthClearValue`). The JSDoc of `RenderState.depth` (`src/runtime/program.ts:78-81`) names `stencil` and `bias`. The JSDoc of `bias` states the sign, and it states that the unit depends on the format (E6, O3). The JSDoc of `PassTargets` (`src/runtime/runtime.ts:83-87`) says 'Every attachment is stored'. That holds for `store: 'store'` only, the default. The implementing pull request rewrites that sentence. It also strips the record's labels from the JSDoc sketches and the example comments, before they enter section 69.

| Input               | Accepted input                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewport            | `x`, `y`, `width` and `height` whole numbers (R23). `width` and `height` from 0 to the viewport limit L. `x` and `y` from -2L. `x + width` and `y + height` at most 2L - 1. An omitted `minDepth` is 0, and an omitted `maxDepth` is 1. | WebGL2 truncates fractions: `viewport(0.5, 0.5, 2.5, 2.5)` reads back as `(0, 0, 2, 2)`. WebGPU rounds them (E3). The bounds are WebGPU's, with the smaller limit L for both tiers (E19). The bounds are not measured on WebGL2 at their extremes (owed frame). Negative sizes are refused on both tiers. |
| Scissor             | Whole numbers from 0 up (R23). Clipped to a `Texture` or a canvas target (R19).                                                                                                                                                         | WebGPU requires the rectangle to lie within the attachment (E19). WebGL2 clips it (E4). A layout rectangle is often fractional (fact, DOM API), so the host rounds it before the call.                                                                                                                    |
| Depth range         | `0 <= minDepth <= maxDepth <= 1`. An omitted `minDepth` is 0, and an omitted `maxDepth` is 1.                                                                                                                                           | WebGL2 clamps silently, and `depthRange(0.8, 0.2)` is `INVALID_OPERATION`. WebGPU invalidates the pass (E5, E9).                                                                                                                                                                                          |
| Blend constant      | Four numbers, each from 0 to 1, for the pass method and the pipeline field (R27, R32). A tuple, or an `ArrayLike` of four numbers.                                                                                                      | WebGPU does not clamp the constant. The WebGL2 spec copy says an implementation may clamp the constant on store (`Clamped Constant Blend Color`, scratchpad copy, not run here). This driver did not clamp (E12). The range from 0 to 1 gives one result on both tiers.                                   |
| Stencil reference   | Whole numbers from 0 to 255 (R15). A fraction is refused (R23).                                                                                                                                                                         | A value above 255 is refused. A reference of 300 stores 44 on WebGPU and 255 on WebGL2 (E7). A refusal removes that difference.                                                                                                                                                                           |
| Stencil clear value | Whole numbers from 0 to 255 (R15). A fraction is refused.                                                                                                                                                                               | A value is kept as given. A clear value of 300 is refused on both tiers.                                                                                                                                                                                                                                  |
| Stencil masks       | Whole numbers from 0 to 0xFFFFFFFF. Both tiers keep the low 8 bits (R15).                                                                                                                                                               | A mask is an AND with the stencil bits, so keeping the low 8 bits changes no result. Stencil has 8 bits on this context (E11).                                                                                                                                                                            |
| Depth bias          | `constant`: a whole number in the int32 range. `slopeScale` and `clamp`: finite numbers. The WebGL2-only rows below refuse the rest (R10, A1).                                                                                          | `GPUDepthBias` is an integer in WebGPU. WebGL2's constant offset is bounded against the WebGPU offset, as O3 measured on `depth24plus` and `depth32float` (F4).                                                                                                                                           |
| Depth clear         | Each value from 0 to 1, checked whatever the load (R35).                                                                                                                                                                                | WebGPU requires 0 to 1 only when the load is `'clear'` (gpuweb spec copy, lines 12767 to 12768). The runtime checks it on both tiers, so the tiers agree. Today WebGL2 clamps the value (inference), and WebGPU accepts an out-of-range value with load `'load'`, so this narrows both (R5, R24).         |
| Multisample mask    | Count 1 only, on both tiers (R21).                                                                                                                                                                                                      | At count 1, bit 0 keeps or drops the draw (E13). A mask with any other count is refused on both tiers, because no test can read a multisampled target until group 3 gives a resolve target.                                                                                                               |
| `store: 'discard'`  | Any attachment except a canvas                                                                                                                                                                                                          | The canvas is read by the compositor (inference, not measured).                                                                                                                                                                                                                                           |

The refusals below are the sentences that the tests assert whole (F2, Rule 12.5). The sentences are illustrative until the implementation fixes them. A sentence names the entry, as the existing refusals do (`src/runtime/program.ts:224-253`). Where no portable spelling exists, the portable column says `none` and gives the reason.

| Case                                                                                                                     | Tiers that refuse | Sentence (illustrative)                                                                                                                                                                           | Portable spelling                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `setStencilReference` outside 0 to 255                                                                                   | Both              | `pass.setStencilReference takes a whole number from 0 to 255; reference is 256.`                                                                                                                  | The same value, from 0 to 255                                                                                           |
| `depth.stencil.reference` outside 0 to 255, or a fraction (R22, R23)                                                     | Both              | `The render pipeline of "fs" sets depth.stencil.reference to 256; it takes a whole number from 0 to 255.`                                                                                         | A value from 0 to 255                                                                                                   |
| A fraction in a viewport position or size (round it with `Math.round`)                                                   | Both              | `pass.setViewport takes whole numbers; width is 0.5.`                                                                                                                                             | A whole number                                                                                                          |
| A fraction in a scissor rectangle (round it with `Math.round`)                                                           | Both              | `pass.setScissorRect takes whole numbers; width is 0.5.`                                                                                                                                          | A whole number                                                                                                          |
| A fraction in `setStencilReference` (round it with `Math.round`)                                                         | Both              | `pass.setStencilReference takes a whole number; reference is 0.5.`                                                                                                                                | A whole number                                                                                                          |
| A stencil clear value outside 0 to 255, or a fraction                                                                    | Both              | `The depth attachment sets stencil.clear to 300; it takes a whole number from 0 to 255.`                                                                                                          | A value from 0 to 255                                                                                                   |
| A depth clear outside 0 to 1                                                                                             | Both              | `The depth attachment sets clear to 2; a depth clear takes a number from 0 to 1.`                                                                                                                 | A value from 0 to 1                                                                                                     |
| A stencil read or write mask outside 0 to 0xFFFFFFFF, or a fraction                                                      | Both              | `The render pipeline of "fs" sets depth.stencil.readMask to 4294967296; it takes a whole number from 0 to 4294967295.`                                                                            | A whole number from 0 to 4294967295                                                                                     |
| `multisample.mask` outside 0 to 0xFFFFFFFF, or a fraction                                                                | Both              | `The render pipeline of "fs" sets multisample.mask to 4294967296; it takes a whole number from 0 to 4294967295.`                                                                                  | A whole number from 0 to 4294967295                                                                                     |
| A non-finite `depth.bias.slopeScale` or `depth.bias.clamp`                                                               | Both              | `The render pipeline of "fs" sets depth.bias.slopeScale to Infinity; it takes a finite number.`                                                                                                   | A finite number                                                                                                         |
| A blend constant that is not four numbers                                                                                | Both              | `pass.setBlendConstant takes four numbers; color has 3 numbers.`                                                                                                                                  | Four numbers from 0 to 1                                                                                                |
| A pipeline `blendConstant` with a component outside 0 to 1, or a length other than four (R32)                            | Both              | `The render pipeline of "fs" sets blendConstant to [2, 0, 0, 0]; it takes four numbers from 0 to 1.`                                                                                              | Four numbers from 0 to 1                                                                                                |
| An unknown stencil operation or compare string                                                                           | Both              | `The render pipeline of "fs" sets depth.stencil.passOp to "zeroo"; it takes keep, zero, replace, invert, increment-clamp, decrement-clamp, increment-wrap or decrement-wrap.`                     | One of those names                                                                                                      |
| clear, load or store on a stencil object that is read-only, inherited or set                                             | Both              | `The depth attachment is readOnly, so stencil.load is inherited as load because the depth aspect is read-only, and the stencil object takes no clear; got stencil.clear 7.`                       | `stencil: { readOnly: false, load: 'clear', clear: 7 }`, or remove the field                                            |
| `setViewport` with a negative width or height, or with a size above the limit                                            | Both              | `pass.setViewport takes a width and a height from 0 to 8192, the viewport limit here; got width -1.`                                                                                              | A size from 0 to the viewport limit                                                                                     |
| `setViewport` with `x` or `y` below -2L, or `x + width` or `y + height` above 2L - 1                                     | Both              | `pass.setViewport takes x and y from -16384, and x + width and y + height up to 16383, the viewport bounds here; got x -20000.`                                                                   | A position inside the viewport bounds                                                                                   |
| `setViewport` with `minDepth` above `maxDepth`, or a depth outside 0 to 1                                                | Both              | `pass.setViewport takes depths with 0 <= minDepth <= maxDepth <= 1; got minDepth 0.8 and maxDepth 0.2.`                                                                                           | Depths in that order, from 0 to 1                                                                                       |
| `setScissorRect` with a negative position or size                                                                        | Both              | `pass.setScissorRect takes whole numbers from 0 up; got width -1.`                                                                                                                                | Sizes from 0 up                                                                                                         |
| `setBlendConstant` with a component outside 0 to 1                                                                       | Both              | `pass.setBlendConstant takes components from 0 to 1; got 2 in component 0.`                                                                                                                       | A component from 0 to 1                                                                                                 |
| `depth.bias.constant` that is not a whole number in the int32 range (round a fraction with `Math.round`)                 | Both              | `The render pipeline of "fs" sets depth.bias.constant to 1.5; it takes a whole number in the int32 range.`                                                                                        | A whole number                                                                                                          |
| A bias, slope scale or clamp other than 0 on point or line topology                                                      | Both              | `The render pipeline of "fs" sets depth.bias.constant 1 on a point-list topology; a bias applies to triangles only; give 0.`                                                                      | 0                                                                                                                       |
| `depth.stencil` on a format with no stencil aspect                                                                       | Both              | `The render pipeline of "fs" sets depth.stencil, which needs a format with a stencil aspect; got depth32float; use depth24plus-stencil8.`                                                         | `depth24plus-stencil8`                                                                                                  |
| The format `stencil8` in a pipeline or an attachment (F7)                                                                | Both              | `The render pipeline of "fs" sets depth.format stencil8, which the runtime does not take on either tier; use depth24plus-stencil8.`                                                               | `depth24plus-stencil8`                                                                                                  |
| A pipeline with `depth.stencil` on a pass with no stencil aspect (F6(a))                                                 | Both              | `pass.draw: the pipeline of "fs" sets depth.stencil, and the pass depth format depth24plus has no stencil aspect; use depth24plus-stencil8.`                                                      | A pass whose depth format is `depth24plus-stencil8`                                                                     |
| A pipeline with `depth.stencil` whose format differs from the pass (F6(a))                                               | Both              | `pass.draw: the pipeline of "fs" has depth format depth24plus-stencil8; the pass depth format is depth32float-stencil8, and the two must match; give the pipeline the pass depth format.`         | A pipeline whose format is the pass depth format                                                                        |
| A key an existing object does not take, such as `depth.bais` (F3, R17 (b))                                               | Both              | `The render pipeline of "fs" sets depth.bais, which depth does not take; depth takes the keys format, compare, write, bias and stencil.`                                                          | The key the object takes                                                                                                |
| A key the new object does not take, such as `depth.stencil.fron`                                                         | Both              | `The render pipeline of "fs" sets depth.stencil.fron, which depth.stencil does not take; it takes the keys compare, failOp, depthFailOp, passOp, front, back, readMask, writeMask and reference.` | The key the object takes                                                                                                |
| A WebGPU spelling on an existing object, such as `depth.depthBias` (F3)                                                  | Both              | `The render pipeline of "fs" sets depth.depthBias, a WebGPU name; the TypeShade name is depth.bias.constant.`                                                                                     | The TypeShade name                                                                                                      |
| A WebGPU key that TypeShade does not take, such as `label` (R40)                                                         | Both              | `The render pipeline of "fs" sets label, which RenderState does not take.`                                                                                                                        | Remove the key                                                                                                          |
| `depth.bias.clamp` other than 0, when the WebGL2 context does not expose `EXT_polygon_offset_clamp`                      | WebGL2 only       | `The render pipeline of "fs" sets depth.bias.clamp to 0.5; the WebGL2 tier takes a non-zero clamp only through EXT_polygon_offset_clamp, and this context lacks it.`                              | `none` on that context. `clamp: 0` removes the clamp, and it is another program.                                        |
| A non-zero `depth.bias.constant` on a depth format other than `depth24plus`, `depth32float` and `depth24plus-stencil8`   | WebGL2 only       | `The render pipeline of "fs" sets depth.bias.constant on depth16unorm; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`                                  | `depth24plus`, `depth32float` or `depth24plus-stencil8` (`depth16unorm` and `depth32float-stencil8` are unmeasured, A1) |
| A non-zero `depth.bias.slopeScale` on a depth format other than `depth24plus`, `depth32float` and `depth24plus-stencil8` | WebGL2 only       | `The render pipeline of "fs" sets depth.bias.slopeScale to 2 on depth16unorm; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`                           | `depth24plus`, `depth32float` or `depth24plus-stencil8` (`depth16unorm` and `depth32float-stencil8` are unmeasured, A1) |
| `store: 'discard'` on a canvas colour target                                                                             | Both              | `The colour target 0 is the canvas: store 'discard' is refused; give store 'store'.`                                                                                                              | `store: 'store'`                                                                                                        |
| A stencil clear whose stencil load is inherited from a depth `load` of `'load'` (R35 (c))                                | Both              | `The stencil clear needs stencil.load 'clear'; stencil.load follows the depth load, which is 'load' here; give stencil.load 'clear'.`                                                             | `stencil: { load: 'clear' }`, or a depth load of 'clear'                                                                |
| `clear`, `load` or `store` on a depth aspect that is `readOnly`                                                          | Both              | `The depth attachment is readOnly: it takes no clear, load or store; got clear 1.`                                                                                                                | Remove the field                                                                                                        |
| A stencil object on a depth format with no stencil aspect                                                                | Both              | `The depth attachment has depth32float, which has no stencil aspect; stencil takes a stencil format; use depth24plus-stencil8.`                                                                   | A stencil format, such as `depth24plus-stencil8`                                                                        |
| A pipeline that writes depth on a read-only pass (F6(b))                                                                 | Both              | `pass.draw: the pipeline of "fs" writes depth, and the pass depth attachment is read-only; set depth.write to false.`                                                                             | `depth.write: false`                                                                                                    |
| A pipeline that writes stencil on a read-only stencil aspect (F6(c))                                                     | Both              | `pass.draw: the pipeline of "fs" writes stencil, and the pass stencil aspect is read-only; set stencil: { readOnly: false } on the depth attachment, or set the stencil write mask to 0.`         | Stencil write mask 0, or `stencil.readOnly` false                                                                       |
| A depth range other than 0 to 1, with a fragment that writes `frag_depth`                                                | WebGL2 only       | `pass.draw: the pipeline of "fs" writes frag_depth, and the depth range is 0.25 to 0.75; the WebGL2 tier refuses this range.`                                                                     | Depth range 0 to 1. `none` until group 14 measures the clamp (O6)                                                       |
| A texture bound from the pass's own depth attachment                                                                     | WebGL2 only       | `The WebGL2 tier cannot sample the depth attachment of the pass that writes it; sample it in a later pass.`                                                                                       | `none`: a same-pass read needs WebGPU's read-only attachment. A later pass samples the depth                            |
| `multisample.count` of 4                                                                                                 | WebGL2 only       | `the WebGL2 tier draws with one sample; a multisampled target is not here.` (existing, `src/runtime/gl-draw.ts:795-798`)                                                                          | Count 1                                                                                                                 |
| `multisample.mask` with a count other than 1 (R21)                                                                       | Both              | `The render pipeline of "fs" sets multisample.mask with count 4; the mask takes count 1 only; remove the mask or set count 1.`                                                                    | Count 1, or no mask                                                                                                     |

A host `GPUTextureView` colour target has no size, so the runtime cannot clip its scissor rectangle and does not refuse it. WebGPU validates that rectangle (R19).

#### WebGL2 lowering

| Field or call                   | WebGPU                                      | WebGL2 lowering                                                                                                                                                                                                                                                                                                                       | Lowering refusals on both tiers                                                                                                                     | Refused on WebGL2 only                                                                                                                   |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `setViewport`                   | `setViewport`                               | `viewport` and `depthRange`, recorded in order                                                                                                                                                                                                                                                                                        | Non-integer x, y, width or height; size outside 0 to the limit; x, y or the far edge outside the viewport bounds; `min > max`; depth outside 0 to 1 | A depth range other than 0 to 1 when the fragment writes `frag_depth` (O6)                                                               |
| `setScissorRect`                | `setScissorRect`                            | `enable(SCISSOR_TEST)` and `scissor`, with the rectangle clipped to a `Texture` or a canvas (R19); a fraction refused (R23)                                                                                                                                                                                                           | Negative size; a fraction (R23)                                                                                                                     | None                                                                                                                                     |
| `setBlendConstant`              | `setBlendConstant`                          | `blendColor`                                                                                                                                                                                                                                                                                                                          | A component outside 0 to 1; a length other than four                                                                                                | None                                                                                                                                     |
| `blendConstant` (pipeline)      | `setBlendConstant`, before the draw         | `blendColor` before each draw whose pipeline declares it. Before a draw that declares none and follows one that did, `blendColor` gets the pass value again (R32)                                                                                                                                                                     | A component outside 0 to 1; a length other than four (R32)                                                                                          | None                                                                                                                                     |
| `setStencilReference`           | `setStencilReference`                       | The pass keeps the value. Each draw passes it to `stencilFuncSeparate` as the reference, unless the pipeline declares one, and only for a pipeline with `depth.stencil` (R22)                                                                                                                                                         | Outside 0 to 255, or a fraction (R23)                                                                                                               | None                                                                                                                                     |
| `depth.stencil`                 | `depthStencil` stencil fields and masks     | Per draw: `enable(STENCIL_TEST)` or `disable`; `stencilFuncSeparate(FRONT, …)` and `(BACK, …)` with one reference and one read mask; `stencilOpSeparate`; `stencilMaskSeparate` with one write mask                                                                                                                                   | A format with no stencil aspect, and `stencil8` (F7); a pass with no stencil aspect (F6(a))                                                         | None                                                                                                                                     |
| `depth.stencil.reference`       | `setStencilReference` before the draw       | Passed to `stencilFuncSeparate` as the reference: the pipeline's own, when it declares one, else the pass value (R22)                                                                                                                                                                                                                 | Outside 0 to 255, or a fraction (R23)                                                                                                               | None                                                                                                                                     |
| `depth.bias.constant`           | `depthBias`                                 | `polygonOffset(slopeScale, constant)`, or `polygonOffsetClampEXT(slopeScale, constant, clamp)` when the clamp is not 0 (the clamp row). On every draw, `POLYGON_OFFSET_FILL` is on when the constant or the slope is not 0, and off otherwise. The size is at least the WebGPU size, and at most 2x it from window depth 0.25 up (F4) | A non-zero value on point or line topology                                                                                                          | A depth format other than `depth24plus` and `depth32float`, until a measure reports (A1). `depth24plus-stencil8` joins after its measure |
| `depth.bias.slopeScale`         | `depthBiasSlopeScale`                       | As `depth.bias.constant`, with the slope as the factor. The offset is the same as on WebGPU (F4)                                                                                                                                                                                                                                      | A non-zero value on point or line topology                                                                                                          | A depth format other than `depth24plus` and `depth32float`, until a measure reports (A1). `depth24plus-stencil8` joins after its measure |
| `depth.bias.clamp`              | `depthBiasClamp`                            | `polygonOffsetClampEXT(slopeScale, constant, clamp)` through `EXT_polygon_offset_clamp`, when the context exposes the extension (A1). A clamp of 0 uses `polygonOffset`                                                                                                                                                               | A non-zero value on point or line topology                                                                                                          | A non-zero value, when the context lacks the extension (O4)                                                                              |
| `multisample.mask`              | `mask`                                      | Count 1: after the draw is recorded and checked, the draw is skipped when bit 0 is 0                                                                                                                                                                                                                                                  | A mask with a count other than 1 (R21)                                                                                                              | A count other than 1 without a mask (existing refusal, `src/runtime/gl-draw.ts:795-798`)                                                 |
| `store: 'discard'`              | `storeOp`, `depthStoreOp`, `stencilStoreOp` | At pass end, each discarded attachment is cleared to 0 (step 16 of the pass procedure). No `invalidateFramebuffer` (R6)                                                                                                                                                                                                               | A canvas colour target                                                                                                                              | None                                                                                                                                     |
| `readOnly`, `stencil.readOnly`  | `depthReadOnly`, `stencilReadOnly`          | Each draw sets its own depth and stencil write masks: `depthMask` in `setState` (`src/runtime/gl-draw.ts:1289`), and the stencil write mask of `depth.stencil`. F6 refuses a pipeline that writes a read-only aspect, so no draw writes one                                                                                           | A pipeline that writes the aspect (F6)                                                                                                              | A texture bound from the pass's own depth attachment (E10)                                                                               |
| `stencil.clear`, `stencil.load` | `stencilClearValue`, `stencilLoadOp`        | `clearBufferiv(STENCIL, 0, [value])`, apart from the depth clear `clearBufferfv(DEPTH)`                                                                                                                                                                                                                                               | `stencil.clear` with a stencil load inherited from a depth `load` of `'load'` (R35 (c))                                                             | None                                                                                                                                     |

The refusal table names every refusal of a field. This table names the refusals that the lowering adds.

The viewport limit L is the smaller of WebGPU's `maxTextureDimension2D` and the WebGL2 `MAX_VIEWPORT_DIMS` (8192 on the measured context, E3). Each refusal names the portable spelling, or `none` with the reason (F2). The viewport bounds use the same L: `x` and `y` from -2L, and `x + width` and `y + height` up to 2L - 1 (E19).

#### Examples (draft fragments)

These fragments are drafts. The implementation compiles each one (Rule 13.8), runs each one on both tiers in a pixel test, and places it in section 69. Each state is written inline in its `render` call, so no literal widens to `string`.

```ts
// Decal: a coplanar draw that wins the depth test. The bias sits on depth32float, a format the
// WebGL2 tier takes a bias on (R10, A1). A bias with slopeScale -1 on depth24plus-stencil8 is, until PR-2 measures that format,
// refused on WebGL2 (A1); a WebGPU-only host learns it from the CI recipe (R20).
const decal = await program.render({
  vertex: 'vs', fragment: 'fs', targets: [format],
  depth: { format: 'depth32float', bias: { constant: -2 } },
});
```

```ts
// Stencil outline. The mark ignores depth: compare 'always' and write false. Each pipeline declares
// its reference, so neither draw depends on the pass value (R22 (b)). Pass 1 writes the reference, 1,
// where the shape is drawn. A value that changes from draw to draw needs pass.setStencilReference
// before that draw.
const mark = await program.render({
  vertex: 'vs', fragment: 'fs', targets: [format],
  depth: { format: 'depth24plus-stencil8', compare: 'always', write: false, stencil: { passOp: 'replace', reference: 1 } },
});
// Pass 2 keeps the depth and the stencil, and draws where the stencil is not 1.
const outline = await program.render({
  vertex: 'vs', fragment: 'fs', targets: [format],
  depth: { format: 'depth24plus-stencil8', write: false, stencil: { compare: 'not-equal', reference: 1 } },
});
frame.pass({ color: [{ target: colour }], depth: { target: depthBuffer } }, (pass) => {
  pass.draw(mark, markBindings, shape);
});
frame.pass(
  { color: [{ target: colour, load: 'load' }], depth: { target: depthBuffer, load: 'load' } },
  (pass) => {
    pass.draw(outline, outlineBindings, shape);
  },
);
```

```ts
// A scissored UI pass. The rectangle comes from a layout box, so it may hold fractions, and each side
// is rounded (R23). The whole attachment is restored before the draws that follow.
const box = panel.getBoundingClientRect();
frame.pass({ color: [{ target: colour, load: 'load' }] }, (pass) => {
  pass.setScissorRect(Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height));
  pass.draw(uiPipeline, uiBindings, quad);
  pass.setScissorRect(0, 0, width, height);
  pass.draw(hudPipeline, hudBindings, quad);
});
```

```ts
// A discarded depth and stencil. The colour is kept. The depth and the stencil are not read after
// the pass. The stencil store follows the depth store unless its stencil object sets its own (R26).
frame.pass(
  { color: [{ target: colour }], depth: { target: depthBuffer, store: 'discard' } },
  (pass) => {
    pass.draw(scene, sceneBindings, geometry);
  },
);
```

```ts
// Translucent pass: depth-tested against the opaque depth, and not written. The depth attachment is
// read-only, so the pipeline sets write: false (F6(b)).
const glass = await program.render({
  vertex: 'vs', fragment: 'fs', targets: [format],
  depth: { format: 'depth24plus', compare: 'less', write: false },
});
frame.pass(
  { color: [{ target: colour, load: 'load' }], depth: { target: depthBuffer, readOnly: true } },
  (pass) => {
    pass.draw(glass, glassBindings, panes);
  },
);
```

```ts
// Two views side by side. Each view sets its viewport before its draws. The sizes are whole numbers (R23).
const half = width >> 1;
frame.pass({ color: [{ target: colour }] }, (pass) => {
  pass.setViewport(0, 0, half, height);
  pass.draw(scene, sceneBindings, geometry);
  pass.setViewport(half, 0, half, height);
  pass.draw(scene, sceneBindings, geometry);
});
```

#### Pass procedure on WebGL2

Each step is one action. The WebGL2 tier runs these steps for each pass, in this order.

1. Attach the framebuffer attachments, as today.
2. Disable `SCISSOR_TEST`.
3. For each canvas colour attachment whose load is `'load'`, run the screen blit-in, as today.
4. Read the host viewport, depth range and blend constant (R4). Step 18 restores them.
5. Set the viewport to the whole target.
6. Set the depth range to 0 and 1.
7. Set the blend constant to 0, 0, 0, 0.
8. Set `drawBuffers` to the recorded colour buffers.
9. Set `colorMask(true)`, `depthMask(true)` and `stencilMask(0xFFFFFFFF)`.
10. For each colour attachment whose load is `'clear'`, clear it with its kind: `clearBufferuiv`, `clearBufferiv` or `clearBufferfv`.
11. For a depth attachment whose load is `'clear'` and that is not read-only, clear the depth with `clearBufferfv(DEPTH)`.
12. For a stencil aspect whose stencil load is `'clear'` and that is not read-only, clear the stencil with `clearBufferiv(STENCIL)`.
13. Run the recorded steps and draws in recording order.
14. Disable `SCISSOR_TEST`.
15. Set `colorMask(true)`, `depthMask(true)` and `stencilMask(0xFFFFFFFF)` again.
16. For each attachment whose store is `'discard'`, clear it to 0, with the clear of its kind.
17. For each canvas colour attachment, run the screen blit-out, as today.
18. Restore the viewport, depth range and blend constant that step 4 read.
19. Unbind the framebuffer, as today.

Notes on the procedure. These notes describe the procedure and do not add steps.

- Steps 5 to 7 are pass-owned (R4). Today the WebGL2 pass sets the viewport (`src/runtime/gl-draw.ts:1444`), disables the scissor test (`:1445`) and sets the colour mask (`:1446`). For a cleared depth, it also sets the depth mask (`:1454`). It sets no depth range and no blend constant. So a depth range or blend constant set in one pass would reach the next.
- Step 2 moves the scissor disable before the blit-in. Today the disable comes after it (`src/runtime/gl-draw.ts:1441-1445`). A scissor that is still on clips the blit (E4).
- The reference of a draw is the pass value at the time of the draw. A draw uses its own `depth.stencil.reference` when its pipeline sets one (R22). The draw passes it to `stencilFuncSeparate` with the read mask (R15). The blend constant of a draw is its pipeline's `blendConstant` when it declares one. A draw that declares none uses the pass value. Before such a draw that follows a declared one, the runtime sets the pass value again with `blendColor` (R32).
- No pass-start step sets `STENCIL_TEST` or `POLYGON_OFFSET_FILL`. Each draw sets both from its pipeline, so a pass-start setting would change no pixel.
- Each draw sets `STENCIL_TEST`, its stencil functions and masks, and `POLYGON_OFFSET_FILL` with its offset, from its pipeline (the lowering rows for `depth.stencil` and `depth.bias`). `setState` sets depth, cull, front face, blend and colour-mask state for each draw (`src/runtime/gl-draw.ts:1284-1304`, called at `:1092`). The clears and the blits do not read the stencil test or the polygon offset (ES 3.0; inference, not read here).
- GL state is global to the context. `depthToColour` (`src/runtime/gl-draw.ts:652-680`) and the compute image pass (`src/core/gl-compute.ts:861-867`) set their own state.
- The host call layer draws on a WebGL2 canvas with `viewport` and `gl.clear` (`src/core/host-draw.ts:586-588`). `gl.clear` obeys the scissor. Steps 2 and 14 keep the scissor off, so the host draw is not clipped.
- Steps 9 and 15 set the writes, because the last draw leaves its own masks. A colour, depth or stencil mask changes what a clear writes (ES 3.0 clear rules: inference, not measured).

### Related work

This record is one of two records for gap group 1. The E1 bug fix is the first step of Order of work, and it is done (PR #631). The later proposal sits outside that order.

- The bug-fix change for E1 is a separate pull request, with the line `Change: none, bug fix`. It sets the stencil load and store from the depth aspect, and the stencil clear to 0 (R13). It is opened and merged first, before the proposal pull request (Order of work, steps 1 and 2). It does not wait for this record. Done: PR #631, merged on 2026-10-13 as `adf7673e`, with every check green on its head `d817c69a`.
- The later proposal holds the other typed cells of group 1. R1 fixes its order. Its decisions are not in this record.

### Order of work

Each numbered item is one action. The E1 bug-fix pull request carries `Change: none, bug fix`. Each other implementing pull request carries `Change: 0064`.

1. Open the bug-fix pull request for E1 from `main` (Related work). It carries `Change: none, bug fix`. Done: PR #631.
2. Warning: a merge cannot be undone. Merge the bug-fix pull request for E1 when every required check is green, with no conflict and no review thread open. It does not wait for this record. A bug fix that needs no proposal is approved in advance (`CLAUDE.md`, Merging). Done: merged as `adf7673e`.
3. Rebase on `main`, then re-check the cited lines, which the E1 fix may move. Then open this proposal as a proposal-only pull request, with `status: draft`. Done: the base is `adf7673e` (Review baseline).
4. Wait for the owner to say "merge" for the proposal pull request.
5. After the owner says merge, set `status: accepted` in the proposal pull request.
6. Record the pull request number, and the status of each open item, in the Approval and plan record.
7. Warning: a merge cannot be undone. Merge the proposal pull request.
8. Open a data pull request that edits `src/core/coverage/`. It carries `Change: 0064`.
9. In that pull request, set each 0064 `gap` cell to `planned (0064)`.
10. Re-bake the table with `bun run bake:capability-coverage`.
11. Open implementing pull request PR-1, from the table below.
12. Open implementing pull request PR-2, from the table below.
13. Open implementing pull request PR-3, from the table below.
14. In each implementing pull request, change each cell only with its test.

| Pull request | Holds                                                                                                                                                   | Cells                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| E1 bug fix   | The stencil load, store and clear defaults of a combined-format pass (`src/runtime/runtime.ts:385-401`, E1). R13 sets the values. Merged: PR #631.      | none                                  |
| PR-1         | The checking function (F1); `setViewport`, `setScissorRect`, `setBlendConstant` and `RenderState.blendConstant`; the WebGL2 pass procedure.             | G1-01 to 06, 63, 64, 69 to 74         |
| PR-2         | The pipeline fields `depth.stencil`, `depth.bias` and `multisample.mask`; `setStencilReference`; the stencil-aspect part of F6, with its refusal tests. | G1-07 to 24, 45 to 54, 67, 68, 75, 76 |
| PR-3         | The attachment fields `store`, `readOnly` and the stencil aspect; the read-only part of F6.                                                             | G1-31 to 44, 55, 56, 59 to 62         |

PR-2 and PR-3 follow PR-1, because they use its checking function (F1). PR-2 also follows the E1 bug fix, because a stencil frame needs the stencil aspect's operations (E1). The order follows the technical dependencies. A usage order, which starts with the stencil and the depth bias that X-GIS uses, is not chosen (R30). The pull request description records the order chosen.

Follow-up, not in this order: a strict mode for the WebGL2 refusals (R20 (b)), as its own proposal.

Deviation D1 applies to this order of work. See "Deviations" below and R2.

### Scope: the 78 cells of group 1

Cell IDs `G1-01` to `G1-78` are labels of this record. They number the 78 cells of the Group 1 list in `docs/capability-coverage.md` (heading "Group 1: Render state"). The numbers follow list order, with each entry's WebGPU cell before its WebGL2 cell. The bake writes that list from `COVERAGE_ROWS` (`scripts/bake-capability-coverage.ts`, `src/core/coverage/index.ts`). The cell map below is this record's copy. "Target" names the tier of a cell.

| Capability                                                                              | Proposal | Cells                         | Count |
| --------------------------------------------------------------------------------------- | -------- | ----------------------------- | ----- |
| Viewport and depth range                                                                | 0064     | G1-01, 02, 63, 64, 73, 74     | 6     |
| Scissor                                                                                 | 0064     | G1-03, 04, 71, 72             | 4     |
| Blend constant                                                                          | 0064     | G1-05, 06, 69, 70             | 4     |
| Stencil reference                                                                       | 0064     | G1-07, 08                     | 2     |
| Stencil pipeline state (faces, masks, operations, `GPUStencilOperation`, `stencilFunc`) | 0064     | G1-09 to 16, 45 to 54, 67, 68 | 20    |
| Stencil attachment (clear, load, store) and the clear row                               | 0064     | G1-37 to 42, 61, 62           | 8     |
| Depth bias, slope scale and clamp, and `polygonOffset`                                  | 0064     | G1-17 to 22, 75, 76           | 8     |
| Sample mask (count 1)                                                                   | 0064     | G1-23, 24                     | 2     |
| Store operations and `invalidateFramebuffer`                                            | 0064     | G1-31 to 34, 55, 56, 59, 60   | 8     |
| Read-only depth and stencil on a pass                                                   | 0064     | G1-35, 36, 43, 44             | 4     |
| Unclipped depth and the depth-clamp extension                                           | later    | G1-27, 28, 65, 66             | 4     |
| Alpha-to-coverage                                                                       | later    | G1-25, 26                     | 2     |
| Sample coverage                                                                         | later    | G1-77, 78                     | 2     |
| Read-only depth and stencil in a render bundle (no bundle API exists)                   | outside  | G1-29, 30 (stay `raw`)        | 2     |
| `gl_DepthRange` (table C)                                                               | outside  | G1-57, 58 (stay `gap`)        | 2     |

Totals: this record (0064) has 66 cells. The later proposal has 8 cells. Outside both proposals there are 4 cells. The total is 78. Each proposal changes only its own cells. The four cells outside both stay as they are (R31).

#### Cell map

The columns are these. ID is the cell ID. Table is the `table` field of the coverage row (`src/core/coverage/model.ts:144`): A, C or D. Source member is the `key`. Now is the status at `196b5d70`. No file under `src/core/coverage/` changed from `4139584` to `196b5d70`. Proposal names the proposal that changes the cell: `0064` is this record, and `later` is the later proposal. After is the status proposed here.

| ID    | Table | Source member (`key`)                                    | Target | Now   | Proposal | After                                        |
| ----- | ----- | -------------------------------------------------------- | ------ | ----- | -------- | -------------------------------------------- |
| G1-01 | A     | `GPURenderPassEncoder.setViewport`                       | WebGPU | raw   | 0064     | typed                                        |
| G1-02 | A     | `GPURenderPassEncoder.setViewport`                       | WebGL2 | gap   | 0064     | typed (sub-gap: frag_depth range)            |
| G1-03 | A     | `GPURenderPassEncoder.setScissorRect`                    | WebGPU | raw   | 0064     | typed                                        |
| G1-04 | A     | `GPURenderPassEncoder.setScissorRect`                    | WebGL2 | gap   | 0064     | typed                                        |
| G1-05 | A     | `GPURenderPassEncoder.setBlendConstant`                  | WebGPU | raw   | 0064     | typed                                        |
| G1-06 | A     | `GPURenderPassEncoder.setBlendConstant`                  | WebGL2 | raw   | 0064     | typed                                        |
| G1-07 | A     | `GPURenderPassEncoder.setStencilReference`               | WebGPU | raw   | 0064     | typed                                        |
| G1-08 | A     | `GPURenderPassEncoder.setStencilReference`               | WebGL2 | gap   | 0064     | typed                                        |
| G1-09 | A     | `GPUDepthStencilState.stencilFront`                      | WebGPU | gap   | 0064     | typed                                        |
| G1-10 | A     | `GPUDepthStencilState.stencilFront`                      | WebGL2 | gap   | 0064     | typed                                        |
| G1-11 | A     | `GPUDepthStencilState.stencilBack`                       | WebGPU | gap   | 0064     | typed                                        |
| G1-12 | A     | `GPUDepthStencilState.stencilBack`                       | WebGL2 | gap   | 0064     | typed                                        |
| G1-13 | A     | `GPUDepthStencilState.stencilReadMask`                   | WebGPU | gap   | 0064     | typed                                        |
| G1-14 | A     | `GPUDepthStencilState.stencilReadMask`                   | WebGL2 | gap   | 0064     | typed                                        |
| G1-15 | A     | `GPUDepthStencilState.stencilWriteMask`                  | WebGPU | gap   | 0064     | typed                                        |
| G1-16 | A     | `GPUDepthStencilState.stencilWriteMask`                  | WebGL2 | gap   | 0064     | typed                                        |
| G1-17 | A     | `GPUDepthStencilState.depthBias`                         | WebGPU | gap   | 0064     | typed                                        |
| G1-18 | A     | `GPUDepthStencilState.depthBias`                         | WebGL2 | raw   | 0064     | typed (sub-gap: unmeasured depth format)     |
| G1-19 | A     | `GPUDepthStencilState.depthBiasSlopeScale`               | WebGPU | gap   | 0064     | typed                                        |
| G1-20 | A     | `GPUDepthStencilState.depthBiasSlopeScale`               | WebGL2 | raw   | 0064     | typed (sub-gap: unmeasured depth format)     |
| G1-21 | A     | `GPUDepthStencilState.depthBiasClamp`                    | WebGPU | gap   | 0064     | typed                                        |
| G1-22 | A     | `GPUDepthStencilState.depthBiasClamp`                    | WebGL2 | raw   | 0064     | typed (sub-gap: clamp without the extension) |
| G1-23 | A     | `GPUMultisampleState.mask`                               | WebGPU | gap   | 0064     | typed (sub-gap: count above 1)               |
| G1-24 | A     | `GPUMultisampleState.mask`                               | WebGL2 | gap   | 0064     | typed (sub-gap: count above 1)               |
| G1-25 | A     | `GPUMultisampleState.alphaToCoverageEnabled`             | WebGPU | gap   | later    | gap                                          |
| G1-26 | A     | `GPUMultisampleState.alphaToCoverageEnabled`             | WebGL2 | gap   | later    | refused                                      |
| G1-27 | A     | `GPUPrimitiveState.unclippedDepth`                       | WebGPU | gap   | later    | typed                                        |
| G1-28 | A     | `GPUPrimitiveState.unclippedDepth`                       | WebGL2 | raw   | later    | typed                                        |
| G1-29 | A     | `GPURenderBundleEncoderDescriptor.depthReadOnly`         | WebGPU | raw   | outside  | raw                                          |
| G1-30 | A     | `GPURenderBundleEncoderDescriptor.stencilReadOnly`       | WebGPU | raw   | outside  | raw                                          |
| G1-31 | A     | `GPURenderPassColorAttachment.storeOp`                   | WebGPU | raw   | 0064     | typed                                        |
| G1-32 | A     | `GPURenderPassColorAttachment.storeOp`                   | WebGL2 | gap   | 0064     | typed                                        |
| G1-33 | A     | `GPURenderPassDepthStencilAttachment.depthStoreOp`       | WebGPU | raw   | 0064     | typed                                        |
| G1-34 | A     | `GPURenderPassDepthStencilAttachment.depthStoreOp`       | WebGL2 | gap   | 0064     | typed                                        |
| G1-35 | A     | `GPURenderPassDepthStencilAttachment.depthReadOnly`      | WebGPU | raw   | 0064     | typed                                        |
| G1-36 | A     | `GPURenderPassDepthStencilAttachment.depthReadOnly`      | WebGL2 | gap   | 0064     | typed (sub-gap: same-pass read)              |
| G1-37 | A     | `GPURenderPassDepthStencilAttachment.stencilClearValue`  | WebGPU | raw   | 0064     | typed                                        |
| G1-38 | A     | `GPURenderPassDepthStencilAttachment.stencilClearValue`  | WebGL2 | gap   | 0064     | typed                                        |
| G1-39 | A     | `GPURenderPassDepthStencilAttachment.stencilLoadOp`      | WebGPU | raw   | 0064     | typed                                        |
| G1-40 | A     | `GPURenderPassDepthStencilAttachment.stencilLoadOp`      | WebGL2 | gap   | 0064     | typed                                        |
| G1-41 | A     | `GPURenderPassDepthStencilAttachment.stencilStoreOp`     | WebGPU | raw   | 0064     | typed                                        |
| G1-42 | A     | `GPURenderPassDepthStencilAttachment.stencilStoreOp`     | WebGL2 | gap   | 0064     | typed                                        |
| G1-43 | A     | `GPURenderPassDepthStencilAttachment.stencilReadOnly`    | WebGPU | raw   | 0064     | typed                                        |
| G1-44 | A     | `GPURenderPassDepthStencilAttachment.stencilReadOnly`    | WebGL2 | gap   | 0064     | typed (sub-gap: same-pass read)              |
| G1-45 | A     | `GPUStencilFaceState.compare`                            | WebGPU | gap   | 0064     | typed                                        |
| G1-46 | A     | `GPUStencilFaceState.compare`                            | WebGL2 | gap   | 0064     | typed                                        |
| G1-47 | A     | `GPUStencilFaceState.failOp`                             | WebGPU | gap   | 0064     | typed                                        |
| G1-48 | A     | `GPUStencilFaceState.failOp`                             | WebGL2 | gap   | 0064     | typed                                        |
| G1-49 | A     | `GPUStencilFaceState.depthFailOp`                        | WebGPU | gap   | 0064     | typed                                        |
| G1-50 | A     | `GPUStencilFaceState.depthFailOp`                        | WebGL2 | gap   | 0064     | typed                                        |
| G1-51 | A     | `GPUStencilFaceState.passOp`                             | WebGPU | gap   | 0064     | typed                                        |
| G1-52 | A     | `GPUStencilFaceState.passOp`                             | WebGL2 | gap   | 0064     | typed                                        |
| G1-53 | A     | `GPUStencilOperation`                                    | WebGPU | gap   | 0064     | typed                                        |
| G1-54 | A     | `GPUStencilOperation`                                    | WebGL2 | gap   | 0064     | typed                                        |
| G1-55 | A     | `GPUStoreOp`                                             | WebGPU | raw   | 0064     | typed                                        |
| G1-56 | A     | `GPUStoreOp`                                             | WebGL2 | gap   | 0064     | typed                                        |
| G1-57 | C     | `glsl:builtinVariables:7.4:gl_DepthRange`                | WebGPU | gap   | outside  | gap                                          |
| G1-58 | C     | `glsl:builtinVariables:7.4:gl_DepthRange`                | WebGL2 | gap   | outside  | gap                                          |
| G1-59 | D     | `webgl:WebGL2RenderingContextBase.invalidateFramebuffer` | WebGPU | raw   | 0064     | typed                                        |
| G1-60 | D     | `webgl:WebGL2RenderingContextBase.invalidateFramebuffer` | WebGL2 | gap   | 0064     | n/a                                          |
| G1-61 | D     | `webgl:WebGL2RenderingContextBase.clearBufferfi`         | WebGPU | typed | 0064     | typed                                        |
| G1-62 | D     | `webgl:WebGL2RenderingContextBase.clearBufferfi`         | WebGL2 | typed | 0064     | typed                                        |
| G1-63 | D     | `webgl:WebGLRenderingContextBase.depthRange`             | WebGPU | raw   | 0064     | typed                                        |
| G1-64 | D     | `webgl:WebGLRenderingContextBase.depthRange`             | WebGL2 | raw   | 0064     | typed (sub-gap: frag_depth range)            |
| G1-65 | D     | `webgl:EXT_depth_clamp`                                  | WebGPU | gap   | later    | typed                                        |
| G1-66 | D     | `webgl:EXT_depth_clamp`                                  | WebGL2 | raw   | later    | typed                                        |
| G1-67 | D     | `webgl:WebGLRenderingContextBase.stencilFunc`            | WebGPU | gap   | 0064     | typed                                        |
| G1-68 | D     | `webgl:WebGLRenderingContextBase.stencilFunc`            | WebGL2 | gap   | 0064     | typed                                        |
| G1-69 | D     | `webgl:WebGLRenderingContextBase.blendColor`             | WebGPU | raw   | 0064     | typed                                        |
| G1-70 | D     | `webgl:WebGLRenderingContextBase.blendColor`             | WebGL2 | raw   | 0064     | typed                                        |
| G1-71 | D     | `webgl:WebGLRenderingContextBase.scissor`                | WebGPU | raw   | 0064     | typed                                        |
| G1-72 | D     | `webgl:WebGLRenderingContextBase.scissor`                | WebGL2 | gap   | 0064     | typed                                        |
| G1-73 | D     | `webgl:WebGLRenderingContextBase.viewport`               | WebGPU | raw   | 0064     | typed                                        |
| G1-74 | D     | `webgl:WebGLRenderingContextBase.viewport`               | WebGL2 | gap   | 0064     | typed (sub-gap: frag_depth range)            |
| G1-75 | D     | `webgl:EXT_polygon_offset_clamp`                         | WebGPU | gap   | 0064     | typed                                        |
| G1-76 | D     | `webgl:EXT_polygon_offset_clamp`                         | WebGL2 | raw   | 0064     | typed (sub-gap: clamp without the extension) |
| G1-77 | D     | `webgl:WebGLRenderingContextBase.sampleCoverage`         | WebGPU | gap   | later    | gap                                          |
| G1-78 | D     | `webgl:WebGLRenderingContextBase.sampleCoverage`         | WebGL2 | gap   | later    | n/a                                          |

Notes on the cell map:

- Rows G1-59 and G1-60 are the two targets of one row, the invalidation row.
- Rows G1-67 and G1-68 cover six keys: `stencilFunc`, `stencilFuncSeparate`, `stencilOp`, `stencilOpSeparate`, `stencilMask` and `stencilMaskSeparate`.
- G1-61 and G1-62 stay `typed`. The combined `clearBufferfi` call is not made: steps 11 and 12 clear depth and stencil apart. The row's WebGL2 cell covers eight keys, and seven of them are typed. So G1-62 stays `typed` (R7). The evidence of the apart clears is E11.
- G1-76 is one WebGL2 cell of the row `webgl:EXT_polygon_offset_clamp` and `webgl:WebGLRenderingContextBase.polygonOffset` (`src/core/coverage/webgl2-host.ts:1137-1139`). By amendment A1 (2026-10-19) the cell is `typed`. The clamp goes through `EXT_polygon_offset_clamp` when the context exposes it. Without the extension, the cell keeps one refusal: a non-zero clamp is a `TypeError` that names the missing extension. The sub-gap is a refusal, not a gap. The journey run `bias-clamp` (`journeys/pipeline-state`) names this cell, and so does G1-22.
- Sub-gap labels (After column). A typed cell with a refusal on one tier names that refusal. G1-02, G1-64 and G1-74 carry the frag_depth range refusal (O6). G1-23 and G1-24 carry the count above 1 (R21). G1-36 and G1-44 carry the same-pass read of the attachment (E10). G1-18 and G1-20 carry the refusal of an unmeasured depth format (A1). `depth24plus-stencil8` leaves that refusal when PR-2 measures it. G1-22 and G1-76 carry the refusal of a non-zero clamp on a context without `EXT_polygon_offset_clamp` (A1). Both name the journey run `bias-clamp` (`journeys/pipeline-state/journey.mjs`), which holds the clamp on WebGL2 where the extension exists and reports "not run" where it does not.
- The `andGap` sub-gap of the clears row (G1-61 and G1-62) is removed by PR-3, which types the stencil clear (G1-37 to G1-42). The sub-gap says 'the stencil clear (clearStencil) has no typed form' (`src/core/coverage/webgl2-host.ts:865-874`). Both cells stay `typed`.

#### Reading of table D rows (R7)

- The WebGPU cell of a table D row takes the status of its WebGPU analogue. For example, `storeOp` is the analogue of `invalidateFramebuffer` (G1-59).
- The WebGL2 cell takes the status of the lowering. If the row has no WebGL2 realisation, the cell is `n/a` under Rule 11.16. G1-60 is such a cell. G1-78 is `n/a` in the later proposal, which owns it. A row whose other keys are typed keeps its typed cell (G1-62, R7). The reason names the rule. The row carries `webgl2Only: { door: 'none' }` (`src/core/coverage/model.ts:158`), which the implementing pull request adds to each `n/a` row that this record makes (G1-60).

### Status totals after this record and the later proposal (forecast)

This table is a forecast. It follows the cell map above. It changes if R7, R10, R21, R31 or R34 changes, if a gating measure of R11 does not report, or if O3 or O4 reports and widens a WebGL2 bias cell. Amendment A1 (2026-10-19) applied the O3 result to the four WebGL2 bias cells (R38).

| Target                                    | `typed` | `n/a` | `refused` | `gap` | `raw` | Total |
| ----------------------------------------- | ------- | ----- | --------- | ----- | ----- | ----- |
| WebGPU, now                               | 1       | 0     | 0         | 20    | 19    | 40    |
| WebGPU, after this record (0064)          | 33      | 0     | 0         | 5     | 2     | 40    |
| WebGPU, after 0064 and the later proposal | 35      | 0     | 0         | 3     | 2     | 40    |
| WebGL2, now                               | 1       | 0     | 0         | 28    | 9     | 38    |
| WebGL2, after this record (0064)          | 32      | 1     | 0         | 3     | 2     | 38    |
| WebGL2, after 0064 and the later proposal | 34      | 2     | 1         | 1     | 0     | 38    |

The 0064 change moves seven WebGL2 raw cells: G1-06, 18, 20, 22, 64, 70 and 76. G1-28 and G1-66 stay raw in 0064, and the later proposal owns them. G1-62 stays typed (R7).

### Status changes

Status changes follow Rule 11.18 and the procedure of `changes/README.md`.

1. Set each changed cell to its new status, with its test or its spelling.
2. Run `bun run bake:capability-coverage`.
3. Read the diff of the re-baked table (Rules 11.14 to 11.18 and Appendix C).

## Why

### Problem

The admission rule of #130 comment 5989190584 admits a WebGL2 lowering only when it gives WGSL's answer for every input WGSL settles. Otherwise the feature fails closed, and the refusal names the portable spelling. That comment also gives up #130's earlier promise that every feature emits on both targets. Child issue #138 calls its runner fallback 'observably' in its title. Comment 5989196955 on #204 decides that fixed-function state belongs to the host, in `RenderState`, and never in shader source.

Group 1 has 78 cells. Now, 48 are `gap` (20 WebGPU, 28 WebGL2), 28 are `raw` (19 WebGPU, 9 WebGL2) and 2 are `typed` (G1-61 and G1-62). The counts follow the status data in `src/core/coverage/` at `196b5d70`, and the cell map above repeats them.

[inference, not run] A key that the runtime does not read is ignored on both tiers, with no message. The risk applies to the existing objects. A typo of a new key there looks like any other unknown key, so F3 covers them. The measured typo cases are in R17.

### Evidence

Labels. [measured] means a probe run on 2026-10-13. [fact] means a result read from a file or a named source. [inference] means a conclusion derived from a reading or a measure. [proposal] means a design decision.

Id prefixes, defined once. A is an assumption. C is a type probe case (the probe files are named in Evidence). D is a deviation. E is evidence. F is a field rule. G1 is a group-1 cell. O is an open item. Q is the question of the earlier draft, and R is its decision (R1 to R40). T is a type probe case that its file labels D1 to D4.

Executor and environment, 2026-10-13: a coding agent in the Claude Code session that drafted this file. Chromium 141.0.7390.37 `headless_shell`. WebGL2 runs on ANGLE over SwiftShader (Vulkan 1.3). WebGPU runs on Dawn over SwiftShader. These are software drivers only. The probe of E20 ran on `196b5d70` with `tsc` 6.0.2 (`/opt/node22/bin/tsc`). The other type probes ran with `tsc` 5.6.3.

The probe sources and outputs are attached to PR #646 comments 6260229048, 6260238742 and 6260244097 (2026-10-19, O17). The attachment maps each of E1 to E18 to its source and output by content, because the probe files carry no E ids. E1 to E18 ran on `db6d0af`, and the type probes ran on `4139584d`. A reviewer can rerun each probe from the attachment. Some outputs exist only as transcript extracts, and the attachment marks them.

The WebGPU statements cite the gpuweb specification (`spec/index.bs`). The copy was read on 2026-10-13 from the session scratchpad, not from the tree. The commit was not recorded when it was read. Proposal 0059 pins gpuweb commit `358eebc8e7bf2d6efa41a4b8b3fbc3a715288204` for the WGSL names fixture only. It does not pin the WebGPU specification. Open item O13 covers this gap. The statements may also differ from `@webgpu/types` 0.1.74 (A4).

- E1 [measured]: `Frame.pass` into a `depth24plus-stencil8` texture fails at `submit()` on WebGPU. The error is `Both stencilLoadOp (LoadOp::Undefined) and stencilStoreOp (StoreOp::Undefined) must be set if the attachment … has a stencil aspect`. WebGL2 succeeds. `depth24plus` succeeds on both. The cause was the depth-only descriptor at `src/runtime/runtime.ts:385-390` at `196b5d70`. PR #631 fixed it: `src/runtime/runtime.ts:385-401` at `adf7673e`. <!-- doc-refs: skip — the first range is read at 196b5d70 -->
- E2 [measured]: stencil face mapping. A counter-clockwise triangle, a clockwise triangle, a line and a point were drawn with the same calls. With `front` set to `replace`, the counter-clockwise triangle, the line and the point write the stencil, and the clockwise triangle does not. With `back` set to `replace`, only the clockwise triangle writes. Both tiers agree in all eight cases. Lines and points use the front face.
- E3 [measured, Chromium 141 only]: a viewport outside the attachment, `(-2, 0, 8, 4)`, `(0, -2, 4, 8)` and `(0, 0, 2, 4)`, gives the same pixels on both tiers with no error. So does a zero size. WebGL2 truncates a fractional viewport. WebGPU rounds it, by the spec text: no probe measured a fractional viewport on WebGPU (O17 attachment). `MAX_VIEWPORT_DIMS` is 8192 on this context. Older WebGPU implementations may validate the viewport against the attachment (O14).
- E4 [measured]: a scissor clips both `clearBufferfv` and `blitFramebuffer`. A 2 by 2 scissor leaves 4 pixels in each.
- E5 [measured]: a depth range of 0.25 to 0.75 gives the same result on both tiers. A draw at Z = 0.2 is followed by a draw at range 0 to 1. At Z = 0.34 the second draw passes, and at Z = 0.36 it fails. A depth bias of -1 wins a coplanar test, and biases of 0 and +1 lose, on both tiers.
- E6 [measured]: the bias offset on `depth32float` matches on both tiers at zero slope. The constants are 1, 100, 1000, 100000 and -1000, at window depth 0.5 only. The probe drew at NDC z 0.5. It is attached to PR #646 (O17). `depth24plus`, other window depths and a non-zero slope were not measured (O3).
- E7 [measured]: a stencil reference of 300 gives 44 on WebGPU (Dawn) and 255 on WebGL2. On WebGPU an `equal` test with 44 passes. On WebGL2 an `equal` test with 255 passes. One software driver each.
- E8 [measured]: after `store: 'discard'`, WebGPU reads zero for colour and depth. On WebGL2, `invalidateFramebuffer` leaves the colour unchanged, `[255, 0, 0, 255]`, with no error. The depth reads zero on this driver.
- E9 [measured]: `depthRange(0.8, 0.2)` is `INVALID_OPERATION` on WebGL2. A WebGPU pass with `minDepth > maxDepth` is invalid.
- E10 [measured]: on WebGL2, sampling the depth texture that is bound as the framebuffer's depth attachment gives `INVALID_OPERATION`. The error holds in three cases: test off and mask off; test on and mask off; test and mask both on.
- E11 [measured]: `clearBufferiv(STENCIL, 0, [7])` is valid on WebGL2. Depth and stencil can be cleared apart. `STENCIL_BITS` is 8 on this context.
- E12 [measured]: `blendColor(2, -1, 0.5, 3)` reads back unclamped on this driver.
- E13 [measured]: alpha-to-coverage with sample count 1 is a WebGPU pipeline error. With count 4 it is accepted. A sample mask of 0 or 2 draws nothing. A mask of 1 or all ones draws.
- E14 [measured]: `unclippedDepth: true` without the `depth-clip-control` feature is a WebGPU pipeline error. With the feature, a full-screen triangle at Z = 1.5 and at Z = -0.5 draws. WebGL2 with `DEPTH_CLAMP_EXT` draws the same two cases.
- E15 [measured]: this WebGL2 context exposes `EXT_polygon_offset_clamp`, `EXT_depth_clamp`, `EXT_color_buffer_float` and `OES_sample_variables`. `MAX_SAMPLES` is 4. `SAMPLE_BUFFERS` is 0 on a framebuffer that the probe built. That framebuffer was not one the runtime built (O17 attachment).
- E16 [measured]: on WebGPU, a `depth32float` target cleared to 0.75 and then discarded reads 0. A following `load` also reads 0. `Texture.read()` rejects every other depth and stencil format on both tiers (`src/runtime/resources.ts:46-49`, `layoutOf` at `:164`). So a discard of depth24plus or of stencil is observed only through a later pass (O8). Stencil discard is not measured.
- E17 [fact]: `src/core/coverage/model.ts` defines `Status` as `typed`, `raw`, `refused`, `planned`, `gap` and `n/a` (line 21). `planned` builds a `planned` cell (line 180). The `GAP_GROUPS` comment for group 3 names the refusal of WebGL2 multisampled targets (Rule 11.11).
- E18 [measured, prototype, attached to PR #646 (O17)]: a new `depth32float` texture reads 0 on WebGPU and 1 on WebGL2 before any write, on SwiftShader. The prototype that gave the bundle estimate of R12 is attached too, except its generated bundle. The attachment records the two bundle sizes, 29344 B and 32719 B, which give the +3,375 B estimate. The initial depth value is a group-6 question (O18).
- E19 [fact, spec copy in the scratchpad, O13]: The `setViewport` device steps bound `x` and `y` below by minus twice `maxTextureDimension2D` (lines 13700 to 13709). They bound `x + width` and `y + height` above by twice that dimension minus 1. The `setScissorRect` validity conditions (lines 13758 to 13762) require `x + width` and `y + height` to lie within the attachment. In `setPipeline` (section at line 13173), the render pass layout must equal the pipeline's (line 13203). A depth-writing pipeline needs `depthReadOnly` false (lines 13204 to 13205). A stencil-writing pipeline needs `stencilReadOnly` false (lines 13206 to 13207). `writesStencil` is defined at lines 8670 to 8682. The depth format rule is at lines 9641 to 9644. The depth clear value lies from 0 to 1 (line 12768).
- E20 [measured, 2026-10-13, `196b5d70`, tsc 6.0.2]: a state without an annotation, `const s = { depth: { format: 'depth32float', compare: 'greater' } }`, passed to a stand-in `render` that takes a `RenderState`, fails with TS2345: `Type 'string' is not assignable to type 'CF | undefined'`. An annotation, `satisfies RenderState` and `as const` each compile. An inline `compare: 'lesss'` fails with TS2820 (`Did you mean "less"`). The probe is in the session scratchpad (O17).

Document audit of this revision (2026-10-13, branch `claude/0064-render-state`, based on `196b5d70`). Each check ran in the worktree of that branch, after the last edit to this file:

- `bunx prettier --write changes/0064-render-state.md`, then `bunx prettier --check` on the same file: the file is formatted (2026-10-13).
- `bun run docs:refs`: 0 dead references in 1144 files (2026-10-13). The skip markers cover the classes that this tree cannot resolve: Rules 11.21 and 11.22, and paths of other repositories.
- `bunx vitest run src/changes.test.ts`: 17 of 17 passed (2026-10-13).
- `bun run changes:check`: exit 0, "no proposal needed" (2026-10-13). The check reads no diff for an untracked file, so it proves nothing about this change.
- Type probes: `types-0064.ts` (cases C1 to C19), `types-0064-c.ts` (C20 to C22) and `types-0064-b.ts`, run with `tsc` 5.6.3 when the draft was written. The file `types-0064-b.ts` labels its cases D1 to D4, and this record calls them T1 to T4.
- The probe of E20 ran on `196b5d70` with `tsc` 6.0.2. The probe outputs are in the session scratchpad, not in the tree. O17 attaches them.
- Not run: `bun run build`, the `qa:*` and gate checks, `bun run reqs:sync`, Doorstop, and the commit-gate checks (`scripts/changes.ts` against a commit, `docs:impact` and `ifchange`), which need a commit. The probe runs E1 to E18 were not repeated (O17).

### Alternatives

- Lower the state through shader source, as #130 would allow. Rejected. Comment 5989196955 on #204 keeps fixed-function state in `RenderState`, and no shader lowering exists for pass state.
- One proposal for all 78 cells. Rejected. The later proposal needs a feature decision and hardware checks. Those must not block this record.
- WebGPU names with WebGPU's full input range. Rejected for now. The names repeat a prefix that the record already drops. WebGL2 cannot match the viewport fraction range (E3). The WebGPU names go in the documentation table.
- Stencil in `PassTargets` only. Rejected. The stencil test is pipeline state (`depthStencil` in WebGPU). Only the attachment operations belong to the pass.
- Viewport, scissor, blend constant and stencil reference as `PassTargets` fields. Rejected (R3).
- Refuse every WebGL2 render-state field. Rejected. Several fields have an exact lowering (E2 to E6), and #130's admission rule asks for a lowering wherever WGSL's answer can be given (comment 5989190584).
- Lower `store: 'discard'` with `invalidateFramebuffer` alone. Rejected. WebGPU defines zeros, and the measured WebGL2 result differs by attachment (E8). See R6.
- Reset every pass-owned state at pass start, with no restore. Not chosen. It narrows the `Runtime.device` hatch for every raw cell (R4).
- A per-draw stencil reference argument (R22 (c)). Not chosen. It changes the signature of every draw for one field.
- Accept `stencil8` on WebGPU only. Not proposed. WebGL2 cannot make the format (`src/runtime/gl-draw.ts:89-103`), so the input table would split by tier (F4). R5 (a) decides the point.

### Assumptions

- A1 [assumption]: a `TypeError` that names the portable spelling is the observable fallback. The program runtime has no CPU tier (Rule 11.11) and no record of rejected entries. Such a record exists only in the compute runner (`src/core/compute/runner.ts`, `runner.rejected`). #138's body names the same reason. The owner adopted R8, which takes this as its premise.
- A2 [assumption]: the measured equalities hold on hardware drivers. Only SwiftShader measured them. Open measures O1 to O11 test this.
- A3 [assumption]: a Rule 11.11 edit is enough for the rule side. A new Rule 11.22 is optional (R8). <!-- doc-refs: skip — Rule 11.22 is not written at 4139584 (R8) -->
- A4 [assumption]: the WebGPU behaviour in the specification text read on 2026-10-13 matches `@webgpu/types` 0.1.74 for each field used here. O13 checks it against a recorded commit.
- A5 [assumption]: the usage facts below are current. They come from a local clone that was not fetched.

### Usage evidence

These facts inform the usage order. They do not set the scope.

- [fact, local clone of X-GIS at `221e9ec4`, 2026-09-08, not fetched]: stencil appears in 17 material literals with three shapes. Compare is `always` or `equal`. The pass operation is `keep` or `replace`. The pass sets the stencil reference to 0 or 1, by phase (`map/src/render/render-phases/draw.ts:37`, `:400`; `map/src/render/vector-tile-renderer.ts:1409`). A depth bias appears once, at `map/src/render/material/point-material.ts:77` (constant -10, slope -1). `storeOp: 'discard'` appears nine times in five files, for depth and stencil. No colour attachment is discarded. Every X-GIS depth attachment is `depth24plus-stencil8`.
- [fact, local clone of radiance at `30daafa`, 2026-10-09]: radiance uses one colour target and a draw count of 3 in its one render pass. It uses no stencil, bias, scissor or store operation.
- [fact, local clone of X-GIS]: no X-GIS code uses `setViewport`, `setScissorRect` or `setBlendConstant`. It uses no alpha-to-coverage, sample mask or sample coverage. It uses no unclipped depth, read-only depth attachment or colour store operation.
- [fact, local clone of X-GIS at `221e9ec4`, not fetched]: X-GIS discards the stencil store in the opaque, points and OIT passes (`map/src/render/passes/opaque-pass.ts:125`, `points-pass.ts:51`, `oit-pass.ts:121`). It discards the depth store in the points pass (`points-pass.ts:48`), and in the opaque and OIT passes only when a condition holds (`opaque-pass.ts:119`, `oit-pass.ts:115`). The opaque pass sets the depth load to `'load'` after its first sub-pass, and the stencil load to `'clear'` (`opaque-pass.ts:118`, `:124`). So the two aspects must be set apart (R13).

## Decisions

**Owner decision record, 2026-10-13 (Asia/Seoul).**

- The owner adopted the proposed answer of every question, R1 to R37, as the decision of record. Each entry below states the adopted answer. A change to one entry is an amendment of this record.
- The owner answered four questions one by one, each with its proposed answer: R1, R2, R6 and R24. R2 accepts deviation D1. R6 includes that the JSDoc of `store` states the cost of the clear.
- The owner decided R38, R39 and R40 in question-and-answer form, on 2026-10-13. They settle the open items that were O21, O22 and O23.
- Acceptance is still the owner's merge of the proposal pull request. These decisions settle the content only.

Each entry gives the decision, its reason, what it affects and the options not chosen. The label "was Qn" keeps the number of the question in the earlier draft. The label "was On" keeps the number of the open item.

**R1. How many proposals does group 1 take? (was Q1)**

- Decided: (a). A bug-fix pull request for E1 comes first, then this proposal (0064), then a later proposal.
- Reason: The later proposal needs a feature decision and hardware checks (O4, O5). Neither may block this record.
- Affects: the front matter, the number of pull requests and the order of acceptance.
- Not chosen: (b) one proposal for the whole group.

**R2. Does one pull request per group apply to group 1? (was Q2)**

- Decided: (b). PR-1, PR-2 and PR-3 implement this record. The owner accepts deviation D1, the split from one pull request per group.
- Reason: PR-2 and PR-3 use the checking function of PR-1 (F1). One pull request would also wait on O2 and O3 for all its cells.
- Affects: Order of work, the pull request table and D1.
- Not chosen: (a) one implementing pull request for the group. The reading that gives (a) is recorded in D1.

**R3. Are the pass-state operations methods or fields? (was Q3)**

- Decided: (a). `RenderPass` has methods with WebGPU's names, and the operations change draw by draw.
- Reason: WebGPU changes these values draw by draw. WebGL2 records each call in order (`src/runtime/gl-draw.ts:1316-1318`).
- Affects: the `RenderPass` and `PassTargets` shapes, the tests and the boundary pattern (O15, R28).
- Not chosen: (b) `PassTargets` fields that set only the start values.

**R4. What does the WebGL2 pass restore after a pass? (was Q4)**

- Decided: (a). After a pass, the WebGL2 tier restores the host's viewport, depth range and blend constant (step 18). The scissor test is off, and the colour, depth and stencil write masks are full (steps 14 and 15). Blend, cull and depth state stay as the last draw set them. STENCIL_TEST, the stencil functions, operations and reference, and the polygon offset stay as the last draw set them.
- Reason: Each pass starts and ends in a defined state, so its pixels do not depend on host state (F4). R24 says no version is published, so narrowing the `Runtime.device` hatch is not yet breaking.
- Affects: pass procedure steps 4, 5 to 7, 14, 15 and 18; the Compatibility note; G1-06, G1-64 and G1-70, with R34.
- Not chosen: (b) no restore. The pass values stay after the pass, and a host value set before the pass is lost for later raw calls.

**R5. Should the accepted inputs start narrow? (was Q5)**

- Decided: (a). The accepted inputs are the intersection of the two tiers, as the input table states. An input widens after measurement.
- Reason: Widening later is not breaking. Narrowing a published input is breaking (Rule 13.9).
- Affects: the input table, the refusal tests and the Compatibility note. F7 refuses `stencil8` on both tiers, because WebGL2 cannot make it (`src/runtime/gl-draw.ts:89-103`).
- Not chosen: (b) WebGPU's input range, with WebGL2 refusing what it cannot give.

**R6. What does `store: 'discard'` promise? (was Q6)**

- Decided: (c). `store: 'discard'` reads as zero afterwards on both tiers. WebGL2 clears each discarded attachment to 0 at pass end (step 16). The JSDoc of `store` states the cost of that clear.
- Reason: A host may read the zero, so weakening "reads zero" later is breaking (Rule 13.9). The clear may cost the bandwidth that `discard` saves on a tile-based or integrated GPU (inference, not measured).
- Affects: the store cells G1-32, G1-34 and G1-56; the discard tests; the JSDoc of `store`; the device measure O1.
- Not chosen: (a) the same promise, with no cost in the JSDoc. (b) contents undefined after the pass, with `invalidateFramebuffer` on WebGL2, which breaks F4. (d) refuse `discard` on WebGL2.

**R7. Are cells G1-59, G1-60 and G1-62 typed or `n/a`? (was Q7)**

- Decided: (a). A WebGPU cell takes the status of its WebGPU analogue, so G1-59 is typed. A WebGL2 cell of a row is typed when the lowering realises the row's keys. It is `n/a` under Rule 11.16 when the row has no WebGL2 realisation. So G1-60 is `n/a`, and G1-62 stays typed.
- Reason: The row of G1-62 has seven keys that typed clears realise (steps 10 to 12). One `n/a` cell would misstate them. G1-60 has no WebGL2 realisation, because `store: 'discard'` clears instead (R6).
- Affects: G1-59, G1-60 and G1-62; the coverage data (`src/core/coverage/webgl2-host.ts`); the forecast totals.
- Not chosen: (b) split `clearBufferfi` into its own row, whose WebGL2 cell is `n/a`.

**R8. Is the `TypeError` the observable fallback, and is Rule 11.22 needed? (was Q8)** <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at 196b5d70 (R8) -->

- Decided: (a). Rule 11.11 is the only rule edited. The `TypeError` that names the portable spelling is the observable fallback (A1). Rule 11.22 is not written now. <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at 196b5d70 (R8) -->
- Reason: Proposal 0042 claims Rule 11.21, and its text is not yet in `docs/language-design.md` (`changes/0042-wasm-tier.md`). Rule 11.22 waits for that text, and the F rules do not need it. <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at 196b5d70 (R8) -->
- Affects: the `rules` front matter, `reqs:sync` and the Doorstop review.
- Not chosen: (b) also add Rule 11.22 now: "A render-state field gives the same pixels on both tiers. Otherwise a tier refuses it by name, with the portable spelling. No field is ignored." <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at 196b5d70 (R8) -->

**R9. Is a pipeline checked against its pass at `pass.draw`? (was Q9)**

- Decided: (a). The pass-fit check (F6) runs at `pass.draw` on both tiers, for `RenderPass.draw` and for `RenderPipeline.draw` into a frame's pass.
- Reason: WebGPU makes the encoder invalid for a layout mismatch, and WebGL2 passes silently (E19). The checks cover only the new fields, so no working program narrows.
- Affects: `pass.draw`, the F6 refusal rows and one refusal test per tier and per spelling of the draw, in PR-2 and PR-3. Slice 0(b) of #204 extends the same function.
- Not chosen: (b) leave the shared check to #204 slice 0(b).

**R10. How are the depth-bias units and the WebGL2 refusals stated? (was Q10)**

- Decided: (a). The `bias` object is typed on both tiers. Until O3 reports, WebGL2 takes a constant bias only on `depth32float`. It refuses, with a `TypeError`, a non-zero slope scale, a non-zero clamp and a bias on any other format (R11, R38). Tests assert the outcome (win or lose), and the unit difference is documented.
- Reason: Rule 13.3 requires a measure of a design that a target might refuse, before the design is kept. Widening after O3 is not breaking (F5).
- Affects: G1-17 to G1-22, G1-75 and G1-76; O3 and O4. Acceptance does not wait for O3 (R38).
- Not chosen: (b) hold acceptance until O3 reports for `depth24plus` and for a non-zero slope; (c) type all three on both tiers without a measure.
- Amendment A1 (2026-10-19). The decided text above stands as the record of 2026-10-13. The owner's go-ahead in the conversation, on 2026-10-19, changes the disposition. WebGL2 accepts a constant bias, a slope scale and a clamp as F4 states. The format set is `depth24plus` and `depth32float`, and `depth24plus-stencil8` once PR-2 measures it. The clamp needs `EXT_polygon_offset_clamp`. Reason: O3 measured the unit (Open items).

**R11. Do hardware measures gate each field? (was Q11)**

- Decided: (a). A WebGL2 cell stays `gap` or `refused` until its measure reports and its frames pass. The gating measures are O2, O3, O4 and O8. O5 gates the later proposal. The four WebGL2 bias cells, G1-18, G1-20, G1-22 and G1-76, are `refused` until their measures report: O3 for G1-18 and G1-20, and O4 for G1-22 and G1-76 (R38).
- Reason: A later narrowing is breaking (Rule 13.9), and a narrower field is not.
- Affects: the acceptance conditions in Approval and plan record; the WebGL2 bias cells of R10 (R38); the WebGL2 stencil cells (O2).
- Not chosen: (b) measure after the implementation, and narrow or refuse later.
- Amendment A1 (2026-10-19). The decided text above stands as the record of 2026-10-13. The owner's go-ahead in the conversation, on 2026-10-19, changes the disposition of the four WebGL2 bias cells. G1-18, G1-20, G1-22 and G1-76 are `typed` after their frames pass. Reason: O3 reported, and the gating measure for G1-18 and G1-20 is met. G1-22 and G1-76 keep one refusal, the clamp on a context without `EXT_polygon_offset_clamp`. O4 stays open.

**R12. Should the bundle budget rise? (was Q12)**

- Decided: (a). This proposal declares a rise to about 33,200 B. Each implementing pull request sets the value from its own measurement (O11).
- Reason: The prototype figure of +3,375 B (E18) cannot be reproduced from this record. Each measurement replaces the estimate.
- Affects: `scripts/bundle-budget.json`, `gate:boundary` and the CHANGELOG entry.
- Not chosen: (b) split the WebGL2 layer so that it stays within 29,800 B.

**R13. Do the stencil aspect's defaults follow the depth aspect, `readOnly` included? (was Q13)**

- Decided: (a). The stencil object follows the depth aspect field by field: `load`, `store`, `clear` and `readOnly`. A field the host sets wins. `readOnly: true` on the depth aspect makes the stencil object read-only, unless the host sets `stencil: { readOnly: false }`. The refusal of a stencil clear is R35.
- Reason: A host must set the two aspects apart. X-GIS does so: its opaque pass sets the stencil load to `'clear'` while the depth load is `'load'` (`map/src/render/passes/opaque-pass.ts:118`, `:124`, at `221e9ec4`).
- Affects: the Defaults paragraph, F6(c), the Compatibility note and the bug-fix change for E1. A port of that opaque pass sets `stencil.load` explicitly. A stencil-mask pass on a read-only depth aspect states `stencil: { readOnly: false, load: 'clear' }`, an accepted cost.
- Not chosen: (b) the stencil store is always `'store'`, and the stencil clear is independent of the depth.

**R14. When does a cell become `planned`? (was Q14)**

- Decided: (a). After acceptance, a data pull request changes the `gap` cells of this record to `planned (0064)`.
- Reason: Rule 11.18 requires a `planned` row to name its proposal, so the proposal file must reach `main` first.
- Affects: the number of pull requests and the sequence in Order of work.
- Not chosen: (b) this proposal's own pull request changes the cells.

**R15. Which values do the stencil reference, the clear value and the masks take? (was Q15)**

- Decided: (b). The stencil reference and the stencil clear value take whole numbers from 0 to 255. A larger value is refused. The read and write masks take whole numbers from 0 to 0xFFFFFFFF, and both tiers keep the low 8 bits.
- Reason: A truncated value gives a wrong stencil, with no message. A truncated mask changes no result, because a mask is an AND with the stencil bits.
- Affects: the input table, the refusal table, the stencil tests and R23.
- Not chosen: (a) 0 to 0xFFFFFFFF for values and masks, with the low 8 bits kept on both tiers.

**R16. Do the face fields apply to both faces? (was Q16)**

- Decided: (a). `compare`, `failOp`, `depthFailOp` and `passOp` sit on `stencil` and apply to both faces. `front` and `back` each override one face.
- Reason: A host writes the short form first, so the short form must be the safe one. Lines and points use the front face (E2), so a test that draws only front faces would hide a gap.
- Affects: `StencilFaceState` and `StencilState` (both exported), and the examples.
- Not chosen: (b) WebGPU's shape only, where `front` and `back` each take all four fields.

**R17. Which unknown keys are refused on existing objects? (was Q17)**

- Decided: (b). The runtime refuses every unknown key, on new and on existing objects (F3).
- Reason: A typo of a new key gives a wrong program with no message. `tsc` does not report it on an inline `render()` argument (probe C19a). This holds because R24 says 0.1.0 is not published.
- Affects: F3, the refusal table, the existing `RenderState` and `PassTargets` objects and the whole-sentence typo tests (Rule 12.5). This departs from #204 slice 0(e), which carries the same work (D2).
- Not chosen: (a) refuse only the closed list of WebGPU spellings. (c) (a) plus a did-you-mean for a key within edit distance 2. (d) move (b) to slice 0(e).

**R18. Who retypes `depth.compare`? (was Q18)**

- Decided: (b). This record retypes `depth.compare` to `CompareFunction` now, with a CHANGELOG line. `SamplerOptions.compare` takes `CompareFunction` too. Its members do not change, but the export is reshaped.
- Reason: A typed field refuses a typo at compile time, and the runtime refuses it only at `render()`. A state hoisted without an annotation stops compiling (E20).
- Affects: the type of `depth.compare` and `SamplerOptions.compare`; the front matter `exports`; `src/__api__/surface.md:1406`; the `GPUCompareFunction` coverage row (`src/core/coverage/webgpu-enums.ts:140-149`); the Compatibility note. This departs from #204 slice 0(e) (D2).
- Not chosen: (a) slice 0(e) retypes `depth.compare` later. Its JSDoc says that the check runs at `render()`. (c) move the whole retype to slice 0(e), which drops `SamplerOptions` from `exports`.

**R19. Does the runtime clip a scissor rectangle to the attachment? (was Q19)**

- Decided: (a). The runtime clips a `Texture` target and a canvas target to the attachment before the call, so WebGPU receives the clipped rectangle. A host view passes through unclipped, and WebGPU validates it.
- Reason: For a `Texture` or a canvas, clipping is exact, because WebGL2 clips anyway (E4). The runtime cannot clip a host view, because it has no size. The zero-size result is open (O12).
- Affects: the scissor rule, the Playground helper (typeshade.github.io), O7 and O12. The O7 condition is item 6 of Approval and plan record.
- Not chosen: (b) refuse a rectangle outside the attachment, and add `pass.width`, `pass.height` and a no-argument reset. The size accessors and the reset are not in this record.

**R20. How does a WebGPU host learn what WebGL2 refuses? (was Q20)**

- Decided: (a). A CI recipe runs the host a second time with `createRuntime({ prefer: ['webgl2'] })`. The recipe appears in section 69 and in the JSDoc of the six fields that the WebGL2-only rows name.
- Reason: The refusals stand under every answer, and the recipe costs documentation only. A WebGPU-first host learns the six refusals on its first WebGL2 run.
- Affects: section 69, the JSDoc of the fields and Required validation. A strict mode is a follow-up in Order of work.
- Not chosen: (b) a runtime option that applies the WebGL2 refusals on the WebGPU tier, as its own proposal; (c) both.

**R21. Does the multisample mask accept a count other than 1? (was Q21)**

- Decided: (b). Both tiers refuse a `multisample.mask` with a count other than 1, by name.
- Reason: The record narrows first (F5). At count 1, bit 0 keeps or drops the draw (E13). No test in this record reads a multisampled target.
- Affects: the `multisample.mask` rows of the input, refusal and lowering tables; the field JSDoc; G1-23 and G1-24, whose count-above-1 case is a sub-gap.
- Not chosen: (a) WebGPU accepts a mask with any count, and WebGL2 keeps its refusal (`src/runtime/gl-draw.ts:795-798`). (c) move G1-23 and G1-24 to the later proposal, with cell totals of 64 and 10.

**R22. Does a pipeline carry the stencil reference? (was Q22)**

- Decided: (b). `depth.stencil.reference` is an optional whole number from 0 to 255. Before each draw of a pipeline that has `depth.stencil`, the runtime sets the reference. The value is the pipeline's own, or the pass value when the pipeline declares none. `pass.setStencilReference` sets the pass value, which is 0 at each pass start. Four rules apply:
  1. A draw of a pipeline with no `depth.stencil` makes no call.
  2. On a frame's pass, the runtime sets the reference before every such draw. It does not compare with the last value it set, because a `pass.raw` call can change the reference unseen.
  3. On a host's encoder (`RenderPipeline.draw` into a host pass), the runtime sets a declared reference and does not restore it. A later undeclared draw on that encoder gets the last value the host set. This is a stated limit.
  4. A declared reference wins for its draw. The next undeclared draw on a frame's pass gets the pass value again.
- Reason: The stencil test reads a value that lives on the pass, and no type links a pipeline to the call (inference). A shipped field cannot be removed without breaking (Rule 13.9), so the field is decided now.
- Affects: `StencilState`, F1, the stencil example, the reference row of the refusal table and the JSDoc of `setStencilReference` and `depth.stencil.reference`. X-GIS sets the reference per phase, to 0 or 1 (`map/src/render/render-phases/draw.ts:37`, `:400`; `map/src/render/vector-tile-renderer.ts:1409`, at `221e9ec4`).
- Not chosen: (a) pass methods only; (c) a per-draw argument.

**R23. Does a fraction in an integer input truncate, or is it refused? (was Q23)**

- Decided: (a). A fraction is refused on both tiers. The integer inputs are: the viewport position and size, the scissor, the stencil reference, clear value and masks, `multisample.mask`, `depth.bias.constant` and `depth.stencil.reference`.
- Reason: The tiers disagree on fractions. WebGL2 truncates a viewport fraction, and WebGPU rounds it (E3). A refusal removes the disagreement, and widening to truncation later is not breaking (F5).
- Affects: the input and refusal rows for the viewport, the scissor, the stencil reference and the bias; the scissored example; O19.
- Not chosen: (b) accept a fraction in the scissor and the stencil reference, and truncate it after a measure on each tier (O19).

**R24. Is typeshade 0.1.0 published? (was Q24)**

- Decided: typeshade 0.1.0 is not published. The owner answered this question one by one.
- Reason: The npm registry lists only the `0.0.0` placeholder, and the repository has no 0.1.0 tag or release. #204 and #335 agree. The date in `CHANGELOG.md:1173` is an entry date, not a release.
- Affects: R4, R17, R18, R21, R23 (the widening rule), the Compatibility note and the two-step rule (Rule 13.10) that a published narrowing would need.
- Not chosen: (b) published. Then R17 (c) and R18 (a) apply, and each narrowing takes the two steps of Rule 13.10.

**R25. How are the render-state objects grouped? (was Q25)**

- Decided: (a). The fields group as drafted: `depth.stencil` and `depth.bias`.
- Reason: The format already lives in `depth`, and the grouping mirrors WebGPU's single `depthStencil`. One object gives F3 one key list per object. A later stencil-only pipeline reads `depth: { format: 'stencil8', stencil }`, a cost that the later proposal owns (inference).
- Affects: the `RenderState` shape, the F3 key lists, the JSDoc rule of F8, the examples and the documentation table.
- Not chosen: (b) flat fields on `depth`, such as `depth.stencilFront`; (c) a top-level `stencil` beside `depth`, with `bias` inside `depth`.

**R26. What shape does the stencil object take on a depth attachment? (was Q26)**

- Decided: (b). A nested `stencil` object sits on the attachment, as `{ clear, load, store, readOnly }`, the same noun as `depth.stencil`. An omitted `stencil` follows the depth aspect as a whole. A `stencil` object that sets some fields follows the depth aspect for each field it omits (R13).
- Reason: One noun names the stencil state at both sites. The flat form gave `tsc` no pointer to the right key (TS2353, probe C18). `stencil: { readOnly: false }` differs from `stencil: {}`, and the documentation says so.
- Affects: the `DepthAttachment` type, the Defaults paragraph and the refusal rows for stencil fields. It also affects the F3 key list and the lowering rows for `readOnly` and the stencil fields.
- Not chosen: (a) four prefixed fields on the attachment: `stencilClear`, `stencilLoad`, `stencilStore` and `stencilReadOnly`.

**R27. Does the blend constant take a tuple or an `ArrayLike`? (was Q27)**

- Decided: (b). `setBlendConstant` takes `ArrayLike<number>`, and F1 checks the length. The `clear` of `PassTargets.color` stays a readonly tuple, as it is today.
- Reason: A tuple adds compile-time rejection and no soundness, because F1 checks the length at run time anyway. WebGPU's `GPUColor` takes an iterable (`@webgpu/types` 0.1.74, `dist/index.d.ts:160-163`).
- Affects: the signature of `setBlendConstant`, F1, the input row for the blend constant and the length tests. The pipeline field of R32 takes the same type.
- Not chosen: (a) a readonly tuple, as before this revision; (c) `ArrayLike` for the `clear` of `PassTargets.color` too. Option (c) is a later amendment, and it widens without breaking.

**R28. Does `radiance` join `DOWNSTREAM_REPOS`, and where does `WEBGPU_CALL` live? (was Q28)**

- Decided: (a). `radiance` joins `DOWNSTREAM_REPOS` in a separate change to `scripts/changes.ts`. The `WEBGPU_CALL` pattern moves into one module that the compiler owns. Radiance imports that module through its `vendor/typeshade` pin.
- Reason: Two copies of one pattern drift apart. Only a listed downstream repository gets the check (O15).
- Affects: the `downstream` front matter, the copy of `WEBGPU_CALL` in radiance (`scripts/boundary.mjs:25-26`), `scripts/changes.ts`, `journeys/_harness.mjs:173` and the boundary item of Required validation.
- Not chosen: (b) radiance stays outside the list. Its own pull request then removes the two names after its pin moves. (c) the pattern stays in both places, with a comment that names both.

**R29. When is the stale sentence in `references/host.md` corrected? (was Q29)** <!-- doc-refs: skip — a path of another repository, which this tree does not have -->

- Decided: (b). A separate pull request of vscode-typeshade corrects the sentence before this record is implemented.
- Reason: The sentence is wrong now, and its correction does not depend on 0064.
- Affects: `references/host.md` in vscode-typeshade (line 181, O16) and the downstream list. <!-- doc-refs: skip — a path of another repository, which this tree does not have -->
- Not chosen: (a) in this proposal's implementing pull requests; (c) at a time the owner chooses, in a separate pull request.

**R30. In which order do PR-1, PR-2 and PR-3 land? (was Q30)**

- Decided: (a). The dependency order applies: PR-1, then PR-2, then PR-3.
- Reason: F1 is the base of each later pull request, so it lands first. A usage order would move only the stencil and bias cells earlier in the merge sequence.
- Affects: Order of work and the pull request table.
- Not chosen: (b) usage order, with the stencil and bias pull request first. F1 would move into that pull request.

**R31. Which proposal takes G1-29, G1-30, G1-57 and G1-58? (was Q31)**

- Decided: (a). These four cells stay outside both proposals, with their status unchanged, until a request names them.
- Reason: No request names the four cells. Each waits for a request, as the other gap cells do.
- Affects: the cell map totals (66, 8 and 4 make 78), the Scope section and the open items.
- Not chosen: (b) the later proposal takes G1-57 and G1-58; (c) a third proposal takes all four.

**R32. Where does the blend constant live? (was Q32)**

- Decided: (c). The blend constant is both a pass method and a pipeline field. `RenderState.blendConstant` sets the constant for the pipeline's draws, under the precedence of R22. A draw whose pipeline declares `blendConstant` sets that value. Before a draw whose pipeline declares no `blendConstant`, and that follows a draw that declared one, the runtime sets the pass value again (WebGPU `setBlendConstant`, WebGL2 `blendColor`). This is the rule that R22 rule 4 states for the stencil reference.
- Reason: A pipeline that declares its stencil reference should declare its blend constant the same way. Without a pipeline field, a forgotten call gives no diagnostic (inference).
- Affects: the `RenderState` sketch, F1, the blend rows of the input, refusal and lowering tables, and the JSDoc of `TargetState`. The `RenderPipeline` key includes `blendConstant`, and the GPU pipeline key excludes it. G1-05, G1-06, G1-69 and G1-70 gain tests. No cell is added.
- Not chosen: (a) a pass method only; (b) a pipeline field only.

**R33. Do the rectangle calls also take an object? (was Q33)**

- Decided: (a). `setViewport` and `setScissorRect` take positional numbers only.
- Reason: An object form is additive, so it can follow without breaking a caller (F5). A host with a `DOMRect` passes four rounded numbers (R23).
- Affects: the signatures of `setViewport` and `setScissorRect` and the scissored example.
- Not chosen: (b) an object form, `{ x, y, width, height }`, for both calls, with the same refusals for each field.

**R34. Does each draw own its depth bias and polygon offset? (was Q34)**

- Decided: (a). Each draw sets its bias, polygon offset and stencil state from its pipeline.
- Reason: R24 says no version is published, so the narrowing costs nothing now, and Rule 13.9 applies once a version is published. Option (b) would make pixels depend on host state, which F4 does not allow.
- Affects: the pass procedure notes, G1-18, G1-20, G1-22 and G1-76, R4 and the Compatibility note.
- Not chosen: (b) a draw sets the offset only when its pipeline declares a bias. (c) refuse `depth.bias` on WebGL2 by name, until a design gives the runtime the offset. Under (c), those four cells are `refused`.

**R35. What does a clear with `load` `'load'` do? (was Q35)**

- Decided: (a) for colour and depth, and (c) for stencil. A colour or depth clear with `load: 'load'` is accepted and ignored, as WebGPU does. A stencil clear is refused only when its stencil load is inherited from a depth `load` of `'load'`. An explicit stencil `load: 'load'` with a clear is accepted and ignored.
- Reason: Option (a) matches WebGPU. Option (c) refuses only the case where the host did not write the load that voids the clear.
- Affects: F3 (it has no clear rule), the stencil refusal row, the Compatibility note and R13. The depth clear range is checked whatever the load (the input table). Accepted cost: `depth: { target, clear: 0, load: i === 0 ? 'clear' : 'load', stencil: { clear: 0 } }` passes at frame 1 and throws a `TypeError` at frame 2. Only option (d) removes that, and it changes the default of R13.
- Not chosen: (b) refuse a clear with `load: 'load'` on colour, depth and stencil. (d) the clear wins: an inherited stencil load becomes `'clear'` when the stencil has a clear.

**R36. Do the read-only arms keep their message literals? (was Q36)**

- Decided: (b). The read-only arms of `DepthAspect` and `StencilAspect` take `clear?: never`, `load?: never` and `store?: never`, with a JSDoc line.
- Reason: A number then reports `Type 'number' is not assignable to type 'undefined'`, and completion offers only the keys that the arm takes. A `boolean` `readOnly` with a clear still fails (type probe T4).
- Affects: the `DepthAspect` and `StencilAspect` types, the Type half of Required validation, and probes C3, C4, C9 to C11 and T1 to T4. It also affects the diagnostics sentence of R26.
- Not chosen: (a) keep the message literals; (c) a plain `readOnly?: boolean`, with the runtime refusal only.

**R37. Does the colour entry's object member narrow? (was Q37)**

- Decided: (b). The object member of a colour entry narrows to `object & { readonly target?: never }`.
- Reason: The depth attachment is fully typed, and the colour entry should match. Otherwise the new `store` field is the first hole in the entry. `tsc` is where an author first sees a typo (probes C14 to C16).
- Affects: the colour entry type in `PassTargets` (`src/runtime/runtime.ts:89-98`), the Type-half tests, F3 and the Compatibility note. A host object with its own `target` property stops compiling. This departs from #204 slice 0(e) (D2).
- Not chosen: (a) keep the object member. Key typos then compile, and the runtime refuses them (F1, F3).

**R38. Does acceptance wait for O3? (was O21)**

- Decided: Acceptance does not wait for O3. Until O3 reports, the WebGL2 depth-bias cells are refused with a `TypeError`, as R11 says. The refused cases are a non-zero clamp, a non-zero slope scale, and a bias on a format other than `depth32float`. A constant bias on `depth32float` stays taken.
- Reason: A narrower field is not breaking, and widening after O3 is not breaking (R11, F5).
- Source: The owner, in the conversation, on 2026-10-13 (Asia/Seoul), in question-and-answer form.
- Affects: R10, R11, item 10 of Approval and plan record, cells G1-18 and G1-76 of the cell map, and the forecast totals.
- Not chosen: Hold acceptance until O3 reports (R10 (b)).
- Amendment A1 (2026-10-19). The decided text above stands as the record of 2026-10-13. The owner's go-ahead in the conversation, on 2026-10-19, changes the disposition. WebGL2 accepts depth bias, within the bound of F4, and no longer refuses it. Reason: O3 reported on 2026-10-19 (Open items). The WebGL2 slope-scale refusal and the format refusal for `depth24plus` no longer apply. The clamp refusal applies only without `EXT_polygon_offset_clamp`. The refusal for a format that O3 did not measure stays.

**R39. Are the current names kept? (was O22)**

- Decided: Keep the current names, including `depth.bias.constant`. The stencil faces take WebGPU's `GPUStencilFaceState` names: `compare`, `failOp`, `depthFailOp` and `passOp`. The attachment fields follow the existing `PassTargets` pattern: `load`, `clear` and `store`. Section 69 gets a table of the WebGPU names.
- Reason: The stencil face names match WebGPU, so a search by each name finds its field (F8). The attachment fields match the names that `PassTargets` already uses.
- Source: The owner, in the conversation, on 2026-10-13 (Asia/Seoul), in question-and-answer form.
- Affects: the field names in the input, refusal and lowering tables, and the documentation table of section 69 (What it touches), which lists each WebGPU name.
- Not chosen: A naming rule that drops the `Op` suffix from `failOp`, `depthFailOp` and `passOp`, as `load` and `store` do.

**R40. Is `label` a supported field? (was O23)**

- Decided: `label` is not a supported field. It gets the generic refusal of R17, "does not take", like any other unknown key.
- Reason: R17 (b) refuses every key that the runtime does not read, and `label` is such a key.
- Source: The owner, in the conversation, on 2026-10-13 (Asia/Seoul), in question-and-answer form.
- Affects: the refusal table (its `label` row) and the typo tests of Required validation.
- Not chosen: A supported `label` field, and a sentence of its own for `label`.

## What it touches

- `rules: '11.11'`: Rule 11.11 gains the WebGL2 refusals of the lowering table and the pass-start convention of the WebGL2 tier (R4). The rule text is `docs/language-design.md:1249`. Rule 11.22 is not written (R8). A rule edit needs `bun run reqs:sync`, then `doorstop -C`, and the review that `reqs/README.md` describes. <!-- doc-refs: skip — Rules 11.21 and 11.22 are not written at 196b5d70 (R8) -->
- `surface: 69`: section 69 of `docs/use-typeshade-surface.md`. The paragraphs on the WebGL2 refusals, on `RenderState`, on `Frame` and the pass, and on the defaults and examples change. The new examples are a stencil outline, a decal, a scissored UI pass and a discarded depth. Every code fragment must compile (Rule 13.8).
- `Program.render` JSDoc (`src/runtime/program.ts:189-191`) gains the reference rule of R22 and the blend-constant rule of R32. The identity tests of `src/runtime/runtime.test.ts:690-705` keep holding, because identical states still return one object. Section 69 says that `render` resolves to cached pipelines (`docs/use-typeshade-surface.md:7971`) and that the same values give the same pipeline back (`:7987`). Both sentences are rewritten to name the wrapper and the GPU pipeline. A difference in the reference or in the blend constant alone gives a new wrapper over one GPU pipeline.
- The documentation table: a table in section 69 of `docs/use-typeshade-surface.md`, with the columns WebGPU name, TypeShade name and the tiers that refuse it. It holds one row per new field, method and type, and one row per existing field that gains a WebGPU name (F8). Each implementing pull request adds the rows of its cells. PR-1 holds three of the four pass methods and the blend constant field. PR-2 holds `setStencilReference`, the reference field and the other pipeline fields. PR-3 holds the attachment fields. The section 69 prose and the examples follow the same split.
- `exports: RenderState, PassTargets, RenderPass`: these three change shape (`src/__api__/surface.md` lines 1404, 1411 and 1412). Run `bun run bake:api-surface` and read the diff (Rule 11.6). JSDoc is required on each new export, because `src/api-doc-coverage.test.ts` checks the module exports (`:199-201`, `:229`). Member JSDoc is a convention of F8. No test checks it.
- `exports: CompareFunction, StencilOperation, StencilFaceState, StencilState, DepthAttachment`: new type-only names. Add them to the explicit list in `src/runtime.ts`. A host needs them to name a state held in a variable. Without them a literal widens to `string`, and `tsc` refuses it. `StencilState` is exported because a host hoists a stencil test on its own. `DepthAttachment` gives the attachment one name, so hover and errors print that name.
- Export rule: `TargetState` (`src/runtime.ts:9-27`) is not exported today. A colour entry and a stencil attachment object have no exported name. A host reaches them through `PassTargets` and `DepthAttachment['stencil']`, which gives the same types without a new export.
- `DepthAspect` and `StencilAspect` are not exported by name. They are written in `src/runtime/runtime.ts` and shape the exported `DepthAttachment`. `StencilAspect` is the type of the `stencil` object (R26).
- `exports: SamplerOptions`: a reshaped export. Its baked line (`src/__api__/surface.md:1406`) changes from the inline eight-member union to `compare?: CompareFunction` (R18). The member set does not change, but the export is reshaped. `scripts/changes.ts` counts a reshaped export as touched, so this record declares it in `exports`. Without that declaration, the implementing pull request fails `scripts/changes.ts`.
- `exports-removed: []`: nothing is removed. `RenderPass.raw` and `Runtime.device` stay (Rule 11.17).
- `codes: []`: the refusals are `TypeError` messages. They have no diagnostic code. Rule 12.5 pins each sentence in a test.
- `examples: []`: no file under `examples/*.shade.ts` changes. The new examples are prose in section 69.
- `downstream`: two entries, described in "What it owes downstream".

### Required validation at implementation

Functional validation (each implementing pull request):

- WebGPU unit tests: `src/runtime/runtime.test.ts`. The fake device returns one shared pass object and drops the attachment descriptors (`runtime.test.ts:154-159`, `:479-496`). Extend the fake to record each `beginRenderPass` descriptor and each pass call.
- WebGL2 unit tests: `src/runtime/gl-draw.test.ts`. The proxy GL gives each unnamed constant the value `0x1000 + key.length` (`gl-draw.test.ts:62`). So `KEEP`, `ZERO`, `INCR` and `DECR` share one value. Give each constant its real value, or a value distinct for each name. Make `getShaderParameter` and `getProgramParameter` return true, so `render()` runs. Assert the recorded call order.
- Instrument proof: before the stencil tests are trusted, a draft that swaps two stencil operations must fail a test. A draft that swaps two compare functions must fail a test too.
- Parity matrix: `src/runtime/render-state-parity.test.ts` (new). It holds one row per field: the WebGPU descriptor, the WebGL2 calls and the refusal. The stencil row asserts all eight operations and all eight compare functions by name. A new field without a row fails. This follows the stray-row check in `src/core/spec-conformance/capability-coverage.test.ts`. The row of G1-19 and the row of G1-21 assert the WebGPU descriptor values (`depthBiasSlopeScale`, `depthBiasClamp`). G1-21 has no frame, because WebGL2 refuses the clamp. <!-- doc-refs: skip — the test file is written by an implementing pull request -->
- Refusals: each sentence of the refusal table is asserted whole (Rule 12.5), on the tier that refuses it, including the rows added in this revision. The typos `bais`, `stencl`, `maks` and `stor`, and the key `label` (R40), are refused on existing objects under R17, each with a whole-sentence test. A type test shows that `tsc` does not report them on an inline `render()` argument, so no one assumes it does.
- Type half: a type test uses `@ts-expect-error` probes, as `src/core/ir/ir.test.ts` does. A stale directive fails `bun run build`, and `src/AGENTS.md:198-199` requires each directive to fail on the line it names. The probes pin these refusals: the read-only arm (R36; C3, C4 and T4), a `CompareFunction` typo, and a stray key beside `readOnly: true` (C9). The colour entry's `store`, `load` and `clear` typos are pinned too (R37; probes C14 and C15). A test that expects no error pins what compiles. It covers a boolean `readOnly` alone (probes C1, C2, C5 and C6), and `setBlendConstant` with a `number[]` or a `Float32Array` (R27). Another test hoists a stencil mode with the exported `StencilState` name, and another hoists it with `as const`.
- Pass fit (F6): one bad pair of pipeline and pass is drawn through `RenderPass.draw` and through `RenderPipeline.draw` into a frame's pass. Both give the same refusal (R9). Add a stencil-writing pipeline on a pass whose stencil aspect is read-only (F6(c)).
- Mask count: a mask with count 4 is refused on both tiers, with the whole sentence (R21).
- Stencil reference (R22): a declared draw, then an undeclared draw, in one frame pass, on both tiers. WebGPU keeps the value between draws.
- Stencil reference, further cases: a pipeline with no `depth.stencil` after `pass.setStencilReference(2)` makes no call, so the value stays on the encoder. `pass.setStencilReference(2)` then a draw of a pipeline with `reference: 1` gives 1. A `RenderPipeline.draw` into a host pass sets the declared reference and does not restore it. A `pass.raw.setStencilReference(7)` call between two draws of one pipeline does not leave a stale reference. Each case is a test of the recorded calls, and the frames assert the pixels.
- Blend constant (R32): a draw of a pipeline with `blendConstant`, then an undeclared draw in the same pass, on both tiers. The recorded calls assert that the undeclared draw gets the pass value again before it (`setBlendConstant` on WebGPU, `blendColor` on WebGL2). The frames assert the pixels.
- Identity (F1): two identical `render()` states return the identical object (`toBe`, as `runtime.test.ts:684-699` asserts). Two spellings of one state, with a default written and omitted, return the identical object, with one GPU pipeline created. Two states that differ only in the reference, or only in the blend constant, return two `RenderPipeline` objects (`not.toBe`) over one GPU pipeline. On WebGPU, one `createRenderPipeline` call creates that pipeline. On WebGL2, one `compile()` and one `WebGLProgram` link build it (`src/runtime/gl-draw.ts:805`).
- Viewport defaults: `setViewport` with no `minDepth` and `maxDepth` draws to depths 0 to 1, on both tiers.
- Pixels on both tiers: `scripts/render-case.ts` (`FRAMES`) and `scripts/compile-gate.ts` (`renderVerdicts`, which runs WebGPU and WebGL2). The `reference()` function in `scripts/render-case.ts` models only `greater` and `always` compares, and colour and depth. It must be extended before a stencil frame can be read (owed work). Each frame has a control arm, with the tested state removed. The control must differ from the frame under test.
- Frames owed:
  - stencil: eight operations against eight compare functions (O2).
  - stencil faces: a counter-clockwise triangle, a clockwise triangle, a line and a point (E2).
  - `readMask` and `writeMask`: a mask of 0x105 gives 5 on both tiers, with the low 8 bits kept (R15).
  - `readMask`: a stored 16 and a reference of 0 pass `equal` with read mask 0x0F and with 0x105, and fail with 0xFF, on both tiers.
  - `stencil.clear`: a non-zero value, such as 7 (E11).
  - `stencil.load: 'load'` across two passes.
  - a read-only stencil: pass 1 writes stencil 1. Pass 2 has a read-only stencil aspect and a pipeline with compare `equal` and reference 1, and it must draw where pass 1 wrote. The control arm has `stencil.readOnly` false and load `'clear'`, and it must not draw there.
  - the depth bias (E5, amendment A1). The bound tests follow. A frame renders the same triangles on both tiers. The sloped-triangle frame for the WebGPU sign of `slopeScale` (G1-19) does not wait for the bound tests.
    - Direction. For each window depth 0.25, 0.5 and 0.75 and each accepted format (`depth24plus`, `depth32float`), a frame shows that the bias moves the depth in the right direction. A biased draw with a negative constant wins a coplanar depth test. Draws with a constant of 0 and a positive constant lose it. Both tiers run the frame.
    - Bound, window depths 0.25 and above. For the same depths and formats, a frame finds the smallest constant that passes a depth test separation on each tier. Let T be that constant on WebGPU and T' that constant on WebGL2. The test asserts T/2 <= T' <= T, which puts the WebGL2 offset within [1x, 2x] of the WebGPU offset (F4). O3 measured 8193 and 4097 at 0.25, and 4097 on both tiers at 0.5 and 0.75.
    - Bound, below window depth 0.25. The same frames run at 0.0625 and 0.125 and record the ratio T/T'. The test asserts the measured bound, not 2x. This record states the measured ratio. If the ratio exceeds 2, the JSDoc and surface §69 state the measured bound and its depth range.
    - `depth24plus-stencil8`. The same frames run on `depth24plus-stencil8` at every depth above and on both tiers. The test asserts that its thresholds equal those of `depth24plus`. A bias on that format stays refused until the test passes.
    - Slope. The same frames find the smallest `slopeScale` that passes. The test asserts that the two tiers give the same threshold, which O3 measured as 0.3125.
    - Format refusal. A bias on `depth16unorm` is refused on WebGL2, and the test asserts the whole sentence (Rule 12.5): `The render pipeline of "fs" sets depth.bias.constant on depth16unorm; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.` A constant and a slope scale each have their own sentence. The slope sentence is `... sets depth.bias.slopeScale to 2 on depth16unorm; ...`, with the same tail.
    - Clamp refusal. On a WebGL2 context whose `getExtension('EXT_polygon_offset_clamp')` returns null, a non-zero clamp throws a `TypeError`. The test asserts the whole sentence: `The render pipeline of "fs" sets depth.bias.clamp to 0.5; the WebGL2 tier takes a non-zero clamp only through EXT_polygon_offset_clamp, and this context lacks it.` A unit test fakes the missing extension. A second unit test counts the requests: the fake context counts `getExtension('EXT_polygon_offset_clamp')`, two biased pipelines are built, and the count is 1 (A1, requested once).
    - [proposal] Clamp frame. Where the context exposes the extension, a frame shows that a clamp limits the offset, with a control arm that has no clamp. The frame does not run on a context without the extension, and the run reports that it did not run. PR-2 A1 names this frame the run `bias-clamp` of `journeys/pipeline-state/journey.mjs`: a red cell with clamp -1e-6 and a green control cell with no clamp, on depth24plus. Its WebGL2 leg reports "not run" when the context lacks `EXT_polygon_offset_clamp`. Ignoring the clamp at draw on WebGL2 fails the run.
  - the depth range (E5);
  - the viewport and the scissor on an off-centre, non-square rectangle, so that a flipped y shows (texture row 0 is the top row, Rule 11.11);
  - a canvas target: the viewport, the scissor and the blit-out on a canvas (O7);
  - the blend constant;
  - the sample mask at count 1, with masks 0, 1, 2 and all ones (E13);
  - store `'discard'` on a colour target with a partial colour write mask, and on an integer colour target (the `clearBufferuiv` branch);
  - store `'discard'` after a pipeline with `depth.write: false` and a partial stencil write mask has drawn. Depth is read back on `depth32float` only (E16). The stencil discard is observed by a later pass whose stencil test reads it, with a control arm (O8);
  - mixed passes: a biased draw, then a plain draw;
  - mixed passes: a stencil draw, a stencil-tested draw and a plain draw;
  - mixed passes: a masked draw, then an unmasked draw;
  - the pass-start state across two passes (R4): a host value set on `Runtime.device` before `submit()` is overridden inside the pass, and restored after it;
  - read-only passes: depth unchanged after the pass, and a writing pipeline refused (F6);
  - refusal tests for a fraction in the viewport, the scissor and the stencil reference (R23);
  - an oversized scissor: a rectangle that extends past a `Texture` attachment is clipped on both tiers (R19);
  - viewport extremes: `x = -2L` and `x + width = 2L - 1` on both tiers (E19 bounds). E3 measured WebGL2 near the attachment only.
- A `stencil8` format is refused on both tiers (F7). The refusal test asserts the whole sentence.
- Journeys: `journeys/_harness.mjs` runs the WebGL2 pass only when `run.console` and `run.scissor` are both undefined (line 671), so a run that sets a scissor skips WebGL2. Remove the clause `run.scissor === undefined` in the same pull request, so that the condition reads `run.console === undefined`. Update the comment at lines 665 to 669 in the same pull request: it describes a raw scissor as WebGPU's alone. The scissor runs then reach WebGL2, because the call is typed (line 357 calls `p.raw.setScissorRect` today and moves to the typed call). Add a scissor run with no `console` and an asymmetric rectangle. The two existing scissor runs (`journeys/console-draw/journey.mjs:61` and `:81`) set `console` and stay WebGPU-only.
- Boundary (R28 (a)): move `WEBGPU_CALL` into one module that the compiler owns, and remove `setScissorRect` and `setViewport` from it (`journeys/_harness.mjs:173-174`). `setBlendConstant` and `setStencilReference` are not in the pattern. Keep `raw` and `GPU[A-Z]`. Radiance imports that module through its pin, in radiance's own pull request. `scripts/changes.ts` lists radiance (O15). Add a compiler test that feeds `engineOffence` each `RenderPass` method name from `src/__api__/surface.md`.
- Coverage evidence: the `GPUCompareFunction` row (`src/core/coverage/webgpu-enums.ts:140-149`) names `SamplerOptions.compare` as the second site of the one concept (R18).
- Gates: `bun run build`, `bun run test`, `bun run gate:compile` on both tiers, `bun run gate:journeys`, `bun run gate:boundary` and `bun run format:check`.

Document validation (each implementing pull request):

- `bun run docs:impact`: every must-fix item is fixed, and every review item is read.
- `bun run docs:refs`.
- `bun run bake:api-surface`, with each diff read (Rule 11.6). The API diff includes `SamplerOptions` (`src/__api__/surface.md:1406`). `bun run bake:capability-coverage`, with each diff read (Rules 11.14 to 11.18 and Appendix C).
- `webgl2Only: { door: 'none' }` on G1-60 only, with the rule number in its `n/a` reason (R7). G1-78 belongs to the later proposal, which sets the flag on its own cell. G1-62 does not get it, because its WebGL2 cell is typed.
- Each implementing pull request re-points every coverage citation of a runtime line that it moved. The citations are in `src/core/coverage/*.ts`. The pull request lists each one in its description. The evidence check (`src/core/spec-conformance/capability-coverage.test.ts:363`) proves only that a cited line exists. So a shifted line stays green.
- `bun run reqs:sync` and `doorstop -C` when Rule 11.11 changes.
- The section 69 code fragments compile (Rule 13.8).
- The `CHANGELOG.md` entry under `[Unreleased]`, in the house style of the runtime entries.
- A test name for each `typed` cell, and a rule and a spelling for each `refused` cell (Rule 11.18). The sub-gap labels of the cell map name each typed cell's refusal.
- `bun run changes:check` after the first commit exists. Before that commit, the check reads no diff and proves nothing.

### Draft impact estimate

- Known: 66 cells in this record, 8 in the later proposal and 4 outside both (the cell map). New names: 33, counting object names. They are 16 render-state names: the `bias`, `stencil` and `mask` fields, `blendConstant`, and their children, including `reference`. They are 8 attachment names: the colour `store`, the depth `store`, `readOnly`, `stencil`, and the four children of `stencil` (`clear`, `load`, `store` and `readOnly`). The rest are 4 pass methods and 5 type exports. The count follows R26, R32 and R33. Two tiers need checks and lowering. The WebGL2 pass procedure is rewritten.
- Estimated: the bundle grows by about 3,375 B, from a prototype attached to PR #646 (R12, E18, O17). The tree does not hold that number.
- Compatibility: see the Compatibility note below.
- Raw cells: seven WebGL2 cells that were `raw` change status in this record (R4, R34), and two change in the later proposal.
- Effort and dates: unknown. Not estimated. No milestone is set.
- Decisions: settled in Decisions. The acceptance conditions are listed in Approval and plan record.

Compatibility note.

- A program that sets no new field, no GL state through `Runtime.device`, and no format that F7 refuses, keeps its WebGPU descriptor and its pixels. The exceptions are the bullets below.
- The WebGL2 GL calls change in three places, with the same pixels. The scissor disable moves before the blit-in (E4). A clear of depth and stencil becomes two calls (E11). Each pass sets its start state (R4).
- After each runtime pass, the scissor test is off, and the colour, depth and stencil write masks are full (R4, steps 14 and 15). Today the colour and depth masks keep the last draw's values (`src/runtime/gl-draw.ts:1289` and `:1303`). A host that reads these after a pass sees the change. STENCIL_TEST, the stencil functions, operations and reference, and the polygon offset stay as the last draw set them (R4).
- A combined-format pass that failed at `submit()` now runs (E1). That makes a failing program work, so it is not breaking.
- Under R4, a host value set through `Runtime.device` is overridden inside each runtime pass. This holds for the viewport, the depth range and the blend constant (G1-06, G1-64 and G1-70). Under R4 (a), those three values return to the host after the pass.
- Each runtime draw sets the GL state of its pipeline. So a host value for the depth bias or the polygon offset does not reach a draw (G1-18, G1-20, G1-22 and G1-76). Together with the three pass-state cells of R4 (G1-06, G1-64 and G1-70), these four cells narrow the Rule 11.17 hatch (R34). Once a version is published, Rule 13.9 counts that as breaking.
- A depth clear outside 0 to 1 is refused on both tiers. WebGPU rejects it only with load `'clear'`, and WebGL2 clamps it today (inference, ES 3.00 clear rules). Both tiers narrow (R5, R24).
- A program that still compiles and computes something else falls under Rule 13.10. That rule needs two steps: a deprecation warning in a published release, then the change in a later one.
- Under R17, a program with an extra key on any object is refused. That is breaking once a version is published. Under R35 (a), a clear with `load: 'load'` on colour or depth still compiles and is ignored. Under R35 (c), a stencil clear whose stencil load is inherited is refused. Each refusal is breaking once a version is published.
- Under R18, a typo of `depth.compare` stops compiling under `tsc`, and so does a state hoisted without an annotation (E20). The runtime already refuses the typo through F1. Hosts annotate with `RenderState`, write `satisfies RenderState` or use `as const`. A CHANGELOG line names the change.
- Under R37, a host object with its own `target` property takes the typed colour arm, and a typo in a colour entry stops compiling. That is breaking for typed hosts once a version is published.
- Under R21, a mask with a count other than 1 is refused on WebGPU too. No X-GIS code uses a sample mask (usage evidence).
- Under R23, a fractional scissor or stencil reference is refused. That is a new refusal of a call that is raw today, so it breaks no typed program.
- Under F7, `depth.format: 'stencil8'` is refused on both tiers. WebGPU accepts such a state when depth writing is off and the compare is `always` (gpuweb spec copy, lines 9641 to 9644). This narrows a WebGPU input under R5 (a), so it is breaking once published (Rule 13.9).
- Whether 0.1.0 is published is R24: it is not.
- [proposal] `render()` identity. Today the key is the raw state JSON (`src/runtime/program.ts:655`), with the constants normalised. So a written default and an omitted one give two objects today. Under F1 they give one identical `RenderPipeline`. A state that differs only in the reference or the blend constant gives a new `RenderPipeline` over the same GPU pipeline (R22, R32). The identity tests (`src/runtime/runtime.test.ts:690-705`) keep holding. Section 69 (`docs/use-typeshade-surface.md:7971` and `:7987`) is rewritten to name the wrapper and the GPU pipeline. That is a documentation change.
- `RenderPass` gains four methods. A host object shaped like `RenderPass` sees a type error. `setBlendConstant` takes an `ArrayLike` under R27 (b), which widens its input.
- `readOnly` and `stencil.readOnly` take `true` or `false`. A boolean variable alone compiles (probes C1, C2, C5 and C6). A boolean with `clear`, `load` or `store` does not (probe C3, R36). Both fields are new, so no published program holds one.

### Approval and plan record

Owner decision record, 2026-10-13 (Asia/Seoul). The proposed answer of R1 to R37 is adopted, and R38 to R40 are decided (see Decisions). R1, R2, R6 and R24 were answered one by one. The decisions settle the content only. Acceptance still needs the owner's merge.

Acceptance, 2026-10-13. The owner approved the proposal in the conversation and said to merge PR #646. Each item below is either done or accepted as open by the owner at that approval. The status of each item follows the list, in Status of the acceptance items.

The items as drafted. Acceptance required each one, done or accepted as open.

Items that need no device. Items 3 to 6 are measures that this environment can run on SwiftShader. Item 2 needs network access to the gpuweb repository. Items 1 and 7 to 11 are records, filings and decisions:

1. The owner's go-ahead in the conversation to merge the proposal pull request (`CLAUDE.md`, Merging). The pull request number is recorded here at acceptance. The merge commit is recorded in the Configuration and validation record, by PR-1.
2. O13: the recorded gpuweb commit of each WebGPU statement. This item needs network access to the gpuweb repository.
3. O2: stencil operations, eight against eight compare functions, as frames (R11). It gates the WebGL2 stencil cells.
4. O3: the bias unit for `depth16unorm` and `depth24plus`, for a non-zero slope, and at window depths other than 0.5. It gates the widening of the WebGL2 bias cells, so acceptance may carry it as open (R10, R11, R38).
5. O8: the stencil discard, observed through a later pass, with a control arm (R11).
6. O7: the viewport, the scissor and the blit-out on a canvas target, on both tiers (R19).
7. O17: the probe sources, outputs and commit of each run, attached to the proposal pull request, with the type probes.
8. O18 and O20: the group-6 issue and the group-1 issue, filed on typeshade/typeshade, with their numbers recorded here. The group-1 issue promises no more about `store: 'discard'` than R6 decides.
9. O15: the change to `scripts/changes.ts` that lists radiance (R28), opened as its own pull request, or recorded as pending.
10. R38 applies: acceptance does not wait for O3. Until O3 reports, the WebGL2 depth-bias cells are refused with a `TypeError`, as R11 says.
11. Other open items (O6, O9 to O12, O16, O19): done, or accepted as open.

Items that need a device. The owner or a contributor with the device runs each one:

12. O1: the probes of O17 on a desktop GPU and a tile-based or integrated GPU. Needs a device: the owner or a contributor with the device runs it. The run also gives the discard clear cost (R6), which goes into the JSDoc of `store`.
13. O4: the hardware exposure of `EXT_polygon_offset_clamp` (R11). Needs a device: the owner or a contributor with the device runs it.

O5 and O14 are not in these lists. O5 has the later proposal as its owner, and it gates that proposal (R11). O14 needs a second WebGPU implementation. At acceptance, O14 is either done or accepted as open by the owner.

Procedure for the device runs (O1 and O4). The owner or a contributor with the device runs these steps:

1. Check out the commit that the O17 attachment names.
2. Run `bun install` in the repository root.
3. Open the probe page of O17 in desktop Chrome, with WebGPU and WebGL2 enabled, on a discrete GPU.
4. Record the browser version, the operating system, and the GPU and driver that `chrome://gpu` shows.
5. Run the probes E1 to E18, and record each printed output.
6. Run `gl.getExtension('EXT_polygon_offset_clamp')` on a WebGL2 context, and record whether it returns an object (O4).
7. Repeat steps 3 to 6 on an integrated GPU, then on a tile-based mobile GPU with Chrome for Android.
8. On each machine, time one draw with `store: 'discard'` and with `store: 'store'`, on WebGL2. Use 60 warm-up frames, then 600 timed frames per arm. Record the mean frame time of each arm (O1, R6).
9. Compare each result with its SwiftShader result. Record each pixel difference as a deviation, on the pull request.
10. Record each result with its device, browser, driver and commit in the Configuration and validation record. Attach the timing output to the pull request.

If a device result changes a cell status, the owner decides that status before acceptance (R11).

Status of the acceptance items (2026-10-13, at the approval):

1. Done. The owner's go-ahead in the conversation, 2026-10-13. The proposal pull request is PR #646, merge commit `499a95d2`, recorded in the Configuration and validation record by PR-1.
2. O13: open, accepted as open. The gpuweb commit of each WebGPU statement is not recorded.
3. O2: open, accepted as open. The WebGL2 stencil cells stay gated until it is measured (R11).
4. O3: open, accepted as open (R38).
5. O8: open, accepted as open. `stencilStore` stays untyped until it is measured (R11).
6. O7: open, accepted as open.
7. O17: open at acceptance, accepted as open. Closed on 2026-10-19: PR #646 comments 6260229048, 6260238742 and 6260244097 attach the sources, the outputs and the commit of each run.
8. O18: done. The initial depth value (E18) is recorded on the group-6 issue, #637 (comment 6140396477). O20: done, #632.
9. O15: pending. No pull request changes `scripts/changes.ts` yet.
10. Done. R38 applies: the WebGL2 depth-bias cells are refused until O3 reports.
11. O6, O9 to O12, O16 and O19: open, accepted as open.
12. O1: open, accepted as open. It needs a device.
13. O4: open, accepted as open. It needs a device.

O14 is open and accepted as open. O5 stays with the later proposal.

No responsibility, milestone or effort estimate is set. Unassigned responsibilities stay unassigned.

### Configuration and validation record

This record does not yet apply. Delivery requires:

- the accepted proposal revision, and its merge commit, which PR-1 records;
- the implementing pull requests, each with `Change: 0064`;
- the delivered configuration: commit, tool versions and the SwiftShader driver information;
- the functional checks and the document checks listed in "Required validation at implementation";
- the status of each open item, O1 to O20;
- each deviation, with its disposition, on this record and on the pull request (D1 and D2 are accepted by the owner).

Compiler status `implemented` does not establish downstream completion.

**PR-1 (2026-10-19).** The accepted proposal revision is PR #646, merge commit `499a95d2`. PR-1 is built on `main` at `06835f6e` (branch `claude/0064-pr1-viewport-scissor-blend`). Its head commit and pull request number are recorded when the commit is made (`Change: 0064`). Tool versions: bun 1.4.2, node v22.22.0, `tsc` 5.6.3, Chromium 141.0.7390.37 (`headless_shell`, SwiftShader, no GPU). Checks, run on 2026-10-19 on the working tree before the commit:

- `bun run build`: exit 0.
- `bun run lint`: exit 0. `bun run format:check`: exit 0.
- `bunx vitest run src/runtime src/core/spec-conformance src/changes.test.ts`: 13 files, 403 tests passed.
- `bun run test`: 444 files, 10,292 tests passed, 4 skipped, 1 todo.
- `bun run bake:api-surface` and `src/api-surface.test.ts`: passed. `bun run bake:capability-coverage` and `--check`: passed.
- `TYPESHADE_CHROMIUM=… bun run gate:journeys`: exit 0. The render-state journey (`journeys/render-state`, 12 runs) passed on WebGPU and WebGL2. The O10 leg ran on WebGL2.
- `TYPESHADE_CHROMIUM=… bun run gate:compile`: exit 0.
- `bun scripts/bundle-boundary.ts`: `typeshade/runtime` 32,773 B gzipped, budget 32,900 B (was 30,389 B and 30,450 B).
- `bun scripts/ifchange.ts --base origin/main`, `bun run docs:refs`, `doc-impact --check`: exit 0.
- `python scripts/doorstop-check.py -C`: three items await a person's review (see Open items). Not cleared by the agent.

Instrument proofs (not committed): swapping `x` and `y`, or `minDepth` and `maxDepth`, in the WebGPU `setViewport` fails its test. On WebGL2, swapping `viewport` and `depthRange`, removing the host restore, or moving the scissor disable back after the blit each fails its test. The files were restored and checked with `cmp`.

Status of the open items after PR-1: O10 closed (the unit leg and the WebGL2 journey leg ran). O11 measured: 32,773 B. O6 open (the refusal is implemented; its measure is not). O7 open (no canvas frame measured beyond the journey's blit). O9 open (blend constant outside 0 to 1 still refused). O12 open: the zero-size scissor passes on and was measured on both tiers (run `S3`: no error, no pixel drawn). The decision whether draws are skipped or refused is not made. O14 open (needs a second WebGPU implementation). O1 to O5 and O8 not touched.

**PR-2 (2026-10-19).** The accepted proposal revision is PR #646, merge commit `499a95d2`. PR-2 is built on `main` at `8c91f468` (branch `claude/0064-pr2-stencil-bias-mask`). The first PR-2 commit is `55888572`. The review fixes of 2026-10-19 are a commit on top of it. The orchestrator makes that commit with `Change: 0064`. Its hash is recorded on the pull request. The merge commit is not known. Tool versions: bun 1.4.2, node v22.22.0, `tsc` 5.6.3, Chromium 141.0.7390.37 (`headless_shell`, SwiftShader, no GPU). The WebGPU adapter reports `depth32float-stencil8` and does not report `depth16unorm`. The bias behaviour of this paragraph is that of `55888572`, and A1 (2026-10-20, below) changes it. Checks, run on 2026-10-19 on the working tree before the review-fix commit:

- `bun run build`: exit 0. `bun run lint`: exit 0. `bun run format:check`: exit 0 after `prettier --write` of the changed files.
- `bunx vitest run src/runtime src/core/spec-conformance src/changes.test.ts src/journeys-boundary.test.ts src/api-surface.test.ts src/api-doc-coverage.test.ts`: 20 files, 550 tests passed.
- `bun run bake:api-surface`: exit 0, no change to `src/__api__/surface.md`.
- `bun run bake:capability-coverage` and `--check`: exit 0, up to date.
- `TYPESHADE_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell bun run gate:journeys`: exit 0, 162 runs ok. The `pipeline-state` journey passed on WebGPU and WebGL2. Two runs are refused on WebGL2 as the proposal says.
- `bun scripts/bundle-boundary.ts`: exit 0. `typeshade/runtime` is 41,511 B gzipped, against a budget of 41,650 B (floor 17,600 B). The budget is the measure plus about 100 B, rounded up to 50 (B2). The figure is the measure of 2026-10-20, after amendment A1.
- `bun run reqs:sync`: exit 0. `reqs/rules/RULE-1111.md` changed. `python scripts/doorstop-check.py -C -e -F`: exit 1, with two review flags (O28): `RULE-1111: unreviewed changes` and `SURF-069: suspect link`. Not cleared.
- `bun run test`: exit 0, 459 files, 10,577 passed, 4 skipped, 1 todo.
- `bun run changes:check`: exit 0 on the working tree. The trailer check of the commit (O30) runs after the orchestrator commits.

Instrument proofs (the cut, the run of its named tests, the restore and `cmp`). Each cut failed its named tests. Every file passed `cmp` after restore.

- WebGPU, the back compare: `applies the defaults, whole`.
- WebGPU, the negative slope in the descriptor: `applies the defaults, whole`.
- WebGPU, the negative constant on a line list: `refuses each value outside its range or its choice`.
- WebGPU, `{ count: 4, mask: 0 }`: `draws a pipeline with a sample mask`.
- WebGPU, the reference edge 255: `sets the pass value of setStencilReference`.
- WebGPU, null values taken as unset: `refuses each value outside its range or its choice`.
- WebGPU, the depth write: `keeps the depth write and the compare`.
- WebGPU, the `JSON.stringify` choice sentence: `refuses each value outside its range or its choice`.
- WebGL2, the back compare: `makes the calls of one stencil draw`.
- WebGL2, the negative slope refusal: `refuses each WebGL2-only bias`.
- WebGL2, `{ count: 4, mask: 0 }` and the null values: `refuses the state of WebGPU with the same sentence`.
- WebGL2, the reference edge 255: `accepts the reference edges 0 and 255`.
- WebGL2, the depth function: `sets the depth function and the depth mask`.

**PR-2, amendment A1 (2026-10-20).** PR-2 implements A1. The WebGL2 tier takes the depth bias within the bound of F4, and A1 is the owner's decision of 2026-10-19 (D28). Measured on 2026-10-20 with `chromium_headless_shell-1194` (SwiftShader, the probe of O3). The smallest passing constant T (WebGPU) and T' (WebGL2), at separation 2^-12, and the ratio T / T':

| Format                                                | Window depth | T     | T'   | Ratio T / T' |
| ----------------------------------------------------- | ------------ | ----- | ---- | ------------ |
| `depth24plus`, `depth32float`, `depth24plus-stencil8` | 0.0625       | 32769 | 4097 | 8            |
| the same                                              | 0.125        | 16385 | 4097 | 4            |
| the same                                              | 0.25         | 8193  | 4097 | 2 (1.9998)   |
| the same                                              | 0.5          | 4097  | 4097 | 1            |
| the same                                              | 0.75         | 4097  | 4097 | 1            |

- The slope threshold is 0.3125 on both tiers, for each of the three formats and each of the five depths.
- The separation 2^-9 gives the same ratios and the same thresholds at each depth.
- `EXT_polygon_offset_clamp` is exposed on this context: `getSupportedExtensions` lists it, and `getExtension` returns it. O4 stays open for hardware.
- Decision, `depth24plus-stencil8`: accepted on WebGL2. Its thresholds equal those of `depth24plus` at every measured depth, on both tiers (the F4 condition).
- Decision, `depth16unorm` and `depth32float-stencil8`: refused on WebGL2, unmeasured (A1).
- Bound, from window depth 0.25 up, measured at 0.25, 0.5 and 0.75: T / 2 <= T' <= T. The WebGL2 offset is between 1x and 2x the WebGPU offset.
- Bound, below window depth 0.25: 8 times at 0.0625 and 4 times at 0.125. The measured bound is above 2x there. Below window depth 0.0625 the ratio is not measured. It is expected to grow as the depth falls (inference: it doubles each time the depth halves). The JSDoc of `depth.bias.constant`, surface §69 and the CHANGELOG state these values.
- Implementation: `src/runtime/gl-draw.ts` lowers a constant and a slope to `polygonOffset(factor, units)`, and a non-zero clamp to `polygonOffsetClampEXT(factor, units, clamp)` when the context exposes `EXT_polygon_offset_clamp`. The context requests the extension once, in `GlDrawing`. A non-zero clamp without the extension is a `TypeError` that names it. Every refusal comes before `compile()` and before the cache insert.
- Cells (`src/core/coverage/webgpu-dictionaries.ts`, `src/core/coverage/webgl2-host.ts`): G1-18 and G1-20 are `typed`, with the sub-gap of depth16unorm and depth32float-stencil8. G1-22 and G1-76 are `typed`, with the sub-gap of a non-zero clamp without the extension.
- Journey (`journeys/pipeline-state`): `bias-format` and `bias-slope` run on WebGL2 with no refusal. `bias-clamp` holds the clamp on WebGL2 and reports "not run" where the context lacks `EXT_polygon_offset_clamp`. `bias-bound` holds, at five depths and three formats, the cell pairs of the bound: green at -T and red at -(ceil(T / R) - 1). `bias-slope-bound` holds the slope threshold: -0.25 red and -0.3125 green, on both tiers.
- Checks (2026-10-20, on the working tree of PR-2 after the merge of `origin/main` 78d9d39e, before the commit):
  - `bun run build`: exit 0.
  - `TYPESHADE_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell bun run gate:journeys`: exit 0, 169 runs ok, 18 of them `pipeline-state`.
  - `bun scripts/bundle-boundary.ts`: exit 0. `typeshade/runtime` is 41,511 B gzipped, against a budget of 41,650 B (set in `scripts/bundle-budget.json`).
  - `bun run bake:capability-coverage` and `--check`: exit 0, up to date. `bun run bake:api-surface`: exit 0.
  - The citation checker (`fix/cite-check.py after`): 68 symbol citations checked, 0 misses; the other citations were re-read by hand (931). All 999 citation items into `src/runtime` from `src/core/coverage/*.ts` were printed with the first line of each cited range and read (PR-2 A1 review fixes, 2026-10-20). Fourteen rows that cite `src/runtime/program.ts:385-392` for pass load, store and depth notes are open: the cited first line documents bindings, not a pass. Next action: re-point them, or cite the pass doc at `program.ts:389-392`, in a follow-up.
  - `bun run test`: exit 0, 460 files, 10,616 passed, 4 skipped, 1 todo.
  - `bun run gate:compile` with `TYPESHADE_CHROMIUM` set to the 1194 build: exit 0, 163 examples, 0 failures. Without the variable it exits 1, because the Playwright build of the default path is not installed.
  - `python scripts/doorstop-check.py -C -e -F`: exit 1, with the two flags of O28 (`RULE-1111` unreviewed changes, `SURF-069` suspect link). Not cleared: no `doorstop review` or `doorstop clear` was run.
  - `bun run docs:refs`: 0 dead references. `bun scripts/ifchange.ts`: exit 0. `bun run docs:impact`: exit 0, with review items that are open (O31).

**PR-2 A1 review fixes (2026-10-20).** The checks below ran on the working tree at `07a11ac6` with the review-fix edits, before the commit. They are dated apart from the 2026-10-19 and the first A1 checks above.

- `bun run build`: exit 0. `bun run lint`: exit 0. `bun run format:check`: exit 0.
- `bunx vitest run src/runtime src/core/spec-conformance src/changes.test.ts src/journeys-boundary.test.ts src/api-surface.test.ts`: exit 0, 20 files, 554 tests passed. The run before `bun run bake:capability-coverage` failed one test, which held the table to a stale bake. The bake ran, and the set passed after it.
- `bun run bake:capability-coverage` and `--check`: exit 0, up to date.
- `TYPESHADE_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell bun run gate:journeys`: exit 0, 170 runs ok, 0 failures. `pipeline-state#14` (`bias-clamp`) ran on WebGL2 and matched: `WebGL2 0.00e+0`. The summary reads `0 not run (extension absent)`.
- `bun scripts/bundle-boundary.ts`: exit 0. `typeshade/runtime` is 41,511 B gzipped, against a budget of 41,650 B. The budget is unchanged: the measure plus about 100 B, rounded up to 50.
- `bun run reqs:sync`: exit 0. `python scripts/doorstop-check.py -C -e -F`: exit 1, with the two flags of O28 (`RULE-1111` unreviewed changes, `SURF-069` suspect link). Not cleared: no `doorstop review` or `doorstop clear` was run.
- `bun run test`: exit 0, 460 files, 10,617 passed, 4 skipped, 1 todo.
- `bun run docs:refs`: exit 0, 0 dead references in 1,218 files. `bun scripts/ifchange.ts`: exit 0.
- Cut checks. Each cut was restored, and `git diff` of the file was clean after the restore.
  - R3, the extension requested per build: the new test fails, `expected 3 to have a length of 1`. Without the cut it passes.
  - R2, the clamp ignored on WebGL2: `pipeline-state#14` fails with `WebGL2 result off by 1.00e+0`, and the gate exits 1. Without the cut it passes.
  - R2, the not-run path: the run's extension name was changed to `EXT_probe_absent`, which the context lacks. The leg reports `WebGL2 not run (EXT_probe_absent absent)`, and the gate exits 0. The name was restored.
- R1 changes the record only. The refusal sentences it now quotes are the ones `src/runtime/gl-draw.test.ts` and `src/runtime/render-state-parity.test.ts` assert.

Status of the open items after PR-2: O2 measured (the `depth32float-stencil8` arm open, O26). O3 measured, open below window depth 0.0625. O27 closed by A1. O11 measured: 41,511 B. O12 open, unchanged. New open items O26 and O28 to O31. O1, O4 to O10 and O13 to O20 are not touched by PR-2.

Correction (PR-2): the PR-1 entry above gives `typeshade/runtime` as 32,773 B against a budget of 32,900 B. `main` records 38,254 B and 39,000 B, after the second merge of `origin/main` (O11). The PR-1 numbers stay as written.

**PR-3 (2026-10-20).** The accepted revision is PR #646, merge commit `499a95d2`, with amendment A1 (#700). The brief names `main` at `77199ec6` as the baseline. The branch `claude/0064-pr3-attachments` sits on `origin/main` `54b4b787`. The branch holds fourteen commits named `WIP: 0064 PR-3 pass attachments (checkpoint N)`, from `91a57b25` to `79d20308`. The commands of the implementing agent did not make them. Several hold intermediate states of the cut checks below. The pull request is #702, and its first commit is `91a57b25`. The orchestrator squashes them on merge (O35).

Tool versions: bun 1.4.2, node v22.22.0, `tsc` 5.6.3, Chromium `headless_shell` 141.0.7390.37. The run has no GPU. Chromium uses SwiftShader. The WebGPU adapter reports vendor `google` and architecture `swiftshader`. The WebGL2 renderer reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. The date of each run is 2026-10-20.

Checks, run on `6bc6df5e`, the head of #702 after the review fixes:

- `bun run build`: exit 0.
- `bun run lint`: exit 0.
- `bun run test` (the full unit run): 460 files passed, 10,649 tests passed, 4 skipped, 1 todo, exit 0. Log: `unit-full.log` (a session log, not committed).
- `TYPESHADE_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell bun run gate:journeys`: exit 0. All 22 runs of `pass-attachments` pass on WebGPU and on WebGL2, with a worst relative error of 0. Log: `final-journeys.log` (a session log, not committed).
- `TYPESHADE_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell bun run gate:compile`: exit 0. 163 examples, 163 on Tint, 124 GLSL ES 3.00 on WebGL2, 121 render pipelines on Tint, 0 failures.
- `bun run bake:api-surface`: exit 0, no diff.
- `bun run bake:capability-coverage`: exit 0, no diff.
- `bun scripts/bundle-boundary.ts`: exit 0. `typeshade/runtime` is 43,178 B gzipped, against a budget of 43,300 B and a floor of 17,600 B.
- `bun run docs:impact`: exit 0, no must-fix item. The review items stay for a reviewer (O31).
- `bun scripts/ifchange.ts --base origin/main`: exit 0.
- `bun run reqs:sync`: exit 0.
- `python scripts/doorstop-check.py -C -e -F`: exit 1, with two errors. `RULE-1111` has unreviewed changes, and `SURF-069` has a suspect link to it. Both are the expected errors of O28. The agent did not clear them.
- `changes:check`: not run. It reads the `Change: 0064` trailer of a commit, and no PR-3 commit exists yet (O30).

Measures of section 3 of the brief. Each result is from SwiftShader only. A2 and O1 stay open.

- M4, E10 on raw WebGL2 (Chromium 141): with the depth test off and the mask false, the draw gives `INVALID_OPERATION` (0x502). With the depth test on and the mask false, it gives 0x502. With the depth test on and the mask true, it gives 0x502. The control with an unattached texture gives `NO_ERROR`. The refusal of PR-3 stands. Probe: `m4-e10.mjs` (a probe, not committed). Output: `m4-e10.out` (a session log, not committed). Not committed.
- M5, F6 against Dawn (raw WebGPU): Dawn refuses p1 (`writes depth while depthReadOnly is true`), p3 (`writes stencil while stencilReadOnly is true`), p7 and p9 (the same stencil message). Dawn draws p2, p4, p5, p6, p8, p10 and p11. The runtime rules refuse the same four arms and draw the same seven. F6 agrees with Dawn on p1 to p11. Probe: `m5-f6-dawn.mjs` (a probe, not committed). Output: `m5-f6-dawn.out` (a session log, not committed). Not committed.
- M1 to M3, journey `pass-attachments` (22 runs, WebGPU and WebGL2): all 22 runs pass on both tiers. No WebGL2 leg is `none` or not run. The four patterns of M1 are the runs `discard-none`, `discard-stencil-only`, `discard-depth-only` and `discard-both`. The discard runs read the stencil and the depth through a later pass. The control arms differ from the discard arms in every cell.

Instrument proofs. Each cut was restored and checked with `cmp`.

- Unit cuts, 19 in total, each with the tests that fail:
  - A1 stencil store (A1, A4).
  - A2 depth clear edge (A2).
  - A2 without `+ 0` (A2).
  - A9 cull (F6 spellings).
  - A9 write mask (F6 spellings).
  - A5 canvas (A5, parity).
  - F3 `readOnly` removed from `PASS_KEYS` (`tsc` fails).
  - A4 `depthReadOnly: false` emitted (A4).
  - A4 stencil store from depth (A4).
  - colour discard dropped on WebGPU (A4, A5, parity).
  - G2 stencil clear 0 (G2).
  - G3 edge 254 (A2, G2, G3).
  - G4 uint as float (G4).
  - G7 `WebGLTexture` not compared (G7, direct).
  - G7 read-only exempts (G7).
  - G13 stencil cleared for depth-only (G4, G13).
  - G9 F6 check removed (G9).
  - E10 check removed (G7, G12).
  - type probe, `readOnly` arm takes `clear` (`tsc` TS2578 in the probes).
- Journey cuts, 8 in total (`bun run build`, then `bun run gate:journeys`):
  - J1 step 16 skipped: the WebGL2 leg of the discard runs fails, and the controls pass.
  - J2 step 15 after step 16: the stale-mask runs fail on WebGL2 (`discard-none`, `discard-stencil-only`, `discard-depth-only`, `discard-both`, `discard-colour`, `discard-depth32`).
  - J3 stencil discard before the depth store: `discard-stencil-only` and `discard-depth-only` fail on both tiers.
  - J4 stencil cleared to 0 on WebGL2: `stencil-clear` and `stencil-apart-a` fail on WebGL2.
  - J5 clears in one condition: `stencil-apart-a`, `stencil-apart-b` and `readonly-stencil-control` fail on WebGL2.
  - J6 `depthLoadOp` with `depthReadOnly` on WebGPU: `readonly-depth`, `example-glass` and `readonly-inherited` fail on WebGPU, because the pass does not validate.
  - J7 colour discard dropped on WebGPU: `discard-colour` and `discard-uint` fail on WebGPU.
  - J8 F6(b) check skipped: no journey run fails, because the journeys draw no refused pass. The unit tests name it.
- Not run: the cuts A3 (pairs), A7 (`passOf` after `beginRenderPass`), A8, A10 (the F6 call after the blend block), the A9 order pairs, G1 (the order of steps 15 and 16 in unit form), G5, G6, G11 and G12. Journey cut J2 covers the order of steps 15 and 16. The unit tests that these cuts would prove stay unproven by a cut.

Status of the open items after PR-3: O8 measured on 2026-10-20 (see O8). O11 measured after PR-3: 43,178 B. O26 open, unchanged. New open items O32 to O35. O1 is not touched by PR-3, and it stays open because it needs a device. O28 and O30 stay open, for the owner and the orchestrator.

## Open items

- O1 [open, needs a device]: the probes of O17 on a desktop GPU and on a tile-based or integrated GPU. The same run measures the cost of the discard clear (R6). Next action: the device procedure in Approval and plan record.
- O2 [measured, 2026-10-19; the `depth32float-stencil8` arm open, see O26]: stencil operations, all eight, against all eight compare functions. The mapping was read, not measured for each pair. Masks as 32-bit values kept to 8 bits, on `depth24plus-stencil8`. Result: the three matrix runs (`matrix-pass`, `matrix-fail`, `matrix-depth-fail`) and `masks` pass on WebGPU and on WebGL2, with a worst error of 0 under `bun run gate:journeys`. The WebGL2 stencil cells G1-08, 10, 12, 14, 16, 46, 48, 50, 52, 54 and 68 are `typed`. Gates the WebGL2 stencil cells (R11).
- O3 [measured 2026-10-19 and 2026-10-20; A1 uses it; open below window depth 0.0625]: the depth bias unit on both tiers. A value is the smallest integer bias that passes a depth test separation. The 2026-10-20 probe is a raw WebGPU page and a raw WebGL2 page on SwiftShader (`chromium_headless_shell-1194`). It covers five window depths, three formats and two separations, 2^-12 and 2^-9. T is the smallest passing constant on WebGPU, and T' is the smallest on WebGL2. The ratio T / T' is the WebGL2 offset over the WebGPU offset, for the separation 2^-12. The separation 2^-9 gives the same ratio at every depth.
  - `depth24plus`, `depth32float` and `depth24plus-stencil8` give the same values in every row.
  - Window depth 0.0625: T 32769, T' 4097, ratio 8.
  - Window depth 0.125: T 16385, T' 4097, ratio 4.
  - Window depth 0.25: T 8193, T' 4097, ratio about 2 (1.9998).
  - Window depth 0.5: T 4097, T' 4097, ratio 1.
  - Window depth 0.75: T 4097, T' 4097, ratio 1.
  - The slope threshold is 0.3125 on both tiers, at every depth and every format measured.
  - Bound, from window depth 0.25 up: T / 2 <= T' <= T, so the WebGL2 offset is between 1x and 2x the WebGPU offset (F4).
  - Bound, below window depth 0.25 (measured bound): the WebGL2 offset is 8 times the WebGPU offset at 0.0625, and 4 times at 0.125. Window depths below 0.0625 are not measured. The JSDoc of `depth.bias.constant` and surface §69 state these two values.
  - [inference, not measured] The ratio doubles for each halving of the window depth below 0.25. The inference of WebGPU r = 2^(exponent(z) - 23) and WebGL2 2^-24 fits these values. The record claims nothing for other depths.
  - `depth16unorm`: WebGL2 only (17/127, 16/127 and 17/128 at 0.25, 0.5 and 0.75, measured 2026-10-19). The WebGPU adapter lacks the format, so WebGPU was not measured. The format stays refused (A1).
  - `depth32float-stencil8`: not measured on this record's O3 probe. It stays refused (A1).
  - Used by amendment A1 (R10, R11, R38). The values replace the E6 limit of window depth 0.5 only.
  - The journey `journeys/pipeline-state` holds these values on both tiers (runs `bias-bound` and `bias-slope-bound`). See the PR-2 entry (A1).
- O4 [open, needs a device]: the exposure of `EXT_polygon_offset_clamp` on hardware, and a capability query for the clamp (R10). Gates per R11. Next action: the device procedure. The capability query follows in this proposal or in the later one. Amendment A1 (2026-10-19): O4 no longer gates the WebGL2 clamp cells. They are `typed` when the context exposes the extension. O4 stays open for the hardware exposure. Measured 2026-10-20 on SwiftShader (`chromium_headless_shell-1194`): the context exposes `EXT_polygon_offset_clamp` (`getSupportedExtensions` lists it, and `getExtension` returns it). Hardware is not measured.
- O5 [open, needs a device]: the exposure of `EXT_depth_clamp` and of the `depth-clip-control` feature on hardware, and the unclipped depth frame. Gates the later proposal (R11). Owner: the later proposal. Next action: the later proposal.
- O6 [open]: the `frag_depth` clamp with a non-default depth range. WebGPU clamps to `[minDepth, maxDepth]`. WebGL2 is expected to clamp to 0 to 1 (inference from ES 3.00, not read). The refusal stays until group 14 measures it.
- O7 [open]: the viewport, the scissor and the blit-out on a canvas target, with limits, fractions and the canvas size (R19). Next action: the canvas frames on both tiers, on SwiftShader.
- O8 [measured, 2026-10-20]: the stencil `discard` and its one-aspect cases, read through a later pass with a control arm. The runs `discard-none`, `discard-stencil-only`, `discard-depth-only` and `discard-both` of `journeys/pass-attachments` pass on WebGPU and on WebGL2, with a worst relative error of 0. The one-aspect cases are `discard-stencil-only` and `discard-depth-only`. Gates the typing of `stencilStoreOp` (R11). The rows that name it are in `src/core/coverage/`. The stencil discard is measured on SwiftShader only (O1 stays open for hardware).
- O9 [open]: a blend constant outside 0 to 1. Refused for now. Next action: widen after a measure (R5).
- O10 [closed, 2026-10-19]: after a pass, the host's kernel passes and the call layer still work. This includes a raw GL value set before `submit()`. Closed by the unit test "leaves no error on the context after a pass that sets every PR-1 call" (`src/runtime/gl-draw.test.ts`, describe "the WebGL2 context after a pass") and by the `hostState` run of the render-state journey on WebGL2.
- O11 [measured, 2026-10-19]: the bundle size of `typeshade/runtime` after PR-1 is 38,254 B gzipped, measured with `bun scripts/bundle-boundary.ts` after the second merge of `origin/main` `492902c3`. The budget in `scripts/bundle-budget.json` is 39,000 B, the value `main` records; the measure is under it, so the budget is not moved. Each later implementing pull request sets the budget from its own measurement (R12). After PR-2 and amendment A1 the measure is 41,511 B. The budget is 41,650 B: the measure plus about 100 B, rounded up to 50, as PR-1 did (R12). After PR-3 the measure is 43,178 B. The budget is 43,300 B: the measure plus about 100 B, rounded up to 50 (R12). The floor is 17,600 B.
- O12 [open]: a scissor that clips to zero size (R19). Next action: measure on both tiers, then decide whether the draws are skipped or refused.
- O13 [open]: the gpuweb commit of each WebGPU statement. The copy was read from the session scratchpad, and its commit was not recorded. Next action: re-read each cited statement at a recorded commit, and record that commit before acceptance.
- O14 [open, needs a second WebGPU implementation]: the viewport outside the attachment on an older WebGPU implementation (E3 is measured on Chromium 141 only). Next action: measure with a second WebGPU implementation, which this environment lacks, or refuse on both tiers.
- O15 [open]: `radiance` is not in `DOWNSTREAM_REPOS` (`scripts/changes.ts:61`). The copy of `WEBGPU_CALL` in radiance (`scripts/boundary.mjs:25-26`) is a second copy of the pattern at `journeys/_harness.mjs:173`. R28 (a) decides the move. Next action: the change to `scripts/changes.ts`, then the move of the pattern.
- O16 [open]: `references/host.md` in vscode-typeshade says "The runtime is WebGPU only" (line 181). The sentence is stale for reasons outside this proposal. R29 (b) decides the correction. Next action: the separate pull request of vscode-typeshade, before this record is implemented. <!-- doc-refs: skip — a path of another repository, which this tree does not have -->
- O17 [closed, 2026-10-19]: the probe sources, their outputs (E1 to E18), the commit of each run and the type probes are attached to PR #646 comments 6260229048, 6260238742 and 6260244097. E1 to E18 ran on `db6d0af`, the type probes on `4139584d`. Two items are only partly supported: E3 (no WebGPU run of a fractional viewport) and E15 (`SAMPLE_BUFFERS` read on the probe's own framebuffer). The E1 statement holds at `196b5d70`, because `src/runtime/` did not change from `db6d0af` to `196b5d70` (inference from an earlier diff, not re-run).
- O18 [closed]: the initial depth value of a new `depth32float` texture (E18) is recorded on the group-6 issue, #637 (comment 6140396477). The read-only depth test writes depth before it reads.
- O19 [open, not required]: a fraction measure on each tier. Only a later widening under R23 (b) needs it, and R23 (a) is decided.
- O20 [closed]: the group-1 issue of step 3b is #632, filed on 2026-10-13. Its text on `store: 'discard'` follows R6 and promises no more than R6. It links to the gap register for its cells and does not adopt the labels G1-01 to G1-78.

- O26 [open]: the discard arm on `depth32float-stencil8` is not run, for the same reason as O2. The journey harness cannot request the feature. Next action: the probe on its own device, or a recorded reason why it cannot run.
- O27 [closed, 2026-10-20, by A1]: the WebGL2 constant bias on `depth32float` has a different unit from WebGPU at window depth 0.25 (O3). The owner's go-ahead on 2026-10-19 accepts the bound. A1 states it, and PR-2 implements it. A1 removes the R38 refusals of the constant and the slope on `depth24plus` and `depth32float`. It also removes the clamp refusal where the context exposes the extension. See A1 and the PR-2 entry (A1).
- O28 [open, owner review]: `reqs/rules/RULE-1111.md` (Rule 11.11) has unreviewed changes, and `SURF-069` has a suspect link to it. Next action: a person reads both and runs `doorstop review`. The agent did not run it.
- O29 [open]: `multisample.mask` of 256 and of 0 draw the same pixels at count 1. The PR-2 implementation brief, section 1.1.4, gives 256 as 0, and its plan table keeps the value as given. See D27.
- O30 [open]: `changes:check` reads the `Change: 0064` trailer of the commit. Next action: run it after the orchestrator commits PR-2.
- O31 [open]: `bun run docs:impact` lists review items for the merged diff (299 lines of output). Only the groups for Rule 11.11, §69, the `RenderState` shape and the bias files were read. Next action: the owner or a reviewer reads the rest of the list. Doc-impact findings do not block the merge (exit 0).
- O32 [open]: a same-pass read of a read-only depth attachment is allowed on WebGPU, and no frame tests it. Unit tests check the WebGL2 refusal only (reading 8, D38). Next action: a frame that binds the read-only depth of its own pass on WebGPU, with a control arm.
- O33 [open]: neither tier refuses a colour attachment that a draw of its own pass samples. E10 refuses the depth attachment only. Next action: the owner decides whether colour is refused the same way, or left to the host.
- O34 [open]: no journey frame exercises a refusal. The refusals of PR-3 are held by the unit tests in `src/runtime/runtime.test.ts` and `src/runtime/gl-draw.test.ts`. Next action: the owner decides whether a refusal frame is needed.
- O35 [closed by the squash merge of #702]: the branch held fourteen WIP commits (see the PR-3 entry). The squash merge of #702 replaces them. `changes:check` on the first PR-3 commit stays under O30.

### Deviations

- D1 [accepted by the owner, R2]: PR-1, PR-2 and PR-3 split group 1. The reading of step 3c as one pull request per group is an inference. It comes from PR #615 comment 6135364899 (the label and the group order) and from proposal 0059 line 338 (each step its own pull request). Disposition: accepted by the owner. Record it on each implementing pull request.
- D2 [accepted by the owner, R17, R18 and R37]: this record carries typed-option work that #204 comment 5989196955 assigns to slice 0(e). That work covers the `depth.compare` type, the key refusal and the colour entry type. Disposition: accepted by the owner, with the adoption of those decisions. Record it on the pull request.
- PR-1 deviations, on the PR-1 pull request and here:
  - D3 [accepted by the owner]: the viewport limit L is each tier's own: `maxTextureDimension2D` on WebGPU, and on WebGL2 the smaller entry of `MAX_VIEWPORT_DIMS`. The proposal's F1 and Required validation say the smaller of the two limits on both tiers. The owner's addendum (2026-10-19) calls this deviation "D2" of PR-1; this record already names D2 for the typed options, so the number here is D3.
  - D4 [accepted by the owner]: the WebGPU descriptor carries `multisample` only when the count is not 1, so `{ multisample: { count: 1 } }` and `{}` give one descriptor. The owner's addendum calls this "D3".
  - D5 [open]: the render-state journey's depth and colour come from two overrides of one vertex and one fragment entry, not from the separate entries the brief drafted (`vsNear`, `fsRed`, `vsFar`, `fsGreen`, `fsWhite`). The GLSL writer warns on a module with several vertex entries, and the journey gate fails on a warning. The pixel expectations are the brief's.
  - D6 [open]: `scripts/entry-calls-page.ts` types its compare parameters as `CompareFunction`, which the new `depth.compare` type forced (TS2322).
  - D7 [open]: the O12 measure is a single run on each tier with a rectangle wholly outside the target. The owner's addendum asks for a measure of the clip, not a decision; the decision stays open.

- PR-2 deviations, on the pull request and here. On 2026-10-19 the owner said to follow the recommendations ("추천대로"). Each reading D8 to D24 is accepted on that basis:
  - D8 [accepted by the owner, 2026-10-19]: masks are stored as their low 8 bits. `readMask: 0x105` and `5` are one state. The WebGPU descriptor carries 255 for the default, and 5 for 0x105. The GL calls carry the same values. The pixels equal those of the full value.
  - D9 [accepted by the owner, 2026-10-19]: the descriptor holds a key only when it differs from the WebGPU default. No `depthBias*` key when the value is 0, no `multisample.mask` when it is 0xFFFFFFFF, and all four stencil fields whenever `depth.stencil` is present. PR-1 D4 is the precedent.
  - D10 [accepted by the owner, 2026-10-19]: `depth.stencil: {}` and no `depth.stencil` are two states. The first needs a stencil pass and sets the reference. The second needs neither.
  - D11 [accepted by the owner, 2026-10-19]: `{ count: 4, mask: 0xFFFFFFFF }` is accepted on WebGPU, and it is `{ count: 4 }`. Only a mask other than the default with a count other than 1 is refused.
  - D12 [accepted by the owner, 2026-10-19]: the key sentence of a nested object is `X takes the keys …`. Rows 268 and 270 of this record say `depth takes the keys …`, and row 269 says `it takes the keys …`. The new objects follow PR-1.
  - D13 [accepted by the owner, 2026-10-19]: `stencil` and `bias` written on `RenderState` get a sentence with the TypeShade name, `depth.stencil` or `depth.bias`. F3 gives them as examples one level down, but its sketch has them as keys of `depth`.
  - D14 [accepted by the owner, 2026-10-19]: a pipeline with `depth.stencil` drawn into a pass with no depth attachment has its own sentence. The proposal's rows have no such case.
  - D15 [accepted by the owner, 2026-10-19]: the WebGL2 slope-scale sentence ends "and its unit is not measured there yet", not "until O3 reports". F2 forbids the label in a thrown sentence. [Superseded by A1, 2026-10-20: the slope sentence now names the formats; see D28.]
  - D16 [accepted by the owner, 2026-10-19]: the order of the checks in `draw` is F6(a) first, then the `frag_depth` refusal, then the record, then the sample-mask return, then the bookkeeping.
  - D17 [accepted by the owner, 2026-10-19]: only `undefined` means unset for a field PR-2 adds. `null` is refused. `depth.compare` keeps PR-1's `??`.
  - D18 [accepted by the owner, 2026-10-19]: `depth.format: 'stencil8'` is refused in a pipeline only (F7). The attachment half is PR-3.
  - D19 [accepted by the owner, 2026-10-19]: a non-zero bias on a line or point topology names the first non-zero field of `constant`, `slopeScale` and `clamp`.
  - D20 [accepted by the owner, 2026-10-19]: G1-18 and G1-76 are `refused`, although a constant bias on `depth32float` is taken. A `refused` cell has a rule and a portable spelling, and the spelling states what the tier takes. [Superseded by A1, 2026-10-20: G1-18, G1-20, G1-22 and G1-76 are `typed`, each with a sub-gap.]
  - D21 [accepted by the owner, 2026-10-19]: the JSDoc of `multisample` gains the WebGL2 count-4 sentence and the recipe, because the same edit adds `mask`.
  - D22 [accepted by the owner, 2026-10-19]: a masked-off WebGL2 draw is checked, then dropped, and its bookkeeping does not change. A masked-off WebGPU draw is recorded, and the GPU drops the samples.
  - D23 [accepted by the owner, 2026-10-19]: every `draws` run of the journey harness checks `getError()` on WebGL2. This reaches the existing `render-state` runs too.
  - D24 [accepted by the owner, 2026-10-19]: PR-2 does not widen the WebGL2 bias refusals, though O3 is measured. The widening is an owner decision (R38). [Closed by A1, 2026-10-20: the widening is the owner decision of 2026-10-19, which A1 records.]
  - D25 [open]: the `depth32float-stencil8` arm of O2 is a probe, and it is not run. The adapter has the feature, and the probe needs the packed-runtime project of `scripts/user-journey.ts`. See O26.
  - D26 [closed]: no point cell of `faces` is dropped. On WebGL2 the point is drawn at the centre of its pixel, and the `faces` run passes with its point cells.
  - D27 [open]: the PR-2 implementation brief, section 1.1.4, gives `multisample.mask` 256 as 0, and its plan table keeps the value as given. PR-2 keeps the value as given. At count 1, 256 and 0 draw the same pixels. See O29.
  - D28 [accepted by the owner, 2026-10-19; made part of the approved text by amendment A1, 2026-10-20]: WebGL2 refused every depth bias on every format, and R38 allowed a constant bias on `depth32float`. A1 takes the bias within the bound of F4 on `depth24plus`, `depth32float` and `depth24plus-stencil8`. The item that the 2026-10-19 fix list calls O22 is O27 in this record, because O22 is the number of R39.
  - D29 [accepted by the owner, 2026-10-19, "추천대로"]: the stencil and bias frames are a journey, `journeys/pipeline-state`, and not new frames in `scripts/render-case.ts` (`FRAMES`). `FRAMES` has two fixed frames that read depth. PR-1 put its pixels in a journey as well, and PR-1 D5 is the same reading. Record it on the pull request.
  - D30 [closed; made part of the approved text by this record update, 2026-10-20]: the delivered clamp, format and slope sentences replace the drafted ones. The refusal table rows (the constant row, the slope row and the clamp row), the Required validation at implementation and the clamp frame name them. A1 names the rows as affected.
- PR-3 deviations, on the pull request and here. On 2026-10-20 the owner said to adopt the recommended readings. Each reading D31 to D47 is accepted on that basis:
  - D31 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 1 of brief section 8. The words of the attachment sentences of 1.1.4 are derived by the pattern of PR-2, and the proposal does not give them. A caller sees about twenty `TypeError` sentences with these words.
  - D32 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 2. Row 266 is split. The inherited case uses the row's words, and an explicit `stencil.readOnly: true` has its own sentence.
  - D33 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 3. R35 (c) refuses `stencil: { readOnly: false, clear: v }` under a read-only depth when no stencil `load` is set, because the inherited load is `'load'`. The alternative was a silent no-op.
  - D34 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 4. The `load`, `store` and `readOnly` values are checked on both tiers, and `null` is refused (PR-2 D17).
  - D35 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 5. `stencilReadOnly` joins the WebGPU names that F3 refuses with the TypeShade key.
  - D36 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 6. The pass-fit order is F6(a), then F6(b), then F6(c). F6 is checked before the `frag_depth` refusal and before the record (PR-2 D16, extended).
  - D37 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 7. `writes.depth` is `depth.write` as normalised, even with `compare: 'never'`. `writes.stencil` follows F6(c), with the cull mode as written, whatever the topology. M5 agrees with Dawn on p1 to p11.
  - D38 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 8. The same-pass read is refused with the row's words, which name no entry. It fires for a `Texture` and for a `WebGLTexture`, and under a read-only attachment. It does not fire on WebGPU. See O32.
  - D39 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 9. A read-only aspect is stored with load `'load'` and store `'store'`. Its WebGPU descriptor has only the `...ReadOnly: true` key, and no `readOnly: false` key exists for a writable aspect (PR-2 D9).
  - D40 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 10. Step 16 runs the clears in the order colour by index, then depth, then stencil.
  - D41 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 11. A depth target with no readable format gets the format `'unknown'`, has no stencil aspect, and is a depth-only pass. The alternative was a refusal.
  - D42 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 12. The pass-level sentences use the prefix `pass()`, as the existing WebGL2 sentences do.
  - D43 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 13. The sub-gap of G1-36 and G1-44 is group 1, issue 632. The gap register counts them in group 1.
  - D44 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 14. Rule 11.11 gets only the phrase on the same-pass read (5.4 of the brief). The alternative was a phrase on `store: 'discard'` too.
  - D45 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 15. The journey is `journeys/pass-attachments`. The harness gains `passes`, `readDepth`, `expectedDepth`, `integer`, `webgl2Must` and `writeMask` (PR-2 D29 precedent). The frames are not in `scripts/render-case.ts`.
  - D46 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 16. `PASS_KEYS` is exported from `src/runtime/program.ts`, and `DepthAttachment` is exported from `typeshade/runtime`. `PASS_KEYS`, `passOf` and `PassPlan` are not public.
  - D47 [accepted by the owner (2026-10-20, 'adopt the recommended readings')]: reading 17. The budget is the measure plus about 100 B, rounded up to 50.
  - D48 [open]: brief section 7, item 1. Row 265 gives `sets depth.stencil.passOp to "zeroo"`, and `main` prints the string as `the string "zeroo"`. The depth comparison prints `"lesss"` with `JSON.stringify`. The owner decides: change row 265, or change `choiceOf`. PR-3 keeps `choiceOf` as it is. Next action: the owner's choice, as an amendment.
  - D49 [open]: brief section 7, item 3. Row 292 names no entry, which F2 requires. PR-3 throws the row's sentence as written (1.3.3). The owner decides whether row 292 gets a prefix that names the entry and the binding. Next action: the owner's choice, as an amendment.

## Amendments

An amendment changes the accepted text. Its pull request is proposal-only, and its merge is its acceptance. Git holds the earlier text. The decided text of a question stays in place, and an amendment record sits under it.

### A1. WebGL2 accepts depth bias within a stated bound (2026-10-19)

- [decision, owner, 2026-10-19] What changed. On WebGL2, depth bias is lowered to `polygonOffset` and is guaranteed within a stated bound. It is not refused. F4 states the bound.
  - The direction of the offset is always the same as on WebGPU.
  - The constant offset is at least the WebGPU offset and at most 2x it, at window depths 0.25 and above, measured on SwiftShader at 0.25, 0.5 and 0.75. Below 0.25, PR-2 measures the ratio at 0.0625 and 0.125, and this record states it. Below window depth 0.0625 the ratio is not measured. It is expected to grow as the depth falls (inference: it doubles each time the depth halves).
  - The slope offset is the same as on WebGPU.
  - The clamp is lowered with `EXT_polygon_offset_clamp` when the context exposes it. Without the extension, a non-zero clamp is a `TypeError` that names the missing extension.
- [fact] Why. O3 measured the unit on 2026-10-19. The WebGL2 constant offset is 2x the WebGPU offset at window depth 0.25 and equal at 0.5 and 0.75. The slope threshold is the same on both tiers. R38 refused the bias because the unit was measured at window depth 0.5 only (E6).
- [decision, agent's choice for the owner to confirm] `depth16unorm`: option (b), refuse it until it is measured. Option (a) was to accept it under the same bound if the unorm step 2^-16 is defined the same way on both tiers.
  - [fact] The WebGPU adapter lacks `depth16unorm`, so only WebGL2 was measured.
  - [inference] Whether both tiers define the step 2^-16 the same way is not known. WebGPU leaves r to the backend.
  - [fact] Without a WebGPU value, no test can show the 1x to 2x bound for the format.
  - [fact] Widening later is not breaking (F5). Narrowing a published input is breaking (Rule 13.9). Refusing now costs less than accepting now and narrowing later.
- [decision, owner's 'follow the recommendations', 2026-10-19] `depth24plus-stencil8` is accepted once PR-2 shows that its depth aspect gives the same thresholds as `depth24plus`, at every measured depth, on both tiers. Until then it is refused. The reason: X-GIS uses this format, with bias -10 and slope -1. `depth32float-stencil8` stays refused until measured.
- Affects: F4, F5, the input row and the refusal rows of depth bias, the lowering rows of `depth.bias`, the example comment of the decal, G1-18, G1-20, G1-22 and G1-76 of the cell map, the forecast totals, Required validation at implementation, R10, R11, R38, O3 and O4.
- Not affected: the front matter. The title, `surface`, `exports`, `codes`, `examples` and `downstream` do not change. Items 4 and 10 of the Approval and plan record, and their status, are the record of 2026-10-13. This amendment supersedes them for the WebGL2 bias cells.
- Deviations D28 and O22 of PR-2: this record does not list them, because PR-2 is not merged. When PR-2 records them, this amendment supersedes them for the bias cells, and PR-2 closes them with a reference to A1.
- Status: `status: accepted` does not change.

## What it owes downstream

- typeshade.github.io (local clone at `ec2398e`, 2026-10-11, not fetched):
  - The Playground render helper (`src/lib/render-runtime.ts`) passes its scissor through `pass.raw.setScissorRect` (lines 65-66). It loads the runtime with `{ console: true }` (line 51). The WebGL2 tier refuses that option (`src/runtime/gl.ts:77-80`). The typed call therefore adds no WebGL2 run for that helper. On WebGPU the helper may move to `pass.setScissorRect`, and it may drop its own clamp, because the runtime clips a `Texture` or canvas target (R19). Its test fake, `scripts/render-runtime.test.ts:202`, fakes `setScissorRect` on `pass.raw`, so it changes with the helper. <!-- doc-refs: skip — a path of another repository, which this tree does not have -->
  - The API reference takes the new fields, methods and type names from their JSDoc. This proposal adds no public file, so `CATEGORY_BY_FILE` does not change.
  - The WebGPU and WebGL2 concept component, `src/components/pages/ConceptsWebgpuPage.astro`, serves the English and Korean pages (`src/pages/guide/concepts/webgpu-and-webgl2.astro`, `src/pages/ko/guide/concepts/webgpu-and-webgl2.astro`). It shows `frame.pass` and describes no pass state. It gains a short section on pass state and the WebGL2 refusals. This is new content, not a correction.
  - `compiler-changes.md` records 0064 when the pin moves.
- vscode-typeshade (local clone at `22ac40a`, 2026-10-11, not fetched):
  - `plugins/typeshade/skills/typeshade/references/host.md` describes what `RenderState` holds (line 131). That sentence gains the new fields. The sentence "The runtime is WebGPU only" (line 181) is stale. A separate pull request corrects it before this record is implemented (R29 (b), O16). <!-- doc-refs: skip — a path of another repository, which this tree does not have -->
  - `compiler-changes.md` records 0064 when the pin moves.
  - The language service changes nothing, because no shader name changes.
- radiance (local clone at `30daafa`, 2026-10-09, not fetched; not a downstream repository of `scripts/changes.ts` until R28 (a) lands, see O15):
  - `scripts/boundary.mjs` (lines 25-26) copies the compiler's `WEBGPU_CALL` pattern. Under R28 (a), radiance imports the shared module through its pin, and its own pull request removes the copy. <!-- doc-refs: skip — a path of another repository, which this tree does not have -->
  - No radiance code uses a render-state call today (usage evidence).

The expected work is known from this record. It is confirmed at acceptance, against each repository's default branch. Undelivered obligations stay pending.
