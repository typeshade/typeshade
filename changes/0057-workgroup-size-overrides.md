---
id: '0057'
title: 'Specialize compute workgroup dimensions and workgroup array lengths from one override'
status: draft
rules:
- '6.5'
- '8.7'
- '11.10'
- '11.11'
surface:
- 3
- 15
- 24
- 69
exports:
- EntryInfo
- PackEntry
- ComputePipeline
exports-removed: []
codes: []
examples:
- workgroup-override
downstream:
- repo: typeshade.github.io
  what: Document override identifiers in @compute and workgroup array lengths, host selection through program.compute constants, resolved workgroup shape, backend limits and unsupported WebGL2 cases; record 0057 in compiler-changes.md.
- repo: vscode-typeshade
  what: Keep parser diagnostics, hover and completion accurate for override-sized @compute dimensions and workgroup arrays; record 0057 in compiler-changes.md.
---

**Document control**

| Field | Record |
| --- | --- |
| Document | Proposal 0057; this file is the proposal source. |
| Revision context | 2026-10-11, Asia/Seoul. This is the draft date, not an approval or delivery date. |
| Request source | GitHub issue [typeshade/typeshade#560](https://github.com/typeshade/typeshade/issues/560), opened by Seungup. This proposal text was prepared at the request of the issue owner. |
| Current lifecycle state | `draft`. The front matter is authoritative. |
| Applicability / effectivity | TypeShade source programs, the CPU oracle, the WGSL program runtime, the WebGL2 compute tier, reflection and downstream documentation. No release version is assigned. |
| Review baseline | `main` at `946b0ea7640a397fff53c4481dbf6d26c254d8af` (the proposal PR base). |
| Proposal review | Review this draft on [typeshade/typeshade#561](https://github.com/typeshade/typeshade/pull/561); the front-matter status remains `draft` until accepted. |
| Revision authority | Git records revisions. Review and merge records establish acceptance. |

The issue requests one `override<u32>` to control a compute entry's first workgroup dimension, a workgroup scratch array length, and shader calculations. This proposal keeps the issue's one-source authoring goal. It does not select an approver, schedule or release version.

## What changes

A TypeShade source file may use a named compile-time integer constant or a pipeline override identifier in the `@compute` dimensions. A workgroup array may use the same override identifier as its outer element count. The compiler preserves that identifier through lowering, reflection and manifest packing; it does not replace the array length with the override's default.

```ts
"use typeshade";

const WG_SIZE: override<u32> = 64;
let scratch: workgroup<array<f32, WG_SIZE>>;

@compute([WG_SIZE, 1, 1])
export function reduce(/* inputs */) {
  // Workgroup strides and reduction bounds may also read WG_SIZE.
}
```

The emitted WGSL uses the same declaration in both places:

```wgsl
override WG_SIZE: u32 = 64u;
var<workgroup> scratch: array<f32, WG_SIZE>;
@compute @workgroup_size(WG_SIZE)
```

An ordinary TypeScript host selects a specialization from the input shape with its own condition, then passes that value through the existing program-runtime `constants` option. For example, the host can choose 64 for narrower inputs and 256 for wider inputs:

```ts
const selectedSize = columns >= 4096 ? 256 : 64;
const pipeline = await program.compute("reduce", { constants: { WG_SIZE: selectedSize } });
```

The TypeShade source remains authored once. The host condition selects the pipeline specialization; it does not rewrite or choose between shader source files. The runtime caches each value set as its own pipeline, as specified by change 0028. `ComputePipeline` reports its resolved `workgroupShape` so the host can derive workgroup counts from the specialization it selected.

The first version is limited to integer constants and overrides that WGSL accepts in these contexts. A symbolic array count is valid only as the outer count of an array stored in workgroup memory. The compiler refuses runtime or uniform values, unsupported address spaces, nested override-sized arrays, non-positive specialized dimensions and dimensions beyond the active device's limits with diagnostics that identify the declaration or entry. Numeric-literal syntax remains valid.

The CPU oracle evaluates a dispatch with the same override values, workgroup shape and scratch-array length as WebGPU. The WebGL2 tier reports a clear unsupported-specialization diagnostic for a non-default override-sized workgroup shape; this proposal does not promise a WebGL2 lowering for that specialization. Numeric, non-specialized workgroup declarations continue to use their existing tier behavior.

## Why

TensorFlow.js selects a workgroup size from the tensor shape, then uses that size for the scratch array and reduction stride. TypeShade currently accepts a host-computed `workgroupSize` through its builder, but that does not let a shader author express one source-language override shared by `@compute`, workgroup memory and kernel expressions. The source parser accepts only numeric literals for `@compute`, and workgroup array lengths are currently fixed numeric sizes.

The program runtime already accepts named override values and keys its WebGPU pipeline cache by those values (change 0028). The proposal extends the source compiler and manifest/reflection path to connect that existing host API to the workgroup shape. It does not add a second host-side constants API.

The alternatives are to author separate 64/256 shader files, generate WGSL or TypeShade source strings on the host, or use the `fn()` builder. Each requires the host to duplicate or construct the kernel instead of selecting a specialization of the shader the developer authored once. A shader-side runtime branch cannot change the pipeline's workgroup dimensions or the workgroup array's type.

## What it touches

- **Rule 6.5:** permit a workgroup array's outer element count to be a valid override expression while keeping the declaration in workgroup space.
- **Rule 8.7:** extend `@compute` dimensions from numeric literals to named compile-time constants and pipeline overrides; retain default dimensions, shape reflection and device-limit diagnostics.
- **Rule 11.10:** carry symbolic workgroup dimensions in the manifest so the runtime can resolve them using the same named constants it supplies to the pipeline. Keep existing manifests readable; decide before acceptance whether the optional metadata requires a schema increment.
- **Rule 11.11:** resolve and validate a specialized shape when the runtime creates a compute pipeline, and expose that resolved shape through `ComputePipeline`.
- **Surface §3:** document accepted `@compute` dimension expressions and the numeric-literal compatibility path.
- **Surface §15:** document the workgroup-size use of an override and the WGSL restrictions.
- **Surface §24:** document override-sized workgroup arrays and the permitted outer-array form.
- **Surface §69:** document host selection through `program.compute(..., { constants })`, the resolved pipeline shape, cache behavior and the WebGL2 diagnostic.
- **Exports:** add resolved `workgroupShape` to `ComputePipeline`; extend `EntryInfo` and `PackEntry` with the symbolic workgroup-dimension metadata needed by reflection and the runtime. Do not export a new core IR type.
- **Codes:** keep existing diagnostics where possible. Add a diagnostic code only if an existing code cannot describe a newly refused form without misrepresenting it.
- **Example and validation:** add `examples/workgroup-override.shade.ts` and a user journey for selecting 64 and 256 from input shape. Validate same-override emission, workgroup array size, reduction results, switching back to a cached pipeline, default and raised device limits, CPU parity, and the WebGL2 refusal. Tint must compile each WGSL variant.
- **Downstream:** the site documents the new authoring/runtime behavior; the VS Code extension documents and presents the same diagnostics and types. Their exact files must be confirmed during acceptance review.

### Draft impact estimate

The compiler work crosses source parsing, symbolic type/IR metadata, validation, WGSL emission, manifest reflection, pipeline construction and the CPU evaluator. The WebGL2 path needs a named refusal and regression coverage. The exact effort and release date are unestimated. This draft does not include a dependency change.

Before acceptance, review must settle whether symbolic shape metadata changes the pack schema, which reflection field records the expression, and whether the WebGL2 unsupported case is acceptable for the first release. The WebGPU API path reuses the existing named `constants` option from 0028.

### Approval and plan record

This record does not yet apply. Acceptance requires review of this draft and a proposal-only pull request merged with `status: accepted`. No approval, decision owner, implementation assignment, milestone or estimate is recorded.

### Configuration and validation record

This record does not yet apply. Delivery requires implementation commits naming `Change: 0057`, the compiler and downstream configurations they affect, and retained functional and document validation evidence. No implementation or check result is claimed.

## What it owes downstream

- `typeshade.github.io`: update the authoring guide, compute-entry and workgroup-memory reference, override guide, error reference and runtime guide for the behavior above. Record 0057 in `compiler-changes.md` when the downstream change is made.
- `vscode-typeshade`: update the language-service guide and diagnostics/hover behavior for the accepted syntax. Record 0057 in `compiler-changes.md` when the downstream change is made.

The downstream repositories and exact pages have not yet been inspected. These obligations are draft scope, not evidence of downstream work or agreement.
