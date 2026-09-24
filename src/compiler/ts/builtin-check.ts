// === `@builtin("...")` validation: name allow-list and stage/direction compatibility ===
//
// Shared by `structs.ts` (a class field's `@builtin(...)`) and `lower/function.ts` (a
// parameter's `@builtin(...)`, and a struct field reached through a parameter or return type),
// so the two front-end sites that parse a `@builtin(...)` decorator agree on one vocabulary and
// one set of stage rules — see design doc §5 and §10 step 5.

import ts from 'typescript';
import {
  WGSL_BUILTIN_NAMES,
  WGSL_BUILTIN_TYPES,
  type FixedTypeBuiltinName,
  type WgslBuiltinName,
} from '../../core/sot.js';
import { typeKey, type ShaderType } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { unknownNameSentence } from './unknown-names.js';
import { isMixinDeclaration } from './mixins.js';
import { isIntegerVarying } from '../../core/passes/varying-interpolate.js';

/** The pipeline stage a `@builtin(...)` id is being checked against. */
export type BuiltinStage = 'vertex' | 'fragment' | 'compute';

/**
 * Every attribute (decorator) name `"use typeshade"` actually parses and acts on:
 * `@vertex`/`@fragment`/`@compute` on a top-level function (`lower/function.ts`'s `parseStage`)
 * and `@builtin`/`@location` on that function's parameters or a struct field (`builtinDecoratorArg`/
 * `numberDecorator` here and in `structs.ts`). This is the one place this list is spelled out;
 * `language-service/ambient.ts`'s `ATTRIBUTE_NAMES` re-exports it rather than retyping it, the
 * same way it already re-exports {@link WGSL_BUILTIN_NAMES} from `core/sot.ts` — the language
 * service depends on the compiler, never the reverse, so the canonical list lives here.
 */
export const ATTRIBUTE_NAMES: readonly string[] = [
  'vertex',
  'fragment',
  'compute',
  'builtin',
  'location',
  // The entry-IO attributes of §53. `@interpolate` and `@invariant` pass through to WGSL and
  // become qualifiers on GLSL ES 3.00; `@blend_src` derives the `dualSourceBlending`
  // capability and fails the module closed on GLSL, which has no second source.
  'interpolate',
  'invariant',
  'blend_src',
  // §54: `@diagnostic("off", "derivative_uniformity")` on an entry, which becomes a
  // module-scope `diagnostic(off, derivative_uniformity);`.
  'diagnostic',
];

/** The interpolation TYPES WGSL names, and the SAMPLINGS each admits. `flat` takes `first`
 *  or `either` and nothing else; `perspective` and `linear` take the three positions. A
 *  sampling is optional everywhere. */
const INTERPOLATE_TYPES: Readonly<Record<string, readonly string[]>> = {
  perspective: ['center', 'centroid', 'sample'],
  linear: ['center', 'centroid', 'sample'],
  flat: ['first', 'either'],
};

/** Reads and checks an `@interpolate("type")` or `@interpolate("type", "sampling")` on a
 *  field, returning the WGSL attribute text, or `undefined` when there is none (or when the
 *  arguments were wrong, which is reported). */
export function interpolateDecoratorArg(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  decorators: readonly ts.Decorator[],
): string | undefined {
  for (const d of decorators) {
    if (!ts.isCallExpression(d.expression)) continue;
    if (!ts.isIdentifier(d.expression.expression)) continue;
    if (d.expression.expression.text !== 'interpolate') continue;
    const raw = d.expression.arguments.map((a) =>
      ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : undefined,
    );
    const [type, sampling] = raw;
    if (type === undefined || raw.length > 2 || (raw.length === 2 && sampling === undefined)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate takes a type, and optionally a sampling, as strings: ` +
            `@interpolate("flat") or @interpolate("linear", "centroid").`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      );
      return undefined;
    }
    const samplings = INTERPOLATE_TYPES[type];
    if (samplings === undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate type "${type}" is not one WGSL has: ` +
            `${Object.keys(INTERPOLATE_TYPES).join(', ')}.`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      );
      return undefined;
    }
    if (sampling !== undefined && !samplings.includes(sampling)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d,
          `@interpolate("${type}") takes the sampling ${samplings.join(' or ')}, ` +
            `not "${sampling}".`,
          TS_CODES.ATTRIBUTE_NAME,
        ),
      );
      return undefined;
    }
    return sampling === undefined ? `@interpolate(${type})` : `@interpolate(${type}, ${sampling})`;
  }
  return undefined;
}

/** Whether `decorators` carries a bare `@invariant`. */
export function hasInvariantDecorator(decorators: readonly ts.Decorator[]): boolean {
  return decorators.some((d) => ts.isIdentifier(d.expression) && d.expression.text === 'invariant');
}

/**
 * Attribute names the compiler recognizes but always rejects with their own dedicated message
 * (`structs.ts`'s `"... on a class is not applied"` / `"@align on a field is not applied"`), so
 * {@link checkAttributeName} must not also call them "unknown" there — that would read as two
 * contradictory diagnostics on the same decorator.
 */
const RECOGNIZED_BUT_UNAPPLIED_ATTRIBUTE_NAMES: readonly string[] = ['std140', 'align'];

/** Where a decorator is written, as a refusal names the place. */
export type AttributeSite =
  | 'a struct field'
  | 'a class'
  | 'a function'
  | "a namespace's function"
  | 'a parameter'
  | 'a parameter of a function that is not an entry'
  | 'a declaration'
  | 'a local function'
  | 'a static field'
  | 'a constructor'
  | 'an overload signature'
  | 'an abstract member'
  | 'a mixin'
  | 'a class expression'
  | 'a local class'
  | 'an index signature';

/**
 * The attributes of {@link ATTRIBUTE_NAMES} each place that reads decorators applies. The
 * collector of that place drops any other, so {@link checkAttributeName} refuses it there: a
 * function is an entry by its stage, and `diagnostic-directive.ts` reads `@diagnostic` off a
 * top-level function only; an entry's parameter takes its IO, where `@invariant` has no effect
 * on the one input WGSL lets it mark (`position`) and is dropped; a struct field takes the IO of
 * an entry's struct. A class, and a parameter of a function that is not an entry, take none.
 */
const SITE_ATTRIBUTES: Readonly<Partial<Record<AttributeSite, readonly string[]>>> = {
  'a function': ['vertex', 'fragment', 'compute', 'diagnostic'],
  "a namespace's function": ['vertex', 'fragment', 'compute'],
  'a parameter': ['builtin', 'location', 'interpolate', 'invariant'],
  'a struct field': ['builtin', 'location', 'interpolate', 'invariant', 'blend_src'],
};

/** The attributes that make a function an entry, which `structs.ts` refuses on a class with a
 *  sentence of its own. */
const STAGE_ATTRIBUTES: readonly string[] = ['vertex', 'fragment', 'compute'];

/** `@std140` anywhere but a class, where `structs.ts` has its own sentence. It is GLSL's layout,
 *  and no position takes a layout here. */
const STD140_NOT_APPLIED =
  '"@std140" is not applied: WGSL lays out a struct by its own rules, which reflect() ' +
  'reports. Remove it.';

/** Why a binding's `@group` and `@binding` are not the author's (Rule 6.1): whichever form
 *  declares the binding, the host reads its slot back from `reflect()`. */
const BINDING_SLOT_REASON =
  "is WGSL's attribute, and is not applied: reflect() reports the group and slot each " +
  'binding gets. Remove it, and read the slot from reflect() on the host.';

/**
 * WGSL's attributes of a struct member (Rule 2.1), which the layout engine does not read
 * (surface §51). On a field, `@size` has its sentence in {@link WGSL_ATTRIBUTES_ELSEWHERE} and
 * `@align` its own in `structs.ts`; anywhere else, each is named as the struct field's.
 */
export const WGSL_MEMBER_ATTRIBUTES: readonly string[] = ['size', 'align'];

/**
 * WGSL's own attributes (Rule 2.1) that a `"use typeshade"` program does not write as a
 * decorator, each with the sentence that says where its intent goes instead. They are WGSL's,
 * so calling one "Unknown attribute" would be false; {@link checkAttributeName} and
 * {@link checkDeclarationDecorators} answer with these. The rest of WGSL's attribute list is
 * {@link ATTRIBUTE_NAMES}, `@align` ({@link WGSL_MEMBER_ATTRIBUTES}), and `@const`, which
 * TypeScript does not parse as a decorator (it is a keyword), and which WGSL keeps for its own
 * built-in functions anyway; `stage3.test.ts` holds the lists to the fixture's.
 */
export const WGSL_ATTRIBUTES_ELSEWHERE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    workgroup_size:
      '"@workgroup_size" is WGSL\'s attribute, written here as @compute\'s argument: ' +
      '@compute([64]) or @compute([8, 8]).',
    size:
      '"@size" is WGSL\'s attribute, and is not applied: a field takes the size WGSL\'s layout ' +
      'gives its type, which reflect() reports. Add a field where you need padding.',
    group: `"@group" ${BINDING_SLOT_REASON}`,
    binding: `"@binding" ${BINDING_SLOT_REASON}`,
    id:
      '"@id" is WGSL\'s attribute, and is not applied: the host sets an override by its name, ' +
      'which reflect() lists. Remove it.',
    must_use:
      '"@must_use" is WGSL\'s attribute, and is not applied: a call\'s result is not checked ' +
      'for use. Remove it.',
    subgroup_size:
      '"@subgroup_size" is WGSL\'s attribute, and is not applied: a compute entry runs at the ' +
      'subgroup size the device chooses. Remove it.',
  }),
);

/** What each attribute of {@link ATTRIBUTE_NAMES} marks, for the refusal of one written where it
 *  is not applied. `stage3.test.ts` writes every name of that list on a declaration and reads
 *  the sentence back, so a name added there without a row here fails it. */
const ATTRIBUTE_TARGET: Readonly<Record<string, string>> = {
  vertex: 'an entry function',
  fragment: 'an entry function',
  compute: 'an entry function',
  builtin: "an entry's input or output",
  location: "an entry's input or output",
  interpolate: "an entry's input or output",
  invariant: "an entry's input or output",
  blend_src: "a field of a fragment entry's output",
  diagnostic: 'a top-level function',
};

/** The decorator identifier `@name` or `@name(...)` reads off, or `undefined` for any other
 *  decorator shape (`@N.k`, `@(fragment)`), which no place reads as an attribute. */
function attributeNameOf(decorator: ts.Decorator): string | undefined {
  if (ts.isIdentifier(decorator.expression)) return decorator.expression.text;
  if (
    ts.isCallExpression(decorator.expression) &&
    ts.isIdentifier(decorator.expression.expression)
  ) {
    return decorator.expression.expression.text;
  }
  return undefined;
}

/** Whether a `@builtin(...)` id is supplied to the shader (`'input'`, a parameter or a field of
 *  a parameter's struct type) or produced by it (`'output'`, a return type or a field of a
 *  struct return type). */
export type BuiltinDirection = 'input' | 'output';

/** Finds a `@builtin("name")` decorator among `decorators` and returns its raw string and the
 *  string literal node itself, for a diagnostic span narrower than the whole declaration.
 *  Mirrors the decorator-call shape both `structs.ts` and `lower/function.ts` already parse. */
export function builtinDecoratorArg(
  decorators: readonly ts.Decorator[],
): { readonly name: string; readonly argNode: ts.StringLiteralLike } | undefined {
  for (const d of decorators) {
    if (!ts.isCallExpression(d.expression)) continue;
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== 'builtin') {
      continue;
    }
    const arg = d.expression.arguments[0];
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      return { name: arg.text, argNode: arg };
    }
  }
  return undefined;
}

function isWgslBuiltinName(name: string): name is WgslBuiltinName {
  return (WGSL_BUILTIN_NAMES as readonly string[]).includes(name);
}

/** Validates a `@builtin("...")` name against {@link WGSL_BUILTIN_NAMES}, pushing a `BUILTIN_NAME`
 *  error with a "Did you mean ...?" suggestion (by edit distance) when one is close. Returns
 *  whether `name` was valid, so a caller can skip the stage check below on an already-invalid
 *  name instead of compounding the error. */
export function checkBuiltinName(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
): boolean {
  if (isWgslBuiltinName(name)) return true;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      unknownNameSentence(
        `Unknown builtin "${name}".`,
        name,
        [WGSL_BUILTIN_NAMES],
        `Supported names: ${WGSL_BUILTIN_NAMES.join(', ')}.`,
      ),
      TS_CODES.BUILTIN_NAME,
    ),
  );
  return false;
}

/** Which stage(s) and direction(s) each builtin id is valid for, per design doc §10 step 5,
 *  and — for the extension-gated ids — per the WGSL built-in value table (§50). Every id in
 *  {@link WGSL_BUILTIN_NAMES} has a row now: `clip_distances` used to be absent and therefore
 *  unconstrained, which let `@builtin("clip_distances")` sit on a fragment INPUT with zero
 *  diagnostics and die at Tint. Exported for `foreign-names.test.ts`, which holds the direction
 *  a GLSL or HLSL built-in value's remedy names to this table. */
export const BUILTIN_STAGE_RULES: Readonly<
  Record<string, readonly { readonly stage: BuiltinStage; readonly direction: BuiltinDirection }[]>
> = {
  vertex_index: [{ stage: 'vertex', direction: 'input' }],
  instance_index: [{ stage: 'vertex', direction: 'input' }],
  position: [
    { stage: 'vertex', direction: 'output' },
    { stage: 'fragment', direction: 'input' },
  ],
  front_facing: [{ stage: 'fragment', direction: 'input' }],
  sample_index: [{ stage: 'fragment', direction: 'input' }],
  sample_mask: [
    { stage: 'fragment', direction: 'input' },
    { stage: 'fragment', direction: 'output' },
  ],
  frag_depth: [{ stage: 'fragment', direction: 'output' }],
  // WGSL: a vertex OUTPUT only, and an `array<f32, N ≤ 8>` — see checkBuiltinType.
  clip_distances: [{ stage: 'vertex', direction: 'output' }],
  primitive_index: [{ stage: 'fragment', direction: 'input' }],
  local_invocation_id: [{ stage: 'compute', direction: 'input' }],
  local_invocation_index: [{ stage: 'compute', direction: 'input' }],
  global_invocation_id: [{ stage: 'compute', direction: 'input' }],
  workgroup_id: [{ stage: 'compute', direction: 'input' }],
  num_workgroups: [{ stage: 'compute', direction: 'input' }],
  // The subgroup pair is a FRAGMENT input as well as a compute one, per WGSL's built-in
  // value table; it read as compute-only here, which refused a legal fragment program.
  subgroup_invocation_id: [
    { stage: 'compute', direction: 'input' },
    { stage: 'fragment', direction: 'input' },
  ],
  subgroup_size: [
    { stage: 'compute', direction: 'input' },
    { stage: 'fragment', direction: 'input' },
  ],
};

/** The longest `array<f32, N>` WGSL's built-in value table lets `@builtin(clip_distances)` be. */
const MAX_CLIP_DISTANCES = 8;

/** Validates the type of a `@location(n)` field or parameter (§53). WGSL: "the type of a
 *  user-defined IO must be a numeric scalar or numeric vector" — a `bool` at a location was
 *  emitted and Tint answered `cannot apply '@location' to declaration of type 'bool'`, while
 *  the GLSL writer produced `out bool ok;`, which a WebGL2 driver reads as something else
 *  again. A struct, an array or a matrix at a location is refused for the same reason. */
export function checkLocationType(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  type: ShaderType,
  interpolate?: string,
): void {
  // An INTEGRAL varying has one interpolation and it is `flat` — there is nothing to
  // interpolate between two integers. WGSL says so outright (Tint: `interpolation type must
  // be 'flat' for integral user-defined IO types`), and the attribute is derived from the
  // type for a field that spells none (§53) — so the only way to reach an integer varying
  // that is not flat is to write another one, which is refused here. It mattered: the GLSL
  // writer answers the same question from the type and emitted `flat out uint id;` whatever
  // the attribute said, so the one source described two programs again.
  if (interpolate !== undefined && isIntegerVarying(type) && !/^flat\b/.test(interpolate)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        node,
        `"${name}" is "${typeKey(type)}" at a @location, so its interpolation is "flat"; ` +
          `@interpolate(${interpolate}) is not one an integer has. Drop the attribute — it is ` +
          `derived from the type — or send an f32.`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return;
  }
  // An emulated double at a `@location` is NOT this rule's to answer. §39 measured what the
  // two targets do with one — a scalar `f64` vertex attribute is kept, because its `vec2<f32>`
  // pair fits the one slot it has, and every other position is refused with a message naming
  // the remedy — and `refuseF64EntryIo` in `lower/function.ts` carries that decision. Answering
  // here too would refuse the shape §39 keeps, and word the rest wrong.
  if (type.kind === 'f64' || type.kind === 'vec64') return;
  const ok =
    (type.kind === 'scalar' && type.scalar !== 'bool') ||
    (type.kind === 'vec' && type.elem !== 'bool');
  if (ok) return;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `"${name}" is at a @location and is "${typeKey(type)}"; a value passed between stages ` +
        `is a numeric scalar or a numeric vector. ` +
        (typeKey(type) === 'bool' || (type.kind === 'vec' && type.elem === 'bool')
          ? 'Send a u32 and compare it.'
          : 'Send its components as separate locations.'),
      TS_CODES.TYPE_MISMATCH,
    ),
  );
}

/** Validates the TYPE declared for a `@builtin(...)` id against what WGSL fixes for it.
 *
 *  Two shapes of rule. Every id with a SINGLE type is checked against {@link WGSL_BUILTIN_TYPES},
 *  which `core/sot.ts` already writes down — `@builtin("vertex_index") i: f32` used to emit
 *  and die at the driver (§53). `clip_distances` is the one id whose type an AUTHOR picks,
 *  `array<f32, N ≤ 8>`, so it has a rule of its own below rather than a row. A name with no
 *  rule of either kind is left alone, so an unknown id (already reported by
 *  {@link checkBuiltinName}) adds no second diagnostic. */
export function checkBuiltinType(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  type: ShaderType,
): void {
  // Every id but `clip_distances` has ONE type, which `core/sot.ts` already writes down — so
  // a declaration that disagrees is checked against that table rather than guessed at (§53).
  // `@builtin("vertex_index") i: f32` used to emit and die at the driver.
  const fixed = WGSL_BUILTIN_TYPES[name as FixedTypeBuiltinName] as ShaderType | undefined;
  if (fixed !== undefined) {
    if (typeKey(fixed) !== typeKey(type)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          `Builtin "${name}" is "${typeKey(fixed)}"; this declares it "${typeKey(type)}".`,
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
    return;
  }
  if (name !== 'clip_distances') return;
  const shown = typeKey(type);
  const ok =
    type.kind === 'array' &&
    type.elem.kind === 'scalar' &&
    type.elem.scalar === 'f32' &&
    type.size !== undefined &&
    type.size >= 1 &&
    type.size <= MAX_CLIP_DISTANCES;
  if (ok) return;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `Builtin "clip_distances" is "${shown}"; WGSL gives it array<f32, N> with N from 1 to ` +
        `${String(MAX_CLIP_DISTANCES)}.`,
      TS_CODES.TYPE_MISMATCH,
    ),
  );
}

/** Validates a (already name-checked) `@builtin(...)` id against the entry stage and direction
 *  it is used in — a `BUILTIN_STAGE` error when it belongs to a different stage or the other
 *  direction (e.g. `frag_depth`, a fragment output, used as a vertex function's return). A name
 *  with no rule (`clip_distances`, or an already-unknown name) is left unconstrained. */
export function checkBuiltinStage(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  stage: BuiltinStage,
  direction: BuiltinDirection,
): void {
  const rules = BUILTIN_STAGE_RULES[name];
  if (!rules || rules.length === 0) return;
  if (rules.some((r) => r.stage === stage && r.direction === direction)) return;
  const allowed = rules.map((r) => `${r.stage} ${r.direction}`).join(' or ');
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `Builtin "${name}" is not a valid ${stage} ${direction}; it is a ${allowed}.`,
      TS_CODES.BUILTIN_STAGE,
    ),
  );
}

/**
 * Validates one decorator's identifier against {@link ATTRIBUTE_NAMES}, pushing an
 * `ATTRIBUTE_NAME` error with a "Did you mean ...?" suggestion when one is close — the same
 * treatment {@link checkBuiltinName} gives a `@builtin("...")` string, but for the decorator
 * name itself. Without this, a misspelled attribute (`@vertx`, `@framgent`, `@bogus`) is silent
 * from both the compiler and the language service: TypeScript never resolves a decorator on an
 * invalid target, so there is no TS2304, and nothing else names the typo — the function or
 * field just silently stops being an entry point or an I/O field. `site` is where the decorator
 * is written. One of the list that `site` does not apply ({@link SITE_ATTRIBUTES}), and a
 * decorator that is not a name at all (`@N.k`, `@(fragment)`), were dropped the same way, and
 * are refused too (Rule 6.7). `@std140` and `@align` on a class, `@align` on a field, and a
 * stage on a class are left alone: `structs.ts` says those are not applied, and a second
 * sentence here would contradict it.
 */
export function checkAttributeName(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  decorator: ts.Decorator,
  site: AttributeSite,
): void {
  const message = attributeRefusal(decorator, sourceFile, site);
  if (message === undefined) return;
  // A generic function, and one that takes a function, is lowered once per instance, and each
  // pass reads its decorators again: one decorator is one refusal (Rule 12.4).
  const start = decorator.getStart(sourceFile);
  if (diagnostics.some((d) => d.start === start && d.message === message)) return;
  diagnostics.push(makeDiagnostic(sourceFile, decorator, message, TS_CODES.ATTRIBUTE_NAME));
}

/** The sentence {@link checkAttributeName} refuses `decorator`, written at `site`, with, or
 *  `undefined` where `site` applies it or another module refuses it. */
function attributeRefusal(
  decorator: ts.Decorator,
  sourceFile: ts.SourceFile,
  site: AttributeSite,
): string | undefined {
  const name = attributeNameOf(decorator);
  if (name === undefined) {
    return (
      `"${decorator.getText(sourceFile)}" is not applied: an attribute is written "@name" or ` +
      `"@name(...)". Remove it.`
    );
  }
  if (ATTRIBUTE_NAMES.includes(name)) {
    if (SITE_ATTRIBUTES[site]?.includes(name) === true) return undefined;
    if (site === 'a class' && STAGE_ATTRIBUTES.includes(name)) return undefined;
    return misplacedAttribute(name, site);
  }
  if (
    RECOGNIZED_BUT_UNAPPLIED_ATTRIBUTE_NAMES.includes(name) &&
    (site === 'a class' || (name === 'align' && site === 'a struct field'))
  ) {
    return undefined;
  }
  return name === 'std140'
    ? STD140_NOT_APPLIED
    : (wgslAttributeSentence(name, site) ?? unknownAttribute(name));
}

/** The sentence for `name`, one of {@link ATTRIBUTE_NAMES}, written at `site`, which does not
 *  apply it. The remedy is to remove it, which compiles wherever it was dropped; on an overload
 *  signature it is to move it onto the implementation, which reads it. */
function misplacedAttribute(
  name: string,
  site: AttributeSite,
  implementation?: AttributeSite,
): string {
  const remedy =
    implementation !== undefined && SITE_ATTRIBUTES[implementation]?.includes(name) === true
      ? 'Write it on the implementation.'
      : 'Remove it.';
  return `"@${name}" does not apply to ${site}: it marks ${ATTRIBUTE_TARGET[name]}. ${remedy}`;
}

/** The sentence for WGSL's own attribute `name` written at `site`, or `undefined` for a name
 *  that is not one of {@link WGSL_ATTRIBUTES_ELSEWHERE} or {@link WGSL_MEMBER_ATTRIBUTES}. A
 *  struct member's attribute anywhere but on a field is named as the field's. */
function wgslAttributeSentence(name: string, site: AttributeSite): string | undefined {
  if (WGSL_MEMBER_ATTRIBUTES.includes(name) && site !== 'a struct field') {
    return `"@${name}" is WGSL's attribute for a struct field, not ${site}. Remove it.`;
  }
  return WGSL_ATTRIBUTES_ELSEWHERE.get(name);
}

/** The sentence for a decorator name neither `"use typeshade"` nor WGSL has. An HLSL or GLSL
 *  attribute (`@numthreads`) names TypeShade's own (#218) before any spelling-distance guess,
 *  which for a foreign name would point at an unrelated attribute. */
function unknownAttribute(name: string): string {
  return unknownNameSentence(
    `Unknown attribute "@${name}".`,
    name,
    [ATTRIBUTE_NAMES],
    `Supported attributes: ${ATTRIBUTE_NAMES.map((n) => `@${n}`).join(', ')}.`,
    '@',
  );
}

/**
 * Where `node` takes a decorator that nothing in the compiler reads, as a refusal names the
 * place, or `undefined` where one is read or refused elsewhere. A variable statement at any
 * depth (a binding of any kind, an override, a module, namespace or local `const` or `let`), an
 * enum, an interface, a type alias and a namespace are `a declaration`, and a function declared
 * in another function's body is `a local function`: TypeScript refuses a decorator on each
 * (TS1206). So it does on a constructor, an index signature, a class expression and a class
 * declared in a function's body, and on a method, accessor or function written without a body,
 * an overload signature or an abstract member (TS1206 or TS1249), which the compiler skips for
 * the implementation, and on a mixin, which runs where it is applied and emits no function; a
 * parameter of any of those is unread with it. A local class, an index signature and a class
 * expression are refused whole where they are collected, and their decorator here with the
 * rest; a static block, refused whole in `structs.ts`, keeps TypeScript's TS1206 on its
 * decorator, since TypeScript's public tree gives a static block no modifiers to read. A
 * `static` field is a module constant, which TypeScript lets a decorator name (TS2304 when the
 * ambient library declares no such name). A top-level or a namespace's function with a body, a
 * class, its instance fields (a function-valued one is a method, Rule 8.16), its methods and
 * every other parameter are read, and refused, where they are collected.
 */
function unreadDecoratorSite(node: ts.Node): AttributeSite | undefined {
  if (
    ts.isVariableStatement(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return 'a declaration';
  }
  if (ts.isFunctionDeclaration(node)) {
    if (!ts.isSourceFile(node.parent) && !ts.isModuleBlock(node.parent)) return 'a local function';
    if (isMixinDeclaration(node)) return 'a mixin';
    return implementationOf(node) !== undefined ? 'an overload signature' : undefined;
  }
  if (ts.isClassExpression(node)) return 'a class expression';
  if (ts.isClassDeclaration(node)) {
    return ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent)
      ? undefined
      : 'a local class';
  }
  if (ts.isConstructorDeclaration(node)) return 'a constructor';
  if (ts.isIndexSignatureDeclaration(node)) return 'an index signature';
  if ((ts.isMethodDeclaration(node) || ts.isAccessor(node)) && node.body === undefined) {
    return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
      ? 'an abstract member'
      : 'an overload signature';
  }
  if (
    ts.isPropertyDeclaration(node) &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
  ) {
    return 'a static field';
  }
  if (ts.isParameter(node)) {
    const fn = node.parent;
    // A constructor's own decorator is unread; the parameters of the one with a body are the
    // ones `new` passes, and read.
    if (ts.isConstructorDeclaration(fn)) {
      return fn.body === undefined ? 'an overload signature' : undefined;
    }
    const site = unreadDecoratorSite(fn);
    return site === 'a local function' ? undefined : site;
  }
  return undefined;
}

/** The implementation an overload signature `fn` declares, the function of the same name with
 *  a body that TypeScript requires to follow it, or `undefined` when `fn` has a body, is
 *  `declare`, or has no implementation (each refused whole as `TS8020`). */
function implementationOf(fn: ts.FunctionDeclaration): ts.FunctionDeclaration | undefined {
  if (fn.body !== undefined || fn.name === undefined) return undefined;
  if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return undefined;
  const statements = (fn.parent as ts.SourceFile | ts.ModuleBlock).statements;
  return statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && s.body !== undefined && s.name?.text === fn.name!.text,
  );
}

/** Where the implementation reads what decorator `d`, written on an overload signature or one
 *  of its parameters, would apply, or `undefined` for any other place. */
function implementationSite(d: ts.Decorator): AttributeSite | undefined {
  const on = d.parent;
  const fn = ts.isParameter(on) ? on.parent : on;
  if (!ts.isFunctionDeclaration(fn)) return undefined;
  const implementation = implementationOf(fn);
  if (implementation === undefined) return undefined;
  if (!ts.isParameter(on)) {
    return ts.isSourceFile(fn.parent) ? 'a function' : "a namespace's function";
  }
  const isEntry = (implementation.modifiers ?? []).some((m) => {
    const name = ts.isDecorator(m) ? attributeNameOf(m) : undefined;
    return name !== undefined && STAGE_ATTRIBUTES.includes(name);
  });
  return isEntry ? 'a parameter' : 'a parameter of a function that is not an entry';
}

/**
 * Refuses every decorator nothing reads ({@link unreadDecoratorSite}), anywhere in `sourceFile`
 * (Rule 6.7). TypeScript parses one there, and its own checker refuses it (TS1206) or resolves
 * its name, which `compile()` never runs, so the decorator vanished: `@group(2) @binding(5)
 * declare const u: uniform<U>` was emitted at group 0, binding 0, and `@id(7)` on an override,
 * `@bogus` on a constant, on a local function, on a static field or on a constructor were
 * dropped with no word, and `@fragment` on an overload signature left the module with no
 * entry. Each decorator is answered by what it is: WGSL's own with
 * {@link WGSL_ATTRIBUTES_ELSEWHERE}, a struct member's as the field's, one `"use typeshade"`
 * reads with where it belongs, and any other name with the unknown-attribute sentence. The
 * language service's merge keeps this sentence alone and drops what TypeScript says inside the
 * same decorator (Rule 12.4).
 */
export function checkDeclarationDecorators(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
): void {
  const visit = (node: ts.Node): void => {
    const site = unreadDecoratorSite(node);
    if (site !== undefined && ts.canHaveModifiers(node)) {
      for (const d of node.modifiers ?? []) {
        if (ts.isDecorator(d)) diagnostics.push(unreadDecoratorRefusal(sourceFile, d, site));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/** The `TS8028` for decorator `d` written at `site`, where nothing reads it. */
function unreadDecoratorRefusal(
  sourceFile: ts.SourceFile,
  d: ts.Decorator,
  site: AttributeSite,
): TsCompilerDiagnostic {
  const name = attributeNameOf(d);
  const message =
    name === undefined
      ? `"${d.getText(sourceFile)}" is not applied: ${site} takes no decorator. Remove it.`
      : name === 'std140'
        ? STD140_NOT_APPLIED
        : ATTRIBUTE_NAMES.includes(name)
          ? misplacedAttribute(name, site, implementationSite(d))
          : (wgslAttributeSentence(name, site) ?? unknownAttribute(name));
  return makeDiagnostic(sourceFile, d, message, TS_CODES.ATTRIBUTE_NAME);
}
