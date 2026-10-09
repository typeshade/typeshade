---
id: '0029'
title: A function the file declares wins over every builtin function of its name, on WebGPU, on WebGL2 and on the CPU
status: implemented
rules:
- '3.2'
- '9.5'
surface:
- 10
- 15
- 62
- 69
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Rule 9.5 lets a function the file declares or imports win over a builtin of the same name only
for the names item 8 added (`USER_FIRST_BUILTINS`). The builtins that came earlier (`fract`,
`pow`, `clamp`, `min` and the rest) keep their precedence over the author's function. That
precedence holds in the constant folder and on the CPU, and nowhere else (#403):

```ts
"use typeshade";
declare const out: storage<array<f32>, "read_write">;
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
@compute([1])
export function main() { out[0] = fract(out[1]); out[2] = fract(1.25); }
```

| Call, `out[1]` holding 1.25 | WGSL                      | WebGPU                | CPU oracle        |
| --------------------------- | ------------------------- | --------------------- | ----------------- |
| `fract(out[1])`             | `out[0] = fract(out[1]);` | 0.75, the declaration | 0.25, the builtin |
| `fract(1.25)`               | `out[2] = 0.25;`, folded  | 0.25, the builtin     | 0.25, the builtin |

- The WGSL writer emits the declaration under its own name, `fn fract`. A module-scope
  declaration hides a predeclared function in WGSL, so every `fract(…)` of the module reaches the
  author's function on WebGPU. That includes the ones the compiler writes itself:
  `random(p)` expands to `fract(sin(dot(…)) * …)`, and beside a declared `fract` that expansion
  calls the declaration on WebGPU and the builtin on the CPU.
- The GLSL writer emits it too, and GLSL ES 3.00 does not let a program redeclare one of its
  builtins. ANGLE refuses the module (`'fract' : Name of a built-in function cannot be
redeclared as function`, surface §10), so it has no WebGL2 program, and `compile()` reports
  nothing.

One program, three answers. After this change:

- **A function the file declares or imports wins over every builtin function of its name**: a
  WGSL built-in function, the free spelling of a `Math` member, and a TypeShade extension that
  is a function (`random`, `sum`, `fill`, …). A call of the name reaches the declaration in the
  constant folder, on the CPU, on WebGPU and on WebGL2, as TypeScript's lookup and WGSL's scoping
  both have it. `USER_FIRST_BUILTINS` stops being a list of exceptions: every builtin function is
  user-first.
- **A value constructor keeps Rule 4.2's direction.** A declaration named like a scalar cast, a
  vector, a matrix or `array` (`f32`, `vec3`, `mat2x2f`, …) does not take a constructor call, as
  an alias does not take a type name. `bool` and `f64` stay the declaration's, as today: files
  declared functions of those names before item 8 made them callable.
- **Each writer emits a declared function whose name its target predeclares under a name the
  target does not have**, and every call through the declaration (`declRef`) with it. A builtin
  call keeps the builtin's name, the author's and the compiler's own alike. In WGSL that is a
  built-in function or a predeclared type or type-generator (a declared `f32` today hides the
  type in the whole module). In GLSL ES 3.00 it is a built-in function, beside the reserved words
  the writer already renames (Rule 3.4). The name is the one the GLSL writer's rename gives, `fract_`
  and then `fract_1`, so both targets spell it the same way.
- **A fold's callback follows the call.** `zip(xs, ys, atan2)` beside a declared `atan2` is
  refused today, because the intrinsic wins and a fold has no intrinsic-valued callback. It calls
  the declaration, as `zip(xs, ys, fma)` beside a declared `fma` already does.

## Why

- **The rule's second clause does not hold where it matters most.** It was written so that "a
  program that meant the builtin before the rule existed must keep meaning that", but no program
  declaring an old builtin's name ever meant the builtin on WebGPU: WGSL has always called the
  declaration there. The clause holds on the CPU and in the folder, which is how the three
  answers above arise, and it makes such a module fail on WebGL2.
- **The editor already resolves the call to the declaration.** TypeScript finds the module's
  `fract` before the ambient one, so hover, go-to-definition and rename all show the author's
  function (Rule 12.7 makes the compiler and the editor one vocabulary). Keeping the rule would
  keep the editor promising what the compiler does not do.
- **Nothing published moves.** `0.1.0` is not released, and the one target that ever ran such a
  program already calls the declaration.

Alternatives considered:

- **Keep Rule 9.5, and rename the declaration in both writers** so that every call of the name
  reaches the builtin on every target. The three answers become one, but the author's function
  is reachable only as a value (`xs.map(fract)`), the editor keeps showing the declaration where
  the compiler calls the builtin, and WebGPU's meaning of the program moves away from WGSL's own
  scoping. This is the fix if the rule is kept, and it needs no proposal.
- **Refuse a declaration named like a builtin**, with a new code. WGSL and TypeScript both allow
  one, and item 8 already made the opposite promise for every name it added.

## What it touches

- **Rule 9.5**: a function the file declares or imports wins over every builtin function of its
  name. A value constructor keeps its precedence, as a type name does over an alias (Rule 4.2),
  except `bool` and `f64`. Each writer emits the declaration under a name its target does not
  predeclare. The recorded divergence and the note that a GLSL builtin's name leaves a WGSL-only
  module go.
- **Surface §10**: the precedence paragraph, the caveat on declaring a GLSL builtin's name
  (`exp2`, `fwidth`, ANGLE's refusal), which the rename answers, and the fold paragraph
  (`zip(xs, ys, atan2)`).
- **Rule 3.2**: the compiler emits a declared name as written, and the rule lists the names it
  emits otherwise. The list gains the module function Rule 9.5 renames because its target
  predeclares the name. An entry point, a binding and an override are still never renamed.
- **Surface §15**: a `textureSample`, `textureLoad` or other texture function the file declares
  is still the author's function, emitted under a name the target does not predeclare. The
  section says it is emitted under the name written.
- **Surface §62**: the check of the names a target refuses says WGSL renames nothing. The WGSL
  writer now renames a module function whose name WGSL predeclares, as the GLSL writer renames
  for itself. The check still covers the module surface neither writer renames.
- **Surface §69**: the load-time emitter's size, which the rename pass and its name lists add
  to.
- **Code**:
  - `src/compiler/ts/lower/expression-call.ts`: the callee check comes before every builtin
    function, the value constructors excepted.
  - `src/compiler/ts/math-alias.ts`: `USER_FIRST_BUILTINS` narrows to the casts it keeps (`bool`,
    `f64`), with its readers in `lower/expression-array.ts` (the fold's `intrinsicFirst`) and
    `lower/new-target.ts`.
  - Both writers: a pass run first in each lowering renames a module function whose name the
    target predeclares, and the calls that reach it: for WGSL its built-in functions, types, type
    generators, aliases and the enumerants its text spells (`read`, `storage`, a texel format),
    for GLSL ES 3.00 its built-in functions, and for both the builtin ids the IR itself knows
    (`atan2`, `saturate`, `f64`). An entry keeps its name.
- **Tests**, on both halves (CLAUDE.md, "A test reads both halves"):
  - `src/compiler/ts/builtins.test.ts`: the `pow` case and the `inverseSqrt` and `atan` cases now
    call the declaration, 99 on the CPU and the renamed declaration in both writers. A declared
    `fract` called with a literal and with a run-time argument gives one answer in WGSL, GLSL and
    the oracle. `random()` beside a declared `fract` keeps the builtin in its expansion, on both
    targets.
  - The language service on the same sources: no diagnostic, and the hover of the call is the
    declaration.
  - The compile gate: a module that declares and calls `fract`, `pow`, `exp2` and `f32` compiles
    on Tint and on ANGLE. On WebGPU, the declared `fract` with a run-time argument gives the CPU
    oracle's value (#403's "Tests owed").
  - The fold: `zip(xs, ys, atan2)` beside a declared `atan2` calls it.

### Configuration and validation record

- **Accepted revision.** This proposal as merged with `status: accepted`, widened by #421 to Rule
  3.2 and surface §15, §62 and §69.
- **Implementation.** One commit, `Change: 0029`, on branch `feat/0029-declared-functions-win`,
  based on `main` at `1026dcbe`. No pull request was assigned when this record was written. It
  supersedes #419, which implemented this proposal on an older base and was not merged; its
  front end, rename pass, name lists and tests are carried over.
- **Delivered beyond #419.**
  - `renamePredeclaredFunctions` keeps the identity of every expression no renamed call is under,
    and rebuilds a shared one once, so `autoVars` pairs an assignment's target with its reads as
    before (`rename-predeclared.test.ts`, "what the pass keeps of the module it is given").
  - `callArgAccess` in `src/core/passes/access.ts` reads a call through a declaration as a call
    of a function, so the kernel proof and every analysis over `eachOperand` take a declared
    `atomicAdd(a: f32, b: f32)` as a read (`parallel-loop.test.ts`).
  - The front end's stage check (`lower/function.ts`) takes a declared `dpdx` as no derivative.
  - The WebGL2 pass program of a compute entry, the program runtime's manifest (`gl.computes`,
    `gl.draws`, `repack`) and the CPU tier of a generated host module reach the declaration
    (`gl-compute.test.ts`, `pack.test.ts`, `host-entry.test.ts`).
- **Deviation, open for review.** The proposal says that an entry keeps its name. An entry named
  like something WGSL predeclares hides that name in the whole WGSL module, so this change
  refuses one with `TS8068` (an existing code) where the module's WGSL uses the name, an error
  at the entry's name in the compiler and in the editor. An entry whose name the WGSL does not
  use, such as `step` in a module that never calls `step`, compiles as before. Rule 3.2 and
  surface §10 and §62 say so.
- **Functional validation, 2026-10-09, Windows 11, Bun 1.4.2, TypeScript 5.6.3, by the
  implementing agent.** Each result below is from that machine; CI has not run the change yet.
  - `bun run build` and `bun run lint` pass. `bun run format:check` passes on an LF checkout of
    the change; the CRLF checkout of a Windows worktree fails every file, as `main` does there.
  - `bun run test` on an LF checkout: 8716 passed, 22 failed. The 22 are a subset of the 24 that
    `main` at `1026dcbe` fails on the same machine: Windows path separators, a checkout outside
    Git, and two `tsc` tests that time out.
  - The bundle boundary, with Windows path separators normalised: `typeshade/emit` 90,926 bytes
    gzipped (`main` 88,896; budget 97,500), `typeshade/runtime` 27,083 (unchanged; budget 29,800).
  - `gate:compile` in Chromium on D3D11, since SwiftShader's WebGPU has no adapter there: the
    declared-names leg passes (360 names, 720 WGSL modules on Tint, 360 GLSL ES 3.00 programs on
    ANGLE, #403's values on the oracle, the codegen and WebGPU, #403's pixel on WebGL2). Its 14
    failures are the 14 `main` has on that machine, all on the program runtime's WebGL2 tier.
  - `gate:differential` on that machine: the WebGPU kernel arm has no failure over 2,687,732
    values; the WebGL2 arms could not get a program or a context there. `gate:journeys`:
    `declared-names` passes on WebGPU and on the CPU oracle; every WebGL2 compute run lost its
    context there. `gate:render` differs from the SwiftShader golden on NVIDIA hardware. These
    three are to be read on CI.
- **Document validation.** `bun run docs:refs` reports no dead reference, `doc-impact.ts` reports
  no must-fix, `changes.ts --staged` keeps the change inside this proposal, and `doorstop -C -e -F`
  passes after RULE-0302 and RULE-0905 were reviewed and SURF-010, SURF-021 and SURF-068 cleared.
- **Pending.** The downstream repositories owe nothing (below).

## What it owes downstream

Nothing. No page of typeshade.dev and no document of vscode-typeshade says which of a builtin and
a declared function a call reaches: searched for `USER_FIRST_BUILTINS`, "keep their
precedence" and the paragraph's other wording. The site renders Rule 9.5 from the pin, and its
Korean rule translations (`content/guide/ko/rules.json`) do not carry it.
