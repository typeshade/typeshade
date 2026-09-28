---
id: '0021'
title: Add a class-based 3D SDF ray-tracer example to the TypeShade examples surface
status: accepted
rules: []
surface: []
exports: []
exports-removed: []
codes: []
examples:
- rt-renderer-class
downstream: []
---

<!-- doc-refs: skip-file — a proposal names the tests and the messages it will add, which this tree does not have yet -->

## What changes

This change adds `examples/rt-renderer-class.shade.ts`, a concrete example of a real-time 3D
signed-distance-field renderer written entirely with the current `"use typeshade"` surface.

The example uses ordinary TypeShade classes for the renderer's domain model:

- `Ray`, `Material`, `SdfSphere`, `SdfBox`, `SdfTorus`, and `SdfPlane`;
- `PointLight`, `Camera`, `Scene`, `Hit`, and `Renderer`.

The scene is represented by 3D SDF distance functions. The renderer performs sphere tracing,
finite-difference surface normals, hard shadows, direct lighting, emissive contribution, cosine
weighted secondary directions, reflections, and per-pixel sampling.

The example has a fragment and vertex entry suitable for the repository's existing renderable
example pipeline, so the compiler emits the corresponding WGSL and GLSL ES 3.00 goldens.

No TypeShade language rule, public export, diagnostic code, or runtime API is added or changed by
this example.

## Why

The repository needs a concrete end-to-end example that demonstrates what the existing TypeShade
class surface can express when the program is a substantial 3D renderer rather than a small shader
snippet.

A ray-traced SDF scene exercises several existing capabilities together: classes with fields and
constructors, method calls, object composition, mutable local state, bounded loops, vector math,
conditionals, functions, and renderable entry points.

This is an example-only change. It deliberately does not introduce a new renderer abstraction or
new runtime API. The purpose is to pin the current language surface against a realistic workload.

## What it touches

- **Example `rt-renderer-class`.** Adds the class-based 3D SDF ray tracer under
  `examples/rt-renderer-class.shade.ts`.
- **Emit goldens.** Adds the WGSL, GLSL ES 3.00 vertex, and GLSL ES 3.00 fragment output under
  `examples/__emit-goldens__/` so the example remains covered by the existing golden and
  renderable-example tests.
- **Rules, surface, exports, codes.** None. The example uses the existing accepted language and
  runtime surface without extending it.
- **Tests.** The existing `examples/examples.test.ts` and golden emission suite pin the example
  and its generated WGSL/GLSL output; the existing compile, Tint, and user-journey gates continue
  to validate that the example remains compatible with the checked compiler/backend surface.

## What it owes downstream

Nothing. The change adds a repository example but does not remove, rename, or change a documented
language feature or public API.
