import { refuse } from './refusal.js';
import {
  type Binding,
  importStatements,
  loadsValue,
  renderImport,
  renderKept,
  respecify,
  usageOf,
} from './import-bindings.js';
import type { SourceAnalysis } from './references.js';

export interface ImportPlan {
  readonly targetHeader: readonly string[];
  readonly sourceEdits: ReadonlyMap<number, readonly string[]>;
  readonly removed: readonly string[];
}

function stayingUsers(
  analysis: SourceAnalysis,
  moved: ReadonlySet<number>,
  bindings: readonly Binding[],
): string[] {
  const wanted = new Set(bindings.map((binding) => binding.decl));
  const users = analysis.imports
    .filter((use) => wanted.has(use.binding) && !moved.has(use.from))
    .map((use) => analysis.units[use.from]!.names.join(', ') || '(unnamed)');
  return [...new Set(users)];
}

export function planImports(
  analysis: SourceAnalysis,
  moved: ReadonlySet<number>,
  sourcePath: string,
  targetPath: string,
): ImportPlan {
  const staying = new Set(analysis.units.map((_, index) => index).filter((i) => !moved.has(i)));
  const movedUsage = usageOf(analysis, moved);
  const stayUsage = usageOf(analysis, staying);
  const targetHeader: string[] = [];
  const sourceEdits = new Map<number, readonly string[]>();
  const removed: string[] = [];
  for (const statement of importStatements(analysis.source)) {
    const needed = statement.bindings.filter((binding) => movedUsage.has(binding.decl));
    if (needed.length === 0) continue;
    if (statement.node.attributes !== undefined) {
      refuse(`${statement.specifier} is imported with attributes; the tool does not copy them`);
    }
    targetHeader.push(
      ...renderImport(needed, movedUsage, respecify(statement.specifier, sourcePath, targetPath)),
    );
    const kept = statement.bindings.filter(
      (binding) => !(movedUsage.has(binding.decl) && !stayUsage.has(binding.decl)),
    );
    const at = analysis.source.statements.indexOf(statement.node);
    if (kept.length === 0) {
      sourceEdits.set(at, []);
      removed.push(statement.node.getText(analysis.source));
      continue;
    }
    const stranded = kept.filter((binding) => !binding.typeOnly && stayUsage.has(binding.decl));
    if (stranded.length > 0 && !statement.typeOnly && !loadsValue(kept, stayUsage)) {
      refuse(
        `after the move the source uses ${stranded.map((b) => b.local).join(', ')} of ${statement.node.getText(analysis.source)} only as a type; the move-purity check refuses a value import used only as a type, and it refuses \`import type\` where the base has a value import (import flag changed)`,
        `The units of the source that still use it: ${stayingUsers(analysis, moved, stranded).join(', ')}.`,
        'Move those units too, or keep one value use of the import in the source.',
      );
    }
    if (kept.length !== statement.bindings.length) {
      sourceEdits.set(at, renderKept(statement, kept, statement.specifier));
    }
  }
  return { targetHeader, sourceEdits, removed };
}
