// Compute-only operations inherit the stage of every entry that reaches them (Rule 8.3).
import ts from 'typescript';
import type { Expr, FuncDecl, ModuleVarDecl, Stmt } from '../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../core/ir/visit.js';
import { collectLocals } from '../../core/passes/opt/expr-utils.js';
import { isBarrierIntrinsic } from '../../core/intrinsics.js';
import { diagnosticAtSpan } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { sameFile, writtenText } from './context.js';

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
