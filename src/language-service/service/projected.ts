import { mapToOriginal, type ProjectionLookup } from '../projection.js';
import type { TypeshadePosition } from '../types.js';
import type { TypeshadeLanguageService } from './types.js';

export function projected(
  inner: TypeshadeLanguageService,
  lookup: ProjectionLookup,
): TypeshadeLanguageService {
  const into = (uri: string, position: TypeshadePosition): TypeshadePosition =>
    lookup(uri)?.toProjectedPosition(position) ?? position;
  const back = <T>(uri: string, value: T): T => mapToOriginal(value, uri, lookup);
  return {
    openDocument: (uri, text, version) => inner.openDocument(uri, text, version),
    updateDocument: (uri, text, version) => inner.updateDocument(uri, text, version),
    closeDocument: (uri) => inner.closeDocument(uri),
    getDiagnostics: (uri) => back(uri, inner.getDiagnostics(uri)),
    getCompletions: (uri, position) => back(uri, inner.getCompletions(uri, into(uri, position))),
    getHover: (uri, position) => back(uri, inner.getHover(uri, into(uri, position))),
    getDefinition: (uri, position) => back(uri, inner.getDefinition(uri, into(uri, position))),
    getReferences: (uri, position, options) =>
      back(uri, inner.getReferences(uri, into(uri, position), options)),
    getDocumentSymbols: (uri) => back(uri, inner.getDocumentSymbols(uri)),
    getSignatureHelp: (uri, position) =>
      back(uri, inner.getSignatureHelp(uri, into(uri, position))),
    prepareRename: (uri, position) => back(uri, inner.prepareRename(uri, into(uri, position))),
    rename: (uri, position, newName) => {
      const edits = inner.rename(uri, into(uri, position), newName);
      return Object.fromEntries(Object.entries(edits).map(([u, list]) => [u, back(u, list)]));
    },
    getSemanticTokens: (uri, range) => {
      const tokens = inner.getSemanticTokens(
        uri,
        range && { start: into(uri, range.start), end: into(uri, range.end) },
      );
      const projection = lookup(uri);
      const written = projection ? tokens.filter((t) => !projection.isInserted(t)) : tokens;
      return back(uri, written);
    },
    getCompiledOutput: (uri, target) => back(uri, inner.getCompiledOutput(uri, target)),
    positionAt: (uri, offset) =>
      lookup(uri)?.originalPositionAt(offset) ?? inner.positionAt(uri, offset),
    offsetAt: (uri, position) =>
      lookup(uri)?.originalOffsetAt(position) ?? inner.offsetAt(uri, position),
  };
}
