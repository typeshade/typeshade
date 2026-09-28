// The JavaScript the package publishes for host code, under the `default` condition beside the
// shader modules it publishes under `typeshade`.
export function contour(h, step) {
  const t = h / step - Math.floor(h / step);
  return Math.min(t, 1 - t) * step;
}
