export function drawn(gl: WebGL2RenderingContext, what: string): void {
  const code = gl.getError();
  if (code === gl.NO_ERROR) return;
  const names: readonly (readonly [number, string])[] = [
    [gl.INVALID_ENUM, 'INVALID_ENUM'],
    [gl.INVALID_VALUE, 'INVALID_VALUE'],
    [gl.INVALID_OPERATION, 'INVALID_OPERATION'],
    [gl.INVALID_FRAMEBUFFER_OPERATION, 'INVALID_FRAMEBUFFER_OPERATION'],
    [gl.OUT_OF_MEMORY, 'OUT_OF_MEMORY'],
    [gl.CONTEXT_LOST_WEBGL, 'CONTEXT_LOST_WEBGL'],
  ];
  const name = names.find(([value]) => value === code)?.[1] ?? 'an error';
  throw new Error(
    `typeshade/webgl2: ${what} did not draw: WebGL2 reported ${name} (0x${code.toString(16)})`,
  );
}
