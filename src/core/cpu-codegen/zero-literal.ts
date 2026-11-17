import type { ModuleDecl, ShaderType, StructDecl } from '../ir/index.js';

const q = (s: string): string => JSON.stringify(s);

export function zeroLit(t: ShaderType, structs: ReadonlyMap<string, StructDecl>): string {
  if (t.kind === 'vec' || t.kind === 'vec64') return `new Array(${t.n}).fill(0)`;
  if (t.kind === 'mat') return `new Array(${t.cols * t.rows}).fill(0)`;
  if (t.kind === 'struct') {
    const decl = structs.get(t.name);
    if (decl === undefined) return '{}';
    const fields = decl.fields.map((f) => `${q(f.name)}: ${zeroLit(f.type, structs)}`);
    return `{${fields.join(', ')}}`;
  }
  if (t.kind === 'array') {
    return `[${Array.from({ length: t.size ?? 0 }, () => zeroLit(t.elem, structs)).join(', ')}]`;
  }
  if (t.kind === 'scalar' && t.scalar === 'bool') return 'false';
  return '0';
}

const VALUE_BINDING_KINDS: ReadonlySet<ShaderType['kind']> = new Set([
  'scalar',
  'f64',
  'vec',
  'vec64',
  'mat',
  'struct',
  'array',
  'atomic',
]);

function unboundValue(t: ShaderType, structs: ReadonlyMap<string, StructDecl>): string {
  if (t.kind === 'array' && (t.size === undefined || t.sizeOverride !== undefined))
    return `$.absent(${unboundValue(t.elem, structs)})`;
  if (t.kind === 'array')
    return `Array.from({ length: ${t.size} }, () => ${unboundValue(t.elem, structs)})`;
  if (t.kind === 'struct') {
    const decl = structs.get(t.name);
    if (decl === undefined) return '({})';
    return `({ ${decl.fields.map((f) => `${q(f.name)}: ${unboundValue(f.type, structs)}`).join(', ')} })`;
  }
  return zeroLit(t, structs);
}

export function unboundBindings(m: ModuleDecl, structs: ReadonlyMap<string, StructDecl>): string[] {
  return m.bindings
    .filter((b) => VALUE_BINDING_KINDS.has(b.type.kind))
    .map((b) => `$.bindings[${q(b.name)}] = ${unboundValue(b.type, structs)};`);
}
