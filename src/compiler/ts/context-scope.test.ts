import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CAS_RESULT_STRUCTS, f32T } from '../../core/ir/types.js';
import type { FuncDecl, StructDecl } from '../../core/ir/nodes.js';
import { optionalT } from './optional/registry.js';
import { fileFunctionsOf, LoweringScope, refusedDeclarationsOf } from './context.js';
import type { PrivateField } from './structs.js';

const struct = (name: string, ...fields: string[]): StructDecl => ({
  name,
  fields: fields.map((field) => ({ name: field, type: f32T })),
});

const funcNamed = (name: string): FuncDecl => ({ name }) as FuncDecl;

const hiddenField = (): PrivateField => ({
  written: '#x',
  owner: ts.factory.createClassDeclaration(undefined, 'P', undefined, undefined, []),
});

describe('which struct a literal of some field names may be', () => {
  const scopeWith = (hidden: boolean): LoweringScope => {
    const scope = new LoweringScope();
    scope.setStructs([struct('Open', 'x'), struct('Hidden', 'x'), struct('Other', 'y')]);
    if (hidden) scope.setPrivateFields(new Map([['Hidden', new Map([['x', hiddenField()]])]]));
    return scope;
  };

  it('is the one struct of those names when no field is private', () => {
    expect(scopeWith(false).matchStruct(['y'])?.name).toBe('Other');
    expect(scopeWith(false).matchStruct(['x'])).toBeUndefined();
  });

  it('is never a struct with a private field', () => {
    expect(scopeWith(true).hasHiddenFields('Hidden')).toBe(true);
    expect(scopeWith(true).matchStruct(['x'])?.name).toBe('Open');
  });

  it('lists every struct of those names for an entry result, but none with a private field', () => {
    expect(
      scopeWith(false)
        .entryResultMatches(['x'])
        .map((s) => s.name),
    ).toEqual(['Open', 'Hidden']);
    expect(
      scopeWith(true)
        .entryResultMatches(['x'])
        .map((s) => s.name),
    ).toEqual(['Open']);
  });

  it('lists no resource struct for an entry result', () => {
    const scope = scopeWith(false);
    scope.setResourceStructs(new Set(['Open']));
    expect(scope.entryResultMatches(['x']).map((s) => s.name)).toEqual(['Hidden']);
  });

  it('lists no compiler-made struct for an entry result, though member access reads it', () => {
    const scope = new LoweringScope();
    scope.setStructs([]);
    const [first] = CAS_RESULT_STRUCTS;
    expect(first).toBeDefined();
    expect(scope.structByName(first!.name)?.fields.map((f) => f.name)).toEqual([
      'old_value',
      'exchanged',
    ]);
    expect(scope.entryResultMatches(['old_value', 'exchanged'])).toEqual([]);
  });
});

describe('the loop and switch a break or a continue may leave', () => {
  it('tracks a loop by depth and never counts below zero', () => {
    const scope = new LoweringScope();
    expect(scope.inLoop()).toBe(false);
    scope.enterLoop();
    scope.enterLoop();
    scope.exitLoop();
    expect(scope.inLoop()).toBe(true);
    scope.exitLoop();
    scope.exitLoop();
    expect(scope.inLoop()).toBe(false);
    scope.enterLoop();
    expect(scope.inLoop()).toBe(true);
  });

  it('tracks a switch apart from a loop', () => {
    const scope = new LoweringScope();
    scope.enterSwitch();
    expect(scope.inSwitch()).toBe(true);
    expect(scope.inLoop()).toBe(false);
    scope.exitSwitch();
    expect(scope.inSwitch()).toBe(false);
  });
});

describe('a call to a function whose declaration was refused', () => {
  const scopeAfter = (refused: readonly string[]): LoweringScope => {
    const callees = new Map<string, FuncDecl>();
    const names = refusedDeclarationsOf(callees);
    for (const name of refused) names.add(name);
    return new LoweringScope(callees);
  };

  it('is known by the written name', () => {
    expect(scopeAfter(['f']).declarationRefused('f')).toBe(true);
    expect(scopeAfter([]).declarationRefused('f')).toBe(false);
  });

  it('is known by the emitted name of a local function', () => {
    const scope = scopeAfter(['fs_f']);
    scope.setLocalFunctions(new Map([['f', 'fs_f']]));
    expect(scope.declarationRefused('f')).toBe(true);
  });

  it('is known through the owner for a local function refused before it was registered', () => {
    const scope = scopeAfter(['fs_scale']);
    scope.setOwner(funcNamed('fs'));
    expect(scope.declarationRefused('scale')).toBe(true);
    scope.setOwner(funcNamed('gs'));
    expect(scope.declarationRefused('scale')).toBe(false);
  });

  it('is known by a namespace-qualified name inside the namespace only', () => {
    const scope = scopeAfter(['N_f']);
    expect(scope.declarationRefused('f')).toBe(false);
    scope.setNamespacePrefix('N');
    expect(scope.declarationRefused('f')).toBe(true);
  });
});

describe('a generic function of the file and a local function of the body', () => {
  it('is generic under the emitted name of a local function, and a file one only by its own', () => {
    const callees = new Map<string, FuncDecl>();
    fileFunctionsOf(callees).generics.add('fs_id');
    const scope = new LoweringScope(callees);
    expect(scope.isGenericFunction('id')).toBe(false);
    scope.setLocalFunctions(new Map([['id', 'fs_id']]));
    expect(scope.isGenericFunction('id')).toBe(true);
    expect(scope.isFileGenericFunction('id')).toBe(false);
    fileFunctionsOf(callees).generics.add('id');
    expect(scope.isFileGenericFunction('id')).toBe(true);
  });
});

describe('the IR name a local takes when the module emits a function of its name', () => {
  const localNamed = (name: string) => ({
    kind: 'local' as const,
    name,
    type: f32T,
    mutable: true,
  });

  it('is fresh where the caller asks to reserve module names', () => {
    const scope = new LoweringScope(new Map([['lum', funcNamed('lum')]]));
    expect(scope.define(localNamed('lum'), true).irName).toBe('lum_1');
  });

  it('is the source name where the caller does not ask', () => {
    const scope = new LoweringScope(new Map([['lum', funcNamed('lum')]]));
    expect(scope.define(localNamed('lum')).irName).toBeUndefined();
  });

  it('is fresh for an internal temporary, whatever the caller asks', () => {
    const scope = new LoweringScope(new Map([['_w', funcNamed('_w')]]));
    expect(scope.defineTemp('_w', f32T)).toBe('_w_1');
  });
});

describe('the structs a scope knows by name', () => {
  it('knows the struct of an optional, which no file declares', () => {
    const optional = optionalT(f32T);
    const scope = new LoweringScope();
    scope.setStructs([]);
    expect(optional.kind === 'struct' && scope.structByName(optional.name)?.fields).toEqual([
      { name: 'value', type: f32T },
      { name: 'present', type: { kind: 'scalar', scalar: 'bool' } },
    ]);
    expect(scope.structByName('Nothing')).toBeUndefined();
  });
});

describe('a name declared twice in one frame', () => {
  it('throws, as TypeScript refuses it', () => {
    const scope = new LoweringScope();
    const local = { kind: 'local' as const, name: 'a', type: f32T, mutable: true };
    scope.define(local);
    expect(() => scope.define(local)).toThrow('Duplicate binding "a" in current scope frame');
  });
});
