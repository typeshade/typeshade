import type { FuncDecl, ShaderType, Stmt } from '../../ir/index.js';

export function declaredTypes(decl: FuncDecl): ReadonlyMap<string, ShaderType> {
  const out = new Map<string, ShaderType>();
  for (const p of decl.params) out.set(p.name, p.type);
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      switch (s.s) {
        case 'let':
          out.set(s.name, s.expr.type);
          break;
        case 'var':
          out.set(s.name, s.type);
          break;
        case 'if':
          for (const arm of s.arms) walk(arm.body);
          if (s.elseBody) walk(s.elseBody);
          break;
        case 'for':
          walk([s.init]);
          walk([s.update]);
          walk(s.body);
          break;
        case 'switch':
          for (const c of s.cases) walk(c.body);
          if (s.defaultBody) walk(s.defaultBody);
          break;
        default:
          break;
      }
    }
  };
  walk(decl.body);
  return out;
}
