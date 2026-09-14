// ═══ A breakpoint's path and a span's file name have to land on the same string ═══
//
// Two claims. The first is that `normalizeFileName` reproduces what `ts.createSourceFile` does
// to the name it is handed — checked by running the same spelling through both, so this file
// reports a TypeScript upgrade that changed the rule instead of letting it become a silent
// mismatch between a breakpoint and a span. The second is that a session built that way
// actually stops: a breakpoint set in the editor's spelling fires on a module compiled under
// the same path, whatever separators either side used.

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { normalizeFileName, sameFileName } from './file-name.js'
import { startDebugSession } from './session.js'
import { compile } from '../../compiler/ts/compile.js'

/** Every spelling a host could plausibly hand either side, and the awkward ones besides. */
const SPELLINGS = [
  'a.ts',
  './a.ts',
  '../a.ts',
  '../../a.ts',
  'shaders/blur.shade.ts',
  './shaders/./blur.shade.ts',
  'shaders/../blur.shade.ts',
  'a//b.ts',
  '/home/u/a.ts',
  '/home/u/../v/a.ts',
  'C:\\shaders\\a.ts',
  'C:/shaders/a.ts',
  '\\\\server\\share\\a.ts',
  'file:///home/u/a.ts',
  'file:///home/./u/a.ts',
  'https://x.dev/a/b.ts',
  'untitled:Untitled-1',
  'typeshade-input.ts',
  '/a/',
  '/',
  '.',
  '..',
]

describe('normalizeFileName agrees with TypeScript', () => {
  it.each(SPELLINGS)('%s', (name) => {
    // `ts.createSourceFile` is the exact thing that produces a span's `file`, so this is the
    // real other side of the comparison, not a model of it.
    const tsName = ts.createSourceFile(
      name,
      '',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ).fileName
    expect(normalizeFileName(name)).toBe(tsName)
  })

  it('is idempotent, so normalizing an already-normalized span name is safe', () => {
    for (const name of SPELLINGS) {
      expect(normalizeFileName(normalizeFileName(name))).toBe(normalizeFileName(name))
    }
  })

  it('does not merge two files that merely look alike', () => {
    // The claim is "same file spelled differently", not "same basename". A relative path and
    // an absolute one are two files, and so are two files of the same name in two directories.
    expect(sameFileName('a.ts', '/a.ts')).toBe(false)
    expect(sameFileName('src/a.ts', 'test/a.ts')).toBe(false)
    expect(sameFileName('a.ts', 'src/a.ts')).toBe(false)
    expect(sameFileName('../a.ts', 'a.ts')).toBe(false)
    expect(sameFileName('A.ts', 'a.ts')).toBe(false)
  })

  it('merges the spellings one host uses for one file', () => {
    expect(sameFileName('C:\\shaders\\a.ts', 'C:/shaders/a.ts')).toBe(true)
    expect(sameFileName('./shaders/a.ts', 'shaders/a.ts')).toBe(true)
    expect(sameFileName('shaders/./a.ts', 'shaders/a.ts')).toBe(true)
    expect(sameFileName('shaders/sub/../a.ts', 'shaders/a.ts')).toBe(true)
  })
})

const SRC = `"use typeshade"

export function fs(): f32 {
  const a = 1.
  const b = a + 1.
  return b
}
`

describe('a breakpoint set in the editor’s spelling fires', () => {
  const stops = (compiledAs: string, breakpointFile: string): number[] => {
    const { module, diagnostics } = compile(SRC, { fileName: compiledAs })
    expect(diagnostics).toEqual([])
    const s = startDebugSession(module, 'fs', [], {
      stopOnEntry: false,
      breakpoints: [{ file: breakpointFile, line: 4 }],
    })
    const lines: number[] = []
    while (s.pause) {
      lines.push(s.pause.span!.line)
      s.continue()
    }
    return lines
  }

  it('when both sides spell the path the same way', () => {
    expect(stops('shaders/blur.shade.ts', 'shaders/blur.shade.ts')).toEqual([4])
  })

  it('when the editor uses backslashes and the compiler stored slashes', () => {
    // The case that motivated `normalizeFileName`. Before it, this armed nothing: the span
    // said `C:/shaders/blur.shade.ts` and the breakpoint said `C:\shaders\blur.shade.ts`, and
    // a breakpoint that matches nothing is indistinguishable from one on a blank line.
    expect(stops('C:\\shaders\\blur.shade.ts', 'C:\\shaders\\blur.shade.ts')).toEqual([4])
    expect(stops('C:\\shaders\\blur.shade.ts', 'C:/shaders/blur.shade.ts')).toEqual([4])
  })

  it('when one side is written relative to the current directory', () => {
    expect(stops('./shaders/blur.shade.ts', 'shaders/blur.shade.ts')).toEqual([4])
    expect(stops('shaders/blur.shade.ts', './shaders/blur.shade.ts')).toEqual([4])
  })

  it('and does not fire for a different file of the same name', () => {
    expect(stops('src/blur.shade.ts', 'test/blur.shade.ts')).toEqual([])
  })

  it('and a file-less breakpoint still matches on the line alone', () => {
    const { module } = compile(SRC, { fileName: 'shaders/blur.shade.ts' })
    const s = startDebugSession(module, 'fs', [], {
      stopOnEntry: false,
      breakpoints: [{ line: 4 }],
    })
    expect(s.pause?.span?.line).toBe(4)
  })
})
