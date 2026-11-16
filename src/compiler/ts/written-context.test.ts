import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { f32T, u32T, structT } from '../../core/ir/types.js';
import {
  authorTypeText,
  classOfStruct,
  programFileOf,
  sameFile,
  useWrittenStructs,
  withLinkedOrigin,
  withWrittenStructs,
  writtenName,
  writtenRange,
  writtenText,
  type LinkedOrigin,
} from './written-context.js';

function parsed(text: string): ts.SourceFile {
  return ts.createSourceFile('scope.shade.ts', text, ts.ScriptTarget.Latest, true);
}

function classNode(namespace: string): ts.ClassDeclaration {
  const sf = parsed(`namespace ${namespace} { export class Box<T> {} }`);
  let found: ts.ClassDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === undefined) throw new Error('test source has no class');
  return found;
}

function linked(): { origin: LinkedOrigin; a: ts.Identifier; b: ts.Identifier } {
  const sf = parsed('const a = 1; const b = 2;');
  const names = sf.statements.map((statement) => {
    if (!ts.isVariableStatement(statement)) throw new Error('expected a variable');
    const name = statement.declarationList.declarations[0]!.name;
    if (!ts.isIdentifier(name)) throw new Error('expected an identifier');
    return name;
  });
  const [a, b] = names as [ts.Identifier, ts.Identifier];
  return {
    a,
    b,
    origin: {
      sourceFile: sf,
      files: ['entry.shade.ts', 'library.shade.ts'],
      written: (start, end) => ({
        file: start >= b.getStart() ? 'library.shade.ts' : 'entry.shade.ts',
        text: sf.text.slice(start, end).replace(/\bb\b/g, 'libraryValue'),
      }),
    },
  };
}

describe('source spelling scope lifetimes', () => {
  it('restores outer struct spelling after a nested compile throws, then clears it', () => {
    const outer = classNode('Outer');
    const inner = classNode('Inner');
    const type = structT('Box_instance');
    const failure = new Error('nested compile failed');
    withWrittenStructs(() => {
      useWrittenStructs([
        { decl: { name: type.name }, classNode: outer, binding: new Map([['T', f32T]]) },
      ]);
      expect(authorTypeText(type)).toBe('Outer.Box<f32>');
      expect(() =>
        withWrittenStructs(() => {
          expect(authorTypeText(type)).toBe('Box_instance');
          useWrittenStructs([
            { decl: { name: type.name }, classNode: inner, binding: new Map([['T', u32T]]) },
          ]);
          expect(authorTypeText(type)).toBe('Inner.Box<u32>');
          throw failure;
        }),
      ).toThrow(failure);
      expect(authorTypeText(type)).toBe('Outer.Box<f32>');
      expect(classOfStruct(type.name)).toEqual({
        written: 'Outer.Box',
        base: 'Outer_Box',
        inNamespace: true,
      });
    });
    expect(authorTypeText(type)).toBe('Box_instance');
    expect(classOfStruct(type.name).inNamespace).toBe(false);
  });

  it('restores linked text and file ownership after a nested origin throws', () => {
    const { origin, a, b } = linked();
    const other = linked();
    const failure = new Error('linked compile failed');
    withLinkedOrigin(origin, () => {
      expect(writtenName(b)).toBe('libraryValue');
      expect(writtenText(b)).toBe('libraryValue');
      expect(writtenRange(origin.sourceFile, b.getStart(), b.getEnd())).toBe('libraryValue');
      expect(sameFile(a, b)).toBe(false);
      expect(programFileOf(b)).toBe(1);
      expect(() =>
        withLinkedOrigin(other.origin, () => {
          // Equal paths and text do not make two source-file objects the same compilation.
          expect(writtenName(b)).toBe('b');
          expect(programFileOf(b)).toBe(0);
          expect(writtenName(other.b)).toBe('libraryValue');
          expect(sameFile(b, other.b)).toBe(false);
          throw failure;
        }),
      ).toThrow(failure);
      expect(writtenName(b)).toBe('libraryValue');
      expect(programFileOf(b)).toBe(1);
    });
    expect(writtenName(b)).toBe('b');
    expect(writtenText(b)).toBe('b');
    expect(programFileOf(b)).toBe(0);
    expect(sameFile(a, b)).toBe(true);
  });

  it('keeps the linked origin active across an independently scoped struct compile', () => {
    const { origin, b } = linked();
    const declaration = classNode('Scoped');
    const type = structT('Scoped_instance');
    withLinkedOrigin(origin, () => {
      withWrittenStructs(() => {
        useWrittenStructs([
          { decl: { name: type.name }, classNode: declaration, binding: new Map([['T', f32T]]) },
        ]);
        expect(authorTypeText(type)).toBe('Scoped.Box<f32>');
        expect(writtenName(b)).toBe('libraryValue');
      });
      expect(authorTypeText(type)).toBe('Scoped_instance');
      expect(writtenName(b)).toBe('libraryValue');
    });
  });
});
