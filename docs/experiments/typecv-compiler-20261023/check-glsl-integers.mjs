import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { inBrowser } = await import(pathToFileURL(resolve('tests/typeshade/browser.mjs')).href);

const root =
  process.env.PROBE_COMPILER_ROOT ??
  (() => {
    throw new Error('Set PROBE_COMPILER_ROOT to the TypeShade checkout under test');
  })();
const { generateModule } = await import(`${root}/src/core/testing/random-ir.ts`);
const { drawnFunction } = await import(`${root}/src/core/testing/draw-harness.ts`);
const { emitGlslModule } = await import(`${root}/src/core/backends/glsl.ts`);
const { intHelperDefs } = await import(`${root}/src/core/backends/glsl-int.ts`);

const cases = [],
  refused = [];
for (const [helper, scalar] of [
  ['_idiv', 'i32'],
  ['_irem', 'i32'],
  ['_udiv', 'u32'],
  ['_urem', 'u32'],
]) {
  const unsigned = scalar === 'u32';
  const defs = intHelperDefs([{ helper, type: { kind: 'scalar', scalar } }]).join('\n');
  for (const b of unsigned ? ['0u', '1u'] : ['0', '-1', '1']) {
    const a = unsigned ? '7u' : 'int(0x80000000u)';
    cases.push({
      id: `literal ${helper}/${b}`,
      source: `#version 300 es\nprecision highp float;\nprecision highp int;\n${defs}\nout vec4 color;\nvoid main(){ color = vec4(float(${helper}(${a},${b}))); }`,
    });
  }
}
const seeds = Number(process.argv[2] ?? 128);
for (let seed = 1; seed <= seeds; seed++) {
  const corpus = generateModule(seed, { exact: true });
  for (const f of corpus.module.funcs) {
    try {
      cases.push({
        id: `seed ${seed} ${f.name}`,
        source: emitGlslModule(drawnFunction(corpus.module, f.name, 1, 1).module, 'fragment'),
      });
    } catch (e) {
      refused.push({ id: `seed ${seed} ${f.name}`, error: String(e) });
    }
  }
}
const { result, errors } = await inBrowser(
  async (cases) => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(
      vertex,
      '#version 300 es\nprecision highp float;\nvoid main(){gl_Position=vec4(float(gl_VertexID),0.,0.,1.);}',
    );
    gl.compileShader(vertex);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(vertex));
    const compile = (source) => {
      const shader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      let error = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
        ? null
        : `compile: ${gl.getShaderInfoLog(shader)}`;
      if (!error) {
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, shader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          error = `link: ${gl.getProgramInfoLog(program)}`;
        gl.deleteProgram(program);
      }
      gl.deleteShader(shader);
      return error;
    };
    if (!compile('#version 300 es\nvoid main( {')) throw new Error('Compiler instrument is blind');
    if (
      !compile(
        '#version 300 es\nprecision highp float;\nin vec2 link_probe;\nout vec4 color;\nvoid main(){color=vec4(link_probe,0.,1.);}',
      )
    )
      throw new Error('Linker instrument is blind');
    const failures = [];
    for (const c of cases) {
      const error = compile(c.source);
      if (error) {
        failures.push({ ...c, error });
        if (failures.length >= 8) break;
      }
    }
    gl.deleteShader(vertex);
    return {
      cases: cases.length,
      failures,
      renderer: gl.getParameter(gl.RENDERER),
      brokenReported: true,
      brokenLinkReported: true,
      linked: true,
    };
  },
  cases,
  { timeoutMs: 600000 },
);
await writeFile(
  `.compiler-study/records/glsl-int-${process.env.PROBE_REVISION ?? 'before'}-linked.json`,
  JSON.stringify({ seeds, refused, errors, ...result }, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      seeds,
      cases: cases.length,
      refused: refused.length,
      errors,
      failures: result.failures.map(({ source: _source, ...r }) => r),
    },
    null,
    2,
  ),
);
process.exitCode = result.failures.length || errors.length ? 1 : 0;
