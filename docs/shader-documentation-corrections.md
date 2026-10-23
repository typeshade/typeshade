# Shader documentation corrections

The owner approved these documentation corrections on 2026-10-23 (UTC).
The review baseline is compiler commit `eb5c3378cd4ffb8f74a9aede8f70cb3bde5155b5`.

## Scope

- Describe the WGSL accuracy allowance for `fma` without promising a single rounding.
- Distinguish GLSL ES precision requirements from a particular device's numeric format.
- Distinguish the emulated `f64T` representation from native GPU double precision.
- Reconcile vertex reflection descriptions with the implementation's packed layout.

These corrections change explanations, not exported shapes or compiler behavior.
The site must update its compiler pin and the affected Korean translations.
Verification results and implementation evidence will be recorded before completion.

## Findings

WGSL's `fma` accuracy allowance includes separate multiply and add operations.
GLSL ES 3.00 sections 4.5.1 to 4.5.4 define precision requirements and stage defaults.
They permit higher implementation precision; mediump does not mandate binary16.
WGSL and GLSL ES 3.00 lack native double-precision shader types, independently of hardware capability.

`vertexLayoutOfEntry` in `src/core/vertex-layout.ts` advances by each format's size without std430 alignment.
A scalar followed by vec3 therefore has offsets 0 and 4, with stride 16.
The existing manifest assertion for vec3 followed by vec2 uses offsets 0 and 12, with stride 20.
Only the stale descriptions changed; buffer layouts and compiler output remain unchanged.

## Evidence

- Read the WGSL `fma` specification and the GLSL ES 3.00 precision specification.
- Reviewed all documentation-impact references; their descriptions remain accurate because no behavior or exported shape changed.
- `bun run docs:impact`, `bun run docs:refs`, `bun scripts/ifchange.ts`, and `bun scripts/changes.ts` passed.
- The source changes are comments only. No tests were added or run locally.
- Current-head CI remains the merge gate; build, lint and format results will be recorded on the pull request.
