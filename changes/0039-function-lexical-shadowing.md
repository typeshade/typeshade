---
id: '0039'
title: Let function parameters and locals shadow module values
status: implemented
rules:
- '3.2'
surface:
- 21
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Update lexical scope guidance and TS8023 examples so a function parameter or local may shadow a module value; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Update lexical scope authoring guidance and diagnostics fixtures; record this proposal in compiler-changes.md.
---

## What changes

A function's parameters and body locals occupy a lexical scope inside the module's scope, as they do in TypeScript. A parameter or top-level body local may shadow a module constant, resource binding, override or module variable. A closure resolves and captures the nearest declaration. Duplicate declarations in the same scope, including a body local that repeats a parameter, remain errors. TypeScript's strict-mode restrictions on `eval` and `arguments` remain errors.

The compiler gives shadowing declarations distinct IR names and emits consistent references on WGSL and GLSL. Calls retain parameter order and types. Reflection and diagnostics retain authored parameter names where names are part of their existing contracts. Receiver and closure inputs must not collide with module declarations or each other when emitted.

## Why

Issue #429's pasted noise helper declares a local `u: vec2` while the shader declares a module uniform `u: uniform<Frame>`. TypeShade rejects the local as a duplicate and then reads `u.x` against `Frame`. Both declarations and their lexical resolution are valid in TypeScript. The same shared scope erroneously rejects a parameter that shadows a module value.

## What it touches

Rule 3.2 states the scope boundary for authored value names. Surface section 21 removes its documented refusal of top-level body locals and parameters that repeat module declarations. No new exports, diagnostic codes or examples are introduced.

The lowering scope separates module values from parameters and body locals. Function lowering consistently binds renamed parameter IR inputs, mutable parameter copies, class receivers and closure captures. The symbol table keeps authored parameter names. Existing block-scope, parameter, class and closure tests cover these interactions. The previous TS8023 parameter-refusal regression becomes an acceptance regression, and a journey exercises local and parameter shadowing through the packed compiler, editor, CPU oracle and WebGPU. Derived rule and surface requirements are synchronized and reviewed.

## What it owes downstream

The site and editor update lexical scope guidance and TS8023 fixtures. Any wording that tells users to rename a parameter or top-level body local solely because a module value has the same name must be removed. Both record this proposal when pinning the implementation.
