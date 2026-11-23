import { bothHalves } from '../../core/testing/both-halves.js';
import { compileTsSource as readFrontEnd } from './source-file.js';

const agree = (source: string): ReturnType<typeof bothHalves>['result'] => {
  const halves = bothHalves(source);
  if (halves.editor.join('\n') !== halves.compiler.join('\n')) {
    throw new Error(
      `editor:\n${halves.editor.join('\n')}\ncompile():\n${halves.compiler.join('\n')}`,
    );
  }
  return halves.result;
};

export const compile = agree;

export const compileTsSource: typeof readFrontEnd = (source) => {
  agree(source);
  return readFrontEnd(source);
};
