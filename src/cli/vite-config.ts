// Edit only a static Vite plugin list; never execute a project's configuration (0085).
import ts from 'typescript';
import { appendList } from './config-edit.js';

function unwrapped(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

function nameOf(node: ts.Expression): string | undefined {
  node = unwrapped(node);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const object = nameOf(node.expression);
    if (object) return `${object}.${node.name.text}`;
  }
  return undefined;
}

/** Add the plugin to a static default configuration, preserving every other source range. */
export function configureVite(file: string, text: string): string {
  const diagnostics = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).diagnostics;
  if (diagnostics?.length) throw new Error(`${file}: fix its syntax before running tshc init.`);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  let plugin: string | undefined;
  const define = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (statement.importClause?.isTypeOnly || !bindings) continue;
    const module = statement.moduleSpecifier.text;
    if (ts.isNamespaceImport(bindings)) {
      if (module === 'typeshade/vite') plugin = `${bindings.name.text}.typeshade`;
      if (module === 'vite') define.add(`${bindings.name.text}.defineConfig`);
    } else
      for (const specifier of bindings.elements) {
        if (specifier.isTypeOnly) continue;
        const original = (specifier.propertyName ?? specifier.name).text;
        if (module === 'typeshade/vite' && original === 'typeshade') plugin = specifier.name.text;
        if (module === 'vite' && original === 'defineConfig') define.add(specifier.name.text);
      }
  }
  const defaults = source.statements.filter(ts.isExportAssignment);
  if (defaults.length !== 1 || defaults[0]!.isExportEquals)
    throw new Error(`${file}: tshc init needs one static default Vite configuration.`);
  let object = unwrapped(defaults[0]!.expression);
  if (
    ts.isCallExpression(object) &&
    define.has(nameOf(object.expression) ?? '') &&
    object.arguments.length === 1
  )
    object = unwrapped(object.arguments[0]!);
  if (!ts.isObjectLiteralExpression(object))
    throw new Error(
      `${file}: use a static default object or defineConfig({ ... }) before running tshc init.`,
    );
  const properties = new Map<string, ts.PropertyAssignment>();
  for (const p of object.properties) {
    if (!ts.isPropertyAssignment(p) || (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name)))
      throw new Error(
        `${file}: tshc init cannot verify spreads or computed configuration properties. Configure typeshade() manually.`,
      );
    if (properties.has(p.name.text))
      throw new Error(`${file}: duplicate property ${JSON.stringify(p.name.text)}.`);
    properties.set(p.name.text, p);
  }
  const plugins = properties.get('plugins');
  const array = plugins ? unwrapped(plugins.initializer) : undefined;
  if (array && !ts.isArrayLiteralExpression(array))
    throw new Error(`${file}: plugins must be a literal array before running tshc init.`);
  if (
    array &&
    ts.isArrayLiteralExpression(array) &&
    plugin &&
    array.elements.some((entry) => {
      if (ts.isSpreadElement(entry)) return false;
      const call = unwrapped(entry);
      return ts.isCallExpression(call) && nameOf(call.expression) === plugin;
    })
  )
    return text;
  if (array && ts.isArrayLiteralExpression(array) && array.elements.some(ts.isSpreadElement))
    throw new Error(
      `${file}: tshc init cannot verify a spread plugin list. Configure typeshade() manually.`,
    );
  const needsImport = plugin === undefined;
  if (!plugin) {
    plugin = 'typeshade';
    for (let i = 1; names.has(plugin); i++) plugin = `typeshadePlugin${i}`;
  }
  let changed =
    array && ts.isArrayLiteralExpression(array)
      ? appendList(text, array, source, `${plugin}()`)
      : appendList(text, object, source, `plugins: [${plugin}()]`);
  if (needsImport) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const at = source.statements[0]!.getStart(source);
    changed =
      changed.slice(0, at) +
      `import { typeshade${plugin === 'typeshade' ? '' : ` as ${plugin}`} } from 'typeshade/vite';${eol}` +
      changed.slice(at);
  }
  return changed;
}
