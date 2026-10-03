import type { FuncDecl } from './nodes.js';

// Private source metadata: a spread-clone preserves it, while the public IR and its
// portable encoding need no new field for a debugger's authored-name view.
const PARAMETER_LOCALS = Symbol('typeshade.parameterLocals');
type WithParameterLocals = FuncDecl & {
  [PARAMETER_LOCALS]?: ReadonlyMap<string, string>;
};

export function setParameterLocals(decl: FuncDecl, locals: ReadonlyMap<string, string>): void {
  (decl as WithParameterLocals)[PARAMETER_LOCALS] = new Map(locals);
}

export function parameterLocalsOf(decl: FuncDecl): ReadonlyMap<string, string> | undefined {
  return (decl as WithParameterLocals)[PARAMETER_LOCALS];
}
