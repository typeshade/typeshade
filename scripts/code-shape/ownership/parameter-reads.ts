import ts from 'typescript';

export type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function isNameSlot(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  return 'name' in parent && parent.name === id;
}

function bindingMembers(pattern: ts.ObjectBindingPattern): string[] | undefined {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) return undefined;
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return undefined;
    names.push(key.text);
  }
  return names;
}

function memberOfUse(id: ts.Identifier): string[] | undefined {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) return [parent.name.text];
  if (ts.isElementAccessExpression(parent) && parent.expression === id) {
    const key = parent.argumentExpression;
    return ts.isStringLiteralLike(key) ? [key.text] : undefined;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === id &&
    ts.isObjectBindingPattern(parent.name)
  ) {
    return bindingMembers(parent.name);
  }
  return undefined;
}

function isOutside(declaration: ts.Declaration, fn: FunctionNode): boolean {
  const inside =
    declaration.getSourceFile() === fn.getSourceFile() &&
    declaration.pos >= fn.pos &&
    declaration.end <= fn.end;
  return !inside && !declaration.getSourceFile().isDeclarationFile;
}

export function membersReadOnly(
  checker: ts.TypeChecker,
  fn: FunctionNode,
  parameter: ts.ParameterDeclaration,
): string[] | undefined {
  const members = new Set<string>();
  let clean = true;
  let parameterSymbol: ts.Symbol | undefined;
  if (ts.isObjectBindingPattern(parameter.name)) {
    const names = bindingMembers(parameter.name);
    if (names === undefined) return undefined;
    names.forEach((name) => members.add(name));
  } else {
    parameterSymbol = checker.getSymbolAtLocation(parameter.name);
  }
  const reach = (id: ts.Identifier): void => {
    if (isNameSlot(id)) return;
    const symbol = ts.isShorthandPropertyAssignment(id.parent)
      ? checker.getShorthandAssignmentValueSymbol(id.parent)
      : checker.getSymbolAtLocation(id);
    if (symbol === undefined) return;
    if (symbol === parameterSymbol) {
      const used = memberOfUse(id);
      if (used === undefined) clean = false;
      else used.forEach((name) => members.add(name));
      return;
    }
    if (symbol.flags & ts.SymbolFlags.Alias) {
      clean = false;
      return;
    }
    if ((symbol.declarations ?? []).some((declaration) => isOutside(declaration, fn)))
      clean = false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) reach(node);
    else ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return clean && members.size > 0 ? [...members].sort() : undefined;
}
