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

### OD-5. An object is passed as JavaScript passes it, with no qualifier; an entry's I/O stays in the type

- Date: 2026-11-09 for the entry's I/O. 2026-11-16 for a parameter, which replaces what the entry
  said on 2026-11-09 (below).
- The owner's words, 2026-11-16: "ps는 old next 아닌 레퍼런스로 받는 개념이 아닌가? 복사로 받아..?
  왜? 배열은 기본적으로 포인터아닌가"; "룰 8.8을 바꿔야겠는데요. Object는 모두 레퍼런스 바이 벨류
  형식으로 가도록? In/out를 없애고 아에 언어 수준에서 자체적으로 포인터를 처리할까요". Shown the
  seven points of proposal 0142 with a recommended answer for each, the owner answered
  "진행하세요".
- What it means:
  - A struct, an instance of a class and an array behave as a JavaScript object does: a function
    that writes its parameter changes the caller's object. A number, a `bool`, a vector and a
    matrix are values.
  - The author writes no `@inout` and no `@out`. The compiler finds which parameters a function
    writes and passes them as the target needs (OD-3, OD-9).
  - A program never runs with a meaning JavaScript would not give it. A form the compiler does
    not implement yet is refused, and the diagnostic says so (OD-9).
  - Proposal 0142 carries the rule text and the stages. Until its first stage is implemented,
    the compiler still reads `@inout` and `@out`, and `docs/language-design.md` still describes
    them; that is the proposal's work, and no reason to keep the qualifiers.
  - An entry's built-in values and inter-stage values stay in the type: `builtin<…>` and
    `location<…>`.
  - Scope, decided 2026-11-09: asked whether this entry also requires every inter-stage value to
    write `location<…>`, the owner chose "생략 허용 (A)". An input or output with no attribute
    (`uv: vec2`) is allowed, and `location<n, T>` stays for a fixed number or an option.
- Replaced, 2026-11-09 to 2026-11-16: the owner's words then were "inout, in, out 이런건 지금 앞에
  따로 쓰는데 왜 타입으로 바꿔야해?", and the entry said that a parameter the function writes back
  to its caller is written `@inout a: f32` or `@out c: f32` before the parameter, not as a type
  (`inout<T>`, change 0111 D4), and that every other parameter is a value. The choice of the
  written form over the type form no longer has a subject: there is no qualifier to place.
- Cost recorded: a call does not show whether it changes its argument, as in JavaScript. `@out`'s
  promise "written whole" is gone, so the compiler must infer where an upload can be skipped.
- Open: `@inout` on a number or a vector (`@inout a: f32`) let a function write a caller's value
  that is no object. JavaScript has no such form. Proposal 0142 must say what replaces it before
  it is accepted.

### OD-6. Nothing is released yet: the bundled builds were tests

- Date: 2026-11-09.
- The owner's words: "아직 정식 릴리즈 전이라 문제 없음 테스트용으로 한것뿐이라". The owner said this when
  asked whether the two published builds that bundle the compiler, vscode-typeshade 0.3.0 on the
  Marketplace and `@typeshade/mcp` 0.1.0 and 0.1.1 on npm, count as releases for Rule 13.10.
- What it means:
  - TypeShade has no official release yet. The `typeshade` package on npm holds only the
    placeholder `0.0.0`.
  - The bundled builds were for testing. A change of meaning or a refusal owes no warning release
    because of them (Rules 13.9 and 13.10).
  - The `## [0.1.0]` heading of `CHANGELOG.md` does not make a release.

### OD-7. A number's type is inferred from its uses; there is no default type to learn

- Date: 2026-11-09.
- The owner's words: "자동추론으로", confirmed as: the compiler infers a number's type from every
  place it reaches (a function's result from the places that call it, a value passed on from the
  place that receives it), and where nothing decides, the compiler chooses without asking the
  author. Asked whether to record this as an entry, the owner said "기록".
- What it means:
  - An author writes a number as a number. The compiler gives it the type its uses need.
  - No default type is part of the language for an author to learn. Where no use decides, the
    compiler's choice is `f32` (the owner's choice, 2026-11-09, proposal 0134 question 5).
  - A value that one use makes an integer and that `/` divides is refused, not silently divided
    as integers (the owner's choice, 2026-11-09, proposal 0134 question 6).
  - Proposal 0134 records the full design.

### OD-8. A `"use typeshade"` file can carry a decorator that a library declares

- Date: 2026-11-11. The owner said this in the session that designs the game engine of
  `typeshade/radiance`, after the agent showed that the compiler refuses `@entity` and `@system`
  in a `"use typeshade"` file with `TS8028`.
- The owner's words: "use typeshade 안에서도 radiance import해서 사용한다거나 extends 한다거나, 뭐
  추가 데코레이터를 지원한다거나.."; "shade.ts 안에 커스텀 데코레이터 지원도 추가되어야할 것
  같습니다. 확실히 좋은 방향으로 만드려면"; "앞으로 당신이 만든 자체 엔진이 강력해지려면".
- What it means:
  - The language is to accept a decorator that is not one of the compiler's own attributes, when
    a library declares it. Rule 6.7 says today that a decorator outside its list must be
    refused. A proposal changes that rule before any code changes.
  - The compiler learns no name of a library. A name such as `entity` or `system` belongs to the
    library that declares it (`docs/dx.md`, principle 7). A decorator that nothing declares is
    still refused.
  - The owner has not yet said what a declared decorator does. The agent showed two readings on
    2026-11-11: the compiler records the decorator and reports it to a tool, or the compiler
    runs it to change the code. The proposal shows both with their costs against OD-3, and the
    owner decides there.

### OD-9. A TypeShade program need not translate one-to-one into a target language

- Date: 2026-11-16. The owner said this while the agent explained which forms of a reference to
  an object WGSL can express (proposal 0142, in draft).
- The owner's words: "제가 얘기하고 싶은건 typeshade로 작성된 코드가 1:1로 다른 언어로 번역될
  필요가 없다는거예요."; "어차피 컴파일러 수준에서 결정 가능하지 않나? 언어가 불가능인게 아니라
  구현부가 없어서 현재로써 안되는건 아니고?"; "아니 어차피 컴파일되면 힙이고 뭐고 필요없지
  않아?". The agent wrote the meaning below and asked whether it was right; the owner answered
  "네 맞아요".
- What it means:
  - TypeShade says what a program means. WGSL, GLSL and the CPU code are what the compiler
    produces from it.
  - That a target language has no construct for a form is not a reason for the language to
    refuse the form. The compiler rewrites it: more than one copy of a function, a struct taken
    apart, a tag and a branch, or any other code with the same result.
  - A form is refused for one of two reasons only. The compiler does not implement it yet, and
    the diagnostic says so. Or no compilation can give it its meaning.
  - Cost recorded: the emitted code does not have to look like the source, so the size of the
    emit and the debugging of it are the compiler's work.
