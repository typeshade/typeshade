---
id: '0027'
title: An integer division, remainder and shift, and a float's conversion to an integer, give WGSL's answer on WebGL2 for every input
status: implemented
rules:
- '7.4'
- '11.12'
surface:
- 11
- 22
exports:
- Backend
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The guide's scalar conversion note, which follows AUTHORING.md's (bun run check:guide lists it), says a float converts to an integer the same way on every target; no page names GLSL's bare integer operators.
- repo: vscode-typeshade
  what: The skill's language reference (plugins/typeshade/skills/typeshade/references/language.md) drops "GLSL leaves an out-of-range value undefined, so clamp first".
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

The GLSL ES 3.00 writer spells an integer `/` and `%`, a shift, and a float's conversion to `i32`
or `u32` with the bare GLSL operator or constructor: `a / b`, `a % b`, `a << b`, `int(x)`,
`uint(x)`. GLSL ES 3.00 gives some of their inputs no result, and WGSL settles every one of them.
The CPU oracle follows WGSL (Rule 11.5), and a WebGL2 driver answers otherwise. Measured on ANGLE
over Vulkan (SwiftShader), in a fragment program that writes an `RGBA32UI` target (#382):

| Expression           | WGSL, WebGPU and the oracle | WebGL2 today    |
| -------------------- | --------------------------- | --------------- |
| `7 / 0` (`i32`)      | 7                           | -7              |
| the least `i32` / -1 | the least `i32`             | 1               |
| `7u / 0u`            | 7                           | 0               |
| `7u % 0u`            | 0                           | 7               |
| `-7 % 3`             | -1                          | 2               |
| `7 % -3`             | 1                           | -2              |
| `i32(3e9)`           | 2147483520                  | the least `i32` |
| `u32(5e9)`           | 4294967040                  | 0               |

So `i % n` over a negative `i` is -1 on WebGPU and on the CPU tier, and 2 on WebGL2, in an entry
and in a kernel function's WebGL2 tier alike.

After this change the GLSL writer gives WGSL's answer on every input:

| Operation                    | GLSL spelling after this change                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `i32` `/`                    | `_idiv(a, b)`: `(b == 0 \|\| (a == -2147483648 && b == -1)) ? a : a / b`           |
| `i32` `%`                    | `_irem(a, b)`: `(b == 0 \|\| (a == -2147483648 && b == -1)) ? 0 : a - (a / b) * b` |
| `u32` `/`                    | `_udiv(a, b)`: `b == 0u ? a : a / b`                                               |
| `u32` `%`                    | `_urem(a, b)`: `b == 0u ? 0u : a % b`                                              |
| a shift by a run-time amount | `a << (b & 31u)` and `a >> (b & 31u)`                                              |
| `i32` of a float             | `_f2i(x)`: `int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)))`        |
| `u32` of a float             | `_f2u(x)`: `uint(mix(clamp(x, 0.0, 4294967040.0), 0.0, isnan(x)))`                 |

- **Each helper is written once per type the module uses**, beside `_idot`, and a vector takes the
  component-wise overload. The clamp bounds are the largest integers an `f32` holds in each
  range, which is where WGSL's conversion saturates (`f32ToI32Sat` and `f32ToU32Sat` in
  `cpu-runtime.ts`).
- **The bare operator stays where no input it can take is undefined:**
  - an unsigned `/` or `%` by a literal that is not zero;
  - a signed `/` by a literal that is neither zero nor -1;
  - a shift by a literal, which Rule 7.4 and `settleConstExprs` keep between 0 and 31.

  A signed `%` always takes the helper, since its dividend may be negative.

**New Rule 11.12:**

> An integer division, remainder and shift, and a float's conversion to an integer, must give
> WGSL's answer on GLSL ES 3.00 for every input WGSL settles. The GLSL writer spells each one
> through a helper that settles the inputs GLSL ES 3.00 leaves undefined, and uses the bare
> operator only where the operands cannot reach one.
>
> - Rationale: GLSL ES 3.00 leaves these inputs without a result: a zero divisor, the least
>   `int` over -1, a negative operand of `%`, a shift amount past the width, and a float the
>   integer cannot hold (§5.9, §4.1.3, §5.4.1). A WebGL2 driver answers otherwise than WGSL on
>   all of them but the shift (#382). The oracle follows WGSL (Rule 11.5). Without this rule, a
>   program means one thing on WebGPU and on the CPU tier and another on WebGL2.
> - Derives from: #382; GLSL ES 3.00 §4.1.3, §5.4.1 and §5.9; WGSL's
>   [Arithmetic Expressions](https://gpuweb.github.io/gpuweb/wgsl/#arithmetic-expr),
>   [Bit Expressions](https://gpuweb.github.io/gpuweb/wgsl/#bit-expr) and
>   [Conversion Expressions](https://gpuweb.github.io/gpuweb/wgsl/#conversion-expr).
> - Enforced by:
>   - the GLSL writer's helpers and their test;
>   - the compile gate, which compiles every example's GLSL on WebGL2;
>   - the GPU differential's WebGL2 arm (`scripts/gpu-differential.ts`), which then holds these
>     operations to the oracle on every input.

**Rule 7.4** keeps its sentence, and its rationale stops resting on GLSL. The refusal of a
divisor the front end proves zero and of a shift amount it folds past 31 stands. Tint refuses
both as constant expressions, and each is most likely a mistake. Neither is certainly undefined
on GLSL any longer.

## Why

Rule 11.2 asks for a divergence to be measured and recorded before it is kept. Rule 11.5 asks the
determinism report to list, as `target`, an operation whose GLSL spelling answers otherwise on an
input WGSL settles. Neither happened for these operations: the report calls them exact, and
surface §11 records only the conversion.

The alternatives considered:

- **List the four as `target` rows and change nothing else** (#382, option B). This meets
  Rule 11.5 and keeps the divergence. `-7 % 3` stays 2 on WebGL2, and the report only says so.
- **Refuse the inputs at the front end.** The front end cannot: the operands are values the
  program computes at run time. Rule 7.4 already refuses the ones it can prove.
- **Settle only the inputs this driver gets wrong.** SwiftShader masks a shift amount as WGSL
  does. GLSL ES 3.00 does not promise that, and another driver need not do it, so the shift is
  settled too.

The cost is a comparison and a select per integer division or remainder, a clamp, an `isnan`
and a select per conversion from a float, and a mask per shift by a run-time amount. A shader
that divides by a constant pays nothing.

## What it touches

- **Rule 7.4**: the rationale no longer says GLSL leaves the two inputs undefined as a reason
  to refuse them. The sentence and its enforcement are unchanged.
- **Rule 11.12**: new, as quoted above.
- **Surface §11**: the paragraph "GLSL ES 3.00 does not promise that" says instead that the GLSL
  writer saturates as WGSL does, so the advice to clamp before converting goes.
- **`Backend`** (an export): the contract gains two optional spellings beside `floatMod` and
  `vectorCompare`, which the one emit walk calls: `intBinop` for an integer `/`, `%` or shift, and
  `floatToInt` for a float's conversion to an integer. A backend that omits them keeps the bare
  operators, as the WGSL writer does, so the change is additive. The API surface is re-baked.
- **Surface §22**: the shift-amount paragraph says a run-time amount is masked on both targets.
  The divisor paragraph says a run-time zero divisor gives WGSL's answer on both targets.

What stays put: `AUTHORING.md`'s conversion note is corrected in the same pull request, and it is
not a proposal criterion. The emit goldens that hold an integer `/`, `%`, a shift or a conversion
from a float change, and they are read as a diff (Rule 11.4).

Tests:

- `src/core/backends/glsl-int-answers.test.ts`:
  - each helper's text for a scalar and a vector;
  - the bare operator where no undefined input is reachable;
  - one module per operation, read by both halves: `compile()`'s GLSL and the language
    service's diagnostics, unchanged.
- The compile gate: every example's GLSL still compiles and links on WebGL2.
- The GPU differential's WebGL2 arm: `draw-harness.ts`'s taint stops leaving these operations
  out. The arm then holds every value to the oracle bit for bit, the 47 816 values of the 48 CI
  seeds that #382 left out included.

## What it owes downstream

- **typeshade.github.io**: the guide's scalar conversion note follows `AUTHORING.md`'s, which
  said only in-range sources are defined on GLSL ES 3.00. `bun run check:guide` lists the page
  when the pin moves. No page shows GLSL's spelling of an integer operator: the from-GLSL page's
  operators table has the float `mod` and `%`, the comparisons and `select`.
- **vscode-typeshade**: the skill's language reference says "GLSL leaves an out-of-range value
  undefined, so clamp first" under the scalar conversions. It becomes: a float converts to an
  integer by truncating and saturating, on every target.
