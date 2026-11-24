import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { WGSL_BUILTIN_NAMES } from './ambient.js';

function completionsAt(source: string, cursor: string, fromEnd = true) {
  const service = createTypeshadeLanguageService();
  service.openDocument('k.ts', source);
  const index = source.indexOf(cursor);
  expect(index, `cursor text ${JSON.stringify(cursor)} not found`).toBeGreaterThanOrEqual(0);
  const offset = fromEnd ? index + cursor.length : index;
  return service.getCompletions('k.ts', service.positionAt('k.ts', offset));
}

const labelsOf = (items: readonly { label: string }[]) => items.map((i) => i.label);
const snippets = (items: readonly { kind: string }[]) => items.filter((i) => i.kind === 'snippet');

describe('getCompletions: builtin ids by pipeline stage', () => {
  const stageSource = (stage: string) =>
    `"use typeshade";\n@${stage}\nexport function f(@builtin("") x: u32): f32 {\n  return 1\n}\n`;

  it('offers a vertex function the vertex inputs only', () => {
    const labels = labelsOf(completionsAt(stageSource('vertex'), '@builtin("'));
    expect(labels).toEqual(['vertex_index', 'instance_index']);
  });

  it('offers a compute function the compute inputs and the subgroup pair, never clip_distances', () => {
    const labels = labelsOf(completionsAt(stageSource('compute'), '@builtin("'));
    expect(labels).toEqual([
      'local_invocation_id',
      'local_invocation_index',
      'global_invocation_id',
      'workgroup_id',
      'num_workgroups',
      'subgroup_invocation_id',
      'subgroup_size',
      'subgroup_id',
      'num_subgroups',
    ]);
    expect(labels).not.toContain('clip_distances');
  });

  it('offers a fragment function its inputs and the subgroup pair, never clip_distances', () => {
    const labels = labelsOf(completionsAt(stageSource('fragment'), '@builtin("'));
    expect(labels).toEqual([
      'position',
      'front_facing',
      'sample_index',
      'sample_mask',
      'primitive_index',
      'subgroup_invocation_id',
      'subgroup_size',
    ]);
  });

  it('offers the whole vocabulary, clip_distances included, where no stage is known', () => {
    const source =
      '"use typeshade";\nexport function f(@builtin("") x: u32): f32 {\n  return 1\n}\n';
    const labels = labelsOf(completionsAt(source, '@builtin("'));
    expect(labels).toEqual([...WGSL_BUILTIN_NAMES]);
    expect(labels).toContain('clip_distances');
  });

  it('keeps only the ids that start with what is typed', () => {
    const source =
      '"use typeshade";\n@compute\nexport function f(@builtin("sub") x: u32): f32 {\n  return 1\n}\n';
    expect(labelsOf(completionsAt(source, '@builtin("sub'))).toEqual([
      'subgroup_invocation_id',
      'subgroup_size',
      'subgroup_id',
    ]);
  });

  it('offers ids inside the first type argument of builtin<...>', () => {
    const source = '"use typeshade";\nclass V {\n  pos: builtin<"ver", u32>\n}\n';
    const items = completionsAt(source, 'builtin<"ver');
    expect(labelsOf(items)).toEqual(['vertex_index']);
    expect(items.every((i) => i.kind === 'builtin')).toBe(true);
  });

  it('offers nothing inside a string that is not the id of builtin(...)', () => {
    const source =
      '"use typeshade";\nconst a = other("ver")\nconst b = builtin(1, "ver")\nconst c = builtin<u32, "ver">\n';
    for (const cursor of ['other("ver', 'builtin(1, "ver', 'builtin<u32, "ver']) {
      expect(completionsAt(source, cursor), cursor).toEqual([]);
    }
  });

  it('does not treat the cursor after the closing quote as inside the id', () => {
    const source = '"use typeshade";\nclass V {\n  @builtin("ver") pos: vec4\n}\n';
    const items = completionsAt(source, '@builtin("ver"');
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.kind === 'builtin')).toEqual([]);
  });

  it('does not filter by stage a builtin id written in the body of a stage function', () => {
    for (const stage of ['vertex', 'compute']) {
      const source = `"use typeshade";\n@${stage}\nexport function f(): f32 {\n  const b = builtin("pos")\n  return 1\n}\n`;
      expect(labelsOf(completionsAt(source, 'builtin("pos')), stage).toEqual(['position']);
    }
  });

  it('does not treat the cursor before the opening quote as inside the id', () => {
    const source = '"use typeshade";\nclass V {\n  @builtin("ver") pos: vec4\n}\n';
    const items = completionsAt(source, '@builtin(');
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.kind === 'builtin')).toEqual([]);
  });
});

describe('getCompletions: vector members', () => {
  const listed = ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a', 'xy', 'xyz', 'xyzw', 'rg', 'rgb', 'rgba'];
  const swizzle = /^(?:[xyzw]{1,4}|[rgba]{1,4})$/;

  it('lists the components and the prefix swizzles of a vec4, and no other swizzle', () => {
    const source = '"use typeshade";\nexport function f(v: vec4): f32 {\n  return v.\n}\n';
    const labels = labelsOf(completionsAt(source, 'return v.'));
    expect(labels.filter((label) => swizzle.test(label)).sort()).toEqual([...listed].sort());
    expect(labels).not.toContain('xxxx');
    expect(labels).not.toContain('wzyx');
  });

  it('keeps swizzle-like names on a receiver that is not a GPU type', () => {
    const source =
      '"use typeshade";\nexport function f(): f32 {\n  const o = { xy: 1, xxxx: 2 }\n  return o.\n}\n';
    const labels = labelsOf(completionsAt(source, 'return o.'));
    expect(labels).toContain('xy');
    expect(labels).toContain('xxxx');
  });
});

describe('getCompletions: where a cursor is inside a comment', () => {
  it('answers with TypeScript alone inside a JSDoc comment', () => {
    const source = '"use typeshade";\n/**\n * @par\n */\nfunction f(): f32 {\n  return 1\n}\n';
    const items = completionsAt(source, '@par');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === 'keyword')).toBe(true);
  });

  const returnSource = (text: string) =>
    `"use typeshade";\nexport function f(): vec4 {\n  return ${text}\n}\n`;

  it('is not inside a closed block comment when it sits right after the closing mark', () => {
    const items = completionsAt(returnSource('/* c */'), '/* c */');
    expect(snippets(items).map((i) => i.label)).toContain('vec4');
  });

  it('is not inside a comment when it sits right before the opening mark', () => {
    const items = completionsAt(returnSource('/* c */'), '/* c */', false);
    expect(snippets(items).map((i) => i.label)).toContain('vec4');
  });

  it('is inside a block comment that is never closed, at the end of the file', () => {
    const source = '"use typeshade";\nconst a = 1\n/* vec';
    expect(snippets(completionsAt(source, '/* vec'))).toEqual([]);
  });

  it('is inside a line comment at its very end', () => {
    const source = '"use typeshade";\nconst a = 1 // vec\nconst b = 2\n';
    expect(snippets(completionsAt(source, '// vec'))).toEqual([]);
  });
});

describe('getCompletions: where a value expression can start', () => {
  const noSnippetAt: readonly [name: string, source: string, cursor: string][] = [
    ['an empty import clause', '"use typeshade";\nimport {  } from "m"\n', 'import { '],
    ['an empty export clause', '"use typeshade";\nconst q = 1\nexport {  }\n', 'export { '],
    ['an empty class body', '"use typeshade";\nclass A {\n  \n}\n', 'class A {\n  '],
    ['an empty interface body', '"use typeshade";\ninterface I {\n  \n}\n', 'interface I {\n  '],
    [
      'the arguments of a decorator',
      '"use typeshade";\nclass V {\n  @location(vec) pos: vec4\n}\n',
      '@location(vec',
    ],
    ['a type alias', '"use typeshade";\ntype T = vec\n', 'type T = vec'],
    ['an interface member type', '"use typeshade";\ninterface I {\n  a: vec\n}\n', 'a: vec'],
    ['a class member list', '"use typeshade";\nclass A {\n  vec\n}\n', '  vec'],
    ['a number literal already written', '"use typeshade";\nconst a = 1\n', 'const a = 1'],
    ['a string literal already written', '"use typeshade";\nconst a = "x"\n', 'const a = "x"'],
  ];
  for (const [name, source, cursor] of noSnippetAt) {
    it(`offers no vec snippet in ${name}`, () => {
      expect(snippets(completionsAt(source, cursor))).toEqual([]);
    });
  }

  it('offers vec snippets at the start of a statement', () => {
    const source = '"use typeshade";\nexport function f(): f32 {\n  vec\n  return 1\n}\n';
    expect(snippets(completionsAt(source, '  vec')).map((i) => i.label)).toEqual([
      'vec2',
      'vec3',
      'vec4',
    ]);
  });
});

describe('getCompletions: the name of a decorator being typed', () => {
  it('offers attributes on the callee of a decorator factory', () => {
    const source = '"use typeshade";\nclass V {\n  @loc(0) pos: vec4\n}\n';
    const items = completionsAt(source, '@loc');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind === 'attribute')).toBe(true);
    expect(labelsOf(items)).toContain('@location');
  });

  it('offers no attributes inside the arguments of a decorator factory', () => {
    const source = '"use typeshade";\nclass V {\n  @location(0) pos: vec4\n}\n';
    const items = completionsAt(source, '@location(');
    expect(items.filter((i) => i.kind === 'attribute')).toEqual([]);
  });
});
