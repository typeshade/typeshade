---
id: '0127'
title: A scalar, vector or supported matrix uniform keeps its host value on WebGL2
status: draft
rules: []
surface:
  - 67
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Admit hello-uniform to WebGL2, supply its scalar value, update its still and gallery expectations and both locales, and record 0127 at adoption.
  - repo: vscode-typeshade
    what: Replace the BARE_UNIFORM backend-refusal fixture with a remaining refusal, add a successful bare-uniform check, and record 0127 at adoption.
---

**Document control**

| Field                         | Record                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0127, status draft. The front matter is the identity and lifecycle authority.                                                                                 |
| Date and attribution          | Authored 2026-11-07 UTC by Codex while progressing the owner's remaining-issue request. This date records authorship, not acceptance.                                  |
| Request source                | Issue [#452](https://github.com/typeshade/typeshade/issues/452), its recorded direction from #198, and roadmap B4.                                                     |
| Applicability / Effectivity   | GLSL uniform emission, shader host draws, manifest render stages and the WebGL2 program runtime. Public source and host values retain their forms. Release unassigned. |
| Review baseline               | main at c0afa047a53c3a83825973144a1b0372aed91f62. The baseline measurements below use that revision's source.                                                          |
| Review and revision authority | No PR is assigned yet. Git records revisions; PR review and merge records establish decisions.                                                                         |

## What changes

A shader-owned `uniform<T>` gains a WebGL2 render tier when its existing host layout and
lowered scalar, vector or matrix representation fit a std140 block. The author need not
wrap its value in a struct. Rule 1.2 permits this target lowering. Rules 4.8, 6.8, 11.10
and 13.3 remain unchanged.

For example, this already compiles to WGSL:

```ts
"use typeshade";
declare const scale: uniform<f32>;
export const fs = fragment(function fs(): location<0, vec4> {
  return vec4(scale, 0., 0., 1.);
});
```

It would also emit GLSL and draw through the generated `fs(canvas, { scale: 0.25 })` call
on a WebGL2 canvas. The manifest program runtime would bind the same authored `scale`
value. WGSL and CPU evaluation keep their existing meanings.

### One block for one binding

Lower each eligible binding to one compiler-owned std140 block with one value member.
An illustrative spelling is:

```glsl
layout(std140) uniform _ScaleBlock {
  float _value;
} scale;
```

Reads of that binding become `scale._value` in GLSL only. Identify the binding declaration;
do not replace matching source text. A same-named local or field must keep its meaning.
Allocate private block and member names through the existing target spelling machinery.
Names must remain collision-free and stable across linked stages.

Keep the authored binding name, group, slot, scalar type and host type. Keep the existing
WGSL emission, reflection layout, `PackBinding.layout` and host packing. Do not insert a
synthetic struct into the public IR, reflection or host view. The caller still supplies a
number, vector tuple or column-major matrix tuple.

The existing manifest `blocks` map associates the authored name with its GLSL block tag.
Both full-screen host draws and manifest render pipelines must consume that map. No new
`Pack` field, schema number, public export, host argument or runtime option is proposed.
Per-entry reachability, cross-stage sharing and unused-binding omission keep their current
rules. A load-time re-emission must describe the same `blocks` as shipped GLSL.

Host-owned loose uniforms retain their existing GLSL spelling and setter contract.
Existing compute-emulation loose uniforms are also unchanged. Grouping several authored
bindings into one block is outside this proposal.

### Supported layouts and limits

The new path covers existing host-shareable `f32`, `i32`, `u32` and their vectors. It covers
the six `f32` matrix shapes with three or four rows. A square alias denotes the same shape.

Existing `f64` lowering and host values are preserved. A bare `f64` lowered to a two-word
vector uses the new block path. An existing lowered struct, such as a `vec64` representation,
continues through the struct path. Both `f64` flavors require validation; the float flavor's
runtime guard must remain real. This draft's native measurement does not establish `f64`
execution; those checks remain delivery requirements.

Keep these boundaries:

- `mat2x2`, `mat3x2` and `mat4x2` uniforms retain `TS8051` and its remedy, bare or nested.
  Rule 4.8 requires refusal: their WGSL column stride is 8; GLSL std140 requires 16.
- Boolean uniforms, `f16` authoring and matrices of `f64` gain no host layout or support.
- Bare arrays gain no new GLSL path. Existing struct uniforms and their arrays retain
  their current support and layout restrictions.
- Storage buffers, textures, samplers, stage restrictions and device limits keep their
  current eligibility rules. A bare uniform cannot hide another reason a tier is absent.

### Buffer allocation is separate from value layout

The member starts at offset zero. Matrix columns use the existing common column stride.
Do not repack columns, reorder components or change the bytes the manifest describes.

The WebGL buffer must cover the linked program's reported UNIFORM_BLOCK_DATA_SIZE.
Preserve the program runtime's existing 16-byte tail-padding policy. The host draw path
must also satisfy the required block size. An implementation may share an internal
allocation helper; that helper must not reshape a public binding layout.

Copy the packed bytes unchanged into a zero-initialized allocation large enough for the
existing padding policy and the reported block size. Extra bytes are allocation padding,
not authored fields. Never infer a column stride from total block size. Validate active
block lookup before using its reported size, and retain existing missing-binding errors.

The measured driver accepts a four-byte scalar block. That observation does not require
every driver to report four bytes, nor justify uploading fewer bytes than a driver needs.

## Why

At the review baseline, a bare scalar, vector or supported matrix produces WGSL and a
`TS8015` GLSL warning. Putting the same value inside a one-field struct removes the warning
and enables GLSL. The missing tier is caused by the binding's outer form.

[src/core/backends/glsl.ts](../src/core/backends/glsl.ts) rejects shader-owned non-struct
uniforms after the existing host-owned loose-uniform branch.
[src/core/manifest.ts](../src/core/manifest.ts) expects a named uniform block.
[src/core/host-draw.ts](../src/core/host-draw.ts) uploads packed bytes directly.
The program runtime's [src/runtime/gl-draw.ts](../src/runtime/gl-draw.ts) already adds
16-byte tail padding in uploadBlock.

The proposed block fits those existing interfaces. Loose uniforms also worked in the
measurement below. They would need typed setters and another metadata/upload path.
Keeping the current refusal would keep requiring a source wrapper without changing the
value's shader meaning. Grouping resources would change slot and limit accounting, so
it is excluded.

### Baseline compiler and editor measurement

Codex ran 34 source forms on 2026-11-07 UTC at the review baseline. Tools were Bun 1.4.4,
Node 24.22.1 and TypeScript 5.6.3. Each type was tested bare and in
`interface Params { value: T; }`, using `compile()`, `hostFace()` and the language service.

The tested scalar/vector types were `f32`, `i32`, `u32`, `vec2`, `vec3`, `vec4`, `vec3i` and vec3u.
All nine `matCxR` shapes were tested too.

| Source forms                                        | Observed compiler and host result                                                    | Observed editor result    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| 14 bare types with a shared layout                  | WGSL present; GLSL absent; one `TS8015` warning; host entry records the GLSL refusal | No diagnostic             |
| The same 14 types inside a struct                   | WGSL and GLSL present; no diagnostic                                                 | No diagnostic             |
| Three two-row matrices, bare and wrapped: six forms | One `TS8051` layout refusal; neither target emitted                                  | The same `TS8051` refusal |

The bare warning was exactly:

```text
Backend emit failed: glsl-es300: uniform binding 'U' must be a struct (a std140 UBO block)
```

The editor-only language service does not run backends. `checkDocuments()` does; its
existing bare-uniform shortfall fixture must change when this warning disappears.

### ANGLE design measurement

Codex measured synthetic candidate GLSL on 2026-11-07 UTC, with Chromium 156.0.8078.4
through Playwright and the repository's software gate launch settings. The observed
renderer was:

```text
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
```

This was actual WebGL2 shader compilation, linking, drawing and readback on SwiftShader.
It was not a physical-GPU run, product implementation, WebGPU execution or full gate.

Each of the 17 types above was drawn as a one-member block and as a loose uniform:
34 draws. All matched the independently calculated red pixel within one RGBA8 unit.
Green and blue were zero; alpha was 255. Every final draw returned NO_ERROR.

For supported types, the block received bytes from the baseline's unchanged `layoutOf`,
`byteSize` and `pack` functions. Two-row matrices used explicitly synthetic std140 bytes;
their successful GL draws do not establish a supported TypeShade host layout.

| Type                         |                Baseline packed bytes | Reported block bytes | Member offset | Matrix column stride |
| ---------------------------- | -----------------------------------: | -------------------: | ------------: | -------------------: |
| `f32`, `i32`, `u32`          |                                    4 |                    4 |             0 |         Not a matrix |
| `vec2`                       |                                    8 |                    8 |             0 |         Not a matrix |
| `vec3`, `vec3i`, `vec3u`     |                                   12 |                   12 |             0 |         Not a matrix |
| `vec4`                       |                                   16 |                   16 |             0 |         Not a matrix |
| `mat2x3`, `mat2x4`           |                                   32 |                   32 |             0 |                   16 |
| `mat3x3`, `mat3x4`           |                                   48 |                   48 |             0 |                   16 |
| `mat4x3`, `mat4x4`           |                                   64 |                   64 |             0 |                   16 |
| `mat2x2`, `mat3x2`, `mat4x2` | No host layout; synthetic 32, 48, 64 |           32, 48, 64 |             0 |                   16 |

A deliberately broken fragment shader failed compilation. For every block, a buffer one
byte smaller than its reported size made the draw return `INVALID_OPERATION` (1282):
17 negative controls. Uploading the reported size restored the expected pixel.

The first measurement script incorrectly expected an unpadded scalar block to fail.
Its assertion failed although every draw matched. The corrected instrument tested one
byte below the queried size. The table records the observation, not that initial assumption.

The measured fragment text followed this complete pattern, with `TYPE` and `EXPR`
substituted from the tested type and expression below:

```glsl
#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform _Block { TYPE value; } binding;
out vec4 color;
void main() { color = vec4(EXPR, 0., 0., 1.); }
```

The loose variant used `uniform TYPE U;` and replaced `binding.value` with U.
A full-screen triangle used `gl_VertexID`; each draw read one RGBA8 pixel.
Scalar `f32` used 0.25 directly. Integer scalars used 1, converted to float and divided by 4.
Float vector lane i held `(i + 1) / 16`; all lanes were summed and divided by 2.
Integer vector lanes held `i + 1`; their sum was converted and divided by 16.
Matrix component i held `(i + 1) / 64` in column-major order; all components were
summed and divided by 4. Reading every component kept the full layout active.
The JavaScript reference calculated those sums independently of emitted GLSL.

## What it touches

- `rules: []`: no normative paragraph changes. Rule 1.2 allows the lowering; Rule 4.8
  excludes two-row uniforms; Rules 6.8 and 11.10 preserve layout and manifest agreement.
- `surface: [67]`: replace the blanket non-struct-uniform fallback statement with the
  supported-layout boundary and unchanged host argument form.
- `exports`, `exports-removed` and `codes` remain empty. No public API or diagnostic
  identity changes. `TS8015` remains available for genuine backend shortfalls.
- `examples: []`: no example is added or removed. Update `hello-uniform`'s existing
  header, blurb and renderability, plus affected generated registry and emit goldens.
- Update roadmap B4, the changelog, compiler/host contract tests and backend-refusal
  fixtures. Preserve their ability to detect a different remaining backend refusal.
- Implement the private GLSL binding path, block-map agreement and both WebGL upload
  paths. Add bounded cases to existing real-driver gates and packed host journeys.
- The two declared downstream repositories owe the adoption work below.

### Draft impact estimate

The known implementation areas are the GLSL writer, manifest block extraction, host draw
upload and program-runtime upload. No dependency or public schema addition is proposed.
Compiler WGSL, CPU results and public binding layouts must compare unchanged.

The technical estimate is a bounded backend/runtime change with cross-path validation.
Time, cost and implementation ownership are unassigned. Native measurement resolves the
block-versus-loose choice for this draft; physical GPU coverage remains unmeasured.

Before acceptance, review the proposed block naming, existing `f64` lowering boundary and
allocation-only padding against Rule 6.8. Resolve any request to support two-row matrices
or bare arrays separately. Those requests cannot be implemented under this record.

### Approval and plan record

This record does not yet apply. Acceptance requires review of this revision and its
declared scope. Record the actual decision, reviewed revision, responsibilities and
milestones when agreed. No approver, delivery date or resource estimate is assigned.
The proposal must merge as accepted before product implementation.

Required functional evidence for delivery:

1. Test compiler and editor together for bare, wrapped and refused neighbor forms.
2. Test all nine matrix shapes, including unchanged `TS8051` `codes`, messages and spans.
3. Compare existing WGSL, reflection, host types and serialized binding layouts unchanged.
4. Verify named `blocks` and bindings in shipped and re-emitted manifest render stages.
5. Draw scalar, signed/unsigned vector and supported matrix values through both WebGL consumers.
6. Compare their pixels with WebGPU, CPU and independent JavaScript expectations.
7. Exercise changed values, generated-name collisions, shared stages and unused bindings.
8. Validate `f64` flavors, including the actual float-flavor guard, without broadening host layouts.
9. Retain broken-shader, undersized-buffer and wrong-value controls in the bounded driver checks.
10. Run the canonical build, relevant tests, lint, format and required compile and packed-journey gates.

The implementation must make `hello-uniform` emit GLSL and draw on a WebGL2-only canvas.
Its registered-example compile gate must pass both WGSL and GLSL validation. A missing
GLSL artifact or fallback to another tier cannot satisfy that evidence.

Required document evidence includes `docs:impact`, `docs:refs`, proposal scope checks,
traceability synchronization when rule-tagged tests change, and reviewed downstream impact.
Preserve historical measurements when updating current support statements.

### Configuration and validation record

This delivery record does not yet apply. The measurements above characterize the baseline
and candidate GLSL spelling. They are not evidence that TypeShade implements the proposal.
Delivery must name the accepted proposal revision, implementation PR/commits, clean build
receipt, actual tools and observed gate results. Record deviations and remaining obligations.
Compiler implementation does not establish downstream adoption.

## What it owes downstream

### typeshade.github.io

Reviewed baseline: bca213452566152ed4b1b55dbdf8294c10d9a33a, with compiler submodule
`vendor/shader-dsl` pinned to 3e1e8420a5313e045beb175131148920bfdc2d07.

[scripts/artifacts.mjs](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/scripts/artifacts.mjs) currently assigns `hello-uniform` the `no-glsl` still refusal.
Remove that exception only when its WebGL2 still passes. Supply the scalar uniform in
[src/lib/hero-shader.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/lib/hero-shader.ts) and verify the live renderer accepts the generated block and
logical binding layout. Do not assume its current struct-field packing covers a bare value.

Update the example's gallery/renderable counts, still and any affected generated records.
Review descriptions in both locales, including [src/i18n/ko.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/i18n/ko.ts)'s contrast with
hello-uniform-struct. Add a playback check for a bare value on WebGL2. Record 0127 in
`compiler-changes.md` at the adopting compiler pin. All adoption work remains pending.

### vscode-typeshade

Reviewed baseline: db3f4171d6ea4689d6048d2252b6553da4599906, with compiler submodule
`vendor/typeshade` pinned to 3e1e8420a5313e045beb175131148920bfdc2d07.

[packages/mcp-server/src/fixtures.ts](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/packages/mcp-server/src/fixtures.ts) calls `BARE_UNIFORM` a GLSL refusal.
[packages/mcp-server/src/tools.test.ts](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/packages/mcp-server/src/tools.test.ts) asserts its `TS8015` warning. Replace that diagnostic
witness with a remaining backend refusal and keep the compiler-backed check meaningful.
Add a successful bare-uniform fixture. Preserve the distinction between editor analysis
and a check that runs emitters. Record 0127 in `compiler-changes.md` at adoption.
No editor public API or syntax feature is proposed. Adoption remains pending.
