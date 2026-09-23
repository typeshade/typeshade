// ═══ Stepping a program written across two files (docs/debugging.md §2.1) ═══
//
// A `"use typeshade"` program can import a helper from another file, and once it does, every
// part of a stepped run that names a location has to name the RIGHT file: the statement the
// run is stopped on, the frame the call came from, and the breakpoint the author set. Nothing
// covered that. The machinery turned out to be right already: `compileTsSources` parses each
// input under its own name, so each statement's span carries the file it was written in, and
// `stepIn` follows a `declRef` without caring which file it lands in, so this file is a lock
// on behaviour rather than a fix. It is worth locking because the failure it prevents is
// invisible: a breakpoint in the wrong file arms nothing, and a frame naming the wrong file
// sends an editor to the wrong line of the wrong document.

import { describe, expect, it } from 'vitest';
import { compileTsSources } from '../../compiler/ts/module.js';
import type { ModuleDecl } from '../ir/nodes.js';
import { startDebugSession, type DebugBreakpoint } from './session.js';

// Laid out so that line 3 carries a statement in BOTH files: that is what makes a
// file-qualified breakpoint a different question from a line-only one.
const UTIL = `"use typeshade";
export function half(x: f32): f32 {
  const h = x * 0.5;
  return h;
}
`;
const MAIN = `"use typeshade";
import { half } from "../lib/util";
export function fs(): f32 {
  const a = 2.;
  const b = half(a);
  return b;
}
`;

function program(): ModuleDecl {
  const r = compileTsSources([
    { fileName: 'lib/util.ts', source: UTIL },
    { fileName: 'app/main.ts', source: MAIN },
  ]);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return { consts: [], structs: [], bindings: [], funcs: [...r.funcs] };
}

/** Every stop of a full single-step run, as `file:line`. */
function walk(breakpoints?: readonly DebugBreakpoint[]): string[] {
  const s = startDebugSession(program(), 'fs', [], { breakpoints });
  const out: string[] = [];
  let guard = 0;
  while (s.pause) {
    if (guard++ > 50) throw new Error('did not finish');
    const sp = s.pause.span;
    out.push(sp ? `${sp.file}:${sp.line}` : '<none>');
    s.stepIn();
  }
  return out;
}

describe('stepping across files', () => {
  it('walks into the imported file and back out, naming each file as it goes', () => {
    expect(walk()).toEqual([
      'app/main.ts:3',
      'app/main.ts:4',
      'lib/util.ts:2',
      'lib/util.ts:3',
      'app/main.ts:5',
    ]);
  });

  it('reports the callee’s frame in one file and the caller’s in the other', () => {
    const s = startDebugSession(program(), 'fs', [], {});
    s.stepIn(); // onto the call
    s.stepIn(); // into half()
    const [inner, outer] = s.pause!.frames;
    expect(s.pause!.frames).toHaveLength(2);

    expect(inner!.fnName).toBe('half');
    expect(inner!.span!.file).toBe('lib/util.ts');
    expect(inner!.fnSpan!.file).toBe('lib/util.ts');
    // The call that made this frame was written in the OTHER file. A frame that reported its
    // own file here would send an editor to the wrong document for "go to caller".
    expect(inner!.callSpan!.file).toBe('app/main.ts');
    expect(inner!.callSpan!.line).toBe(4);

    expect(outer!.fnName).toBe('fs');
    expect(outer!.span!.file).toBe('app/main.ts');
    expect(outer!.fnSpan!.file).toBe('app/main.ts');
    expect(outer!.callSpan).toBeUndefined();
  });

  it('shows the callee’s own locals, under the callee’s own types', () => {
    const s = startDebugSession(program(), 'fs', [], {});
    s.stepIn();
    s.stepIn(); // first statement of half()
    s.stepIn(); // after `const h = x * 0.5`
    const frame = s.pause!.frames[0]!;
    expect(frame.fnName).toBe('half');
    expect(frame.locals.get('x')).toBe(2);
    expect(frame.locals.get('h')).toBe(1);
    expect([...frame.localTypes.keys()].sort()).toEqual(['h', 'x']);
    // …and the caller's `a` is not visible from inside the callee.
    expect(frame.locals.has('a')).toBe(false);
  });

  it('a file-qualified breakpoint fires only in the file it names', () => {
    // Line 3 carries a statement in each file. Naming one file has to pick one of them.
    const stops = (bp: DebugBreakpoint): string[] => {
      const s = startDebugSession(program(), 'fs', [], { stopOnEntry: false, breakpoints: [bp] });
      const out: string[] = [];
      while (s.pause) {
        const sp = s.pause.span!;
        out.push(`${sp.file}:${sp.line}`);
        s.continue();
      }
      return out;
    };
    expect(stops({ file: 'app/main.ts', line: 3 })).toEqual(['app/main.ts:3']);
    expect(stops({ file: 'lib/util.ts', line: 3 })).toEqual(['lib/util.ts:3']);
    // Unqualified, the same line number is two stops, which is why `file` exists.
    expect(stops({ line: 3 })).toEqual(['app/main.ts:3', 'lib/util.ts:3']);
    // A file that is in the program but has no statement on that line arms nothing.
    expect(stops({ file: 'lib/util.ts', line: 5 })).toEqual([]);
  });

  it('stepOver stays in the calling file, and stepOut leaves the called one', () => {
    const over = startDebugSession(program(), 'fs', [], {});
    const seen: string[] = [];
    while (over.pause) {
      seen.push(`${over.pause.span!.file}:${over.pause.span!.line}`);
      over.stepOver();
    }
    expect(seen).toEqual(['app/main.ts:3', 'app/main.ts:4', 'app/main.ts:5']);

    const out = startDebugSession(program(), 'fs', [], {});
    out.stepIn();
    out.stepIn();
    expect(out.pause!.span.file).toBe('lib/util.ts');
    out.stepOut();
    // Back in the CALLING file on the CALLING statement, per docs/debugging.md §2.1: a step-out
    // returns to the statement that made the call with the callee's frame gone, not to the
    // caller's next statement. Crossing a file boundary does not change that.
    expect(out.pause!.span.file).toBe('app/main.ts');
    expect(out.pause!.span.line).toBe(4);
    expect(out.pause!.frames.map((f) => f.fnName)).toEqual(['fs']);
  });

  it('runs to the same answer the whole-program oracle gives', () => {
    // A stepped run is the oracle taken one statement at a time, not a second evaluator, and
    // a cross-file call must not be where the two diverge.
    const s = startDebugSession(program(), 'fs', [], { stopOnEntry: false });
    expect(s.done).toBe(true);
    expect(s.result).toBe(1);
  });
});
