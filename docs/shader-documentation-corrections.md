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
