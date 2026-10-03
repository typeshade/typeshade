---
id: '0034'
title: Accept loose equality as the shader equality operator
status: accepted
rules:
- '7.1'
surface:
- 28
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

## What changes

`==` and `!=` are accepted wherever `===` and `!==` are accepted. TypeShade treats the four spellings as the same typed comparison; it does not implement JavaScript coercion. The operands must still have one compatible shader type.

## Why

GLSL ES and WGSL each provide one typed equality operation, and TypeShade already rejects mixed numeric types before lowering. Refusing the JavaScript spellings adds authoring friction without preserving a useful runtime distinction for shader values.

## What it touches

Rule 7.1 and the surface operator/refusal text change. The expression lowering and integration tests pin that `==`/`!=` lower to the same IR and emitted operators as `===`/`!==`.

## What it owes downstream

No downstream repository is listed because this expands accepted source syntax without changing generated interfaces or exports.
