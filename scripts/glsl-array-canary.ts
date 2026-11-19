import { chromium } from 'playwright';
import { gateBrowserSettings } from './gate-browser.js';

const vertex = (declaration: string) => `#version 300 es
precision highp float;
${declaration}
void main() {
  gl_Position = vec4(values[0], values[1], values[2], 1.0);
}
`;

const fragment = (declaration: string) => `#version 300 es
precision highp float;
out vec4 colour;
${declaration}
void main() {
  colour = vec4(values[0], values[1], values[2], 1.0);
}
`;

async function main(): Promise<void> {
  const settings = gateBrowserSettings(process.env);
  const browser = await chromium.launch(settings.launch);
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>GLSL ES 3.00 array syntax canary</title>');
    const result = await page.evaluate(
      (input: {
        typeVertex: string;
        typeFragment: string;
        declaratorVertex: string;
        declaratorFragment: string;
        nestedVertex: string;
        nestedFragment: string;
      }) => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (gl === null) throw new Error('WebGL2 context is unavailable');

        const compile = (
          type: number,
          source: string,
        ): { shader: WebGLShader | null; log: string } => {
          const shader = gl.createShader(type);
          if (shader === null) return { shader: null, log: 'createShader returned null' };
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
          const log = gl.getShaderInfoLog(shader) ?? '';
          if (!ok) {
            gl.deleteShader(shader);
            return { shader: null, log };
          }
          return { shader, log };
        };

        const typeVs = compile(gl.VERTEX_SHADER, input.typeVertex);
        const typeFs = compile(gl.FRAGMENT_SHADER, input.typeFragment);
        const declaratorVs = compile(gl.VERTEX_SHADER, input.declaratorVertex);
        const declaratorFs = compile(gl.FRAGMENT_SHADER, input.declaratorFragment);
        const nestedVs = compile(gl.VERTEX_SHADER, input.nestedVertex);
        const nestedFs = compile(gl.FRAGMENT_SHADER, input.nestedFragment);

        const link = (vs: WebGLShader | null, fs: WebGLShader | null): boolean => {
          if (vs === null || fs === null) return false;
          const program = gl.createProgram();
          if (program === null) return false;
          gl.attachShader(program, vs);
          gl.attachShader(program, fs);
          gl.linkProgram(program);
          const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
          gl.deleteProgram(program);
          return linked;
        };

        const typeLinked = link(typeVs.shader, typeFs.shader);
        const declaratorLinked = link(declaratorVs.shader, declaratorFs.shader);
        const mixedLinked = link(typeVs.shader, declaratorFs.shader);
        for (const shader of [
          typeVs.shader,
          typeFs.shader,
          declaratorVs.shader,
          declaratorFs.shader,
        ]) {
          if (shader !== null) gl.deleteShader(shader);
        }

        return {
          typeVertexAccepted: typeVs.shader !== null,
          typeFragmentAccepted: typeFs.shader !== null,
          declaratorVertexAccepted: declaratorVs.shader !== null,
          declaratorFragmentAccepted: declaratorFs.shader !== null,
          nestedVertexRejected: nestedVs.shader === null,
          nestedFragmentRejected: nestedFs.shader === null,
          typePairLinked: typeLinked,
          declaratorPairLinked: declaratorLinked,
          mixedPairLinked: mixedLinked,
          nestedVertexLog: nestedVs.log,
          nestedFragmentLog: nestedFs.log,
          renderer: gl.getParameter(gl.RENDERER) as string,
        };
      },
      {
        typeVertex: vertex('float[3] values;'),
        typeFragment: fragment('float[3] values;'),
        declaratorVertex: vertex('float values[3];'),
        declaratorFragment: fragment('float values[3];'),
        nestedVertex: vertex('float[3][2] values;'),
        nestedFragment: fragment('float[3][2] values;'),
      },
    );

    console.log(`GLSL ES 3.00 array syntax canary · ${result.renderer}`);
    console.log(
      `type-style declarations compile: ${result.typeVertexAccepted && result.typeFragmentAccepted}`,
    );
    console.log(
      `identifier-style declarations compile: ${result.declaratorVertexAccepted && result.declaratorFragmentAccepted}`,
    );
    console.log(
      `nested arrays rejected: ${result.nestedVertexRejected && result.nestedFragmentRejected}`,
    );
    console.log(
      `program links (type / identifier / mixed): ${result.typePairLinked} / ${result.declaratorPairLinked} / ${result.mixedPairLinked}`,
    );

    const failures = [
      !result.typeVertexAccepted &&
        'compiler rejected valid vertex type-style array declaration',
      !result.typeFragmentAccepted &&
        'compiler rejected valid fragment type-style array declaration',
      !result.declaratorVertexAccepted &&
        'compiler rejected valid vertex identifier-style array declaration',
      !result.declaratorFragmentAccepted &&
        'compiler rejected valid fragment identifier-style array declaration',
      !result.nestedVertexRejected &&
        'compiler accepted illegal vertex array-of-arrays declaration',
      !result.nestedFragmentRejected &&
        'compiler accepted illegal fragment array-of-arrays declaration',
      !result.typePairLinked && 'compiler failed to link the type-style vertex/fragment pair',
      !result.declaratorPairLinked &&
        'compiler failed to link the identifier-style vertex/fragment pair',
      !result.mixedPairLinked &&
        'compiler failed to link the mixed-syntax vertex/fragment pair',
    ].filter((failure): failure is string => Boolean(failure));
    if (failures.length > 0) throw new Error(failures.join('\n'));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
