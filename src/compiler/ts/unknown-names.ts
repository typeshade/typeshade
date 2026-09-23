// === A name the compiler cannot find, and the one remedy every place names (Rule 12.1) ===
//
// A name is written in many places: a value, a callee, a type, a field, an assignment target,
// an attribute, a `@builtin` id. Each place that cannot find one says so in its own sentence,
// and the remedy that follows is decided here, once, in one order:
//
// 1. A GLSL or HLSL name is TypeShade's spelling of it (`FOREIGN_NAMES`, #218): `lerp` is `mix`.
//    A spelling guess is wrong for these, because the nearest name by letters can mean
//    something else: `fmod` is one letter from `mod`, and `mod` floors where `fmod` truncates.
// 2. A name of the same kind that exists where the name was written, and is spelled like it:
//    `clmap` is "Did you mean "clamp"?".
// 3. Otherwise the place's own remedy, which its caller supplies.
//
// ONE ANSWER. The editor used to show TypeScript's TS2552 for a misspelled name, because its
// "Did you mean" was the only remedy on offer, while `compile()` and the build said "Unknown
// identifier" and nothing more. So an author (or an agent) who read the build got no fix, and
// the language service needed an exception to its rule that the compiler's sentence is the one
// kept (Rule 12.4). The compiler names the fix itself now, by TypeScript's own spelling rule, so
// every surface prints one sentence and the exception is gone.
//
// THE SPELLING RULE is TypeScript's (`getSpellingSuggestion` in its checker), so no suggestion
// the editor used to show is lost: an insertion or a deletion costs 1, a substitution 2, a
// change of case alone 0.1, a candidate whose length differs by more than a third is not
// considered, one shorter than three letters only when it differs by case, and one further
// than two fifths of the name's length is not a suggestion. One addition: two adjacent letters
// swapped cost 1, as in rustc's rule, since `tiem` for `time` and `vce3` for `vec3` are the
// commonest slip of all and TypeScript's rule misses both in a short name.
//
// SCOPES. Candidates come in groups, innermost scope first, and the first group with a match
// answers: a parameter spelled like the typo wins over a builtin spelled like it, which is the
// order TypeScript's own lookup reports in.

import ts from 'typescript';
import { foreignNameRemedy } from './foreign-names.js';

/** Candidate names, a scope to a group, innermost first. */
export type NameScopes = Iterable<Iterable<string>>;

/** The edit distance between `a` and `b` by the costs above, or `undefined` once it is known to
 *  exceed `max`. */
function spellingDistance(a: string, b: string, max: number): number | undefined {
  let beforePrevious: number[] = [];
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const x = a[i - 1]!;
      const y = b[j - 1]!;
      let d: number;
      if (x === y) {
        d = previous[j - 1]!;
      } else {
        const substitution = x.toLowerCase() === y.toLowerCase() ? 0.1 : 2;
        d = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + substitution);
        if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) {
          d = Math.min(d, beforePrevious[j - 2]! + 1);
        }
      }
      current.push(d);
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return undefined;
    beforePrevious = previous;
    previous = current;
  }
  const distance = previous[b.length]!;
  return distance > max ? undefined : distance;
}

/** The candidate in one group spelled most like `name`, by the rule above, or `undefined`. */
function closestIn(name: string, candidates: Iterable<string>): string | undefined {
  const maxLengthDifference = Math.max(2, Math.floor(name.length * 0.34));
  let bestDistance = Math.floor(name.length * 0.4) + 1;
  let best: string | undefined;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    if (Math.abs(candidate.length - name.length) > maxLengthDifference) continue;
    if (candidate.length < 3 && candidate.toLowerCase() !== name.toLowerCase()) continue;
    const distance = spellingDistance(name, candidate, bestDistance - 0.1);
    if (distance === undefined) continue;
    bestDistance = distance;
    best = candidate;
  }
  return best;
}

/** The name `name` was most likely meant to be: the closest candidate of the innermost group
 *  that has one, or `undefined` when no candidate is close enough to suggest. */
export function similarName(name: string, scopes: NameScopes): string | undefined {
  for (const group of scopes) {
    const hit = closestIn(name, group);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** The sentence that suggests `name`, written as the author would write it (`prefix` is `@`
 *  for an attribute). */
export const didYouMean = (name: string, prefix = ''): string => `Did you mean "${prefix}${name}"?`;

/** The remedy for an unknown `name` among `scopes`: TypeShade's spelling of a GLSL or HLSL
 *  name, else the name of the same kind spelled like it, else `undefined`, for the caller to
 *  name its own. `prefix` is how the suggestion is written (`@` for an attribute). */
export function unknownNameRemedy(
  name: string,
  scopes: NameScopes,
  prefix = '',
): string | undefined {
  const foreign = foreignNameRemedy(name);
  if (foreign !== undefined) return foreign;
  const similar = similarName(name, scopes);
  return similar === undefined ? undefined : didYouMean(similar, prefix);
}

/** The sentence for an unknown name: `mistake`, then the remedy of {@link unknownNameRemedy},
 *  or `otherwise` when neither table has one (and nothing, when `otherwise` is absent). */
export function unknownNameSentence(
  mistake: string,
  name: string,
  scopes: NameScopes,
  otherwise?: string,
  prefix = '',
): string {
  const remedy = unknownNameRemedy(name, scopes, prefix) ?? otherwise;
  return remedy === undefined ? mistake : `${mistake} ${remedy}`;
}

// --- Names in scope, by TypeScript's lexical rule ---

/** What a name is asked for as: a value (read or written), a callee, or a type. A callee's
 *  candidates are the values that can be called: a function, a local function, a parameter that
 *  takes one, and an imported name, which may be one. */
export type NameMeaning = 'value' | 'callee' | 'type';

/** The names a binding pattern binds: the name itself, or each name a destructuring binds. */
function boundNames(pattern: ts.BindingName): string[] {
  if (ts.isIdentifier(pattern)) return [pattern.text];
  const out: string[] = [];
  for (const element of pattern.elements) {
    if (!ts.isOmittedExpression(element)) out.push(...boundNames(element.name));
  }
  return out;
}

/** Whether a variable's initializer is a function, which makes the variable a callee. */
const holdsFunction = (d: ts.VariableDeclaration): boolean =>
  d.initializer !== undefined &&
  (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));

/** Whether a parameter takes a function (Rule 8.18). */
const takesFunction = (p: ts.ParameterDeclaration): boolean =>
  p.type !== undefined && ts.isFunctionTypeNode(p.type);

/** The names an import declaration binds, which are values and types both. */
function importedNames(st: ts.ImportDeclaration): string[] {
  const clause = st.importClause;
  if (clause === undefined) return [];
  const out: string[] = [];
  if (clause.name !== undefined) out.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) out.push(bindings.name.text);
    else for (const spec of bindings.elements) out.push(spec.name.text);
  }
  return out;
}

/** The names a statement list declares, for `meaning`. */
function declaredNames(statements: readonly ts.Statement[], meaning: NameMeaning): string[] {
  const out: string[] = [];
  for (const st of statements) {
    if (ts.isImportDeclaration(st)) {
      out.push(...importedNames(st));
      continue;
    }
    if (meaning === 'type') {
      if (
        (ts.isClassDeclaration(st) ||
          ts.isInterfaceDeclaration(st) ||
          ts.isTypeAliasDeclaration(st) ||
          ts.isEnumDeclaration(st)) &&
        st.name !== undefined
      ) {
        out.push(st.name.text);
      }
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (meaning === 'value' || holdsFunction(d)) out.push(...boundNames(d.name));
      }
    } else if (ts.isFunctionDeclaration(st) && st.name !== undefined) {
      out.push(st.name.text);
    } else if (
      meaning === 'value' &&
      (ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) &&
      st.name !== undefined &&
      ts.isIdentifier(st.name)
    ) {
      out.push(st.name.text);
    }
  }
  return out;
}

/** The parameters of a function-like node, as candidates for `meaning`. */
function parameterNames(fn: ts.SignatureDeclaration, meaning: NameMeaning): string[] {
  if (meaning === 'type') return (fn.typeParameters ?? []).map((tp) => tp.name.text);
  const out: string[] = [];
  for (const p of fn.parameters) {
    if (meaning === 'value' || takesFunction(p)) out.push(...boundNames(p.name));
  }
  if (meaning === 'value' && ts.isFunctionExpression(fn) && fn.name !== undefined) {
    out.push(fn.name.text);
  }
  return out;
}

/**
 * The names declared where `node` is written, for `meaning`, a scope to a group, innermost
 * first, by TypeScript's lexical rule: each block, `case` block, loop header, `catch` clause and
 * parameter list around it, then the namespace bodies, then the file. A function's parameters
 * and the top level of its body are one scope, as they are to TypeScript. A name declared
 * anywhere in a scope is a candidate, as it is for TypeScript's "Did you mean", whatever its
 * position there.
 */
export function namesInScope(node: ts.Node, meaning: NameMeaning): string[][] {
  const scopes: string[][] = [];
  let from: ts.Node = node;
  for (let at: ts.Node | undefined = node.parent; at !== undefined; from = at, at = at.parent) {
    const names: string[] = [];
    if (ts.isBlock(at) || ts.isSourceFile(at) || ts.isModuleBlock(at)) {
      names.push(...declaredNames(at.statements, meaning));
      if (ts.isBlock(at) && ts.isFunctionLike(at.parent) && meaning !== 'type') {
        names.push(...parameterNames(at.parent, meaning));
      }
    } else if (ts.isFunctionLike(at)) {
      // A type parameter is in scope in the signature and the body alike. A value parameter was
      // counted with the body's block, unless the name is not in that block: an arrow function
      // with an expression body, or a later parameter's default.
      const body = (at as { readonly body?: ts.Node }).body;
      if (meaning === 'type' || body === undefined || !ts.isBlock(body) || from !== body) {
        names.push(...parameterNames(at, meaning));
      }
    } else if (ts.isCaseBlock(at)) {
      for (const clause of at.clauses) names.push(...declaredNames(clause.statements, meaning));
    } else if (
      meaning !== 'type' &&
      (ts.isForStatement(at) || ts.isForOfStatement(at) || ts.isForInStatement(at)) &&
      at.initializer !== undefined &&
      ts.isVariableDeclarationList(at.initializer)
    ) {
      for (const d of at.initializer.declarations) {
        if (meaning === 'value' || holdsFunction(d)) names.push(...boundNames(d.name));
      }
    } else if (
      meaning === 'value' &&
      ts.isCatchClause(at) &&
      at.variableDeclaration !== undefined
    ) {
      names.push(...boundNames(at.variableDeclaration.name));
    } else if (
      meaning === 'type' &&
      (ts.isClassLike(at) || ts.isInterfaceDeclaration(at) || ts.isTypeAliasDeclaration(at))
    ) {
      names.push(...(at.typeParameters ?? []).map((tp) => tp.name.text));
    }
    if (names.length > 0) scopes.push(names);
  }
  return scopes;
}

// --- Members a declaration names, for a misspelled `C.x`, `E.x`, `N.f()` or `v.m()` ---

/** The class, enum or namespace the file declares under the flattened name `flat` (`N_P` for
 *  `P` inside `namespace N`, #107). */
function declarationNamed(
  sourceFile: ts.SourceFile,
  flat: string,
): ts.ClassDeclaration | ts.EnumDeclaration | ts.ModuleBlock | undefined {
  const visit = (
    statements: readonly ts.Statement[],
    prefix: string,
  ): ts.ClassDeclaration | ts.EnumDeclaration | ts.ModuleBlock | undefined => {
    for (const st of statements) {
      if (
        (ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) &&
        st.name !== undefined &&
        `${prefix}${st.name.text}` === flat
      ) {
        return st;
      }
      if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name)) {
        let body = st.body;
        let inner = `${prefix}${st.name.text}`;
        while (body !== undefined && ts.isModuleDeclaration(body)) {
          inner = `${inner}_${body.name.text}`;
          body = body.body;
        }
        if (body === undefined || !ts.isModuleBlock(body)) continue;
        if (inner === flat) return body;
        const hit = visit(body.statements, `${inner}_`);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  };
  return visit(sourceFile.statements, '');
}

const isStatic = (m: ts.ClassElement): boolean =>
  ts.getModifiers(m as ts.HasModifiers)?.some((k) => k.kind === ts.SyntaxKind.StaticKeyword) ??
  false;

const writtenName = (m: ts.ClassElement): string | undefined =>
  m.name !== undefined && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))
    ? m.name.text
    : undefined;

/** The static members the class `cls` declares, by the names they are written under. */
export function staticMemberNames(cls: string, sourceFile: ts.SourceFile): string[] {
  const decl = declarationNamed(sourceFile, cls);
  if (decl === undefined || !ts.isClassDeclaration(decl)) return [];
  return decl.members.flatMap((m) => {
    const name = isStatic(m) ? writtenName(m) : undefined;
    return name === undefined ? [] : [name];
  });
}

/** The instance methods the class `cls` declares. */
export function methodNames(cls: string, sourceFile: ts.SourceFile): string[] {
  const decl = declarationNamed(sourceFile, cls);
  if (decl === undefined || !ts.isClassDeclaration(decl)) return [];
  return decl.members.flatMap((m) => {
    const name = ts.isMethodDeclaration(m) && !isStatic(m) ? writtenName(m) : undefined;
    return name === undefined ? [] : [name];
  });
}

/** The members the enum `enumName` declares. */
export function enumMemberNames(enumName: string, sourceFile: ts.SourceFile): string[] {
  const decl = declarationNamed(sourceFile, enumName);
  if (decl === undefined || !ts.isEnumDeclaration(decl)) return [];
  return decl.members.flatMap((m) => (ts.isIdentifier(m.name) ? [m.name.text] : []));
}

/** The functions the namespace `ns` declares (flattened, `A_B` for `namespace A.B`). */
export function namespaceFunctionNames(ns: string, sourceFile: ts.SourceFile): string[] {
  const decl = declarationNamed(sourceFile, ns);
  if (decl === undefined || !ts.isModuleBlock(decl)) return [];
  return decl.statements.flatMap((st) =>
    ts.isFunctionDeclaration(st) && st.name !== undefined ? [st.name.text] : [],
  );
}
