import { expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';

const IO = '/p/io.shade.ts';
const IO_TEXT = `"use typeshade";
export interface VsIn {
  position: vec3;
  uv: vec2;
}
`;
const imports = (entry: string): string => `"use typeshade";
import { VsIn } from "./io.shade.ts";
@vertex
${entry}
`;

it('two programs whose paths no shorter text tells apart are each named by the whole uri', () => {
  const first = '/p/main.shade.ts';
  const second = 'x:/p/main.shade.ts';
  const service = createTypeshadeLanguageService({ resolveImport: () => IO });
  service.openDocument(IO, IO_TEXT);
  service.openDocument(
    first,
    imports(
      'export function vs(normal: vec3, v: VsIn): vec4 {\n  return vec4(v.position + normal, v.uv.x);\n}',
    ),
  );
  service.openDocument(
    second,
    imports('export function vs(v: VsIn): vec4 {\n  return vec4(v.position, v.uv.x);\n}'),
  );
  const hover = service.getHover(IO, service.positionAt(IO, IO_TEXT.indexOf('uv:')))?.contents;
  expect(hover).toBe(
    [
      '```ts\n(property) VsIn.uv: vec2<f32>\n```',
      `vertex attribute at @location(2) in ${first}`,
      `vertex attribute at @location(1) in ${second}`,
    ].join('\n\n'),
  );
});
