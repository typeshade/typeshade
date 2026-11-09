# The owner's decisions

This file records the decisions the owner (Seungup) made about what TypeShade is. Each entry
holds the owner's own words, the date, and what the decision means for the work. Every agent
and every person reads this file before any other document of this repository.

## Precedence

1. An entry here takes precedence over every other document of this repository, including
   `docs/language-design.md`, `docs/roadmap.md`, `docs/dx.md`, `AGENTS.md` and the proposals in
   `changes/`.
2. Where another document can be read against an entry, the entry holds, and the other document
   is the one to fix.
3. Only the owner adds, changes or removes an entry, in the conversation. An agent records the
   owner's words and the date in a pull request that changes this file only.
4. A proposal, a review finding or an agent's recommendation does not change an entry. A review
   finding that an entry makes costly is recorded as a cost of the entry. It is not a reason to
   choose otherwise.

## Entries

### OD-1. TypeShade is a language of its own that borrows TypeScript's syntax

- Date: 2026-11-09. The same idea opens `docs/language-design.md` §1.8: "TypeShade is a language
  of its own."
- The owner's words: "typeshade는 하나의 언어인데 … 언어예요. 라이브러리가 아니라"; "이미 use
  typeshade 지시어가 들어가고 자체 컴파일러도 가지고 있는데"; "타입스크립트 문법을 차용한거지
  그대로 쓰는 언어가 아니라니까요? vue, react도 똑같은데".
- What it means:
  - A `"use typeshade"` file is read by TypeShade's own compiler and language service.
  - Whether a TypeScript tool (`tsc`, prettier, typescript-eslint, esbuild, Bun, a bundler)
    accepts a form is not a criterion for the language.
  - Support for the language's own syntax in those tools is the project's work, as it is for
    Vue single-file components and JSX. It is never a reason to change the language.
  - "Ordinary TypeScript" (`docs/roadmap.md`) means TypeScript's way of writing. It does not mean
    that the TypeScript toolchain accepts the file.

### OD-2. An entry's stage is written `@vertex`, `@fragment` or `@compute`

- Date: 2026-11-09.
- The owner's words: "typeshade 예제가 지금 @vertex 이걸 vertex(…) 이렇게 바뀌었는데, 의도한게
  아닌데"; "vertex, fragment, compute 라는 고정 함수명을 쓰는게 이해가 안되는거예요"; "vertex
  fragment 도 그렇게 하라고 했는데".
- What it means: an entry point carries the language's own attribute, `@vertex`, `@fragment` or
  `@compute([…])`. A stage is not a call of a fixed function name (change 0111 D1), not a type of
  the return value, and not inferred from the signature.

### OD-3. The language stays small; the compiler's work is not pushed onto the author

- Date: 2026-11-09.
- The owner's words: "나는 가능한 이런 언어 레벨에서 계속 추가되는게 싫습니다. 인지적으로
  공부해야할게 계속 늘어나잖아요. 가능한 다 없애는게 맞아요. 컴파일러가 해야하는일인데, 왜 자꾸
  사용자에게 밀어붙이는건지".
- What it means:
  - A construct exists only for what the author must state and the compiler cannot know.
  - An optimization, a tuning parameter or a validation the compiler can satisfy by rewriting is
    the compiler's work.
  - A construct that the compiler could replace is removed (proposals 0131 and 0132 apply this
    to `numerics` and `diagnostic`).

### OD-4. Show the owner what changes before the owner decides

- Date: 2026-11-09.
- The owner's words: "결정하는거 지금 나한테 안보여주고 결정내려달라는게 말이 안되잖아. 알려줘야지
  내가 확인하지"; "또 어떻게 했는지 얘기도 안해주고 머지 승인 요청은 너무 그런데?".
- What it means: before the owner decides on a proposal or a merge, the agent shows what the
  change does, with one example before and after, and the options with their costs.
  `CLAUDE.md` (Merging) carries the procedure.

### OD-5. A parameter qualifier is written before the parameter, `@inout` or `@out`; an entry's I/O stays in the type

- Date: 2026-11-09.
- The owner's words: "inout, in, out 이런건 지금 앞에 따로 쓰는데 왜 타입으로 바꿔야해?". Asked
  which form holds for a parameter qualifier, the owner chose the form written before the
  parameter (`@inout a: f32`). Asked the same for an entry's I/O fields, the owner chose to keep
  the type form (`pos: builtin<"position", vec4>`, `uv: location<0, vec2>`).
- What it means:
  - A parameter that the function writes back to its caller is written `@inout a: f32` or
    `@out c: f32`. The type form `inout<T>` and `out<T>` of change 0111 D5 is not the
    language's form. Change 0111 D5 moved the qualifier into the type only so that a plain
    `tsc` accepts the file, which OD-1 rejects.
  - `in` is not written: every parameter is passed by value unless it carries `@inout` or
    `@out`.
  - An entry's built-in values and inter-stage values stay in the type: `builtin<…>` and
    `location<…>`.
  - Change 0130 adds a rule after Rule 1.7 that says a construct that describes a value that
    flows in or out, a parameter included, is part of its type. For a parameter qualifier this
    entry holds, and that rule text is fixed in its own pull request.
