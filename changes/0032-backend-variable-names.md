---
id: '0032'
title: Keep TypeScript variable names and escape their backend spellings
status: accepted
rules:
- '3.2'
- '3.3'
- '3.4'
surface:
- 62
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Update reserved-name guidance from surface section 62 to show legal TypeScript variables being escaped in shader output
- repo: vscode-typeshade
  what: Update reserved-name and TS8068 guidance for locals, parameters, module constants and module variables
---

<!-- doc-refs: skip-file — a draft proposal names planned changes and downstream work -->

## What changes

TypeScript-valid local variables, parameters, module constants and module variables may be
named `target`, `discard`, `half`, or another spelling a backend reserves. The emitter creates
a copy with collision-free identifiers and rewrites every corresponding declaration and
reference. CPU evaluation, authored IR, source diagnostics and debugger names retain their
source spelling. JavaScript syntax and strict-mode restrictions remain in force.

The name allocator reserves authored names and names it creates, including names in nested
and sibling scopes. It handles constant-expression initializers and module-variable reads
and writes. Both WGSL and GLSL use the same rewrite, with each backend's existing reserved
word authority and identifier shape restrictions. A program without an affected variable
retains its existing output.

Bindings, overrides, entry functions, structs and fields keep their existing host and
interface naming contracts and diagnostics. This change adds no public API or host name
mapping. GLSL helper function renaming continues to work as before.

## What it touches

- Rules 3.2, 3.3 and 3.4 and surface section 62 explain source names versus backend spellings.
- The TS8068 table in the language-service API retains the remaining refusal categories.
- `src/core/passes/variable-names.ts` supplies the shared emit-copy rewrite; WGSL and GLSL
  invoke it with their own reserved-name predicates.
- `src/compiler/ts/reserved-names.ts` stops refusing the variable categories the backends
  can represent, and its tests retain refusals for unchanged categories.
- Regressions cover reserved variables, suffix collisions, scopes, constant expressions,
  caller values, CPU evaluation, the language service and actual GPU compilation.
- A backend-variable-names journey exercises the packed package as a consumer.
- Derived requirements and their suspect links must be synchronized and reviewed.

## Local review status

The user explicitly requested this behavior during the issue investigation. This proposal
stays draft alongside a reviewable local implementation; no accepted merge is claimed.
