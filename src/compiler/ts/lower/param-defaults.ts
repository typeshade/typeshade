// ═══ Default parameter values (roadmap 0.3 item T7, #92) ═══
//
// `function tint(c: vec3, k: f32 = 0.5)` is ordinary TypeScript, and `tint(c)` is how it is
// then called. Neither WGSL nor GLSL has default arguments, so the emitted function keeps
// every parameter and the missing ones are filled in where the call is written: `tint(c)`
// becomes `tint(c, 0.5)`. Nothing about the default reaches the IR as a default.
//
// That is why a default may not read another parameter. The argument for `a` at a call site is
// an EXPRESSION, not a value: filling `b = a * 2.` in would emit that expression a second time
// and run whatever it calls twice. TypeScript evaluates the default against the argument's
// value, which needs a binding this surface has nowhere to put, since a call is an expression
// and the IR has no let-expression. The default is lowered once, at the declaration, in the
// module's scope with no parameters in it, and the one Expr is spliced at every call site.
//
// This file is storage and nothing else, so the call lowering can read a default without
// importing the expression lowering that produced it.

import type ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { absentOf, optionalInner, type StructLookup } from '../optional.js';

/** A parameter with a default: the default as written, lowered once by `lowerParamDefaults`
 *  in function.ts. Or an optional parameter `x?: T` (Rule 7.10, change 0093), whose filler is
 *  the absent value of its type, built where the call is. */
type Slot = { readonly node: ts.Expression; expr?: Expr } | { readonly absent: ShaderType };

const DEFAULTS = new WeakMap<FuncDecl, (Slot | undefined)[]>();

/** Record what each of `parameters` defaults to, against `stub`'s own parameter indices.
 *  `offset` is 1 for a method, whose stub carries `self_` ahead of the written parameters
 *  (#86). An optional parameter `x?: T` records the absent value as its filler (change 0093);
 *  `absentOnly` records those alone, for a signature whose defaults no pass lowers (a local
 *  function, an arrow function written as an argument). A signature with no default and no
 *  optional parameter records nothing, so `hasParamDefaults` stays false and every call keeps
 *  the arity check it had. */
export function recordParamDefaults(
  stub: FuncDecl,
  parameters: readonly ts.ParameterDeclaration[],
  offset = 0,
  absentOnly = false,
): void {
  let slots: (Slot | undefined)[] | undefined;
  for (const [i, p] of parameters.entries()) {
    const type = stub.params[offset + i]?.type;
    if (p.initializer && !absentOnly) {
      slots ??= new Array<Slot | undefined>(stub.params.length).fill(undefined);
      slots[offset + i] = { node: p.initializer };
    } else if (p.questionToken && !p.initializer && type !== undefined && optionalInner(type)) {
      slots ??= new Array<Slot | undefined>(stub.params.length).fill(undefined);
      slots[offset + i] = { absent: type };
    }
  }
  if (slots) DEFAULTS.set(stub, slots);
}

/** True when the signature writes at least one default, which is what makes a call with fewer
 *  arguments than parameters worth looking at. */
export function hasParamDefaults(stub: FuncDecl): boolean {
  return DEFAULTS.has(stub);
}

/** The defaults of `stub` still to lower, as `[index, node]` pairs. A slot already lowered is
 *  left out, so the pass that resolves one default in terms of another can run again without
 *  redoing the work or repeating a diagnostic. */
export function paramDefaultNodes(stub: FuncDecl): readonly (readonly [number, ts.Expression])[] {
  const slots = DEFAULTS.get(stub);
  if (!slots) return [];
  const out: (readonly [number, ts.Expression])[] = [];
  for (const [i, slot] of slots.entries())
    if (slot && 'node' in slot && slot.expr === undefined) out.push([i, slot.node]);
  return out;
}

/** Keep the lowered default for parameter `i`. A default that did not lower keeps none, and
 *  the call site falls back to the arity message, since the reason was already reported where
 *  the default was written. */
export function setParamDefault(stub: FuncDecl, i: number, expr: Expr): void {
  const slot = DEFAULTS.get(stub)?.[i];
  if (slot && 'node' in slot) slot.expr = expr;
}

/** True when parameter `i` of `stub` writes a default, whether or not it lowered. A call that
 *  omits it is not an arity mistake: the reason it has no value was said where it was written,
 *  and repeating it as "expects 2, got 1" on every call sends the author to the wrong line. */
export function declaresParamDefault(stub: FuncDecl, i: number): boolean {
  return DEFAULTS.get(stub)?.[i] !== undefined;
}

/** The lowered default for parameter `i` of `stub`, or the absent value of an optional
 *  parameter (`structs` resolves the zero of a struct it holds), or undefined when it has
 *  none. */
export function paramDefault(stub: FuncDecl, i: number, structs: StructLookup): Expr | undefined {
  const slot = DEFAULTS.get(stub)?.[i];
  if (slot === undefined) return undefined;
  if ('absent' in slot) return absentOf(slot.absent, optionalInner(slot.absent)!, structs);
  return slot.expr;
}

/** Whether parameter `i` of `stub` is an optional parameter, `x?: T` (change 0093). */
export function isOptionalParam(stub: FuncDecl, i: number): boolean {
  const slot = DEFAULTS.get(stub)?.[i];
  return slot !== undefined && 'absent' in slot;
}

/** The calls a filled-in default brought into `owner`'s body (roadmap 0.3 item T7, #92). The
 *  recursion check walks the syntax tree, where these calls are not written; without them a
 *  cycle that only closes through a default emits WGSL Tint refuses and a CPU run that
 *  overflows. Each is paired with the call site that omitted the argument, to anchor the
 *  diagnostic where the author can edit it. */
const FILLED = new WeakMap<FuncDecl, { readonly to: string; readonly node: ts.Node }[]>();

export function noteFilledCall(owner: FuncDecl, to: string, node: ts.Node): void {
  const prior = FILLED.get(owner);
  if (prior) prior.push({ to, node });
  else FILLED.set(owner, [{ to, node }]);
}

export function filledCallsOf(
  owner: FuncDecl,
): readonly { readonly to: string; readonly node: ts.Node }[] {
  return FILLED.get(owner) ?? [];
}

/** How many of `stub`'s parameters a call must write, counting from `leading`: every parameter
 *  up to the last one without a default. TypeScript allows `f(a = 1, b: f32)`, where both
 *  arguments are required, so this counts the trailing run of defaults rather than all of
 *  them. */
export function requiredParamCount(stub: FuncDecl, leading = 0): number {
  const slots = DEFAULTS.get(stub);
  if (!slots) return stub.params.length - leading;
  let n = stub.params.length;
  const filled = (slot: Slot | undefined): boolean =>
    slot !== undefined && ('absent' in slot || slot.expr !== undefined);
  while (n > leading && filled(slots[n - 1])) n--;
  return n - leading;
}
