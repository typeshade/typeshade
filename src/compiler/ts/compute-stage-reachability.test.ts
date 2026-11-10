// Verifies: Rule 8.3, Rule 12.4, Rule 12.6, Rule 12.7 (docs/language-design.md; traced in reqs/).
// #321 control#14/#15: measured on Chromium 156.0.8078.4/SwiftShader (2026-11-07).
// Tint refuses render entries that reach workgroup variables or barriers through helpers.
// "var with 'workgroup' address space cannot be used by fragment pipeline stage";
// "built-in cannot be used by vertex pipeline stage" (a barrier reached through a helper).
// Unreachable helpers and compute entries pass shader-module and pipeline creation.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FILE = '/stages/main.shade.ts';
const WORKGROUP = 'let shared: workgroup<f32>;';
const entry = (stage: 'vertex' | 'fragment', body: string, name = 'main') =>
  `export const ${name} = ${stage}(function ${name}(): vec4 { ${body} });`;
const memoryMessage = (stage: string) =>
  `"shared" is workgroup memory, which only a compute entry has; a ${stage} entry cannot read or write it.`;
const barrierMessage = (name: string, stage: string) =>
  `${name}() belongs in a compute entry or a function it calls; a ${stage} entry has ${name === 'textureBarrier' ? 'no workgroup whose texture writes it could order' : 'no workgroup to wait for'}.`;
type Refusal = { text: string; code: string; message: string; start?: number };

function paired(
  body: string,
  refusals: readonly Refusal[] = [],
  files: Record<string, string> = {},
) {
  const source = `"use typeshade";\n${body}`;
  const readDocument = (path: string) => files[path];
  const result = compile(source, { fileName: FILE, readDocument });
  const service = createTypeshadeLanguageService({ readDocument });
  service.openDocument(FILE, source);
  try {
    const editor = service.getDiagnostics(FILE);
    const expected = refusals.map(({ text, code, message, start = source.lastIndexOf(text) }) => {
      expect(start).toBeGreaterThanOrEqual(0);
      const lines = source.slice(0, start).split('\n');
      const line = lines.length;
      const character = lines.at(-1)!.length + 1;
      return {
        code,
        message,
        category: 'error',
        fileName: FILE,
        start,
        length: text.length,
        line,
        character,
        endLine: line,
        endCharacter: character + text.length,
      };
    });
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual(expected);
    expect(
      editor.map(({ code, message, severity, uri, range }) => ({
        code,
        message,
        severity,
        uri,
        range,
      })),
    ).toEqual(
      expected.map((d) => ({
        code: d.code,
        message: d.message,
        severity: 'error',
        uri: FILE,
        range: {
          start: { line: d.line - 1, character: d.character - 1 },
          end: { line: d.endLine - 1, character: d.endCharacter - 1 },
        },
      })),
    );
    if (refusals.length === 0) {
      expect(result.wgsl).toBeDefined();
      expect(service.getCompiledOutput(FILE, 'wgsl')?.text).toBe(result.wgsl);
      // A render module retaining workgroup declarations remains WebGPU-only.
      expect(result.diagnostics.every((d) => d.code === 'TS8015' && d.category === 'warning')).toBe(
        true,
      );
    } else expect(result.wgsl).toBeUndefined();
    return result;
  } finally {
    service.closeDocument(FILE);
  }
}

for (const stage of ['vertex', 'fragment'] as const) {
  describe(`${stage} compute-only reachability`, () => {
    for (const [name, prefix, body] of [
      ['direct read', '', 'return vec4(shared);'],
      ['direct write', '', 'shared = 1.; return vec4(0.);'],
      ['helper read', 'function read(): f32 { return shared; }', 'return vec4(read());'],
      ['helper write', 'function write() { shared = 1.; }', 'write(); return vec4(0.);'],
      [
        'chain',
        'function read(): f32 { return shared; } function chain(): f32 { return read(); }',
        'return vec4(chain());',
      ],
      [
        'getter',
        'class Probe { dummy: f32 = 0.; get value(): f32 { return shared; } }',
        'const p = new Probe(); return vec4(p.value);',
      ],
      [
        'namespace helper',
        'namespace N { export function read(): f32 { return shared; } }',
        'return vec4(N.read());',
      ],
    ]) {
      it(`refuses a workgroup ${name} at the variable use`, () => {
        paired(`${WORKGROUP}\n${prefix}\n${entry(stage, body!)}`, [
          { text: 'shared', code: 'TS8033', message: memoryMessage(stage) },
        ]);
      });
    }
    for (const name of ['workgroupBarrier', 'storageBarrier', 'textureBarrier']) {
      for (const indirect of [false, true]) {
        it(`refuses ${indirect ? 'helper' : 'direct'} ${name} at the call`, () => {
          paired(
            `${indirect ? `function barrier() { ${name}(); }` : ''}\n${entry(stage, `${indirect ? 'barrier' : name}(); return vec4(0.);`)}`,
            [{ text: `${name}()`, code: 'TS8034', message: barrierMessage(name, stage) }],
          );
        });
      }
    }
    it('refuses a barrier reached through a getter', () => {
      paired(
        `class Probe { dummy: f32 = 0.; get value(): f32 { storageBarrier(); return 1.; } }\n${entry(stage, 'const p = new Probe(); return vec4(p.value);')}`,
        [
          {
            text: 'storageBarrier()',
            code: 'TS8034',
            message: barrierMessage('storageBarrier', stage),
          },
        ],
      );
    });
    it('accepts an unreachable workgroup and barrier helper', () => {
      paired(
        `${WORKGROUP}\nfunction read(): f32 { workgroupBarrier(); return shared; }\n${entry(stage, 'return vec4(0.);')}`,
      );
    });
    it('does not mistake a declared function for a barrier builtin', () => {
      paired(
        `function workgroupBarrier() {}\n${entry(stage, 'workgroupBarrier(); return vec4(0.);')}`,
      );
    });
  });
}

it('accepts compute use through shared helpers', () => {
  paired(
    `${WORKGROUP}\nfunction write() { shared = 1.; }\nfunction read(): f32 { return shared; }\nfunction barrier() { workgroupBarrier(); storageBarrier(); textureBarrier(); }\n@compute([1]) export function main() { write(); barrier(); shared = read(); }`,
  );
});

it('reports one shared helper use once across two fragment entries and a diamond', () => {
  paired(
    `function barrier() { workgroupBarrier(); }\nfunction left() { barrier(); }\nfunction right() { barrier(); }\n${entry('fragment', 'left(); right(); return vec4(0.);', 'first')}\n${entry('fragment', 'barrier(); return vec4(0.);', 'second')}`,
    [
      {
        text: 'workgroupBarrier()',
        code: 'TS8034',
        message: barrierMessage('workgroupBarrier', 'fragment'),
      },
    ],
  );
});

it('does not let a compute caller make a shared helper legal for a fragment caller', () => {
  paired(
    `function barrier() { workgroupBarrier(); }\n@compute([1]) export function cs() { barrier(); }\n${entry('fragment', 'barrier(); return vec4(0.);')}`,
    [
      {
        text: 'workgroupBarrier()',
        code: 'TS8034',
        message: barrierMessage('workgroupBarrier', 'fragment'),
      },
    ],
  );
});

it('does not mistake authored locals or parameters for module workgroup variables', () => {
  paired(
    `${WORKGROUP}\nfunction read(shared: f32): f32 { return shared; }\n${entry('fragment', 'const shared: f32 = 2.; return vec4(read(shared));')}`,
  );
});

it('does not mistake generated array-search locals for module workgroup variables', () => {
  paired(
    `let i: workgroup<i32>; let r: workgroup<i32>;\n${entry('fragment', 'const xs: array<i32, 2> = [1, 2]; return vec4(f32(xs.indexOf(2)));')}`,
  );
});

it('does not reach a same-named user helper through a Math builtin', () => {
  paired(
    `${WORKGROUP}\nfunction abs(x: f32): f32 { return shared; }\n${entry('fragment', 'return vec4(Math.abs(-1.));')}`,
  );
});

for (const barrier of [false, true]) {
  it(`anchors an imported ${barrier ? 'barrier' : 'workgroup'} helper refusal in the excluded entry`, () => {
    const library = `"use typeshade";\n${barrier ? 'export function helper(): f32 { workgroupBarrier(); return 1.; }' : 'let shared: workgroup<f32>; export function helper(): f32 { return shared; }'}`;
    const body = `import { helper } from "./lib.shade.ts";\n${barrier ? '' : 'const shared: f32 = 1.;\n'}${entry('fragment', 'return vec4(helper());')}`;
    const source = `"use typeshade";\n${body}`;
    paired(
      body,
      [
        {
          text: 'main',
          start: source.indexOf('const main') + 6,
          code: barrier ? 'TS8034' : 'TS8033',
          message: barrier
            ? barrierMessage('workgroupBarrier', 'fragment')
            : memoryMessage('fragment'),
        },
      ],
      { '/stages/lib.shade.ts': library },
    );
    const service = createTypeshadeLanguageService({
      readDocument: (path) => (path === '/stages/lib.shade.ts' ? library : undefined),
    });
    service.openDocument('/stages/lib.shade.ts', library);
    try {
      expect(service.getDiagnostics('/stages/lib.shade.ts')).toEqual([]);
    } finally {
      service.closeDocument('/stages/lib.shade.ts');
    }
  });
}

it('keeps a recursive helper refusal and terminates the stage walk', () => {
  const body = `function recur(): f32 { return recur(); }\n${entry('fragment', 'return vec4(recur());')}`;
  paired(body, [
    {
      text: 'recur()',
      start: `"use typeshade";\n${body}`.indexOf('return recur()') + 7,
      code: 'TS8031',
      message:
        'Recursive call: "recur" -> "recur". WGSL has no call stack, so a function must not take part in a call cycle.',
    },
  ]);
});
