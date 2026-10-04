---
id: '0040'
title: Author explicit references and pointers in shader source
status: draft
rules:
- '4.1'
- '7.1'
- '7.2'
- '8.8'
- '8.10'
- '8.25'
- '13.9'
surface:
- 26
- 52
- 70
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Add the explicit reference and pointer syntax, its target lowering and its limits to the authoring guide and editor examples; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Add parser-aware diagnostics and hover guidance for references and pointers; record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — a draft records a proposed authoring-surface change and its outstanding design questions -->

## What changes

Shader source gains C-like address/dereference operators and TypeShade pointer types: `*T` is a
mutable pointer type, `*const T` is read-only, `&place` takes the address of a place, and
`*pointer` dereferences it. For example:

```ts
function swap(a: *f32, b: *f32) {
  let temp = *a;
  *a = *b;
  *b = temp;
}

function main() {
  let x: f32 = 1.0;
  let y: f32 = 2.0;
  swap(&x, &y);
}
```

One-level mutable pointer parameters use `*T`, matching the example. A read-only pointer uses
`*const T`; `&place` takes the address only when the place's mutability satisfies the expected
parameter type. The type checker must reject writes through a read-only pointer. The compiler
analysis and hover preserve pointer types as `*T` or `*const T`; they are not aliases for `T`.
These type spellings belong to TypeShade; the familiar part is the address, dereference,
multiplication and bitwise operators, not an exact C or Rust type declaration grammar.

WGSL receives address-space-correct `ptr<...>` parameters and address/dereference operations.
GLSL ES 3.00 receives `in`, `out` or `inout` parameters where the source reference can be
represented as a parameter; a pointer value that cannot be represented by GLSL is diagnosed for
that target. For `swap`, WGSL is expected to use `ptr<function, f32>` parameters and calls such as
`swap(&x, &y)`, while GLSL uses `inout float` parameters and `swap(x, y)`. The first slice takes
addresses only of function-local places at a call site: local bindings and their struct fields or
array elements. It does not take addresses of module variables, resources, or pointer dereferences.
Pointer types are accepted on function parameters; pointer values cannot be stored in locals,
structs or arrays, or returned. Pointer parameters are limited to module-level free functions;
pointer arguments cannot be passed through local functions, closures, callbacks or class methods.
Hover reports the TypeShade pointer type at declarations, uses and operators, and names the emitted
WGSL pointer address space when one is known.

`*T` is proposed to behave as an exclusive mutable reference for the duration of a call, not as a
C raw pointer with unrestricted aliasing. A mutable argument must be disjoint from every other
pointer argument to that call, including read-only arguments; multiple read-only arguments may
overlap. The compiler accepts `swap(&x, &y)`, rejects `swap(&x, &x)` and a mutable/read-only
overlap, and diagnoses places whose disjointness it cannot establish. Since only local places can
be borrowed, pointer values cannot escape, pointer parameters are limited to module-level free
functions, and pointer arguments cannot be passed through closures or methods, the callee cannot
reach a borrowed local through a global, resource, capture or implicit `this` alias. This keeps CPU,
WGSL and GLSL behavior aligned: GLSL ES 3.00 defines `inout` using copy-in/copy-out, and leaves the
order of copying output parameters back undefined, so aliased mutable calls cannot preserve
ordinary pointer aliasing there. This is closer to Rust's exclusive mutable-reference guarantee
than C's raw-pointer semantics.

The `main` body in the example is a helper-shaped syntax sample; a runnable GPU module still marks
its actual entry function with the existing stage decorator.

Taking a writable address makes the addressed local a write target for the existing automatic-var
lowering, so `x` and `y` emit as WGSL `var` values. Taking the address of a place that cannot be
written through is refused when the expected pointer type is mutable; use a read-only pointer for
that place.

The TypeShade-only lexer does not define `**` as an exponentiation token. It emits two `*` tokens,
and a Pratt parser decides from position whether each is multiplication or dereference. Thus
prefix `**p` parses as two dereferences, while `a**p` parses as `a * (*p)`; exponentiation is
written `pow(a, b)`. Type-position `**T` is a nested pointer type. Prefix runs of `&` likewise
parse as repeated address-of operators; infix `&` remains bitwise AND and infix `&&` remains
logical AND. This differs intentionally from ordinary TypeScript, whose own `**` grammar is
unchanged outside TypeShade compilation.

The first version supports one pointer level across both targets and only pointers to valid shader
places and flows the compiler can prove. It does not promise null pointers, pointer arithmetic,
arbitrary casts, escaping local addresses, pointer returns or mutable pointer parameters on
host-callable exports. Exported functions invoked from JavaScript therefore cannot expose a
mutable pointer as an ordinary `T`; their host signature remains value-based. Nested pointer
syntax is parsed, then rejected with a source diagnostic in the first version because WGSL's
pointer store type must be storable and a pointer is not a storable type; GLSL ES 3.00 also has no
pointer-to-pointer representation. This leaves room for a future target-specific pointer
extension without implying unsupported semantics.

## Why

WGSL already uses pointers for explicit address passing, and GLSL ES 3.00 expresses parameter
access with `in`, `out` and `inout`. Today TypeShade infers these modes for mutating methods,
closures and atomics, but authors cannot name a reference in source and the editor cannot hover a
source pointer type. An explicit surface would let shader authors express aliasing and mutation
at the call site while retaining TypeShade's shared IR and target-specific lowering.

The source is parsed through TypeScript today. Its grammar rejects `*f32` types, prefix `&x` and
`*p`, and assigns `**` to exponentiation. This proposal therefore includes a TypeShade lexer and
Pratt expression parser plus source-position mapping for compiler diagnostics and language-service
requests. In TypeShade mode `**` is two `*` tokens, not a compound token, and exponentiation is
`pow(a, b)`. The syntax is enabled only when a `.ts`/`.shade.ts` file is compiled as TypeShade
source; ordinary TypeScript parsing keeps its existing grammar. Adding ordinary TypeScript helpers
alone cannot meet the requested token syntax.

## What it touches

Rules 4.1, 7.1 and 7.2 are updated to admit pointer types, define unary and binary `*`/`&` by
position, and remove `**` exponentiation from TypeShade source in favor of `pow(a, b)`. Rules 8.8
and 8.10 distinguish implicit mutation references from author-written pointers and define which
source places may be addressed. New Rule 8.25 defines pointer types, mutability, aliasing,
address-space inference, the single supported pointer level, target support and the initial
exclusions. Rule 13.9 records that dropping exponentiation syntax is a breaking source change and
requires the next minor release before 1.0; the changelog must show `pow(a, b)` as its migration.
Surface §26 gains the explicit pointer form alongside the existing `this`/`inout` lowering, §52
specifies the operator syntax, and §70 documents the authoring syntax and target output. The
roadmap moves one-level pointers and reference parameters out of the after-1.0 deferrals.

The planned implementation updates the TypeShade parser/projection, the `Expr`/`ShaderType` IR and
portable representation, type and place checking, every IR visitor, WGSL/GLSL lowering, the CPU
oracle/code generator, debugger type display, and the language-service symbol/expression hover
tables. Pointer arguments to host-callable exports remain refused until a host reference wrapper
can preserve scalar mutation rather than pretending the pointer is a by-value `T`. Tests cover
read-only and mutable pointers, writes and rejection of overlapping or uncertain mutable borrows,
WGSL address spaces, GLSL `in`/`out`/`inout` lowering and honest target refusals, source-span
diagnostics, hover at declarations and uses, and rejection of invalid or escaping places. No new
top-level export is expected unless the agreed TypeScript projection requires a public type
helper.

## What it owes downstream

The site must document how to write references, what each target emits, and which pointer shapes
GLSL ES 3.00 cannot express. The editor extension must accept the new syntax without TypeScript
parser errors and show the compiler's reference types and address-space details on hover. Each
downstream repository records `0040` when it vendors the implementation.
