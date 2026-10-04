---
id: '0040'
title: Author explicit references and pointers in shader source
status: draft
rules:
- '4.1'
- '6.10'
- '7.1'
- '7.2'
- '8.8'
- '8.10'
- '8.17'
- '8.18'
- '8.25'
- '12.7'
- '13.9'
surface:
- 9
- 14
- 21
- 26
- 49
- 52
- 63
- 70
exports:
- ShaderType
- Expr
- Stmt
- KeyOf
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Document pointer parameters and local const reference bindings, lexical exclusive borrowing, parser syntax, target lowering and limitations; record this proposal in compiler-changes.md.
- repo: vscode-typeshade
  what: Add parser-aware diagnostics and hover for pointer types, const reference bindings, borrow origins and lifetimes; record this proposal in compiler-changes.md.
---

<!-- doc-refs: skip-file — a draft records a proposed authoring-surface change and its outstanding design questions -->

## What changes

This is a proposal for future behavior. The syntax and checks below are not implemented by this
document. The first version would support pointer parameters and function-local immutable pointer
bindings, with exclusive mutable borrowing shared by the CPU, WGSL and GLSL backends.

### Source syntax and the two meanings of const

Shader source gains C-like address/dereference operators and TypeShade pointer types:

| Form                        | Proposed meaning                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `*T`                        | One-level pointer providing exclusive read/write access to a `T` place.                         |
| `*const T`                  | One-level pointer providing shared read-only access to a `T` place.                             |
| `&place`                    | Borrow an addressable place, with access selected by the expected pointer type.                 |
| `*pointer`                  | Access the borrowed place. Its type is `T`; whether it is writable depends on the pointer type. |
| `const ref: *T = &x`        | Fix the pointer binding while allowing writes to its pointee.                                   |
| `const view: *const T = &x` | Fix the pointer binding and prohibit writes to its pointee.                                     |

`const` before a binding prevents reassignment of that binding. `const` inside `*const T` makes
the pointee read-only. Neither spelling changes the type of the original value. A pointer type
remains distinct from `T` throughout checking, diagnostics and hover; `Ref<T> = T` cannot express
these rules. These type spellings belong to TypeShade, rather than reproducing the complete C or
Rust type grammar.

The original motivating example becomes valid shader source:

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

The `main` name here is a helper-shaped syntax sample; a runnable GPU module still marks its
actual entry function with the existing stage decorator.

Local pointer bindings use `const`, including a mutable pointee:

```ts
function addOne(value: *f32) {
  *value = *value + 1.0;
}

function example() {
  let x: f32 = 1.0;
  {
    const ref: *f32 = &x;
    *ref = 2.0;
    addOne(ref);
  }
  x = x + 1.0;
  {
    const view: *const f32 = &x;
    const snapshot: f32 = *view;
  }
}
```

`const ref = &place` infers `*T` when the existing place rules make that place writable.
Authors request a read-only borrow of a writable place with an explicit `*const T` annotation or
a read-only parameter's expected type. Borrowing a read-only place infers `*const T`; an expected
`*T` then produces an error. This preserves Rule 6.10: a scalar `const x` is not writable as a
whole, while fields of a uniquely constructed local `const` aggregate may already be writable.
Borrow inference follows the addressed place's writability rather than treating every source
`const` as deeply immutable. Materializing storage never changes source-level access rights.

The expected type is applied before the borrow is established: `inspect(&x)` creates a shared
borrow when `inspect` accepts `*const T`. Passing an existing mutable pointer to a read-only
parameter creates a temporary shared reborrow; it does not permanently change that pointer's
declared type. Pointer bindings declared with `let`, pointer reassignment, and pointer copies
such as `const second = ref` are excluded from the first version. Another shared borrow can be
created with `const second: *const T = &x` when shared borrowing is already permitted.

### Borrowable places and pointer scope

The first version borrows function-local value bindings and their supported struct fields or
array elements. A place is described by its originating local binding and its field/index path;
the compiler retains that description through each dereference and permitted call reborrow.
The pointee must have a shader value type supported by the selected targets. Literal values,
temporary expressions, vector components and swizzles are not borrowable in this version.

Address-taking promotes a local to addressable backend storage. Writable borrowing also makes
the local a write target for automatic-var analysis, including writes made only by a callee. A
read-only source value may need the same storage materialization, while the checker continues to
reject source writes to it. Emitting an address of a WGSL `let` value is not a valid substitute.

Pointer parameters belong only to module-level free shader functions. Calls passing pointers
must resolve directly to those functions. Local functions, closures, callbacks, indirect calls
and class methods cannot accept or receive these pointer arguments in the first version. These
limits prevent a callee from reaching the borrowed caller local through a capture or implicit
`this` alias. They do not change existing implicit mutation handling on methods without explicit
pointer arguments.

Pointers are permitted as formal parameters and function-local `const` bindings. They cannot be
stored in structs or arrays, assigned into other bindings, returned, captured, or passed across
the JavaScript host boundary. Pointer declarations at module scope and addresses of globals,
resources or pointer bindings themselves are excluded. Taking `&*ref` is also excluded in the
first version; forwarding `ref` at a permitted call site is the supported reborrow form.

### Exclusive borrowing and lexical lifetimes

`*T` follows an exclusive mutable-reference contract. This is a TypeShade language guarantee;
the `*T` spelling does not imply unrestricted C or Rust raw-pointer aliasing.

| Active borrow        | Other access to an overlapping place                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Mutable `*T`         | Direct reads, writes and any additional borrow are rejected. Access through the owning pointer is allowed. |
| Read-only `*const T` | Direct reads and further shared borrows are allowed. Direct writes and mutable borrows are rejected.       |
| No borrow            | Access follows the original binding's mutability.                                                          |

A direct argument borrow such as `swap(&x, &y)` lasts for that call. A local pointer binding's
borrow starts after its address expression has been evaluated and lasts until the declaring block
exits. The first version does not end a borrow at the pointer's last use. An explicit inner block
therefore provides a predictable way to release a local borrow:

```ts
let x: f32 = 1.0;
{
  const ref = &x;
  *ref = 2.0;
  const value = *ref;
  // Reading x here would still conflict, even after ref's final use.
}
const value = x;
```

Pointer parameters hold their borrow for the callee's execution. Passing a parameter or local
pointer to another permitted function establishes a short-lived reborrow for that call, suspends
the original pointer's conflicting access, and restores it on return. This is not an assignment
or copy of a mutable pointer. Every argument to a call must be checked together, so `swap(ref,
ref)` fails even if arguments are evaluated sequentially. Passing a pointer where a value `T` is
expected is an error; authors write `*ref` to read the pointee.

Direct and indirect effects both count as access. While `const ref = &obj.x` is active, a method
call whose receiver effects overlap `obj.x` conflicts. A local closure capturing `x` cannot read
it during an exclusive `&x` borrow or write it during a shared borrow. Existing capture and
receiver-effect analysis must check such calls even when no explicit pointer is passed. A
pointer binding itself cannot be captured. Effects that cannot be proved disjoint produce a
diagnostic rather than bypassing the borrow check.

The same checks apply when a callback is handed to a function or an array method. Captured
values loaded to prepare that call and callback effects both count: `xs.map(v => v + x)` conflicts
with an active exclusive borrow of `x`, and a callback that writes `x` conflicts with a shared
borrow. Rule 8.18's specialized call copies must retain those capture effects. The restriction on
explicit pointer parameters for callbacks does not exempt ordinary callbacks from live-borrow
checking.

The portable first version conservatively treats every place with the same originating local
root as overlapping, including distinct fields or constant array indices. This rule applies to
both lexical borrows and pointer-call arguments. Distinct roots are disjoint; shared borrows may
share a root. WGSL alias analysis checks roots when a parameter is written, and its
unrestricted-pointer extension does not remove that check. Thus two mutable references to
`obj.a` and `obj.b` are refused even when their fields differ. A future field-sensitive checker
and call normalization may relax this limit; the first version does not promise it.
[WGSL alias analysis](https://gpuweb.github.io/gpuweb/wgsl/#alias-analysis)

Control-flow analysis preserves every borrow that can still be active along an incoming path;
loops cannot discard a live borrow at a back edge. Block exit, including an early return, ends
that block's local borrows. There are no explicit lifetime annotations or non-lexical lifetimes
in this version.

### Evaluation order and stable place identity

A borrow identifies the place selected when its address expression is evaluated. The compiler
evaluates root/index expressions once in source order and freezes dynamic indices needed to
retain that identity. Changing an index variable later does not retarget a pointer:

```ts
let i: i32 = 0;
{
  const ref: *f32 = &xs[i];
  i = 1;
  *ref = *ref + 1.0;
}
```

If that indexed source form is otherwise valid, the reference continues to name `xs[0]` after
`i` changes. GLSL projection cannot paste `xs[i]` into each dereference. It introduces an index
temporary and uses the corresponding stable l-value:

```glsl
int i = 0;
{
  int _refIndex = i;
  i = 1;
  xs[_refIndex] = xs[_refIndex] + 1.0;
}
```

Calls similarly evaluate address arguments once before using their projected places. The index
forms accepted by the existing shader language do not expand as a side effect of this proposal.
Static borrow identity, source evaluation order and runtime alias effects must agree, including
after optimization passes.

### WGSL and GLSL output

For the `swap` sample, the proposed WGSL output has this shape:

```wgsl
fn swap(a: ptr<function, f32>, b: ptr<function, f32>) {
  let temp = *a;
  *a = *b;
  *b = temp;
}

fn main() {
  var x: f32 = 1.0;
  var y: f32 = 2.0;
  swap(&x, &y);
}
```

The corresponding GLSL ES 3.00 helper shape is:

```glsl
void swap(inout float a, inout float b) {
  float temp = a;
  a = b;
  b = temp;
}

void example() {
  float x = 1.0;
  float y = 2.0;
  swap(x, y);
}
```

The local mutable reference in `example` would lower to a WGSL pointer value:

```wgsl
var x: f32 = 1.0;
{
  let ref: ptr<function, f32> = &x;
  *ref = 2.0;
  addOne(ref);
}
```

Source `const ref` becomes WGSL `let ref`. WGSL permits pointer-valued `let` declarations, but
pointer types are neither constructible constant types nor storable pointee types. Consequently
local pointers do not imply pointer arrays, pointer struct members or nested pointers.
[WGSL value declarations](https://gpuweb.github.io/gpuweb/wgsl/#value-decls),
[WGSL memory views](https://gpuweb.github.io/gpuweb/wgsl/#memory-views)

For a function-local `*const T`, WGSL still uses `ptr<function, T>`: function-address-space
pointers have native `read_write` access. TypeShade enforces read-only access before emission;
it must not invent `ptr<function, T, read>`.
[WGSL address spaces](https://gpuweb.github.io/gpuweb/wgsl/#address-spaces)

GLSL has no local pointer declaration. The compiler records `ref` as the originating place,
projects `*ref` to that l-value, and projects `addOne(ref)` to `addOne(x)`. No local pointer
variable or detached value copy is emitted. A read-only parameter uses `in T`; a mutable
parameter conservatively uses `inout T`, including when its body happens to read only. Emitting
`out T` requires proving that every path initializes the pointee before reading it and before
return; that optimization is not required by the first version.

GLSL ES 3.00 specifies parameter copying into and out of a call, with output-copy order
undefined. The exclusive borrow rules prevent an accepted program from observing conflicting
mutable aliases across those copies. The CPU oracle must model accesses to the originating
place, rather than silently passing independent scalar values.
[GLSL ES 3.00 specification, section 6.1.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)

Borrowing a supported struct field or array element locally and passing its pointer to a WGSL
function are distinct target questions. Subobject pointer arguments can require WGSL's
`unrestricted_pointer_parameters` extension. The compiler must check the capability profile and
use a supported representation, normalize to a whole-root pointer while retaining the exact
subplace and evaluation order, or report a target diagnostic. It cannot silently substitute a
detached temporary. The separate same-root mutable-call restriction still applies.
[WGSL function restrictions](https://gpuweb.github.io/gpuweb/wgsl/#function-restriction),
[WGSL language extensions](https://gpuweb.github.io/gpuweb/wgsl/#language-extensions-sec)

### Token grammar and exponentiation migration

The TypeShade lexer does not define an exponentiation token `**`; it emits two `*` tokens. The
expression parser distinguishes prefix and infix positions, and the type parser recognizes
pointer type prefixes:

| Source                     | Parsing in TypeShade mode                                                            |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `*p`                       | Dereference.                                                                         |
| `a * b`                    | Multiplication.                                                                      |
| `&x`                       | Address-of.                                                                          |
| `a & b`                    | Bitwise AND.                                                                         |
| `a && b`                   | Logical AND.                                                                         |
| `**p`                      | Two dereferences, `*(*p)`; rejected when it requires an unsupported nested pointer.  |
| `a**p`                     | Multiplication by a dereference, `a * (*p)`.                                         |
| `**T` in a type position   | Nested pointer syntax, rejected semantically in the first version.                   |
| `&&x` in a prefix position | Two address-of operations, rejected when the inner result is not a borrowable place. |
| `pow(a, b)`                | Exponentiation.                                                                      |

Prefix `&&` must be contextually split, while infix `&&` remains a logical token. Unary
address-of/dereference bind more tightly than multiplication; postfix field/index access binds
more tightly than unary operators. Use `(*ref).field` to access a field through a pointer;
`*ref.field` dereferences the result of field access instead. This proposal does not add `->` or
change existing restrictions on spread `...`.

Deleting the exponentiation interpretation is a breaking source change, including `**=`. In
TypeShade mode `a ** b` is parsed as `a * (*b)`, so it fails when `b` has an ordinary scalar type;
it must never silently keep the old power meaning. The former compound exponentiation form
`**=` is refused with migration guidance. Existing scalar exponentiation becomes `pow(a, b)`,
and exponentiation assignment becomes `a = pow(a, b)` with place evaluation preserved where `a`
is more than a simple binding. Release notes document both migrations.

The syntax applies only when `.ts` or `.shade.ts` source is compiled in TypeShade mode. Ordinary
TypeScript keeps its grammar. Recognizing repeated prefixes does not promise nested pointer
semantics: only one pointer level is supported. Null pointers, arithmetic, pointer comparisons
and arbitrary pointer casts remain excluded.

### Hover and diagnostics

Hover is derived from compiler types and place analysis, with original source spans retained
through the editor's TypeScript projection. It distinguishes a pointer from its pointee and
covers operator tokens as well as identifiers:

| Hover location                                 | Information to show                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ref` in `const ref: *f32 = &x` or a later use | `const ref: *f32`; binding fixed, pointee writable; originating place `x`; lexical borrow scope.         |
| `view` in `const view: *const f32 = &x`        | `const view: *const f32`; binding fixed, pointee read-only; originating place `x`; lexical borrow scope. |
| `&` in `&x`                                    | Address-of result type, shared/exclusive access, originating place and inferred address space.           |
| `*` in `*ref`                                  | Dereference result type `f32` and whether assignment is permitted.                                       |
| Type prefix `*` or `*const`                    | Pointer type, pointee access and supported pointer depth.                                                |
| Pointer parameter                              | Declared pointer type and call-scoped borrow; target lowering when known.                                |

Target details appear only when known: WGSL `ptr<function, f32>`, GLSL `inout float` or `in float`,
and any capability limitation. The `function` address space describes storage origin and does
not claim that source `*const T` becomes a native WGSL read-only function pointer. Frozen-index
temporaries and generated symbols do not replace source names in hover or diagnostics.

Borrow-conflict diagnostics point at the conflicting access and include the original borrow
declaration as related information. Suggestions must not imply that the compiler releases a
borrow at its last use; suggest an inner block where appropriate. Unsupported depth, invalid
address operands, pointer escape, read-only writes, host-boundary signatures, unknown
disjointness and target capability failures need distinct explanatory messages. Numeric codes
are not allocated by this draft: allocate them before acceptance and update `codes`, the
diagnostic catalog and downstream guidance together.

### Acceptance and rejection examples

These outcomes are proposed language checks, followed by the selected target's capability checks:

| Source pattern                                                                   | v1 outcome and reason                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `swap(&x, &y)` with distinct writable local roots                                | Accept: disjoint mutable borrows lasting for the call.                                               |
| `const ref = &x; *ref = 2.0` for writable `x`                                    | Accept: `*T` inference; fixed binding, writable pointee.                                             |
| `const view: *const f32 = &x; const n = *view`                                   | Accept: shared read-only access, including borrowing a writable local.                               |
| Two `*const T` borrows of `x`                                                    | Accept: shared borrows may overlap.                                                                  |
| `addOne(ref)` followed by `*ref = 3.0`                                           | Accept: short-lived reborrow ends after the call.                                                    |
| `inspect(ref)` where `inspect` accepts `*const T`                                | Accept: temporary shared reborrow from the exclusive owner.                                          |
| `swap(&x, &x)` or `swap(ref, ref)`                                               | Reject: overlapping mutable arguments.                                                               |
| Mutable and read-only arguments borrowing `x` in one call                        | Reject: exclusive/shared overlap.                                                                    |
| `swap(&obj.a, &obj.b)`                                                           | Reject: mutable pointer call arguments share a root, despite distinct fields.                        |
| Direct `x` read or write while `const ref = &x` is in scope                      | Reject: exclusive local borrow remains live to block exit.                                           |
| `x = 2.0` while a shared `view` is in scope                                      | Reject: shared borrow forbids writes.                                                                |
| Method/closure call with conflicting receiver/capture access                     | Reject: indirect access obeys the same live borrow restrictions.                                     |
| Callback handed to a function or array method with conflicting capture access    | Reject: preparing captures and invoking callbacks obey the same live borrow restrictions.            |
| `*view = 2.0` for `*const f32`                                                   | Reject: read-only pointee.                                                                           |
| `ref = &y`, `let ref: *f32 = &x`, or `const second = ref`                        | Reject: pointer rebinding/copying is outside v1.                                                     |
| `&1.0`, `&makeValue()`, `&vector.x`, or `&vector.xy`                             | Reject: invalid or excluded address operands.                                                        |
| Two local mutable borrows of `arr[i]` and `arr[j]`                               | Reject: the originating root is shared, even for provably distinct indices.                          |
| Pointer argument naming a struct field or array element                          | Accept only if place, originating-root and target capability checks succeed.                         |
| Returning a pointer, storing one in a struct/array, or capturing it              | Reject: pointer escape/storage is outside v1.                                                        |
| Address of a global/resource or an explicit pointer argument to a method/closure | Reject: unsupported storage origin or call path.                                                     |
| Nested pointer type or dereference requiring pointer-to-pointer                  | Reject after parsing: unsupported semantic depth.                                                    |
| Pointer parameter exposed to JavaScript                                          | Reject: host reference transport is outside v1; scalar mutation cannot use ordinary value arguments. |

## Why

WGSL exposes address passing, while GLSL expresses parameter access with `in`, `out` and `inout`.
TypeShade currently infers mutation modes for methods, closures and atomics, but authors cannot
name a source pointer or hover its type. Explicit references let authors express mutation at a
call site and keep a stable local reference across statements with the shared IR and three
backends.

Rust's shared references allow multiple readers, and its mutable references require exclusivity.
That distinction informs this proposal's access contract; TypeShade's spelling, lexical lifetime
rule and shader restrictions remain its own design. Rust's raw `*mut T` and `*const T` types do
not provide this exclusive-reference guarantee by themselves.
[Rust pointer types](https://doc.rust-lang.org/reference/types/pointer.html)

The TypeScript grammar rejects prefix `&x`, `*p` and `*f32` types, and interprets `**` as
exponentiation. Supporting these tokens requires TypeShade parsing and a semantic editor
projection with source positions. Erasing pointer types into `T`, or rewriting token strings
without syntax and provenance, cannot preserve hover, lifetimes and alias checks.

## What it touches

Rules 4.1, 7.1 and 7.2 admit pointer types, define unary/binary `*` and `&` by position and replace
TypeShade exponentiation syntax with `pow(a, b)`. Rule 6.10 distinguishes immutable pointer
bindings from pointee access while preserving existing aggregate-place writability. Rules 8.8
and 8.10 distinguish implicit mutation references from author-written pointers and define
addressable source places. Rule 8.17 checks captures against live borrows and excludes
pointer-binding capture; Rule 8.10 also covers receiver effects. Rule 8.18 retains capture
effects when callbacks are handed to functions or array methods. New Rule 8.25 defines pointer access, local lexical
lifetimes, reborrowing, overlap/root checks, address-space inference, depth and target limitations.
Rule 12.7 requires compiler/editor agreement on source pointer types, operator hover and spans.
Rule 13.9 records the breaking `**`/`**=` migration and the next minor release before 1.0.

Surface §9 gains writable dereference targets, §14 the local pointer-binding/capture limits and
§21 lexical borrow scopes. Surface §26 explains the relationship to implicit `this` lowering
without admitting explicit pointer parameters on methods. Sections §49 and §52 document hover,
source projection and operator parsing; §63 explains live-borrow constraints on array callbacks,
and §70 documents the complete pointer authoring contract.
The authoring guide and roadmap reflect local bindings; the changelog records the exponentiation
migration. Adding pointer types and address/dereference operations is expected to reshape the
existing recorded IR definitions `ShaderType`, `Expr`, `Stmt` and `KeyOf`; those shapes are
declared above even though no new public authoring helper is proposed. Implementation rebakes
the API surface and stays within the declared shape impacts; any further expected definition
changes identified during design must be declared before acceptance. The public
barrel does not gain direct imports of private core modules. No registered example is added by
this draft; planned examples and any new exports must be declared before acceptance.

### Implementation phases

1. Agree the syntax, exclusions, lifetime contract and target capability policy; allocate
   diagnostics and finalize declared impacts before accepting the proposal.
2. Add TypeShade lexer/type and expression parsing, original source spans and semantic
   language-service projection. Preserve ordinary TypeScript outside TypeShade mode.
3. Extend pointer types and place/provenance representation through the IR, portable
   representation and every visitor. Add contextual access inference, lexical borrow/call-effect
   checking, reborrowing and automatic storage materialization. Review serialized IR compatibility
   and cache identities when new type/node tags are introduced; the runtime and emitter retain
   their existing dependency boundary from the TypeScript front end.
4. Lower WGSL pointers, GLSL place projections and CPU place accesses over the shared walk.
   Freeze dynamic indices and check target capabilities without detached-copy fallbacks.
5. Add symbol/expression/operator hover, related diagnostic spans, debugger type display and
   host-signature checks. Update normative rules, surface, guide and downstream documentation.

An accepted subset must not enable syntax ahead of its checking and backend semantics. Parser
recognition alone is not an implementation of this feature.

### Validation evidence required for implementation

The implementation demonstrates source token distinctions, exponentiation migration failures,
one-level pointer type checking and original diagnostic/hover positions. Tests cover both
meanings of `const`, contextual shared inference, existing aggregate mutability, mutation through
callees, parameter/local reborrows, lexical block exit, control-flow joins, receiver/capture
effects, callback handoffs and specialized array calls, conflicting arguments and invalid pointer
storage/escape. Negative probes show that
the checker rejects overlap rather than merely finding no diagnostics on accepted input.

CPU, WGSL and GLSL checks agree on `swap`, mutable local bindings, shared reads and successive
reborrows. Dynamic-index probes demonstrate one evaluation and a stable element after index
mutation. Real target compilation covers whole-local pointers and enabled subobject capability
paths; unsupported profiles yield source diagnostics. Same-root mutable calls remain rejected
with the unrestricted-pointer extension enabled. Read-only source locals materialize valid WGSL
storage without becoming writable in source, and source `const` pointers emit as WGSL `let`.

Required repository gates include the build, unit suite, compile gate and CPU/GPU parity checks
appropriate to changed emit semantics, plus a user journey for the expanded authoring surface.
Documentation impact, references, traceability, formatting and downstream records remain part
of completion. This proposal records required evidence; it does not claim that implementation
checks have already passed.

## What it owes downstream

The site documents the two meanings of `const`, inferred versus explicitly shared borrowing,
lexical lifetimes, reborrow calls, overlap/root errors, token migration and target output.
Examples include direct `swap(&x, &y)` and an inner-block local reference, with a conflicting
access example and the capability-dependent subobject limitation.

The editor accepts TypeShade tokens through parser-aware integration and shows pointer types,
pointee access, originating places and borrow scope at identifiers and operators. It must not
present generated TypeScript errors as source language errors. Both downstream repositories
update diagnostic guidance after code allocation and record `0040` when vendoring the implementation.
