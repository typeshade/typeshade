import { expect } from 'vitest';
import { bothHalves } from '../../core/testing/both-halves.js';

export const codedErrorsOf = (src: string) => {
  const halves = bothHalves(src);
  expect(halves.editor).toEqual(halves.compiler);
  return halves.compiler.map((line) => line.replace(/^typeshade /, ''));
};

export const errorsOf = (src: string) =>
  codedErrorsOf(src).map((line) => line.replace(/^TS\d+: /, ''));

const OVERLOAD_ERROR = 'typescript 2769';

export const codedPlus2769 = (src: string) => {
  const halves = bothHalves(src);
  expect(halves.editor.filter((line) => !line.startsWith(OVERLOAD_ERROR))).toEqual(halves.compiler);
  expect(halves.editor.filter((line) => line.startsWith(OVERLOAD_ERROR))).toHaveLength(1);
  return halves.compiler.map((line) => line.replace(/^typeshade /, ''));
};

export const errorsPlus2769 = (src: string) =>
  codedPlus2769(src).map((line) => line.replace(/^TS\d+: /, ''));
