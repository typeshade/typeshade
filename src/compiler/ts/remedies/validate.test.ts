import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { TS_CODES } from '../codes.js';
import type { BatchItem, SourceChange } from './contracts.js';
import { checkedEditCompiles, checkModuleEdits, compilingCheckedEdit } from './validate.js';

const source = (name: string, text: string) =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);

function item(change: SourceChange): BatchItem {
  return {
    diagnostic: () => undefined,
    sets: [change, change],
    conflict: false,
    name: vi.fn(),
    generic: vi.fn(),
  };
}

describe('checked edit validation boundaries', () => {
  it('checks authored text without editor annotations and restores the compilation guard', () => {
    const sf = source('projected-remedy.shade.ts', 'let x: i32 = bad;');
    const start = sf.text.indexOf('bad');
    const candidate = item({ start, end: start + 3, text: 'i32(3)' });
    const check = vi.fn((text: string, starts: readonly number[] | undefined) => {
      expect(text).toBe('let x = i32(3);');
      expect(starts).toBeUndefined();
      expect(compilingCheckedEdit()).toBe(true);
      return [];
    });
    checkModuleEdits(sf, [], [candidate], [], [{ at: 5, length: 5 }], check);
    expect(check).toHaveBeenCalledTimes(1);
    expect(candidate.name).toHaveBeenCalledWith(0);
    expect(candidate.generic).not.toHaveBeenCalled();
    expect(compilingCheckedEdit()).toBe(false);
  });

  it('restores the guard after a thrown compile and retries the same edit', () => {
    const sf = source('throwing-remedy.shade.ts', 'bad;');
    const candidate = item({ start: 0, end: 3, text: 'i32(7)' });
    const failure = new Error('compiler callback failed');
    const before = checkedEditCompiles();
    expect(() =>
      checkModuleEdits(sf, [], [candidate], [], [], () => {
        expect(compilingCheckedEdit()).toBe(true);
        throw failure;
      }),
    ).toThrow(failure);
    expect(compilingCheckedEdit()).toBe(false);
    expect(candidate.name).not.toHaveBeenCalled();
    checkModuleEdits(sf, [], [candidate], [], [], () => []);
    expect(candidate.name).toHaveBeenCalledWith(0);
    expect(checkedEditCompiles() - before).toBe(2);
    expect(compilingCheckedEdit()).toBe(false);
  });

  it.each(['same place', 'different place'] as const)(
    'does not hide an added error with the same text at the %s',
    (place) => {
      const sf = source(`duplicate-${place}.shade.ts`, 'bad; keep; other;');
      const candidate = item({ start: 0, end: 3, text: 'i32(3)' });
      const diagnostic: TsCompilerDiagnostic = {
        code: TS_CODES.TYPE_MISMATCH,
        message: 'existing error',
        category: 'error',
        fileName: sf.fileName,
        line: 1,
        character: sf.text.indexOf('keep') + 1,
        endLine: 1,
        endCharacter: sf.text.indexOf('keep') + 5,
        start: sf.text.indexOf('keep'),
        length: 4,
      };
      checkModuleEdits(sf, [diagnostic], [candidate], [], [], (text) => [
        { code: diagnostic.code, message: diagnostic.message, start: text.indexOf('keep') },
        {
          code: diagnostic.code,
          message: diagnostic.message,
          start: text.indexOf(place === 'same place' ? 'keep' : 'other'),
        },
      ]);
      expect(candidate.name).not.toHaveBeenCalled();
      expect(candidate.generic).toHaveBeenCalledTimes(1);
    },
  );

  it('maps an existing error back through projection removal and replacement growth', () => {
    const sf = source('mapped-remedy.shade.ts', 'let x: i32 = bad; keep;');
    const start = sf.text.indexOf('bad');
    const candidate = item({ start, end: start + 3, text: 'i32(300)' });
    const diagnostic: TsCompilerDiagnostic = {
      code: TS_CODES.TYPE_MISMATCH,
      message: 'unrelated error',
      category: 'error',
      fileName: sf.fileName,
      line: 1,
      character: sf.text.indexOf('keep') + 1,
      endLine: 1,
      endCharacter: sf.text.indexOf('keep') + 5,
      start: sf.text.indexOf('keep'),
      length: 4,
    };
    checkModuleEdits(sf, [diagnostic], [candidate], [], [{ at: 5, length: 5 }], (text) => [
      { code: diagnostic.code, message: diagnostic.message, start: text.indexOf('keep') },
    ]);
    expect(candidate.name).toHaveBeenCalledWith(0);
    expect(candidate.generic).not.toHaveBeenCalled();
  });
});
