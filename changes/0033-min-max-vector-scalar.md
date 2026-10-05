---
id: '0033'
title: Componentwise min and max accept a scalar broadcast beside a vector
status: accepted
rules:
- '9.2'
- '12.7'
surface:
- 10
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a proposal records the authoring-surface change and its tests -->

## What changes

`min(vecN, scalar)` and `max(vecN, scalar)` are valid TypeShade source. The compiler lowers the
scalar to a vector splat before either backend emits the builtin, preserving one componentwise
meaning across WGSL, GLSL ES 3.00 and the CPU oracle.

## Why

The EDSL and CPU tier already define componentwise scalar broadcasting. Refusing the source form
only because WGSL's builtin overload table lacks it leaks a backend restriction into the authoring
language. The backend receives the explicit vector form it requires.

## What it touches

The TypeScript front end, ambient language-service declarations, math diagnostics, backend-facing
lowering tests and the surface documentation change together. The compiler test pins native float
and integer vectors, `Math.min`, and the emitted WGSL splat.

## What it owes downstream

Nothing: this is an additive authoring form with no exported API change.
