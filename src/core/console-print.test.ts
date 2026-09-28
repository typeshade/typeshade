// The printed console line (change 0025, surface §66): the prefix each tier prints before an
// event's arguments, as the format string the host's console reads.
//
// Verifies: Rule 8.24.

import { describe, expect, it, vi } from 'vitest';
import type { ConsoleEvent } from './console.js';
import { consoleCalls, droppedCall, printConsole } from './console-print.js';
import type { SourceSpan } from './ir/span.js';

const GPU_STYLE = 'background:#6d28d9;color:#fff;border-radius:3px;padding:0 4px';
const CPU_STYLE = 'background:#0f766e;color:#fff;border-radius:3px;padding:0 4px';
const WHERE = 'color:#888';

const span = (file: string, line: number): SourceSpan => ({
  file,
  start: 0,
  length: 1,
  line,
  character: 0,
  endLine: line,
  endCharacter: 1,
});

describe('the printed console line', () => {
  it('prefixes the tier, the file and line, and the invocation, and keeps the method', () => {
    const e: ConsoleEvent = {
      method: 'warn',
      args: ['x', 4.5],
      span: span('/app/src/particles.shade.ts', 13),
      invocation: [3, 0, 0],
    };
    expect(consoleCalls(e, 'GPU')).toEqual([
      {
        method: 'warn',
        args: ['%c GPU %c particles.shade.ts:14  [3, 0, 0] ', GPU_STYLE, WHERE, 'x', 4.5],
      },
    ]);
    expect(consoleCalls(e, 'CPU')[0]!.args.slice(0, 2)).toEqual([
      '%c CPU %c particles.shade.ts:14  [3, 0, 0] ',
      CPU_STYLE,
    ]);
  });

  it('leaves out what an event does not have', () => {
    expect(consoleCalls({ method: 'log', args: ['height', 0.25] }, 'CPU')).toEqual([
      { method: 'log', args: ['%c CPU %c ', CPU_STYLE, WHERE, 'height', 0.25] },
    ]);
    const e: ConsoleEvent = { method: 'info', args: [1], span: span('C:\\w\\terrain.shade.ts', 5) };
    expect(consoleCalls(e, 'CPU')[0]!.args[0]).toBe('%c CPU %c terrain.shade.ts:6 ');
  });

  it('prints a label that holds a directive as written, and escapes one in a file name', () => {
    const e: ConsoleEvent = { method: 'log', args: ['%d of %s', 2], span: span('a%d.shade.ts', 0) };
    const [c] = consoleCalls(e, 'GPU');
    // The label is an argument after the format string, which no console reads as a directive.
    expect(c!.args[0]).toBe('%c GPU %c a%%d.shade.ts:1 ');
    expect(c!.args[3]).toBe('%d of %s');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      printConsole(e, 'GPU');
      expect(log).toHaveBeenCalledWith(...c!.args);
    } finally {
      log.mockRestore();
    }
  });

  it('prints a table after a log line that carries the prefix', () => {
    const rows = [
      [1, 2],
      [3, 4],
    ] as unknown as ConsoleEvent['args'][number];
    const e: ConsoleEvent = { method: 'table', args: [rows], invocation: [0, 1, 0] };
    expect(consoleCalls(e, 'GPU')).toEqual([
      { method: 'log', args: ['%c GPU %c [0, 1, 0] ', GPU_STYLE, WHERE] },
      { method: 'table', args: [rows] },
    ]);
  });

  it('names the entry in the warning for calls that did not fit', () => {
    expect(droppedCall('step', 758)).toEqual({
      method: 'warn',
      args: [
        '%c GPU %c step(): 758 console calls did not fit the console buffer.',
        GPU_STYLE,
        WHERE,
      ],
    });
  });
});
