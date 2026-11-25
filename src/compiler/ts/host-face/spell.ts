import type { ShaderType } from '../../../core/ir/types.js';
import { authorTypeText } from '../context.js';

export function spell(t: ShaderType): string {
  if (t.kind === 'struct') return t.name;
  if (t.kind === 'array')
    return t.size === undefined ? `array<${spell(t.elem)}>` : `array<${spell(t.elem)}, ${t.size}>`;
  if (t.kind === 'atomic') return `atomic<${t.elem}>`;
  return authorTypeText(t);
}
