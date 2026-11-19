import { chromium } from 'playwright';
import { gateBrowserSettings } from './gate-browser.js';

const vertex = (declarator: string) => `#version 300 es
precision highp float;
${declarator}
void main() {
  gl_Position = vec4(values[0], values[1], values[2], 1.0);
}
`;

const fragment = (declarator: string) => `#version 300 es
precision highp float;
out vec4 colour;
${declarator}
void main() {
  colour = vec4(values[0], values[1], values[2], 1.0);
}
`;

async function main(): Promise<void> {
  const settings = gateBrowserSettings(process.env);
  const browser = await chromium.launch(settings.launch);
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>GLSL ES 3.00 array declarator canary</title>');
    const result = await page.evaluate(({ badVertex, badFragment, goodVertex, goodFragment }) => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (gl === null) throw new Error('WebGL2 context is unavailable');

      const compile = (type: number, source: string): { shader: WebGLShader | null; log: string } => {
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

      const badVs = compile(gl.VERTEX_SHADER, badVertex);
      const badFs = compile(gl.FRAGMENT_SHADER, badFragment);
      const goodVs = compile(gl.VERTEX_SHADER, goodVertex);
      const goodFs = compile(gl.FRAGMENT_SHADER, goodFragment);
      let linkLog = '';
      let linked = false;
      if (goodVs.shader !== null && goodFs.shader !== null) {
        const program = gl.createProgram();
        if (program === null) {
          linkLog = 'createProgram returned null';
        } else {
          gl.attachShader(program, goodVs.shader);
          gl.attachShader(program, goodFs.shader);
          gl.linkProgram(program);
          linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
          linkLog = gl.getProgramInfoLog(program) ?? '';
          gl.deleteProgram(program);
        }
      }
      for (const shader of [goodVs.shader, goodFs.shader])
        if (shader !== null) gl.deleteShader(shader);
      return {
        invalidVertexRejected: badVs.shader === null,
        invalidFragmentRejected: badFs.shader === null,
        validVertexAccepted: goodVs.shader !== null,
        validFragmentAccepted: goodFs.shader !== null,
        validProgramLinked: linked,
        invalidVertexLog: badVs.log,
        invalidFragmentLog: badFs.log,
        validLinkLog: linkLog,
        renderer: gl.getParameter(gl.RENDERER) as string,
      };
    }, {
      badVertex: vertex('float[3] values;'),
      badFragment: fragment('float[3] values;'),
      goodVertex: vertex('float values[3];'),
      goodFragment: fragment('float values[3];'),
    });

    console.log(`GLSL ES 3.00 array declarator canary · ${result.renderer}`);
    console.log(`invalid vertex rejected: ${result.invalidVertexRejected}`);
    console.log(`invalid fragment rejected: ${result.invalidFragmentRejected}`);
    console.log(`valid vertex accepted: ${result.validVertexAccepted}`);
    console.log(`valid fragment accepted: ${result.validFragmentAccepted}`);
    console.log(`valid vertex/fragment link: ${result.validProgramLinked}`);

    const failures = [
      !result.invalidVertexRejected && 'ANGLE accepted invalid vertex declarator float[3] values',
      !result.invalidFragmentRejected && 'ANGLE accepted invalid fragment declarator float[3] values',
      !result.validVertexAccepted && 'ANGLE rejected valid vertex declarator float values[3]',
      !result.validFragmentAccepted && 'ANGLE rejected valid fragment declarator float values[3]',
      !result.validProgramLinked && `ANGLE failed to link valid vertex/fragment pair: ${result.validLinkLog}`,
    ].filter((x): x is string => Boolean(x));
    if (failures.length > 0) throw new Error(failures.join('\\n'));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
