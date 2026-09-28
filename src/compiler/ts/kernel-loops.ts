// Implements: Rule 8.22, its TS8070 wording (docs/language-design.md; traced in reqs/).
// === A kernel function's loop that runs on the CPU, in the author's words ===
//
// The independence proof (`src/core/passes/parallel-loop.ts`) decides on the IR, where names
// are the lowering's: a second `i` is `i_1`, a method's object `self_`, a `for…of`'s counter
// `_i`. The refusal must name the author's line and the author's names (Rule 12.1), so it is
// worded here, with the names each kernel function's scope recorded as it was lowered and the
// source text its spans index. One warning per loop, for the first reason (Rule 12.4), or one on
// the function when its body is not the kernel call's shape.

import type ts from 'typescript';
import type { Expr, FuncDecl, ModuleDecl } from '../../core/ir/nodes.js';
import type { SourceSpan } from '../../core/ir/span.js';
import { sourceSpanOf } from '../../core/ir/span.js';
import {
  proveKernels,
  type LoopRefusal,
  type ShapeRefusal,
} from '../../core/passes/parallel-loop.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { TS_CODES } from './codes.js';
import { diagnosticAtSpan } from './diagnostic.js';

/** What each IR name of a kernel function was written as, recorded when its body is lowered. */
export const kernelSourceNames = new WeakMap<FuncDecl, ReadonlyMap<string, string>>();

/** The `TS8070` warnings for the kernel functions of `m`; `sourceFileOf` is the file each was
 *  declared in, whose text its spans index. */
export function kernelLoopDiagnostics(
  m: ModuleDecl,
  sourceFileOf: (f: FuncDecl) => ts.SourceFile,
): TsCompilerDiagnostic[] {
  const out: TsCompilerDiagnostic[] = [];
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  for (const proof of proveKernels(m)) {
    const f = byName.get(proof.fn)!;
    const names = kernelSourceNames.get(f) ?? new Map<string, string>();
    const sourceFile = sourceFileOf(f);
    const w = new Wording(sourceFile, names);
    if (proof.shape !== undefined) {
      out.push(warn(sourceFile, proof.shape.at ?? sourceSpanOf(f), w.shape(proof.shape)));
      continue;
    }
    for (const v of proof.loops) {
      if (v.ok) continue;
      const counter = v.loop.counted?.name;
      out.push(warn(sourceFile, sourceSpanOf(v.loop), w.loop(v.refusal, counter)));
    }
  }
  return out;
}

const warn = (sf: ts.SourceFile, span: SourceSpan | undefined, message: string) =>
  diagnosticAtSpan(sf, span, undefined, message, TS_CODES.KERNEL_LOOP_ON_CPU, 'warning');

/** The reductions a loop may combine with, as the remedy lists them. */
const COMBINE = '+= *= min max & | ^';

class Wording {
  constructor(
    private readonly sf: ts.SourceFile,
    private readonly names: ReadonlyMap<string, string>,
  ) {}

  /** `line 9`, one-based, as an editor numbers it. */
  private line(at: SourceSpan | undefined): string {
    return at === undefined ? 'a line' : `line ${at.line + 1}`;
  }

  private name(ir: string): string {
    return this.names.get(ir) ?? ir;
  }

  /** The source text a span covers, on one line. */
  private text(at: SourceSpan | undefined): string | undefined {
    if (at === undefined) return undefined;
    return this.sf.text
      .slice(at.start, at.start + at.length)
      .replace(/\s+/g, ' ')
      .trim();
  }

  loop(r: LoopRefusal, counter: string | undefined): string {
    const why = 'This loop runs on the CPU because';
    switch (r.rule) {
      case 'R1':
        return r.why === 'while'
          ? `${why} it is a while loop, whose trip count is known only when it ends. A for loop over a count runs on the GPU.`
          : `${why} "${this.text(r.at) ?? 'its step'}" does not step through a range of indices. Step by adding a constant.`;
      case 'R2':
        return r.why === 'return'
          ? `${why} ${this.line(r.at)} returns from inside it, so whether an iteration runs depends on the ones before it. Record the result in an array and read it after the loop.`
          : `${why} ${this.line(r.at)} breaks out of it, so whether an iteration runs depends on the ones before it. Record the result in an array and read it after the loop.`;
      case 'R3':
        if (r.why === 'carried')
          return `${why} ${this.line(r.at)} writes "${this.name(r.name)}", which the next iteration reads. Declare it inside the loop, or combine it with one of ${COMBINE}.`;
        return `${why} ${this.line(r.at)} writes "${this.expr(r.target)}", an element two iterations can share. ${this.indexRemedy(counter)}`;
      case 'R4':
        if (r.why === 'reads-written')
          return `${why} ${this.line(r.at)} reads "${this.expr(r.read)}", which another iteration writes. Read from an array the loop does not write.`;
        return `${why} ${this.line(r.at)} uses the value ${r.fn} returns, which depends on the order the iterations run in. Call it as a statement of its own, and read the array after the loop.`;
      case 'R5':
        return `${why} ${this.line(r.at)} calls "${this.name(r.callee)}", which writes "${r.writes}". Return the value from "${this.name(r.callee)}" and combine it in the loop instead.`;
      case 'R6':
        if (r.why === 'console')
          return `${why} ${this.line(r.at)} calls ${r.name}, whose lines would print in another order on the GPU. Log after the loop.`;
        if (r.why === 'barrier')
          return `${why} ${this.line(r.at)} calls ${r.name}(), and an iteration of a loop is not a workgroup. Write a @compute entry to use a barrier.`;
        return `${why} ${this.line(r.at)} reads "${this.name(r.name)}", which is workgroup memory, and an iteration of a loop is not a workgroup. Write a @compute entry to use it.`;
    }
  }

  shape(r: ShapeRefusal): string {
    if (r.why === 'split')
      return `This loop runs on the CPU because ${this.line(r.at)} reads "${this.name(r.name)}", which the loop on ${this.line(r.reducedAt)} combines. Split the function: return "${this.name(r.name)}" from one kernel function and pass it to the next.`;
    const what =
      r.what !== undefined
        ? `writes "${this.name(r.what)}" outside its loops`
        : `is neither a loop nor a statement that computes a value`;
    return `This function runs on the CPU because ${this.line(r.at)} ${what}. A kernel function's body is scalar statements, then its loops, then a return: move that line into a loop, or into the code that calls the function.`;
  }

  /** The remedy for a shared element: an index made from the loop's counter. */
  private indexRemedy(counter: string | undefined): string {
    const shown = counter === undefined ? undefined : this.name(counter);
    // A `for…of`'s counter has no name the author wrote.
    return shown === undefined || shown.startsWith('_')
      ? 'Write at an index made from the loop counter of a counted for.'
      : `Write at an index made from "${shown}".`;
  }

  /** An expression as the author would write it: its own text when it carries a span, and
   *  otherwise printed with the author's names. */
  expr(e: Expr): string {
    const own = this.text(sourceSpanOf(e));
    return own ?? this.print(e, 0);
  }

  private print(e: Expr, outer: number): string {
    switch (e.op) {
      case 'lit':
        return typeof e.value === 'number' ? String(e.value) : String(e.value);
      case 'varref':
      case 'param':
        return this.name(e.name);
      case 'constref':
      case 'overrideref':
      case 'externref':
        return e.name;
      case 'index':
        return `${this.print(e.base, 9)}[${this.print(e.idx, 0)}]`;
      case 'member':
        return `${this.print(e.base, 9)}.${e.field}`;
      case 'unop':
        return `-${this.print(e.a, 8)}`;
      case 'binop': {
        const p = PRECEDENCE[e.bop] ?? 1;
        const text = `${this.print(e.a, p)} ${e.bop} ${this.print(e.b, p + 1)}`;
        return p < outer ? `(${text})` : text;
      }
      case 'call':
        return `${e.fn}(${e.args.map((a) => this.print(a, 0)).join(', ')})`;
      case 'construct':
        return `${e.type.kind === 'scalar' ? e.type.scalar : 'vec'}(${e.args.map((a) => this.print(a, 0)).join(', ')})`;
      default:
        return '…';
    }
  }
}

const PRECEDENCE: Readonly<Record<string, number>> = {
  '*': 6,
  '/': 6,
  '%': 6,
  '+': 5,
  '-': 5,
  '<<': 4,
  '>>': 4,
  '&': 3,
  '^': 2,
  '|': 1,
};
