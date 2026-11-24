// The symbol-anchor form of an evidence segment.
//
//   path#Symbol                  a top-level declaration
//   path#Class.method            a member: class, interface, enum, type literal, or the keys of a
//                                top-level `const` whose initializer is an object literal
//   path#Symbol~"needle"         the declaration (or member) whose text holds the literal needle
//   path#"title"                 a `.test.ts` file only: the first `describe`, `it` or `test` call
//                                whose title holds the needle
//
// Several anchors share one path, joined by `|` with no space: `path#A|B.c~"x"`. The `|` cannot
// occur in an identifier, and a needle cannot hold it either, nor `"`. A needle cannot hold the
// segment separator `; ` because the evidence string is cut there first.

export interface Anchor {
  readonly symbol?: string;
  readonly member?: string;
  readonly needle?: string;
  readonly text: string;
}

export type AnchorParse =
  | { readonly ok: true; readonly anchors: readonly Anchor[]; readonly length: number }
  | { readonly ok: false; readonly message: string };

export const ANCHOR_MARK = '#';
export const ANCHOR_SEPARATOR = '|';

const NAME = '[A-Za-z_$][\\w$]*';
const NEEDLE = '"[^"|]+"';
const ANCHOR = new RegExp(`^(?:(${NAME})(?:\\.(${NAME}))?(?:~(${NEEDLE}))?|(${NEEDLE}))`);

export function parseAnchors(text: string): AnchorParse {
  const anchors: Anchor[] = [];
  let at = 0;
  for (;;) {
    const found = ANCHOR.exec(text.slice(at));
    if (!found) {
      return {
        ok: false,
        message: `anchor ${anchors.length + 1} does not follow the anchor grammar: "${text.slice(at)}"`,
      };
    }
    const [whole, symbol, member, needle, title] = found;
    const quoted = needle ?? title;
    anchors.push({
      text: whole,
      ...(symbol === undefined ? {} : { symbol }),
      ...(member === undefined ? {} : { member }),
      ...(quoted === undefined ? {} : { needle: quoted.slice(1, -1) }),
    });
    at += whole.length;
    if (text[at] !== ANCHOR_SEPARATOR) return { ok: true, anchors, length: at };
    at += 1;
  }
}

export const isTestPath = (path: string): boolean => path.endsWith('.test.ts');
