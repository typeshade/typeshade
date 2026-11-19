import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../../optional.js';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { boolT, f32T, i32T, u32T } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText, type LoweringScope } from '../../context.js';
import { foldNumericLit, isIntScalar, retargetDeclaredIntLit } from '../../lit-coerce.js';
import { TS_CODES } from '../../codes.js';
import { pushDiag } from '../expression-array.js';

export function typeArrayElement(
  node: ts.Expression,
  lowered: Expr,
  elem: ShaderType,
  size: number | undefined,
  i: number,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  let out = retargetDeclaredIntLit(lowered, node, elem);
  if (isBareNumericLiteral(node) && isNumericScalar(elem)) {
    const folded = foldNumericLit(out);
    if (folded.op === 'lit' && typeof folded.value === 'number' && !isIntScalar(elem)) {
      out = { op: 'lit', type: elem, value: folded.value };
    }
  }
  if (typeKey(out.type) !== typeKey(elem)) {
    const castable = (t: ShaderType): boolean =>
      t.kind === 'scalar' || t.kind === 'vec' || t.kind === 'f64' || t.kind === 'vec64';
    const cast = castable(elem) && castable(out.type) ? '; cast it' : '';
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `array<${authorTypeText(elem)}${size === undefined ? '' : `, ${size}`}> element ${i} must be ${authorTypeText(elem)}, got ${authorTypeText(out.type)}. There is no implicit conversion${cast}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return out;
}

function isBareNumericLiteral(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isBareNumericLiteral(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isBareNumericLiteral(node.operand);
  }
  return ts.isNumericLiteral(node);
}

export function zeroOfArrayElement(type: ShaderType, scope: LoweringScope): Expr | undefined {
  switch (type.kind) {
    case 'scalar': {
      const k = typeKey(type);
      if (k === 'bool') return { op: 'lit', type: boolT, value: false };
      if (k === 'f32') return { op: 'lit', type: f32T, value: 0 };
      if (k === 'i32') return { op: 'lit', type: i32T, value: 0 };
      if (k === 'u32') return { op: 'lit', type: u32T, value: 0 };
      return undefined;
    }
    case 'vec': {
      const elemT =
        type.elem === 'f32'
          ? f32T
          : type.elem === 'i32'
            ? i32T
            : type.elem === 'u32'
              ? u32T
              : undefined;
      if (!elemT) return undefined;
      const z: Expr = { op: 'lit', type: elemT, value: 0 };
      return { op: 'construct', type, args: Array.from({ length: type.n }, () => z) };
    }
    case 'mat': {
      if (type.elem !== 'f32') return undefined;
      const colT: ShaderType = { kind: 'vec', n: type.rows, elem: 'f32' } as ShaderType;
      const z: Expr = { op: 'lit', type: f32T, value: 0 };
      const col: Expr = {
        op: 'construct',
        type: colT,
        args: Array.from({ length: type.rows }, () => z),
      };
      return { op: 'construct', type, args: Array.from({ length: type.cols }, () => col) };
    }
    case 'array': {
      if (type.size === undefined) return undefined;
      const elem = zeroOfArrayElement(type.elem, scope);
      if (!elem) return undefined;
      return { op: 'construct', type, args: Array.from({ length: type.size }, () => elem) };
    }
    case 'struct': {
      const decl = scope.structByName(type.name);
      if (!decl) return undefined;
      const args: Expr[] = [];
      for (const f of decl.fields) {
        const z = zeroOfArrayElement(f.type, scope);
        if (!z) return undefined;
        args.push(z);
      }
      return { op: 'construct', type, args };
    }
    default:
      return undefined;
  }
}

export function isNumericScalar(t: ShaderType): boolean {
  const k = typeKey(t);
  return k === 'f32' || k === 'i32' || k === 'u32';
}
