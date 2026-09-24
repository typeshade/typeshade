# Traceability

This directory is the traceability tree of the design rules, kept with
[Doorstop](https://doorstop.readthedocs.io). Regulated software industries (DO-178C, ISO 26262)
keep their requirements the same way. Every requirement is an item with a content
fingerprint. Every item that depends on it records the fingerprint it was checked against.
When the requirement changes, the dependent item becomes _suspect_, and it stays suspect until
someone reads it and clears it.

| Document | Directory       | Items                                                                                                                                                                                                |
| -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RULE`   | `reqs/rules/`   | One per `**Rule N.M.**` of `docs/language-design.md`; `RULE-0201` is Rule 2.1. Its `references` are the files that verify it, each searched for the keyword `Rule N.M`.                              |
| `SURF`   | `reqs/surface/` | One per section of `docs/use-typeshade-surface.md` that a rule cites or that cites a rule; `SURF-013` is surface §13. It links to those rules, so a change to one of them makes the section suspect. |

**Never edit these files by hand.** `docs/language-design.md` stays the normative text, and
`bun run reqs:sync` (`scripts/reqs-sync.ts`) derives the items from it. The script keeps only
what Doorstop owns from the committed items: each item's `reviewed` fingerprint and each
link's stamp. `src/reqs.test.ts` fails when the items are stale.

## When you change a rule, a surface section, or a verifying test

1. Edit the Markdown or the test.
2. `bun run reqs:sync`
3. `doorstop -C` (install once with `pip install doorstop==3.2`). `-C` skips the warning for a
   rule no surface section explains; not every rule has one. Each flagged item is a step:
   - `RULE-xxxx: unreviewed changes`: the rule's text or its verifying files changed. Check that
     each file in its `references` and `evidence` still verifies what the rule now says. Then
     run `doorstop review RULE-xxxx`.
   - `SURF-nnn: suspect link: RULE-xxxx`: a rule this surface section explains has changed. Read
     the section and bring it in line with the rule. Then run `doorstop clear SURF-nnn`.
   - `external reference not found`: a verifying file is gone, or no longer names the rule.
     Restore the `Verifies: Rule N.M` tag or name the right file in the rule's "Enforced by".
4. Commit the items together with the change. CI's traceability job runs `doorstop -C -e`, so a
   suspect link or an unreviewed item fails the pull request.

Running `doorstop review` or `doorstop clear` records that you read the item. It is the
traceability equivalent of a signature, so never run either one without reading the item.

## How a rule is verified

`verification` in each `RULE` item is one of four values:

- `test`: a test, a gate script or a CI workflow checks the rule. A file named in "Enforced by"
  counts, and so does any file carrying a `Verifies: Rule N.M` tag, which is how a test states
  its end of the link. An author-facing `*.shade.ts` example carries no tag; the suite that
  compiles it (`examples/shade-examples.test.ts`) stands in for it.
- `code`: only the implementation the rule names carries it out (an `Implements: Rule N.M`
  tag), and no test checks it yet. Each one is a gap for a test to close.
- `pending`: Appendix B lists the rule as not yet enforced.
- `review`: its "Enforced by" says review holds it. An "Enforced by" that opens with "review"
  is `review` even when it names a file, since the file is what review reads (Rule 3.7's
  `codes.ts`), unless a test verifies the rule.

A rule that fits none of the four fails `reqs:sync`.

Doorstop cannot see hidden paths (`.github/`) or any path containing a word from `.gitignore`
(`coverage/` hides `intrinsic-coverage.test.ts`). A verifying file it cannot see is listed
under `evidence` instead of `references`, and `src/reqs.test.ts` checks its keyword.

## The matrix

`doorstop publish all <dir>` writes the documents and `traceability.csv` /
`traceability.html`. CI uploads that output as the `traceability` artifact of every run.
