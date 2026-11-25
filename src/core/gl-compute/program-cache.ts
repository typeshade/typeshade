const linked = new WeakMap<WebGL2RenderingContext, Map<string, WebGLProgram>>();

export function compile(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  what: string,
  varyings: readonly string[] = [],
): WebGLProgram {
  let cache = linked.get(gl);
  if (cache === undefined) linked.set(gl, (cache = new Map()));
  const key = `${vs}\0${fs}\0${varyings.join(',')}`;
  const hit = cache.get(key);
  if (hit !== undefined && gl.isProgram(hit)) return hit;
  const shaders: WebGLShader[] = [];
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type);
    if (s === null) throw new Error(`typeshade/webgl2: could not create ${what}'s shader`);
    shaders.push(s);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) {
      throw new Error(`typeshade/webgl2: ${what} did not compile: ${gl.getShaderInfoLog(s) ?? ''}`);
    }
    return s;
  };
  const p = gl.createProgram();
  if (p === null) throw new Error(`typeshade/webgl2: could not create ${what}'s program`);
  let keep = false;
  try {
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    if (varyings.length > 0) gl.transformFeedbackVaryings(p, [...varyings], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) {
      throw new Error(`typeshade/webgl2: ${what} did not link: ${gl.getProgramInfoLog(p) ?? ''}`);
    }
    cache.set(key, p);
    keep = true;
    return p;
  } finally {
    if (keep) for (const s of shaders) gl.detachShader(p, s);
    else gl.deleteProgram(p);
    for (const s of shaders) gl.deleteShader(s);
  }
}
