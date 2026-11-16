// Validate stage-restricted operations after every function body has been lowered (Rule 8.3).
import ts from 'typescript';
import type { Expr, FuncDecl, ModuleVarDecl, Stmt } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { collectLocals } from '../../core/passes/opt/expr-utils.js';
import {
  ATOMIC_INTRINSICS,
  isBarrierIntrinsic,
  SUBGROUP_INTRINSICS,
} from '../../core/intrinsics.js';
import { diagnosticAtSpan, makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { sameFile, writtenText } from './context.js';
import { calleeNamesOf } from './function-call-graph.js';

type RenderStage = 'vertex' | 'fragment';
export const workgroupStageMessage = (name: string, stage: RenderStage): string =>
  `"${name}" is workgroup memory, which only a compute entry has; a ${stage} entry cannot read or write it.`;
export const barrierStageMessage = (name: string, stage: RenderStage): string =>
  `${name}() belongs in a compute entry or a function it calls; a ${stage} entry has ` +
  `${name === 'textureBarrier' ? 'no workgroup whose texture writes it could order' : 'no workgroup to wait for'}.`;

type Use = Extract<Expr, { op: 'varref' | 'call' }>;

/** Read the lowered bodies before optimisation. A function with no render caller is legal.
 * Calls follow declaration identity, so a builtin cannot reach a same-named user helper.
 * Local IR names are excluded: generated array helpers need not avoid module-variable names. */
export function checkComputeOnlyUses(
  funcs: readonly FuncDecl[],
  vars: readonly ModuleVarDecl[],
  nodes: ReadonlyMap<string, ts.Node>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const workgroup = new Set(vars.filter((v) => v.space === 'workgroup').map((v) => v.name));
  const own = new Map<FuncDecl, { uses: Use[]; calls: Set<FuncDecl> }>();
  for (const fn of funcs) {
    const locals = new Set(fn.params.map((p) => p.name));
    collectLocals(fn.body, locals);
    const uses: Use[] = [];
    const calls = new Set<FuncDecl>();
    const walk = (stmt: Stmt): void =>
      eachStmtExpr(
        stmt,
        (expr) =>
          eachExpr(expr, (e) => {
            if (e.op === 'call') {
              if (e.declRef !== undefined) calls.add(e.declRef);
              else if (isBarrierIntrinsic(e.fn)) uses.push(e);
            } else if (e.op === 'varref' && workgroup.has(e.name) && !locals.has(e.name))
              uses.push(e);
          }),
        walk,
      );
    for (const stmt of fn.body) walk(stmt);
    own.set(fn, { uses, calls });
  }
  const key = (d: TsCompilerDiagnostic): string =>
    JSON.stringify([d.fileName, d.start, d.length, d.code, d.message]);
  const reported = new Set(diagnostics.map(key));
  // Recover the AST node for the existing linked-origin map. A helper in another file is
  // legal in that file alone; its excluded entry must own the error the editor displays.
  const at = (node: ts.Node, start: number, end: number): ts.Node | undefined => {
    if (node.getStart(sourceFile) === start && node.getEnd() === end) return node;
    return ts.forEachChild(node, (child) =>
      child.pos <= start && child.end >= end ? at(child, start, end) : undefined,
    );
  };
  const originNodes = new Map<Use, ts.Node | undefined>();
  const originOf = (use: Use): ts.Node | undefined => {
    if (!originNodes.has(use)) {
      originNodes.set(
        use,
        use.span === undefined
          ? undefined
          : at(sourceFile, use.span.start, use.span.start + use.span.length),
      );
    }
    return originNodes.get(use);
  };
  for (const entry of funcs) {
    if (entry.stage !== 'vertex' && entry.stage !== 'fragment') continue;
    const entryNode = nodes.get(entry.name);
    const seen = new Set<FuncDecl>();
    const queue = [entry];
    for (let i = 0; i < queue.length; i++) {
      const fn = queue[i]!;
      if (seen.has(fn)) continue;
      seen.add(fn);
      const record = own.get(fn);
      if (record === undefined) continue;
      for (const use of record.uses) {
        const useNode = originOf(use);
        const imported =
          useNode !== undefined && entryNode !== undefined && !sameFile(useNode, entryNode);
        const written =
          useNode !== undefined
            ? writtenText(useNode)
            : use.span === undefined
              ? use.op === 'varref'
                ? use.name
                : use.fn
              : sourceFile.text.slice(use.span.start, use.span.start + use.span.length);
        const diagnostic = diagnosticAtSpan(
          sourceFile,
          imported ? undefined : use.span,
          imported ? ((entryNode as ts.NamedDeclaration).name ?? entryNode) : nodes.get(fn.name),
          use.op === 'varref'
            ? workgroupStageMessage(written, entry.stage)
            : barrierStageMessage(use.fn, entry.stage),
          use.op === 'varref' ? TS_CODES.MODULE_VAR : TS_CODES.BARRIER_PLACEMENT,
        );
        const id = key(diagnostic);
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic);
      }
      queue.push(...record.calls);
    }
  }
}

/** The ops WGSL and GLSL ES 3.00 allow only in the fragment stage: the kill, the three
 *  screen-space derivatives, which need the neighbouring invocations of a quad, and the depth
 *  comparison with an IMPLICIT level of detail, which needs the same derivatives to pick its
 *  level (roadmap 0.4 item 11; Tint: "built-in cannot be used by compute pipeline stage").
 *  `textureSampleCompareLevel` samples level 0 and is legal in any stage, so it is not here. */
/** The name the author wrote for a fragment-only call. The set below holds NEUTRAL ids, and the
 *  array and cube forms of a texture read are ids of their own (`textureSampleCompareArray`,
 *  `textureSampleBiasArray`, `textureSampleCompareCube`) that no author writes: the surface
 *  spells every form with the one name and the texture's dim picks the id. So the suffix comes
 *  off before the message, which otherwise names a function the file does not contain. */
const writtenName = (op: string): string =>
  op.replace(/^(texture\w+?)(CubeArray|Array|Cube)$/, '$1');

/** The stage-restricted calls, EXPORTED so a later pass can seed its own walk from the same
 *  rows rather than keep a second copy (#145). */
export const FRAGMENT_ONLY_CALLS: ReadonlySet<string> = new Set([
  // The implicit level of detail of a plain sample needs the derivatives. The plain, array and
  // cube-array ids are here AND in the core lint (fragment-only-builtin), which is the EDSL's
  // only gate; the front end says it first, at the entry, with the call chain in the sentence.
  // A cube samples under the plain id, since `arraySuffix` gives a cube no suffix.
  //
  // `textureSample` and `textureSampleArray` were in the LINT alone until #145, so a vertex
  // entry sampling a `texture_2d` was answered by an SD0109 from the backend rather than by a
  // sentence about the author's own file. Keeping the two tables equal is what the test does.
  'textureSample',
  'textureSampleArray',
  'textureSampleCubeArray',
  'textureSampleCompare',
  'textureSampleCompareArray',
  'textureSampleCompareCube',
  // A bias shifts the IMPLICIT level of detail, so it needs the derivatives too; Tint and a
  // WebGL2 driver both refuse it outside a fragment stage (roadmap 0.4 item 12).
  'textureSampleBias',
  'textureSampleBiasArray',
  'textureSampleBiasCubeArray',
  'textureSampleCompareCubeArray',
  'fwidth',
  'dpdx',
  'dpdy',
  'fwidthCoarse',
  'fwidthFine',
  'dpdxCoarse',
  'dpdxFine',
  'dpdyCoarse',
  'dpdyFine',
]);

/** The calls WGSL admits in a fragment or a compute stage but not in a vertex one, EXPORTED
 *  beside the set above (#145): a texture write (`textureStore` is `@stage("fragment",
 *  "compute")` in Tint's table, core.def:1484-1522) and every atomic built-in
 *  ("Atomic built-in functions must not be used in a vertex shader stage", wgsl.txt:25422).
 *  The atomics are read off the intrinsic catalogue rather than listed again, so one added
 *  there is refused in a vertex entry by existing.
 *
 *  Any call that TOUCHES a writable storage texture belongs to this group too. That rule is
 *  about the RESOURCE, not the builtin — "a resource with write or read_write access must not
 *  be statically accessed by a vertex shader" — so it cannot be a name: `textureLoad` and
 *  `textureDimensions` are the same ids a sampled texture uses. It is recognised by the
 *  argument's own type in {@link stageRestrictedOpsOf}. Reported the way the fragment-only set
 *  is, over the call graph, but only for a vertex entry. */
export const FRAGMENT_OR_COMPUTE_CALLS: ReadonlySet<string> = new Set([
  'textureStore',
  ...Object.keys(ATOMIC_INTRINSICS),
  // The subgroup built-in functions (change 0117): `core.def` stages every one
  // `fragment, compute`, and a vertex stage has no subgroup to fold.
  ...SUBGROUP_INTRINSICS,
]);

/** Why a call of {@link FRAGMENT_OR_COMPUTE_CALLS} is not in a vertex shader, by family. The
 *  rule is one of two in the spec: a resource with write access is not reachable from a vertex
 *  stage (wgsl.txt:7741-7743, 15343-15347), or the built-in itself is stage-restricted. */
const whyNotVertex = (op: string): string =>
  op === 'textureStore'
    ? `WGSL allows a texture write in a fragment or compute stage only.`
    : ATOMIC_NAMES.has(op)
      ? `WGSL allows an atomic built-in in a fragment or compute stage only.`
      : SUBGROUP_INTRINSICS.has(op)
        ? `WGSL allows a subgroup built-in function in a fragment or compute stage only.`
        : `A storage texture declared "read_write" must not be reached from a vertex stage at ` +
          `all, so reading or measuring one there is refused with writing it. (A "write" one ` +
          `refuses the read itself, whatever the stage.)`;

const ATOMIC_NAMES: ReadonlySet<string> = new Set(Object.keys(ATOMIC_INTRINSICS));

/** Whether a call TOUCHES a writable storage texture — the member of the fragment-or-compute
 *  group that no name distinguishes, because the rule is about the resource. `textureLoad`,
 *  `textureDimensions` and `textureNumLayers` are the ids a sampled texture uses too, so the
 *  argument's type is what decides. `textureStore` is in the set by name and needs no help: a
 *  storage texture is the only thing it takes. */
const touchesWritableStorage = (e: Extract<Expr, { op: 'call' }>): boolean =>
  e.args.some((a) => a.type.kind === 'storage-texture' && a.type.access !== 'read');

/** Whether a function's OWN body uses a stage-restricted op, by the name to report it under. */
function stageRestrictedOpsOf(body: readonly Stmt[]): Set<string> {
  const found = new Set<string>();
  const walkStmt = (s: Stmt): void => {
    if (s.s === 'discard') found.add('discard');
    eachStmtExpr(
      s,
      (e) => {
        eachExpr(e, (x) => {
          // A call through a declaration (`declRef`) reaches the file's own function, which wins
          // over the builtin of its name (Rule 9.5): a declared `dpdx` is no derivative. What
          // its body does is found when the call graph reaches it.
          if (x.op !== 'call' || x.declRef !== undefined) return;
          if (
            FRAGMENT_ONLY_CALLS.has(x.fn) ||
            FRAGMENT_OR_COMPUTE_CALLS.has(x.fn) ||
            touchesWritableStorage(x)
          )
            found.add(x.fn);
        });
      },
      walkStmt,
    );
  };
  for (const s of body) walkStmt(s);
  return found;
}

/** `discard` and the screen-space derivatives are fragment-only, and an entry is as illegal
 *  for using one through a helper as for using one itself: Tint rejects a vertex entry whose
 *  call graph reaches a `discard` ("cannot be used in vertex pipeline stage … called by entry
 *  point 'vs'"), and ANGLE rejects the GLSL. Checking an entry's own body was not enough, so
 *  this closes over the call graph once every body is lowered — which is also the first point
 *  at which the graph is known. A helper is still never rejected on its own: it is legal
 *  until something calls it from the wrong stage. */
function checkFragmentOnlyOps(
  funcs: readonly FuncDecl[],
  nodeByName: ReadonlyMap<string, ts.NamedDeclaration>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const own = new Map<string, Set<string>>();
  const calls = new Map<string, Set<string>>();
  for (const f of funcs) {
    own.set(f.name, stageRestrictedOpsOf(f.body));
    calls.set(f.name, calleeNamesOf(f.body));
  }
  for (const entry of funcs) {
    if (entry.stage !== 'vertex' && entry.stage !== 'compute') continue;
    const node = nodeByName.get(entry.name);
    if (!node?.name) continue;
    // Breadth-first over the call graph, reporting each op once at the nearest function that
    // uses it, so a shared helper does not report the same thing twice for one entry.
    const seen = new Set<string>([entry.name]);
    const queue: string[] = [entry.name];
    const reported = new Set<string>();
    while (queue.length > 0) {
      const name = queue.shift()!;
      for (const op of own.get(name) ?? []) {
        if (reported.has(op)) continue;
        // Everything in `found` that is not fragment-only is a vertex rule: the two sets are
        // disjoint, and a name that reached `found` through the writable-storage test is in
        // neither. `discard` and the fragment-only set take the other arm.
        const vertexOnlyRule = !FRAGMENT_ONLY_CALLS.has(op) && op !== 'discard';
        // A texture write, a writable-storage read and an atomic are legal in a compute entry;
        // only a vertex entry is refused them.
        if (vertexOnlyRule && entry.stage !== 'vertex') continue;
        reported.add(op);
        const where =
          name === entry.name
            ? `"${entry.name}" is a ${entry.stage} entry`
            : `"${name}" is reachable from the ${entry.stage} entry "${entry.name}"`;
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            node.name,
            vertexOnlyRule
              ? `"${op}" is only valid in a fragment or compute shader; ${where}. ` +
                  whyNotVertex(op)
              : `"${writtenName(op)}" is only valid in a fragment shader; ${where}.`,
            TS_CODES.UNSUPPORTED,
          ),
        );
      }
      for (const callee of calls.get(name) ?? []) {
        if (seen.has(callee) || !own.has(callee)) continue;
        seen.add(callee);
        queue.push(callee);
      }
    }
  }
}

/** The entry-stage validation phase, run after inherited bodies and recursion are settled.
 * Preserve the two walks and their order: their diagnostics and call-identity rules differ. */
export function checkEntryStageUses(
  funcs: readonly FuncDecl[],
  vars: readonly ModuleVarDecl[],
  nodes: ReadonlyMap<string, ts.NamedDeclaration>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  checkFragmentOnlyOps(funcs, nodes, sourceFile, diagnostics);
  checkComputeOnlyUses(funcs, vars, nodes, sourceFile, diagnostics);
}
