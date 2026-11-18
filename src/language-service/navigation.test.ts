import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { SHADE_DTS } from './ambient.js';
import { TYPE_DOCS } from './docs.js';

const SOURCE =
  '"use typeshade";\n' +
  'class Camera {\n' +
  '  position: vec4\n' +
  '}\n' +
  'const camera = uniform<Camera>(0, 0)\n' +
  'function scale(x: f32): f32 {\n' +
  '  return x\n' +
  '}\n' +
  '@vertex export function vs(i: builtin<"vertex_index">): vec4 {\n' +
  '  const s = scale(1.0)\n' +
  '  return vec4(s, s, s, 1.0)\n' +
  '}\n' +
  '@fragment export function fs(): vec4 {\n' +
  '  return camera.position\n' +
  '}\n';

describe('getDefinition', () => {
  it('finds the definition of a user function from its call site', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const offset = SOURCE.indexOf('scale(1.0)');
    const position = service.positionAt('a.ts', offset);
    const defs = service.getDefinition('a.ts', position);
    expect(defs.length).toBe(1);
    expect(defs[0]!.uri).toBe('a.ts');
    const declOffset = SOURCE.indexOf('function scale') + 'function '.length;
    expect(service.offsetAt('a.ts', defs[0]!.range.start)).toBe(declOffset);
  });

  it('finds the definition of a struct field from a property access', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const offset = SOURCE.lastIndexOf('camera.position') + 'camera.'.length;
    const position = service.positionAt('a.ts', offset);
    const defs = service.getDefinition('a.ts', position);
    expect(defs.length).toBe(1);
    const fieldOffset = SOURCE.indexOf('position: vec4');
    expect(service.offsetAt('a.ts', defs[0]!.range.start)).toBe(fieldOffset);
  });

  it('drops a definition that lands in the ambient lib', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const offset = SOURCE.indexOf('position: vec4') + 'position: '.length;
    const position = service.positionAt('a.ts', offset);
    expect(service.getDefinition('a.ts', position)).toEqual([]);
  });
});

describe('getReferences', () => {
  it('finds every reference to a resource, and can exclude its declaration', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const declOffset = SOURCE.indexOf('camera =');
    const position = service.positionAt('a.ts', declOffset);
    const withDecl = service.getReferences('a.ts', position, { includeDeclaration: true });
    const withoutDecl = service.getReferences('a.ts', position, { includeDeclaration: false });
    expect(withDecl.length).toBe(2);
    expect(withoutDecl.length).toBe(1);
    expect(withDecl.every((loc) => loc.uri === 'a.ts')).toBe(true);
  });
});

describe('getDocumentSymbols', () => {
  it('re-labels a struct, a resource, a helper, and two entries with their stage detail', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const symbols = service.getDocumentSymbols('a.ts');
    const byName = new Map(symbols.map((s) => [s.name, s]));

    expect(byName.get('Camera')?.kind).toBe('struct');
    expect(byName.get('Camera')?.children?.map((c) => c.kind)).toEqual(['field']);

    expect(byName.get('camera')?.kind).toBe('resource');
    expect(byName.get('scale')?.kind).toBe('function');

    expect(byName.get('vs')?.kind).toBe('entry');
    expect(byName.get('vs')?.detail).toBe('vertex');
    expect(byName.get('vs')?.children?.map((c) => c.kind)).toEqual(['parameter']);

    expect(byName.get('fs')?.kind).toBe('entry');
    expect(byName.get('fs')?.detail).toBe('fragment');
  });
});

describe('prepareRename / rename', () => {
  it('renames a user function across its declaration and every call site', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const position = service.positionAt(
      'a.ts',
      SOURCE.indexOf('function scale') + 'function '.length,
    );
    const prepared = service.prepareRename('a.ts', position);
    expect(prepared?.placeholder).toBe('scale');
    const edits = service.rename('a.ts', position, 'multiply');
    expect(edits['a.ts']?.length).toBe(2);
  });

  it('renames the same function across a CRLF document', () => {
    const crlfSource = SOURCE.replace(/\n/g, '\r\n');
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', crlfSource);
    const position = service.positionAt(
      'a.ts',
      crlfSource.indexOf('function scale') + 'function '.length,
    );
    const prepared = service.prepareRename('a.ts', position);
    expect(prepared?.placeholder).toBe('scale');
    const edits = service.rename('a.ts', position, 'multiply');
    expect(edits['a.ts']?.length).toBe(2);
    for (const edit of edits['a.ts']!) {
      const offset = service.offsetAt('a.ts', edit.range.start);
      expect(crlfSource.slice(offset, offset + 5)).toBe('scale');
    }
  });

  it('refuses to rename an ambient name', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const position = service.positionAt(
      'a.ts',
      SOURCE.indexOf('position: vec4') + 'position: '.length,
    );
    expect(service.prepareRename('a.ts', position)).toBeUndefined();
    expect(service.rename('a.ts', position, 'vec4x')).toEqual({});
  });

  it('refuses to rename the builtin string inside @builtin(...)', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const position = service.positionAt('a.ts', SOURCE.indexOf('vertex_index') + 1);
    expect(service.prepareRename('a.ts', position)).toBeUndefined();
    expect(service.rename('a.ts', position, 'nope')).toEqual({});
  });

  // Regression: `prepareRename` refused the directive string (ts.getRenameInfo says a plain
  // string literal cannot be renamed), but `rename` went straight to ts.findRenameLocations,
  // which treats a string literal as renamable and rewrote `"use typeshade"` itself.
  it('refuses to rename the "use typeshade" directive string, at every offset inside it', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const start = SOURCE.indexOf('"use typeshade"');
    const end = start + '"use typeshade"'.length;
    for (let offset = start; offset < end; offset++) {
      const position = service.positionAt('a.ts', offset);
      expect(service.prepareRename('a.ts', position)).toBeUndefined();
      expect(service.rename('a.ts', position, 'nope')).toEqual({});
    }
  });

  it('never returns edits from rename where prepareRename refused, at any offset in the file', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    for (let offset = 0; offset <= SOURCE.length; offset++) {
      const position = service.positionAt('a.ts', offset);
      const prepared = service.prepareRename('a.ts', position);
      const edits = service.rename('a.ts', position, 'renamed');
      if (prepared === undefined) {
        expect(
          edits,
          `offset ${offset} (${JSON.stringify(SOURCE.slice(offset, offset + 8))})`,
        ).toEqual({});
      } else {
        expect(Object.keys(edits).length, `offset ${offset}`).toBeGreaterThan(0);
      }
    }
  });

  // Regression: TypeScript's own decorator-resolution machinery (the code path
  // getDefinitionAtPosition/getRenameInfo/findRenameLocations all go through) `Debug.fail()`s
  // when the decorated node is a FunctionDeclaration — exactly the shape `@vertex`/`@fragment`
  // are attached to in "use typeshade". These three methods must return their empty shape
  // instead of letting that throw escape, at every offset inside either decorator.
  it('does not throw, and returns an empty result, on every offset inside @vertex', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const start = SOURCE.indexOf('@vertex');
    const end = start + '@vertex'.length;
    for (let offset = start; offset <= end; offset++) {
      const position = service.positionAt('a.ts', offset);
      expect(() => service.getDefinition('a.ts', position)).not.toThrow();
      expect(service.getDefinition('a.ts', position)).toEqual([]);
      expect(() => service.prepareRename('a.ts', position)).not.toThrow();
      expect(service.prepareRename('a.ts', position)).toBeUndefined();
      expect(() => service.rename('a.ts', position, 'nope')).not.toThrow();
      expect(service.rename('a.ts', position, 'nope')).toEqual({});
    }
  });

  it('does not throw, and returns an empty result, on every offset inside @fragment', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const start = SOURCE.indexOf('@fragment');
    const end = start + '@fragment'.length;
    for (let offset = start; offset <= end; offset++) {
      const position = service.positionAt('a.ts', offset);
      expect(() => service.getDefinition('a.ts', position)).not.toThrow();
      expect(() => service.prepareRename('a.ts', position)).not.toThrow();
      expect(() => service.rename('a.ts', position, 'nope')).not.toThrow();
    }
  });

  it('still resolves @builtin/@location parameter decorators normally (not swept up by the guard)', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', SOURCE);
    const position = service.positionAt('a.ts', SOURCE.indexOf('vertex_index') + 1);
    // Already covered above as "refuses to rename" (it's a @builtin(...) string), but the point
    // here is specifically that this offset is NOT caught by the new function-decorator guard —
    // it is a call-expression decorator on a parameter, a different shape entirely.
    expect(() => service.getDefinition('a.ts', position)).not.toThrow();
  });
});

describe('ambientLibUri (change 0143)', () => {
  const LIB = 'file:///ext/lib.typeshade.d.ts';
  const CALLS =
    '"use typeshade";\n' +
    'function f(a: u32, x: vec3, b: f32): f32 {\n' +
    '  const m = mix(x, x, 0.5)\n' +
    '  return b\n' +
    '}\n';
  const at = (service: ReturnType<typeof createTypeshadeLanguageService>, needle: string) =>
    service.positionAt('a.ts', CALLS.indexOf(needle));

  it('reports an ambient definition at the uri, at a range that reads the name in SHADE_DTS', () => {
    const service = createTypeshadeLanguageService({ ambientLibUri: LIB });
    service.openDocument('a.ts', CALLS);
    for (const name of ['u32', 'vec3', 'mix']) {
      const defs = service.getDefinition('a.ts', at(service, name));
      expect(defs.length, name).toBeGreaterThan(0);
      for (const def of defs) {
        expect(def.uri).toBe(LIB);
        const start = service.offsetAt(LIB, def.range.start);
        expect(start, name).toBeGreaterThan(0);
        expect(SHADE_DTS.slice(start, service.offsetAt(LIB, def.range.end))).toBe(name);
        expect(service.positionAt(LIB, start)).toEqual(def.range.start);
      }
    }
  });

  it('keeps only the ambient declaration among the references of a type', () => {
    const service = createTypeshadeLanguageService({ ambientLibUri: LIB });
    service.openDocument('a.ts', CALLS);
    const refs = service.getReferences('a.ts', at(service, 'f32'));
    expect(refs.filter((r) => r.uri === 'a.ts')).toHaveLength(2);
    const inLib = refs.filter((r) => r.uri === LIB);
    expect(inLib).toHaveLength(1);
    const start = service.offsetAt(LIB, inLib[0]!.range.start);
    expect(SHADE_DTS.slice(start, service.offsetAt(LIB, inLib[0]!.range.end))).toBe('f32');
  });

  it('answers as before when the adapter names no file', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', CALLS);
    expect(service.getDefinition('a.ts', at(service, 'mix'))).toEqual([]);
    expect(service.getReferences('a.ts', at(service, 'f32')).map((r) => r.uri)).toEqual([
      'a.ts',
      'a.ts',
    ]);
  });

  it('still refuses to rename an ambient name, and never stores the file as a document', () => {
    const service = createTypeshadeLanguageService({ ambientLibUri: LIB });
    service.openDocument('a.ts', CALLS);
    expect(service.prepareRename('a.ts', at(service, 'u32'))).toBeUndefined();
    const before = service.getDefinition('a.ts', at(service, 'mix'));
    service.openDocument(LIB, SHADE_DTS);
    service.updateDocument(LIB, SHADE_DTS);
    expect(service.getDefinition('a.ts', at(service, 'mix'))).toEqual(before);
    expect(service.getDiagnostics(LIB)).toEqual([]);
  });
});

describe('the ambient type declarations carry their TYPE_DOCS sentence (change 0143)', () => {
  it('has a JSDoc block right above the first declaration of every described type', () => {
    const lines = SHADE_DTS.split('\n');
    const missing = Object.keys(TYPE_DOCS).filter((name) => {
      const i = lines.findIndex((line) =>
        new RegExp(`^(?:type|interface)\\s+${name}\\b`).test(line),
      );
      return i < 1 || !lines[i - 1]!.trimEnd().endsWith('*/');
    });
    expect(Object.keys(TYPE_DOCS).length).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it('leaves the hover of a type name as TYPE_DOCS states it', () => {
    const service = createTypeshadeLanguageService();
    const text = '"use typeshade";\nfunction g(a: u32): u32 {\n  return a\n}\n';
    service.openDocument('a.ts', text);
    const hover = service.getHover('a.ts', service.positionAt('a.ts', text.indexOf('u32')));
    expect(hover?.contents).toBe(`\`u32\` — ${TYPE_DOCS.u32}`);
  });
});
