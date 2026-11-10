// Implements: Rule 6.6, Rule 6.7, Rule 8.25 (docs/language-design.md; traced in reqs/).
//
// The attribute types of change 0111 (decision D2, amendment 1): an entry input's or output's
// attribute written in its type, which a plain `tsc --strict` accepts, in place of a decorator
// on a parameter or a field, which it refuses on a function's parameter (TS1206).
//
//   i: builtin<'vertex_index'>                  the parameter `@builtin("vertex_index") i: u32`
//   pos: builtin<'position', { invariant: true }>
//   cd: builtin<'clip_distances', array<f32, 4>>
//   id: location<1, u32, { interpolate: 'flat' }>
//   b: location<0, vec4, { blend_src: 1 }>
//
// A built-in value takes its type from WGSL (`WGSL_BUILTIN_TYPES`, change 0135, decision D1.2),
// so `builtin<N>` writes none and an option is its second argument. `clip_distances` is the one
// name whose type the author chooses, and it keeps its type argument. A written type that WGSL
// fixes, `builtin<'vertex_index', u32>`, is the migration form: it is still read, and
// `builtin-type-form.ts` warns on it (`TS8028`).
//
// The type form of a parameter qualifier, `x: inout<f32>` and `y: out<f32>`, is not the
// language's form: a qualifier is written before the parameter, `@inout x: f32` (Rule 8.25,
// change 0137), and the type form is refused with `TS8028` (`refuseQualifierTypes`). The
// refused type still stands for its qualifier on a parameter, so that the refusal is the one
// diagnostic its mistake gets (Rule 12.4), and it still means its value type everywhere.
//
// Each type stands for the decorators the decorated form writes. The decorators are made of the
// type's own nodes: the callee is the type's name or the option's name, and each argument is the
// literal written in the type. So every reader of a decorator reads these, every position is
// one the author wrote, and the emit is the decorated form's. The type itself means its value
// type: `builtin<'position', vec4>` is a `vec4` (`type-map.ts`).
import ts from 'typescript';

/** The attribute types, and the index of the type argument that is the value's type. `inout`
 *  and `out` are the refused type form of a qualifier (change 0137), kept here so that each
 *  means its value type while the refusal stands. */
export const ATTRIBUTE_TYPES: Readonly<Record<string, number>> = {
  builtin: 1,
  location: 1,
  inout: 0,
  out: 0,
};

/** The longest `array<f32, N>` WGSL's built-in value table lets `clip_distances` be. */
export const MAX_CLIP_DISTANCES = 8;

/** The options an attribute type's options argument may name, each a decorator of its own. */
const OPTIONS = ['interpolate', 'invariant', 'blend_src'] as const;

/** The arguments of an attribute type after its first: the value's type, where one is written,
 *  and the options. A `location<n, T, O>` writes both in place. A `builtin<N>` writes no type,
 *  and an options object is then its second argument, `builtin<'position', { invariant: true }>`
 *  (change 0135, decision D1.3); the migration form `builtin<N, T, O>` writes the type second
 *  and the options third. An options object is an object type literal, which no built-in
 *  value's type is. */
export function attributeArgumentsOf(ref: ts.TypeReferenceNode): {
  readonly value?: ts.TypeNode;
  readonly options?: ts.TypeNode;
} {
  const args = ref.typeArguments ?? [];
  const name = (ref.typeName as ts.Identifier).text;
  if (name === 'inout' || name === 'out') return args[0] === undefined ? {} : { value: args[0] };
  const second = args[1];
  if (name === 'builtin' && second !== undefined && ts.isTypeLiteralNode(second))
    return { options: second };
  return {
    ...(second === undefined ? {} : { value: second }),
    ...(args[2] === undefined ? {} : { options: args[2] }),
  };
}

/** The name a `builtin<"…">` writes, or undefined when its first argument is no string. */
export function builtinNameOf(ref: ts.TypeReferenceNode): string | undefined {
  const first = ref.typeArguments?.[0];
  if (first === undefined || !ts.isLiteralTypeNode(first)) return undefined;
  const literal = first.literal;
  return ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)
    ? literal.text
    : undefined;
}

/** Whether `node` is the builtin id of a `builtin<"…", T>` type, the one string position of an
 *  attribute type with a closed vocabulary: hover and completion read it as they read the
 *  argument of a `builtin("…")` decorator. */
export function isBuiltinTypeLiteral(node: ts.Node): node is ts.StringLiteral {
  const literalType = node.parent;
  const ref = literalType?.parent;
  return (
    ts.isStringLiteral(node) &&
    literalType !== undefined &&
    ts.isLiteralTypeNode(literalType) &&
    ref !== undefined &&
    ts.isTypeReferenceNode(ref) &&
    ts.isIdentifier(ref.typeName) &&
    ref.typeName.text === 'builtin' &&
    ref.typeArguments?.[0] === literalType
  );
}

/** Whether `node` is a reference to an attribute type. */
export function isAttributeType(node: ts.TypeNode | undefined): node is ts.TypeReferenceNode {
  return (
    node !== undefined &&
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    Object.hasOwn(ATTRIBUTE_TYPES, node.typeName.text)
  );
}

/** The value type an attribute type stands for, or `node` when it is none. Nested attribute
 *  types are unwrapped too: `inout<location<0, f32>>` is never written, but costs nothing. */
export function valueTypeOf(node: ts.TypeNode): ts.TypeNode {
  let at: ts.TypeNode = node;
  while (isAttributeType(at)) {
    const value = attributeArgumentsOf(at).value;
    if (value === undefined) return at;
    at = value;
  }
  return at;
}

const made = new WeakSet<ts.Decorator>();
const cache = new WeakMap<ts.Node, readonly ts.Decorator[]>();

/** Whether a decorator was made from an attribute type rather than written. */
export function isTypeDecorator(d: ts.Decorator): boolean {
  return made.has(d);
}

/** Gives a synthesized node the text range of `range` and the parent `parent`. */
function place<T extends ts.Node>(node: T, range: ts.TextRange, parent: ts.Node): T {
  ts.setTextRange(node, range);
  (node as { parent: ts.Node }).parent = parent;
  return node;
}

/** A literal written as a type argument (`'position'`, `0`, `true`), or undefined. */
function literalOf(node: ts.TypeNode | undefined): ts.Expression | undefined {
  if (node === undefined || !ts.isLiteralTypeNode(node)) return undefined;
  return node.literal as ts.Expression;
}

/** The decorators the attribute types in `node`'s type stand for, in the order the decorated
 *  form writes them: the attribute, then its options. One array per declaration, so each pass
 *  reads the same nodes. `node` is a parameter, a class field or an interface field. */
export function typeDecoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  // A function's type is its result's, whose attribute the stage gives it (Rule 8.2).
  if (!ts.isParameter(node) && !ts.isPropertyDeclaration(node) && !ts.isPropertySignature(node))
    return [];
  const known = cache.get(node);
  if (known !== undefined) return known;
  const out: ts.Decorator[] = [];
  const parameter = ts.isParameter(node);
  const type = (node as { type?: ts.TypeNode }).type;
  const f = ts.factory;
  const decorator = (
    callee: ts.Identifier,
    args: readonly ts.Expression[] | undefined,
    range: ts.TextRange,
  ): void => {
    const expr: ts.Expression =
      args === undefined ? callee : f.createCallExpression(callee, undefined, args);
    const d = f.createDecorator(expr);
    place(d, range, node);
    if (expr !== callee) place(expr, range, d);
    made.add(d);
    out.push(d);
  };
  let at = type;
  while (isAttributeType(at)) {
    const ref = at;
    const name = ref.typeName as ts.Identifier;
    const args = ref.typeArguments ?? ts.factory.createNodeArray<ts.TypeNode>();
    if (name.text === 'inout' || name.text === 'out') {
      // The refused type form stands for its qualifier on a parameter alone, where the front
      // end reads a qualifier; elsewhere it is its value type (change 0137).
      if (parameter) decorator(name, undefined, ref);
    } else {
      const literal = literalOf(args[0]);
      decorator(name, literal === undefined ? [] : [literal], ref);
      const options = attributeArgumentsOf(ref).options;
      if (options !== undefined && ts.isTypeLiteralNode(options)) {
        for (const member of options.members) {
          if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
          if (!(OPTIONS as readonly string[]).includes(member.name.text)) continue;
          const value = member.type;
          if (member.name.text === 'invariant') {
            decorator(member.name, undefined, member);
            continue;
          }
          // `interpolate: 'flat'`, or a type and a sampling, `interpolate: ['linear', 'centroid']`.
          const values =
            value !== undefined && ts.isTupleTypeNode(value)
              ? value.elements.map((e) => literalOf(e as ts.TypeNode))
              : [literalOf(value)];
          decorator(
            member.name,
            values.filter((v): v is ts.Expression => v !== undefined),
            member,
          );
        }
      }
    }
    at = attributeArgumentsOf(ref).value;
  }
  cache.set(node, out);
  return out;
}

/** The decorators `node` carries: those written on it, then those its type stands for. */
export function attributeDecoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  const written = ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? [])
    : ((node as { modifiers?: readonly ts.ModifierLike[] }).modifiers ?? []).filter(ts.isDecorator);
  const typed = typeDecoratorsOf(node);
  return typed.length === 0 ? written : [...written, ...typed];
}
