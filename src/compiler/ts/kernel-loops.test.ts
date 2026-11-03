// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.6 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.29 (docs/language-design.md; traced in reqs/).
//
// A kernel function (change 0013, part 1): an exported function that takes an array with no
// size. Its array is the caller's storage, read and written in place, its loops are proved
// independent or run on the CPU with `TS8070` naming why, and no target emits it. Read twice, as
// every program an author writes is (CLAUDE.md): each warning in `compile()` and in the language
// service on the same source, with the same text.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { hostFace } from './host-face.js';
import { describeRead } from './kernel-loops.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
import { lowerKernel } from '../../core/passes/kernel-lower.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { copy, runKernelPlan } from '../../core/testing/kernel-plan.js';
import type { CpuValue } from '../../core/cpu-runtime.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const module = (body: string): string => `"use typeshade";\n${body}\n`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

/** Each refusal of the proof as the author reads it: `[name, program, message]`. The lines are
 *  counted from the directive, which is line 1. */
const REFUSED: readonly (readonly [string, string, string])[] = [
  [
    'R1, a while loop',
    `export function fill(a: array<f32>) {
  let i: u32 = 0;
  while (i < a.length) {
    a[i] = 1.;
    i++;
  }
}`,
    'This loop runs on the CPU because it is a while loop, whose trip count is known only when it ends. A for loop over a count runs on the GPU.',
  ],
  [
    'R1, a multiplicative step',
    `export function halve(a: array<f32>) {
  for (let stride: u32 = 64; stride > 0; stride /= 2) {
    a[stride] = 1.;
  }
}`,
    'This loop runs on the CPU because "stride /= 2" does not step through a range of indices. Step by adding a constant.',
  ],
  [
    'R2, a return',
    `export function find(a: array<f32>): u32 {
  for (let i: u32 = 0; i < a.length; i++) {
    if (a[i] > 1.) {
      return i;
    }
  }
  return 0;
}`,
    'This loop runs on the CPU because line 5 returns from inside it, so whether an iteration runs depends on the ones before it. Record the result in an array and read it after the loop.',
  ],
  [
    'R3, a carried variable',
    `export function running(a: array<f32>) {
  let nearest = 1e30;
  for (let i: u32 = 0; i < a.length; i++) {
    nearest = min(nearest, a[i]);
    a[i] = nearest;
  }
}`,
    'This loop runs on the CPU because line 5 writes "nearest", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & | ^.',
  ],
  [
    'R3, a shared element',
    `export function scatter(a: array<f32>, idx: array<u32>, b: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    b[idx[i]] = a[i];
  }
}`,
    'This loop runs on the CPU because line 4 writes "b[idx[i]]", an element two iterations can share. Write at an index made from "i".',
  ],
  // #983: a counter that stands alone in a sum with a value the loop does not change is a write
  // at `1*i + c` and runs on the GPU. A counter divided first, or added to a value each
  // iteration declares, still reaches an element twice.
  [
    'R3, a counter divided before it is added to a value the loop does not change',
    `export function keep(tape: array<f32>, block: array<f32>, at: u32) {
  for (let n: u32 = 0; n < block.length; n++) {
    tape[at + n / 2] = block[n];
  }
}`,
    'This loop runs on the CPU because line 4 writes "tape[at + n / 2]", an element two iterations can share. Write at an index made from "n".',
  ],
  [
    'R3, a counter added to a value each iteration declares',
    `export function keep(tape: array<f32>, block: array<f32>) {
  for (let n: u32 = 0; n < block.length; n++) {
    const off = block.length - n;
    tape[off + n] = block[n];
  }
}`,
    'This loop runs on the CPU because line 5 writes "tape[off + n]", an element two iterations can share. Write at an index made from "n".',
  ],
  [
    'R4, a read of what another iteration writes',
    `export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}`,
    'This loop runs on the CPU because line 4 reads "out[i - 1]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R5, a call that writes a module variable',
    `let calls: u32 = 0;
function tally(): u32 {
  calls += 1;
  return calls;
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = tally();
  }
}`,
    'This loop runs on the CPU because line 9 calls "tally", which writes "calls". Return the value from "tally" and combine it in the loop instead.',
  ],
  // #908: the sentence names a class's function and a namespace's function as the author wrote
  // them (`Voice.tally`, `Ns.f`), not as the module emits them (`Voice_tally`, `Ns_f`).
  [
    'R5, a static function that writes a module variable',
    `let calls: u32 = 0;
class Voice {
  static tally(): u32 {
    calls += 1;
    return calls;
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Voice.tally();
  }
}`,
    'This loop runs on the CPU because line 11 calls "Voice.tally", which writes "calls". Return the value from "Voice.tally" and combine it in the loop instead.',
  ],
  [
    'R5, a static function that writes a static field',
    `class Voice {
  static count: u32 = 0;
  static tally(): u32 {
    Voice.count += 1;
    return Voice.count;
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Voice.tally();
  }
}`,
    'This loop runs on the CPU because line 11 calls "Voice.tally", which writes "Voice.count". Return the value from "Voice.tally" and combine it in the loop instead.',
  ],
  [
    'R5, a method that writes a module variable',
    `let calls: u32 = 0;
class Voice {
  phase!: f32;
  bump(): u32 {
    calls += 1;
    return calls;
  }
}
export function count(a: array<u32>, vs: array<Voice>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = vs[i].bump();
  }
}`,
    'This loop runs on the CPU because line 12 calls "Voice.bump", which writes "calls". Return the value from "Voice.bump" and combine it in the loop instead.',
  ],
  [
    'R5, a namespace function that writes a module variable',
    `let calls: u32 = 0;
namespace Ns {
  export function f(): u32 {
    calls += 1;
    return calls;
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.f();
  }
}`,
    'This loop runs on the CPU because line 11 calls "Ns.f", which writes "calls". Return the value from "Ns.f" and combine it in the loop instead.',
  ],
  [
    'R5, a function of a nested namespace that writes a module variable',
    `let calls: u32 = 0;
namespace A {
  export namespace B {
    export function f(): u32 {
      calls += 1;
      return calls;
    }
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = A.B.f();
  }
}`,
    'This loop runs on the CPU because line 13 calls "A.B.f", which writes "calls". Return the value from "A.B.f" and combine it in the loop instead.',
  ],
  [
    'R5, a function whose own name looks like a namespace member keeps its name',
    `let calls: u32 = 0;
namespace Ns {
  export function g(): u32 {
    return 1;
  }
}
function Ns_f(): u32 {
  calls += 1;
  return calls;
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns_f();
  }
}`,
    'This loop runs on the CPU because line 14 calls "Ns_f", which writes "calls". Return the value from "Ns_f" and combine it in the loop instead.',
  ],
  // #955: an instance of a generic function of a namespace and the copy of one that takes a
  // function are made where a call asks for them (`Ns_pick_u32`, `Ns_apply_inc`), and the sentence
  // names them as the author wrote them (`Ns.pick`, `Ns.apply`), as it names the namespace's others.
  [
    'R5, an instance of a generic namespace function that writes a module variable',
    `let calls: u32 = 0;
namespace Ns {
  export function pick<T>(x: T): T {
    calls += 1;
    return x;
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.pick(a[i]);
  }
}`,
    'This loop runs on the CPU because line 11 calls "Ns.pick", which writes "calls". Return the value from "Ns.pick" and combine it in the loop instead.',
  ],
  [
    'R5, a copy of a namespace function that takes a function and writes a module variable',
    `let calls: u32 = 0;
function inc(x: u32): u32 {
  return x + 1;
}
namespace Ns {
  export function apply(f: (x: u32) => u32, x: u32): u32 {
    calls += 1;
    return f(x);
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.apply(inc, a[i]);
  }
}`,
    'This loop runs on the CPU because line 14 calls "Ns.apply", which writes "calls". Return the value from "Ns.apply" and combine it in the loop instead.',
  ],
  [
    'R5, an instance of a generic function of a nested namespace that writes a module variable',
    `let calls: u32 = 0;
namespace A {
  export namespace B {
    export function pick<T>(x: T): T {
      calls += 1;
      return x;
    }
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = A.B.pick(a[i]);
  }
}`,
    'This loop runs on the CPU because line 13 calls "A.B.pick", which writes "calls". Return the value from "A.B.pick" and combine it in the loop instead.',
  ],
  // #972: the same for a generic function of the top level and a function of the top level that
  // takes a function. The instance `pick_u32` and the copy `apply_inc` are made where a call asks
  // for them, and the sentence names the function the author wrote, `pick` and `apply`, as it names
  // `Ns.pick`. The type arguments are left out: the author edits the one function, and may have
  // written no type argument at all.
  [
    'R5, an instance of a generic function of the top level that writes a module variable',
    `let calls: u32 = 0;
function pick<T>(x: T): T {
  calls += 1;
  return x;
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = pick(a[i]);
  }
}`,
    'This loop runs on the CPU because line 9 calls "pick", which writes "calls". Return the value from "pick" and combine it in the loop instead.',
  ],
  [
    'R5, an instance whose type arguments the call writes is named without them',
    `let calls: u32 = 0;
function pick<T>(x: T): T {
  calls += 1;
  return x;
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = pick<u32>(a[i]);
  }
}`,
    'This loop runs on the CPU because line 9 calls "pick", which writes "calls". Return the value from "pick" and combine it in the loop instead.',
  ],
  [
    'R5, a copy of a function of the top level that takes a function and writes a module variable',
    `let calls: u32 = 0;
function inc(x: u32): u32 {
  return x + 1;
}
function apply(f: (x: u32) => u32, x: u32): u32 {
  calls += 1;
  return f(x);
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = apply(inc, a[i]);
  }
}`,
    'This loop runs on the CPU because line 12 calls "apply", which writes "calls". Return the value from "apply" and combine it in the loop instead.',
  ],
  // #987: a local function is a function of the module named after the body that declares it
  // (`count_bump`), and the copy of one that takes a function is named after the functions handed
  // to it (`count_apply_inc`). The author wrote neither: the sentence names the function as it is
  // declared, `bump` and `apply`, as it names the copy of a function of the top level (#972).
  [
    'R5, a local function that writes a module variable',
    `let calls: u32 = 0;
export function count(a: array<u32>) {
  function bump(x: u32): u32 {
    calls += 1;
    return x + 1;
  }
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 9 calls "bump", which writes "calls". Return the value from "bump" and combine it in the loop instead.',
  ],
  [
    'R5, a local arrow function that writes a module variable',
    `let calls: u32 = 0;
export function count(a: array<u32>) {
  const bump = (x: u32): u32 => {
    calls += 1;
    return x + 1;
  };
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 9 calls "bump", which writes "calls". Return the value from "bump" and combine it in the loop instead.',
  ],
  [
    'R5, a local function whose own local function writes a module variable',
    `let calls: u32 = 0;
export function count(a: array<u32>) {
  function outer(x: u32): u32 {
    function inner(y: u32): u32 {
      calls += 1;
      return y + 1;
    }
    return inner(x);
  }
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = outer(a[i]);
  }
}`,
    'This loop runs on the CPU because line 12 calls "outer", which writes "calls". Return the value from "outer" and combine it in the loop instead.',
  ],
  [
    'R5, a copy of a local function that takes a function and writes a module variable',
    `let calls: u32 = 0;
function inc(x: u32): u32 {
  return x + 1;
}
export function count(a: array<u32>) {
  function apply(f: (x: u32) => u32, x: u32): u32 {
    calls += 1;
    return f(x);
  }
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = apply(inc, a[i]);
  }
}`,
    'This loop runs on the CPU because line 12 calls "apply", which writes "calls". Return the value from "apply" and combine it in the loop instead.',
  ],
  // #1004: a function a namespace declares as a constant is a function of the module under the
  // namespace's name (`Ns_bump`), as its `function` declaration is. The sentence names it as the
  // author wrote it (`Ns.bump`, `A.B.bump`), also for a copy of one that takes a function
  // (`Ns_apply_inc`), as it names the others of the namespace (#908, #955). A function of the top
  // level declared as a constant is emitted as written (`bump`) and has nothing to respell.
  [
    'R5, a function a namespace declares as an arrow function that writes a module variable',
    `let calls: u32 = 0;
namespace Ns {
  export const bump = (x: u32): u32 => {
    calls += 1;
    return x + 1;
  };
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 11 calls "Ns.bump", which writes "calls". Return the value from "Ns.bump" and combine it in the loop instead.',
  ],
  [
    'R5, a function a namespace declares as a function expression that writes a module variable',
    `let calls: u32 = 0;
namespace Ns {
  export const bump = function (x: u32): u32 {
    calls += 1;
    return x + 1;
  };
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 11 calls "Ns.bump", which writes "calls". Return the value from "Ns.bump" and combine it in the loop instead.',
  ],
  [
    'R5, a function a nested namespace declares as an arrow function that writes a module variable',
    `let calls: u32 = 0;
namespace A {
  export namespace B {
    export const bump = (x: u32): u32 => {
      calls += 1;
      return x + 1;
    };
  }
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = A.B.bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 13 calls "A.B.bump", which writes "calls". Return the value from "A.B.bump" and combine it in the loop instead.',
  ],
  [
    'R5, a copy of a function a namespace declares as an arrow function that takes a function',
    `let calls: u32 = 0;
function inc(x: u32): u32 {
  return x + 1;
}
namespace Ns {
  export const apply = (f: (x: u32) => u32, x: u32): u32 => {
    calls += 1;
    return f(x);
  };
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns.apply(inc, a[i]);
  }
}`,
    'This loop runs on the CPU because line 14 calls "Ns.apply", which writes "calls". Return the value from "Ns.apply" and combine it in the loop instead.',
  ],
  [
    'R5, a function of the top level declared as an arrow function keeps its name',
    `let calls: u32 = 0;
const bump = (x: u32): u32 => {
  calls += 1;
  return x + 1;
};
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 9 calls "bump", which writes "calls". Return the value from "bump" and combine it in the loop instead.',
  ],
  [
    'R5, an arrow function of the top level whose own name looks like a namespace member keeps its name',
    `let calls: u32 = 0;
namespace Ns {
  export const other = (x: u32): u32 => x;
}
const Ns_bump = (x: u32): u32 => {
  calls += 1;
  return x + 1;
};
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = Ns_bump(a[i]);
  }
}`,
    'This loop runs on the CPU because line 12 calls "Ns_bump", which writes "calls". Return the value from "Ns_bump" and combine it in the loop instead.',
  ],
  // #987: a read carries no span of its own, so the sentence prints it from the IR with the
  // names the table holds: a namespace's constant (`Ns.K`, emitted `Ns_K`), an enum's member
  // (`Mode.B`, emitted `Mode_B`) and a call of a local function (`behind`, emitted `f_behind`).
  [
    'R4, a read at a namespace constant',
    `namespace Ns {
  export const K: u32 = 1;
}
export function f(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - Ns.K];
  }
}`,
    'This loop runs on the CPU because line 7 reads "a[i - Ns.K]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R4, a read at an enum member',
    `enum Mode {
  A,
  B,
}
export function f(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[u32(i32(i) - Mode.B)];
  }
}`,
    'This loop runs on the CPU because line 8 reads "a[u32(i32(i) - Mode.B)]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R4, a read at a call of a local function',
    `export function f(a: array<f32>) {
  function behind(i: u32): u32 {
    return i - 1;
  }
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[behind(i)];
  }
}`,
    'This loop runs on the CPU because line 7 reads "a[behind(i)]", which another iteration writes. Read from an array the loop does not write.',
  ],
  // #988: a parameter keeps the name its signature gives it and may share it with a value of the
  // module (Rule 3.2), and a local may share its name with a function the module emits under it.
  // The sentence names the parameter or the local as the author wrote it, not the static field or
  // the function the module emits under the same name (`Voice_OFFSET`, `Voice_shift`).
  [
    'R4, an array parameter named like the emitted name of a static field',
    `class Voice {
  static OFFSET: u32 = 1;
}
export function f(xs: array<f32>, Voice_OFFSET: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    Voice_OFFSET.push(i);
    xs[i] = f32(Voice_OFFSET.length);
  }
}`,
    'This loop runs on the CPU because line 8 reads "Voice_OFFSET.length", and "Voice_OFFSET" is an array the loop pushes onto, whose length and elements depend on the iterations before. Read it after the loop.',
  ],
  [
    'R3, an array parameter named like the emitted name of a class function',
    `class Voice {
  static shift(i: u32): u32 {
    return i ^ 1;
  }
}
export function f(xs: array<f32>, Voice_shift: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    Voice_shift.push(i);
    Voice_shift[i] = 0;
  }
}`,
    'This loop runs on the CPU because line 10 writes "Voice_shift" in place, and the loop also pushes onto it. Push every element, or write every element in place.',
  ],
  [
    'R3, a local named like the emitted name of a class function',
    `class Voice {
  static shift(i: u32): u32 {
    return i ^ 1;
  }
}
export function f(a: array<f32>) {
  let Voice_shift = 0.;
  for (let i: u32 = 0; i < a.length; i++) {
    Voice_shift = Voice_shift + a[i];
    a[i] = Voice_shift;
  }
}`,
    'This loop runs on the CPU because line 10 writes "Voice_shift", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & | ^.',
  ],
  // A read carries no span of its own, so the sentence prints it from the IR with the names of the
  // table: a parameter or a local in the index is worded as written too.
  [
    'R4, a read at a parameter named like the emitted name of a static field',
    `class Voice {
  static OFFSET: u32 = 1;
}
export function f(a: array<f32>, Voice_OFFSET: u32) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - Voice_OFFSET];
  }
}`,
    'This loop runs on the CPU because line 7 reads "a[i - Voice_OFFSET]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R4, a read at a local named like the emitted name of a class function',
    `class Voice {
  static shift(i: u32): u32 {
    return i ^ 1;
  }
}
export function f(a: array<f32>) {
  const Voice_shift: u32 = 1;
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - Voice_shift];
  }
}`,
    'This loop runs on the CPU because line 10 reads "a[i - Voice_shift]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R3, a static field the loop writes keeps the name the author gave it',
    `class Voice {
  static count: f32 = 0.;
}
export function f(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    Voice.count = Voice.count + a[i];
    a[i] = Voice.count;
  }
}`,
    'This loop runs on the CPU because line 7 writes "Voice.count", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & | ^.',
  ],
  [
    'R6, a console call',
    `export function noisy(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    console.log(a[i]);
    a[i] = 1.;
  }
}`,
    'This loop runs on the CPU because line 4 calls console.log, whose lines would print in another order on the GPU. Log after the loop.',
  ],
  // Change 0078: an array a loop pushes onto is written by no other form, and is not read.
  [
    'R3, a push and a write in place to one array',
    `export function keep(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    out[i] = 0.;
  }
}`,
    'This loop runs on the CPU because line 5 writes "out" in place, and the loop also pushes onto it. Push every element, or write every element in place.',
  ],
  [
    'R4, a read of the length of a pushed array',
    `export function keep(xs: array<f32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (out.length < 4) {
      out.push(i);
    }
  }
}`,
    'This loop runs on the CPU because line 4 reads "out.length", and "out" is an array the loop pushes onto, whose length and elements depend on the iterations before. Read it after the loop.',
  ],
  [
    'R4, a read of an element of a pushed array',
    `export function keep(xs: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i] + out[0]);
  }
}`,
    'This loop runs on the CPU because line 4 reads "out[0]", and "out" is an array the loop pushes onto, whose length and elements depend on the iterations before. Read it after the loop.',
  ],
  [
    'R4, the value push returns',
    `export function keep(xs: array<u32>, out: array<u32>, at: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    at[i] = out.push(xs[i]);
  }
}`,
    'This loop runs on the CPU because line 4 uses the value push returns, the length before it, which depends on the iterations before. Call push as a statement of its own, and read the length after the loop.',
  ],
];

describe('a loop that runs on the CPU says why, in the compiler and in the editor (TS8070)', () => {
  it.each(REFUSED)('%s', (_name, body, message) => {
    expect(compiled(body)).toEqual([`warning TS8070 ${message}`]);
    expect(edited(body)).toEqual([`warning TS8070 ${message}`]);
  });

  it('is quiet on a loop the proof accepts, in both halves', () => {
    const body = `export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it('is quiet on a loop that pushes and a length read after it, in both halves (change 0078)', () => {
    const body = `export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
      out.push(i + 1);
    }
  }
  return out.length;
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it("keeps push refused outside a kernel function's loop, in both halves (surface §63)", () => {
    for (const body of [
      `export function once(out: array<u32>) {
  out.push(1u);
}`,
      `export function local(xs: array<u32>): u32 {
  var ys = array<u32, 4>();
  for (let i: u32 = 0; i < xs.length; i++) {
    ys.push(xs[i]);
  }
  return ys[0];
}`,
    ]) {
      const c = compiled(body);
      expect(c.some((d) => d.startsWith('error '))).toBe(true);
      expect(edited(body).some((d) => d.startsWith('error '))).toBe(true);
    }
  });

  it('refuses a pushed value of another type, in both halves', () => {
    const body = `export function keep(xs: array<f32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
}`;
    expect(compiled(body).some((d) => d.startsWith('error '))).toBe(true);
    expect(edited(body).some((d) => d.startsWith('error '))).toBe(true);
  });

  it('runs a loop that reads the length of the array it writes on the GPU, in both halves (#345)', () => {
    // The length is fixed when the host binds the buffer, so reading it is no element read: the
    // proof reads it as `access.ts` says, as the Rule 7.5 bound check already did.
    const body = `export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(out.length);
  }
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    expect(kernel?.kind === 'kernel' ? kernel.face.gpu?.loops.length : undefined).toBe(1);
    // An element of the array it writes, read at another index, is still refused.
    expect(
      compiled(`export function smear(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = a[i] + a[i > 0 ? i - 1 : i];
  }
}`),
    ).toEqual([
      'warning TS8070 This loop runs on the CPU because line 4 reads "a[…]", which another iteration writes. Read from an array the loop does not write.',
    ]);
  });

  it('runs the whole function on the CPU when its body is not a kernel call', () => {
    const body = `export function f(a: array<f32>) {
  a[0] = 1.;
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = 2.;
  }
}`;
    const want =
      'warning TS8070 This function runs on the CPU because line 3 writes "a" outside its loops. A kernel function\'s body is scalar statements, then its loops, then stores into its arrays and a return: move that line into a loop, after the last loop, or into the code that calls the function.';
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toEqual([want]);
  });

  // Verifies: Rule 8.22. After the last loop a kernel function stores into its arrays (change
  // 0094, part 3): a reduction's result, a count, a store past the array's end, which every tier
  // drops, and a function with no loop at all (decision D7).
  it('is quiet on stores after the last loop, in both halves (change 0094)', () => {
    const body = `export function sumInto(xs: array<f32>, sums: array<f32>, k: i32): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  sums[0] = s;
  sums[k] += s * 2.;
  sums[sums.length + 1] = 7.;
  return s;
}
export function plan(count: array<u32>, wg: array<u32>) {
  wg[0] = (count[0] + 63) / 64;
  wg[1] = 1;
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it('runs a function with a store between two loops on the CPU, in both halves', () => {
    const body = `export function twice(a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = 1.;
  }
  b[0] = a[0];
  for (let i: u32 = 0; i < b.length; i++) {
    b[i] = b[i] + 1.;
  }
}`;
    const want =
      'warning TS8070 This function runs on the CPU because line 6 writes "b" outside its loops. A kernel function\'s body is scalar statements, then its loops, then stores into its arrays and a return: move that line into a loop, after the last loop, or into the code that calls the function.';
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toEqual([want]);
  });
});

describe('a kernel function that writes a storage texture (change 0077)', () => {
  // Verifies: Rule 8.22. A 2D storage texture parameter makes an exported function a kernel
  // function, and a store at vec2u(i % W, i / W) is the one texel form R3 accepts.
  const INVERT = `export function invert(
  src: texture_2d<f32>,
  dst: texture_storage_2d<"rgba8unorm", "write">,
  w: u32,
  h: u32,
) {
  for (let i: u32 = 0; i < w * h; i++) {
    const c = textureLoad(src, vec2u(i % w, i / w), 0);
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0 - c.rgb, c.a));
  }
}`;

  it('accepts the store at vec2u(i % W, i / W), in both halves', () => {
    expect(compiled(INVERT)).toEqual([]);
    expect(edited(INVERT)).toEqual([]);
    const r = compile(module(INVERT), { fileName: 'm.shade.ts' });
    expect(r.module.funcs.find((f) => f.name === 'invert')?.kernel).toBe(true);
    const [p] = proveKernels(r.module);
    const v = p!.loops[0]!;
    expect(v.ok).toBe(true);
    expect(v.ok ? v.writes.map((w) => `${w.kind} ${w.name}`) : []).toEqual(['texel dst']);
  });

  it('leaves an exported helper that takes only a sampled texture a helper (Amendment 1)', () => {
    const body = `declare const img: texture_2d<f32>;
export function tex(t: texture_2d<f32>, uv: vec2i): vec4 {
  return textureLoad(t, uv, 0);
}
interface FsOut {
  color: location<0, vec4>;
}
export const fs = fragment(function fs(p: builtin<"position", vec4>): FsOut {
  return { color: tex(img, vec2i(p.xy)) };
});`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.module.funcs.find((f) => f.name === 'tex')?.kernel).toBeUndefined();
    expect(r.wgsl).toContain('fn tex(');
  });

  it.each([
    [
      'a store at a shifted texel',
      `export function shifted(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    textureStore(dst, vec2u((i + 1) % w, i / w), vec4(1.0));
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 stores into "dst" at a texel two iterations can share. Store at vec2u(i % W, i / W), with the same W at every store to the texture.',
    ],
    [
      'two stores of two widths',
      `export function two(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0));
    textureStore(dst, vec2u(i % h, i / h), vec4(0.0));
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 stores into "dst" at a texel two iterations can share. Store at vec2u(i % W, i / W), with the same W at every store to the texture.',
    ],
    [
      'a load of a texel another iteration stores',
      `export function smear(t: texture_storage_2d<"r32float", "read_write">, w: u32, h: u32) {
  for (let i: u32 = 1; i < w * h; i++) {
    const p = textureLoad(t, vec2u((i - 1) % w, (i - 1) / w));
    textureStore(t, vec2u(i % w, i / w), p);
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 reads "textureLoad(t, vec2u((i - 1) % w, (i - 1) / w))", a texel another iteration stores. Load the texel the iteration stores, or read a texture the loop does not write.',
    ],
  ])('refuses %s, with the same text in both halves', (_name, body, message) => {
    expect(compiled(body)).toEqual([message]);
    expect(edited(body)).toEqual([message]);
  });

  it('accepts a load of the texel the iteration stores, and the size anywhere', () => {
    const body = `export function bump(t: texture_storage_2d<"r32float", "read_write">) {
  const d = textureDimensions(t);
  for (let i: u32 = 0; i < d.x * d.y; i++) {
    const v = textureLoad(t, vec2u(i % d.x, i / d.x));
    textureStore(t, vec2u(i % d.x, i / d.x), v + vec4(f32(textureDimensions(t).x)));
  }
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });
});

describe('a kernel function (Rules 8.22, 8.23, 8.6)', () => {
  const RENDER = `export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}`;

  it('is emitted by no target: it runs on the host side of the call', () => {
    const r = compile(module(RENDER), { fileName: 'm.shade.ts' });
    expect(r.wgsl).toContain('fn height(');
    expect(r.wgsl).not.toContain('render');
    expect(r.module.funcs.find((f) => f.name === 'render')?.kernel).toBe(true);
  });

  it("writes the caller's array in place on the CPU oracle", () => {
    const r = compile(module(RENDER), { fileName: 'm.shade.ts' });
    const cpu = compileModule(r.module, { precision: 'f32' });
    const out = [0, 0, 0, 0];
    cpu.fns.render!([1, 0.5, 2, 0.25] as never, 2 as never, out as never);
    const k = [1, 0.5, 2, 0.25];
    const want = [0, 1, 2, 3].map((i) => {
      const p = [(i % 2) / 2, Math.floor(i / 2) / 2];
      return k[0]! * Math.sin(p[0]! * k[1]!) + k[2]! * Math.cos(p[1]! * k[3]!);
    });
    out.forEach((x, i) => expect(x).toBeCloseTo(want[i]!, 5));
  });

  it('reads the length of its array', () => {
    const r = compile(module('export function n(xs: array<f32>): u32 { return xs.length; }'), {
      fileName: 'm.shade.ts',
    });
    expect(r.diagnostics).toEqual([]);
    expect(compileModule(r.module).fns.n!([1, 2, 3] as never)).toBe(3);
  });

  it('counts the vectors of an array<vec4f>: .length is u32 and one iteration takes one vector (change 0068)', () => {
    const body = `export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`;
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const cpu = compileModule(r.module, { precision: 'f32' });
    const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Float32Array(8);
    cpu.fns.copy4!(out as never, a as never);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Editor half: the same source is clean, and the length is a u32 there too.
    const service = createTypeshadeLanguageService();
    const uri = 'm.shade.ts';
    const source = module(body);
    service.openDocument(uri, source);
    expect(service.getDiagnostics(uri)).toEqual([]);
    const at = source.indexOf('out.length');
    const hover = service.getHover(uri, service.positionAt(uri, at + 4))?.contents ?? '';
    expect(hover).toContain('u32');
  });

  it('copies an array<vec4f> to the bits of the array<f32> copy of the same numbers (change 0068 validation)', () => {
    const vec = compile(
      module(`export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`),
      { fileName: 'm.shade.ts' },
    );
    const flat = compile(
      module(`export function copy1(out: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`),
      { fileName: 'm.shade.ts' },
    );
    expect(vec.diagnostics).toEqual([]);
    expect(flat.diagnostics).toEqual([]);
    const cpuVec = compileModule(vec.module, { precision: 'f32' });
    const cpuFlat = compileModule(flat.module, { precision: 'f32' });
    // Signed zeros, subnormals, a large and a small magnitude: the copy moves the bits, not the values.
    const src = new Float32Array([-0, 0, 1e-40, -3.4e38, 1.5, -2.25, 1e-30, 123456.75]);
    const outVec = new Float32Array(8);
    const outFlat = new Float32Array(8);
    cpuVec.fns.copy4!(outVec as never, src as never);
    cpuFlat.fns.copy1!(outFlat as never, src as never);
    expect(new Uint32Array(outVec.buffer)).toEqual(new Uint32Array(outFlat.buffer));
    expect(new Uint32Array(outVec.buffer)).toEqual(new Uint32Array(src.buffer));
  });

  it('is not called from another function, in the compiler and in the editor', () => {
    const body = `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
declare const data: storage<array<f32>, "read_write">;
export const cs = compute([1], function cs() {
  data[0] = total(data);
});`;
    const want =
      'error TS8099 "total" is a kernel function, which host code calls and whose arrays are the call\'s storage, so no function can call it. Move what the two share into a plain function and call that from both.';
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toContain(want);
  });

  it('is exported: a function no host can call takes no array with no size (Rule 12.6)', () => {
    const [d] = compiled(
      'function total(xs: array<f32>): f32 { return xs[0]; }\nexport const cs = compute([1], function cs() {});',
    );
    expect(d).toMatch(/^error TS8020 Parameter "xs" is array<f32>, an array with no size/);
  });

  it('is called through the import, asynchronously (the call: host-kernel.test.ts)', () => {
    const f = hostFace(module(RENDER), { fileName: 'm.shade.ts' });
    expect(f.view).toContain(
      'export declare function render(k: vec4, size: u32, out: array<f32>): Promise<void>;',
    );
    expect(f.view).toContain('export declare function height(');
  });
});

describe('a row-major write needs one width for the whole loop (#398)', () => {
  const gpuLoops = (body: string): number | undefined => {
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    return kernel?.kind === 'kernel' ? kernel.face.gpu?.loops.length : undefined;
  };
  const grid = (width: string, before = '', inner = ''): string =>
    `export function f(w: u32, h: u32, out: array<f32>) {${before}
  for (let y: u32 = 0; y < h; y++) {${inner}
    for (let x: u32 = 0; x < ${width.split('|')[0]!}; x++) {
      out[${width.split('|')[1]!}] = f32(y);
    }
  }
}`;

  it('runs a width that changes from row to row on the CPU, in both halves', () => {
    // Rows of different widths overlap: `y * (h - y) + x` over `x < h - y` writes out[3] from
    // rows 0 and 1 when h is 4, and the two invocations would race on the GPU. `W2` was made
    // when `s` was 1 and the bound reads `s` at 2, so each row is two widths long.
    const cases: [string, string, number][] = [
      [grid('h - y|y * (h - y) + x'), 'y * (h - y) + x', 5],
      [grid('W|y * W + x', '', '\n    const W = h - y;'), 'y * W + x', 6],
      [
        grid('s * w|y * W2 + x', '\n  let s: u32 = 1;\n  const W2 = s * w;\n  s = 2;'),
        'y * W2 + x',
        8,
      ],
    ];
    for (const [body, index, line] of cases) {
      const want = `warning TS8070 This loop runs on the CPU because line ${String(line)} writes "out[${index}]", an element two iterations can share. Write at an index made from "y".`;
      expect(compiled(body), index).toEqual([want]);
      expect(edited(body), index).toEqual([want]);
      expect(gpuLoops(body), index).toBeUndefined();
    }
  });

  it('runs one width on the GPU, written inline, through a const or through a let it never sets again', () => {
    for (const body of [
      grid('w|y * w + x'),
      grid('w|at', '', '').replace('out[at]', 'const at = y * w + x;\n      out[at]'),
      grid('w|row + x', '', '\n    const row = y * w;'),
      grid('W|y * W + x', '\n  const W = w;'),
      grid('s|y * s + x', '\n  let s: u32 = w;'),
    ]) {
      expect(compiled(body), body).toEqual([]);
      expect(edited(body), body).toEqual([]);
      expect(gpuLoops(body), body).toBe(1);
    }
  });
});

describe('a write at the counter added to a value the loop does not change runs on the GPU (#983)', () => {
  // Rule 8.22, R3: a write at `a*i + c`, with `a` and `c` the same in every iteration, lands on
  // a different element in each. The proof read the coefficient of the counter from a product, so
  // a counter that stood alone in the sum (`at + n`) had none, and TS8070 told the author to
  // "write at an index made from n", which the author had written. `n * 1 + at` was accepted.
  const keep = (
    index: string,
  ): string => `export function keep(tape: array<f32>, block: array<f32>, at: u32): void {
  for (let n: u32 = 0; n < block.length; n++) {
    tape[${index}] = block[n];
  }
}`;

  /** The plan of the GPU loops, as the plugin writes it into the generated module. */
  const gpu = (body: string) => {
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    return kernel?.kind === 'kernel' ? kernel.face.gpu : undefined;
  };

  /** Each index as the author writes it, the same index in plain JavaScript, and the store as
   *  the WGSL writes it (the uniform `keep_args` holds `at`). */
  const FORMS: readonly (readonly [string, (n: number, at: number) => number, string])[] = [
    ['at + n', (n, at) => at + n, 'tape[(keep_args.at + n)] = block[n];'],
    ['n + at', (n, at) => n + at, 'tape[(n + keep_args.at)] = block[n];'],
    ['at + n * 2', (n, at) => at + n * 2, 'tape[(keep_args.at + (n * 2u))] = block[n];'],
    ['n * 2 + at', (n, at) => n * 2 + at, 'tape[((n * 2u) + keep_args.at)] = block[n];'],
    ['n * 1 + at', (n, at) => n * 1 + at, 'tape[(n + keep_args.at)] = block[n];'],
    ['at + 7 + n', (n, at) => at + 7 + n, 'tape[((keep_args.at + 7u) + n)] = block[n];'],
  ];

  it('runs the loop of the issue on the GPU: no TS8070 in the compiler, none in the editor', () => {
    const issue = `export function keep(tape: array<f32>, block: array<f32>, at: u32): void {
  for (let n: u32 = 0; n < block.length; n++) tape[at + n] = block[n];
}`;
    expect(compiled(issue)).toEqual([]);
    expect(edited(issue)).toEqual([]);
    expect(gpu(issue)?.loops).toHaveLength(1);
  });

  it.each(FORMS)(
    'runs the write at tape[%s] on the GPU, in both halves',
    (index, _plain, store) => {
      const body = keep(index);
      expect(compiled(body), index).toEqual([]);
      expect(edited(body), index).toEqual([]);
      expect(gpu(body)?.loops, index).toHaveLength(1);
      expect(gpu(body)?.wgsl, index).toContain(`@compute @workgroup_size(64)\nfn keep_loop0(`);
      expect(gpu(body)?.wgsl, index).toContain(store);
    },
  );

  it('plans the bare counter as it plans `n * 1 + at`, the workaround the author wrote', () => {
    const workaround = gpu(keep('n * 1 + at'))?.loops;
    expect(workaround).toHaveLength(1);
    for (const index of ['at + n', 'n + at'])
      expect(gpu(keep(index))?.loops, index).toEqual(workaround);
  });

  it.each(FORMS)('writes tape[%s] on the CPU oracle as a plain loop does', (index, plain) => {
    const r = compile(module(keep(index)), { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const cpu = compileModule(r.module, { precision: 'f32' });
    const block = [1, 2, 3, 4, 5];
    const tape = new Array<number>(24).fill(0);
    cpu.fns.keep!(tape as never, block as never, 3 as never);
    const want = new Array<number>(24).fill(0);
    for (let n = 0; n < block.length; n++) want[plain(n, 3)] = block[n]!;
    expect(tape).toEqual(want);
    expect(tape.filter((x) => x !== 0)).toHaveLength(block.length);
  });

  it('runs an i32 counter under a cast on the GPU too, in both halves', () => {
    const body = `export function keep(tape: array<f32>, block: array<f32>, at: u32): void {
  for (let k: i32 = 0; k < i32(block.length); k++) {
    tape[at + u32(k)] = block[u32(k)];
  }
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    expect(gpu(body)?.loops).toHaveLength(1);
    expect(gpu(body)?.wgsl).toContain('tape[(keep_args.at + u32(k))] = block[u32(k)];');
  });
});

describe("the first access that is not at the loop counter, in the author's words (change 0058)", () => {
  // The planner of `typeshade/fuse` says why two calls run as two dispatches from text the
  // compiler wrote at build time: "blur reads `t[i - 1]`", the form TS8070 names a read in.

  /** `describeRead` over the array named `array`, in the loop `loop` of kernel function `fn`. */
  const worded = (body: string, fn: string, array: string, loop = 0) => {
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const f = r.module.funcs.find((x) => x.name === fn)!;
    const v = proveKernels(r.module).find((p) => p.fn === fn)!.loops[loop]!;
    if (!v.ok) throw new Error('refused');
    const fact = [...v.reads, ...v.stores].find((x) => x.name === array)!;
    return describeRead(f, fact);
  };

  it("prints the element with the author's names, and the one-based line of its statement", () => {
    const body = `export function blur(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i] + t[i - 1];
  }
}`;
    expect(worded(body, 'blur', 't')).toEqual({ text: 't[i - 1]', line: 4 });
    // The directive is line 1, so this is the line an editor shows.
    expect(module(body).split('\n')[3]).toContain('t[i - 1]');
  });

  it('prints a counter the lowering renamed as the author wrote it', () => {
    // The second `i` of a function is `i_1` in the IR.
    const body = `export function two(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i];
  }
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i + 1] * 2.;
  }
}`;
    expect(worded(body, 'two', 't', 0)).toBeUndefined();
    expect(worded(body, 'two', 't', 1)).toEqual({ text: 't[i + 1]', line: 7 });
  });

  it.each([
    [
      'a field of the element',
      'class P { pos: vec4; }\nexport function f(out: array<P>, ps: array<P>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i].pos = ps[i + 1].pos;\n  }\n}',
      'f',
      'ps',
      'ps[i + 1].pos',
    ],
    [
      'a stride',
      'export function f(out: array<f32>, x: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[2 * i];\n  }\n}',
      'f',
      'x',
      'x[2 * i]',
    ],
    [
      'a gather',
      'export function f(out: array<f32>, table: array<f32>, ix: array<u32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = table[ix[i]];\n  }\n}',
      'f',
      'table',
      'table[ix[i]]',
    ],
    [
      'a loop-invariant index',
      'export function f(out: array<f32>, x: array<f32>, n: u32) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[n];\n  }\n}',
      'f',
      'x',
      'x[n]',
    ],
    [
      'a write',
      'export function f(out: array<f32>, x: array<f32>) {\n  for (let i: u32 = 0; i < x.length; i++) {\n    out[i * 2 + 1] = x[i];\n  }\n}',
      'f',
      'out',
      'out[i * 2 + 1]',
    ],
  ])('prints %s', (_name, body, fn, array, text) => {
    expect(worded(body, fn, array)?.text).toBe(text);
  });

  it("prints a call in the index with the author's name for the function, and a builtin with its own (#955)", () => {
    // The module emits a class's function as `Voice_shift` and a namespace's as `Ns_shift`; the
    // report says `Voice.shift`, as the sentence of TS8070 does.
    const reading = (declaration: string, call: string): string =>
      `${declaration}\nexport function f(out: array<f32>, t: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = t[${call}];\n  }\n}`;
    const shift = (name: string): string => `  ${name}(i: u32): u32 {\n    return i ^ 1;\n  }\n`;
    expect(
      worded(reading(`class Voice {\n  static${shift('shift')}}`, 'Voice.shift(i)'), 'f', 't')
        ?.text,
    ).toBe('t[Voice.shift(i)]');
    expect(
      worded(
        reading(`namespace Ns {\n  export function${shift('shift')}}`, 'Ns.shift(i)'),
        'f',
        't',
      )?.text,
    ).toBe('t[Ns.shift(i)]');
    expect(
      worded(
        reading(
          `namespace A {\n  export namespace B {\n    export function pick<T>(x: T): T {\n      return x;\n    }\n  }\n}`,
          'A.B.pick(i ^ 1)',
        ),
        'f',
        't',
      )?.text,
    ).toBe('t[A.B.pick(i ^ 1)]');
    // A function of the top level and a builtin keep their own names.
    expect(worded(reading(`function${shift('shift')}`, 'shift(i)'), 'f', 't')?.text).toBe(
      't[shift(i)]',
    );
    expect(worded(reading('', 'min(i + 1, 3)'), 'f', 't')?.text).toBe('t[min(i + 1, 3)]');
  });

  it("prints a static field in the index with the author's name for it (#972)", () => {
    // A static field that nothing writes is the module constant `Voice_OFFSET`, and one the file
    // writes is the module variable `Voice_count`; the report says `Voice.OFFSET` and `Voice.count`.
    const reading = (declaration: string, index: string): string =>
      `${declaration}\nexport function f(out: array<f32>, t: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = t[${index}];\n  }\n}`;
    expect(
      worded(reading('class Voice {\n  static OFFSET: u32 = 1;\n}', 'i + Voice.OFFSET'), 'f', 't')
        ?.text,
    ).toBe('t[i + Voice.OFFSET]');
    expect(
      worded(
        reading('class Voice {\n  static readonly OFFSET: u32 = 1;\n}', 'i + Voice.OFFSET'),
        'f',
        't',
      )?.text,
    ).toBe('t[i + Voice.OFFSET]');
    // The static field the file writes was named already, and still is.
    expect(
      worded(
        reading(
          'class Voice {\n  static count: u32 = 1;\n  static bump(): void {\n    Voice.count += 1;\n  }\n}',
          'i + Voice.count',
        ),
        'f',
        't',
      )?.text,
    ).toBe('t[i + Voice.count]');
    // A constant of the top level keeps its own name, also one named like a static field that its
    // class does not declare.
    expect(worded(reading('const K: u32 = 1;', 'i + K'), 'f', 't')?.text).toBe('t[i + K]');
    expect(
      worded(
        reading(
          'const Voice_OFFSET: u32 = 1;\nclass Voice {\n  static ON: u32 = 1;\n}',
          'i + Voice_OFFSET',
        ),
        'f',
        't',
      )?.text,
    ).toBe('t[i + Voice_OFFSET]');
  });

  it('prints a local function in the index as the author declared it, and its copy by the same name (#987)', () => {
    // The module emits a local function as `f_bump`, after the function that declares it, and the
    // copy of one that takes a function as `f_apply_inc`, after the functions handed to it. The
    // report says `bump` and `apply`. The copy takes the arguments its own parameters name, so the
    // function handed to it is not one of them.
    const local = `export function f(out: array<f32>, t: array<f32>) {
  function bump(i: u32): u32 {
    return i ^ 1;
  }
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[bump(i)];
  }
}`;
    expect(compiled(local)).toEqual([]);
    expect(edited(local)).toEqual([]);
    expect(worded(local, 'f', 't')?.text).toBe('t[bump(i)]');
    const copy = `function inc(x: u32): u32 {
  return x + 1;
}
export function f(out: array<f32>, t: array<f32>) {
  function apply(g: (x: u32) => u32, x: u32): u32 {
    return g(x) ^ 1;
  }
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[apply(inc, i)];
  }
}`;
    expect(compiled(copy)).toEqual([]);
    expect(edited(copy)).toEqual([]);
    expect(worded(copy, 'f', 't')?.text).toMatch(/^t\[apply\(/);
  });

  it('prints a function a namespace declares as a constant in the index as the author wrote it, and its copy by the same name (#1004)', () => {
    // The module emits it as `Ns_shift`, as it emits the namespace's `function` declaration, and
    // the copy of one that takes a function as `Ns_apply_inc`. The report says `Ns.shift`,
    // `A.B.shift` and `Ns.apply`. A function of the top level declared as a constant keeps its name.
    const reading = (declaration: string, call: string): string =>
      `${declaration}\nexport function f(out: array<f32>, t: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = t[${call}];\n  }\n}`;
    const inc = 'function inc(x: u32): u32 {\n  return x + 1;\n}\n';
    const cases: [string, string, string][] = [
      [
        'namespace Ns {\n  export const shift = (i: u32): u32 => i ^ 1;\n}',
        'Ns.shift(i)',
        't[Ns.shift(i)]',
      ],
      [
        'namespace Ns {\n  export const shift = function (i: u32): u32 {\n    return i ^ 1;\n  };\n}',
        'Ns.shift(i)',
        't[Ns.shift(i)]',
      ],
      [
        'namespace A {\n  export namespace B {\n    export const shift = (i: u32): u32 => i ^ 1;\n  }\n}',
        'A.B.shift(i)',
        't[A.B.shift(i)]',
      ],
      // The copy takes the arguments its own parameters name, so the function handed to it is
      // not one of them.
      [
        `${inc}namespace Ns {\n  export const apply = (g: (x: u32) => u32, x: u32): u32 => g(x) ^ 1;\n}`,
        'Ns.apply(inc, i)',
        't[Ns.apply(i)]',
      ],
      // A function of the top level declared as a constant, and one named like a namespace
      // member, keep their names.
      ['const shift = (i: u32): u32 => i ^ 1;', 'shift(i)', 't[shift(i)]'],
      [
        'namespace Ns {\n  export const other = (i: u32): u32 => i;\n}\nconst Ns_shift = (i: u32): u32 => i ^ 1;',
        'Ns_shift(i)',
        't[Ns_shift(i)]',
      ],
    ];
    for (const [declaration, call, text] of cases) {
      const body = reading(declaration, call);
      expect(compiled(body), body).toEqual([]);
      expect(edited(body), body).toEqual([]);
      expect(worded(body, 'f', 't')?.text, body).toBe(text);
    }
  });

  it('prints a namespace constant and an enum member in the index as the author wrote them (#987)', () => {
    // The module emits a namespace's constant as `Ns_K` and an enum's member as `Mode_B`, the same
    // joining a class's static field takes (`Voice_OFFSET`); the report says `Ns.K` and `Mode.B`.
    const reading = (declaration: string, index: string): string =>
      `${declaration}\nexport function f(out: array<f32>, t: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = t[${index}];\n  }\n}`;
    const cases: [string, string, string][] = [
      ['namespace Ns {\n  export const K: u32 = 1;\n}', 'i + Ns.K', 't[i + Ns.K]'],
      ['enum Mode {\n  A,\n  B,\n}', 'u32(i32(i) + Mode.B)', 't[u32(i32(i) + Mode.B)]'],
      // A constant of the top level, and a constant of a namespace the function does not read,
      // keep their names.
      ['const K: u32 = 1;', 'i + K', 't[i + K]'],
      [
        'namespace Ns {\n  export const K: u32 = 1;\n}\nconst Ns_L: u32 = 1;',
        'i + Ns_L',
        't[i + Ns_L]',
      ],
    ];
    for (const [declaration, index, text] of cases) {
      const body = reading(declaration, index);
      expect(compiled(body), body).toEqual([]);
      expect(edited(body), body).toEqual([]);
      expect(worded(body, 'f', 't')?.text, body).toBe(text);
    }
    // A parameter named like the name the module emits for them is the parameter (#988).
    const parameters: [string, string][] = [
      ['namespace Ns {\n  export const K: u32 = 1;\n}', 'Ns_K'],
      ['enum Mode {\n  A,\n  B,\n}', 'Mode_B'],
    ];
    for (const [declaration, name] of parameters) {
      const body = `${declaration}\nexport function f(out: array<f32>, t: array<f32>, ${name}: u32) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = t[i + ${name}];\n  }\n}`;
      expect(compiled(body), body).toEqual([]);
      expect(edited(body), body).toEqual([]);
      expect(worded(body, 'f', 't')?.text, body).toBe(`t[i + ${name}]`);
    }
  });

  it('prints a parameter or a local as the author wrote it when the module emits a static field or a function under its name (#988)', () => {
    // The module emits a static field that nothing writes as `Voice_OFFSET`, one the file writes as
    // `Voice_count` and a class's function as `Voice_shift`. A parameter keeps the name its
    // signature gives it and may share it with them (Rule 3.2), so the report names the parameter.
    // A local that shares the name of a function is the same: the function is read by a call.
    const VOICE = `class Voice {
  static OFFSET: u32 = 1;
  static count: u32 = 1;
  static bump(): void {
    Voice.count += 1;
  }
  static shift(i: u32): u32 {
    return i ^ 1;
  }
}`;
    const reading = (params: string, before: string, index: string): string =>
      `${VOICE}\nexport function f(out: array<f32>, t: array<f32>${params}) {\n  for (let i: u32 = 0; i < out.length; i++) {${before}\n    out[i] = t[${index}];\n  }\n}`;
    for (const name of ['Voice_OFFSET', 'Voice_count', 'Voice_shift']) {
      const sources = [
        reading(`, ${name}: u32`, '', `i + ${name}`),
        reading('', `\n    const ${name}: u32 = 2;`, `i + ${name}`),
      ];
      for (const body of sources) {
        // The program is legal in both halves, and the report words the read as written.
        expect(compiled(body), body).toEqual([]);
        expect(edited(body), body).toEqual([]);
        expect(worded(body, 'f', 't')?.text, body).toBe(`t[i + ${name}]`);
      }
    }
    // The static field and the function themselves keep the names the author gave them.
    const own = `${VOICE}
export function g(out: array<f32>, t: array<f32>, u: array<f32>, v: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i + Voice.OFFSET] + u[i + Voice.count] + v[Voice.shift(i)];
  }
}`;
    expect(compiled(own)).toEqual([]);
    expect(edited(own)).toEqual([]);
    expect(worded(own, 'g', 't')?.text).toBe('t[i + Voice.OFFSET]');
    expect(worded(own, 'g', 'u')?.text).toBe('u[i + Voice.count]');
    expect(worded(own, 'g', 'v')?.text).toBe('v[Voice.shift(i)]');
  });

  it('prints a length as the author wrote it, `xs.length`, and not as the IR spells it', () => {
    const body = `export function reverse(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[t.length - 1 - i];
  }
}`;
    expect(worded(body, 'reverse', 't')?.text).toBe('t[t.length - 1 - i]');
  });

  it('says nothing about an array every access of which is at the counter', () => {
    expect(
      worded(
        `export function add(out: array<f32>, a: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`,
        'add',
        'a',
      ),
    ).toBeUndefined();
  });

  it('is data: it survives JSON, which is how the generated module carries it', () => {
    const w = worded(
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i + 1];
  }
}`,
      'f',
      'x',
    );
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('prints a read as TS8070 prints the same read of a loop it refuses', () => {
    // `a[i - 1]` in a loop that writes `a` is refused (R4), and the warning names it; the same
    // read of an array the loop does not write is accepted, and `describeRead` names it alike.
    const refused = compiled(`export function blend(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - 1];
  }
}`);
    expect(refused[0]).toContain('reads "a[i - 1]"');
    expect(
      worded(
        `export function blend(out: array<f32>, a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    out[i] = a[i] + a[i - 1];
  }
}`,
        'blend',
        'a',
      )?.text,
    ).toBe('a[i - 1]');
  });
});

describe('a loop that calls a method on an element is proved as the same loop written inline (change 0110, D4)', () => {
  // A method that changes its object is, at a call, a write to the object it is called on, as an
  // `@inout` argument is, for the independence proof (proposal 0110). Each form below is written
  // twice: through a member of `Voice`, and inline, the member's body written into the loop. The
  // class and the helper are the same lines in both, so the loop is on the same line in both.
  // Both halves read each program (CLAUDE.md): `compile()` and the language service give the
  // same diagnostics, and the proof gives the same verdict and the same facts.
  const CLASS = `class Voice {
  phase!: f32;
  freq!: f32;
  tick(dt: f32): f32 {
    this.phase = this.phase + this.freq * dt;
    return this.phase;
  }
  level(): f32 {
    return this.phase * 0.5;
  }
  static mixOf(a: f32, b: f32): f32 {
    return a * 0.5 + b * 0.5;
  }
  bumpBy(d: f32): void {
    nudge(this.phase, d);
  }
}
function nudge(x: inout<f32>, d: f32): void {
  x = x + d;
}`;
  /** The kernel function `f` with `params` and one loop over `count` from `start` whose body is
   *  `body`, after the class; the loop's body is line 24. */
  const kernel = (params: string, body: string, count = 'vs.length', start = 0): string =>
    `${CLASS}\nexport function f(${params}) {\n  for (let i: u32 = ${String(start)}; i < ${count}; i++) {\n    ${body}\n  }\n}`;

  /** What the proof says of the loop: the facts the planner reads, or the rule that refuses it. */
  const verdict = (body: string): unknown => {
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    const [proof] = proveKernels(r.module);
    const v = proof!.loops[0]!;
    if (!v.ok) return { refused: v.refusal.rule };
    // By name: the proof lists what a statement writes in the order it finds it, the target of
    // `t[i] = vs[i].tick(dt)` before the object of the call, and the planner reads the facts by
    // parameter.
    const byName = <T extends { name: string }>(xs: readonly T[]): T[] =>
      [...xs].sort((x, y) => x.name.localeCompare(y.name));
    return {
      reads: byName(v.reads.map(({ name, atI, forms }) => ({ name, atI, forms }))),
      stores: byName(v.stores.map(({ name, atI, readBack }) => ({ name, atI, readBack }))),
      reductions: v.reductions.length,
    };
  };

  const ACCEPTED: readonly (readonly [string, string, string])[] = [
    [
      'a method that changes its object, on an element',
      kernel('vs: array<Voice>, t: array<f32>, dt: f32', 't[i] = vs[i].tick(dt);'),
      kernel(
        'vs: array<Voice>, t: array<f32>, dt: f32',
        'vs[i].phase = vs[i].phase + vs[i].freq * dt; t[i] = vs[i].phase;',
      ),
    ],
    [
      'a method that reads its object',
      kernel('u: array<f32>, vs: array<Voice>', 'u[i] = vs[i].level();'),
      kernel('u: array<f32>, vs: array<Voice>', 'u[i] = vs[i].phase * 0.5;'),
    ],
    [
      'a static function',
      kernel(
        't: array<f32>, a: array<f32>, b: array<f32>',
        't[i] = Voice.mixOf(a[i], b[i]);',
        't.length',
      ),
      kernel(
        't: array<f32>, a: array<f32>, b: array<f32>',
        't[i] = a[i] * 0.5 + b[i] * 0.5;',
        't.length',
      ),
    ],
    [
      'a method that hands a field to an @inout parameter',
      kernel('vs: array<Voice>, d: f32', 'vs[i].bumpBy(d);'),
      kernel('vs: array<Voice>, d: f32', 'nudge(vs[i].phase, d);'),
    ],
  ];

  it.each(ACCEPTED)('%s: accepted with the facts of the inline loop', (_, method, inline) => {
    for (const body of [method, inline]) {
      expect(compiled(body)).toEqual([]);
      expect(edited(body)).toEqual([]);
    }
    const facts = verdict(method);
    expect(facts).not.toHaveProperty('refused');
    expect(facts).toEqual(verdict(inline));
  });

  it('reads a changing method on an element as a write at that element, at the counter', () => {
    // `vs[i].tick(dt)` writes `vs` at `i` and reads it back, as the inline form does.
    expect(verdict(ACCEPTED[0]![1])).toEqual({
      reads: [],
      stores: [
        { name: 't', atI: true, readBack: false },
        { name: 'vs', atI: true, readBack: true },
      ],
      reductions: 0,
    });
  });

  /** Each refusal, through the member and inline: `[name, method, inline, method's words,
   *  inline's words]`. The proof refuses both on the same line by the same rule; the words name
   *  what each form writes or reads, the object the method is called on or the field the inline
   *  form names. */
  const REFUSED_BOTH: readonly (readonly [string, string, string, string, string])[] = [
    [
      'a changing method on an element two iterations share (R3)',
      kernel('vs: array<Voice>, t: array<f32>, dt: f32', 't[i] = vs[0].tick(dt);', 't.length'),
      kernel(
        'vs: array<Voice>, t: array<f32>, dt: f32',
        'vs[0].phase = vs[0].phase + vs[0].freq * dt; t[i] = vs[0].phase;',
        't.length',
      ),
      'This loop runs on the CPU because line 24 writes "vs[0]", an element two iterations can share. Write at an index made from "i".',
      'This loop runs on the CPU because line 24 writes "vs[0].phase", an element two iterations can share. Write at an index made from "i".',
    ],
    [
      'a reading method on an element another iteration writes (R4)',
      kernel(
        'vs: array<Voice>, u: array<f32>, dt: f32',
        'vs[i].tick(dt); u[i] = vs[i - 1].level();',
        'vs.length',
        1,
      ),
      kernel(
        'vs: array<Voice>, u: array<f32>, dt: f32',
        'vs[i].phase = vs[i].phase + vs[i].freq * dt; u[i] = vs[i - 1].phase * 0.5;',
        'vs.length',
        1,
      ),
      'This loop runs on the CPU because line 24 reads "vs[i - 1]", which another iteration writes. Read from an array the loop does not write.',
      'This loop runs on the CPU because line 24 reads "vs[i - 1].phase", which another iteration writes. Read from an array the loop does not write.',
    ],
    [
      'a static function handed an element another iteration writes (R4)',
      kernel('t: array<f32>, a: array<f32>', 't[i] = Voice.mixOf(a[i], t[i - 1]);', 't.length', 1),
      kernel('t: array<f32>, a: array<f32>', 't[i] = a[i] * 0.5 + t[i - 1] * 0.5;', 't.length', 1),
      'This loop runs on the CPU because line 24 reads "t[i - 1]", which another iteration writes. Read from an array the loop does not write.',
      'This loop runs on the CPU because line 24 reads "t[i - 1]", which another iteration writes. Read from an array the loop does not write.',
    ],
    [
      'a method that hands a field of a shared element to an @inout parameter (R3)',
      kernel('vs: array<Voice>, d: f32', 'vs[0].bumpBy(d);'),
      kernel('vs: array<Voice>, d: f32', 'nudge(vs[0].phase, d);'),
      'This loop runs on the CPU because line 24 writes "vs[0]", an element two iterations can share. Write at an index made from "i".',
      'This loop runs on the CPU because line 24 writes "vs[0].phase", an element two iterations can share. Write at an index made from "i".',
    ],
  ];

  it.each(REFUSED_BOTH)(
    '%s: refused as the inline loop is',
    (_, method, inline, mWords, iWords) => {
      expect(compiled(method)).toEqual([`warning TS8070 ${mWords}`]);
      expect(edited(method)).toEqual([`warning TS8070 ${mWords}`]);
      expect(compiled(inline)).toEqual([`warning TS8070 ${iWords}`]);
      expect(edited(inline)).toEqual([`warning TS8070 ${iWords}`]);
      expect(verdict(method)).toEqual(verdict(inline));
    },
  );
});

describe('a static field read in a kernel function that has a parameter or a local named like the field (#999)', () => {
  // The module emits `Voice.OFFSET` as the constant `Voice_OFFSET`. A parameter keeps the name its
  // signature gives it and may share it (Rule 3.2, change 0039), and a local may too. The author
  // wrote `Voice.OFFSET`, a read of the field, and the lookup of it found the parameter instead:
  // `TS8022 "Voice" has no static field "OFFSET"`.
  const VOICE = `class Voice {
  static OFFSET: u32 = 1;
}`;
  const WITH_PARAMETER = `${VOICE}
export function f(out: array<f32>, t: array<f32>, Voice_OFFSET: u32) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i + Voice_OFFSET] + f32(Voice.OFFSET);
  }
}`;
  const WITH_LOCAL = `${VOICE}
export function f(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    const Voice_OFFSET: u32 = 2;
    out[i] = t[i + Voice_OFFSET] + f32(Voice.OFFSET);
  }
}`;
  const T = [10, 20, 30, 40, 50, 60];

  /** The kernel function `f` as the GPU runs it: the WGSL of its plan, and what the plan and the
   *  function itself, both on the `f32` oracle, leave in the `out` array for `extra`. */
  const run = (body: string, extra: CpuValue[]) => {
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const f = r.module.funcs.find((x) => x.name === 'f')!;
    const plan = lowerKernel(
      f,
      r.module,
      proveKernels(r.module).find((p) => p.fn === 'f')!,
    );
    if ('noGpu' in plan) throw new Error(plan.noGpu);
    const args: CpuValue[] = [[0, 0, 0, 0], T, ...extra];
    const want = args.map(copy);
    compileModule(r.module, { precision: 'f32' }).fns.f!(...want);
    return {
      wgsl: emitModule(plan.module),
      oracle: want[0],
      plan: runKernelPlan(r.module, 'f', plan, args).arrays[0],
    };
  };

  it.each([
    ['a parameter', WITH_PARAMETER],
    ['a local', WITH_LOCAL],
  ])('is legal with %s of that name, in both halves', (_name, body) => {
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it('reads the field, and not the parameter, in the WGSL of the plan and on the oracle', () => {
    // The parameter is 2 and the field is 1: reading one for the other changes every element.
    const { wgsl, oracle, plan } = run(WITH_PARAMETER, [2]);
    expect(wgsl).toContain('const Voice_OFFSET: u32 = 1u;');
    expect(wgsl).toContain('out[i] = (t[(i + f_args.Voice_OFFSET)] + f32(Voice_OFFSET));');
    expect(oracle).toEqual([31, 41, 51, 61]);
    expect(plan).toEqual(oracle);
  });

  it('reads the field, and not the local, in the WGSL of the plan and on the oracle', () => {
    const { wgsl, oracle, plan } = run(WITH_LOCAL, []);
    expect(wgsl).toContain('const Voice_OFFSET: u32 = 1u;');
    expect(wgsl).toContain('f32(Voice_OFFSET)');
    expect(oracle).toEqual([31, 41, 51, 61]);
    expect(plan).toEqual(oracle);
  });
});
