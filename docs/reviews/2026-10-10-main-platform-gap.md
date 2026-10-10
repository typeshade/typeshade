# TypeShade `main` 구현·로드맵 대조 및 후속 작업 지도 (2026-10-10)

> Status: **source-backed audit / proposed prioritization**, not an approved API change or delivery plan.
>
> Review baseline: [`fa8ac7fbaa1ca4e1aec12aa93ed8d6580c08d258`](https://github.com/typeshade/typeshade/commit/fa8ac7fbaa1ca4e1aec12aa93ed8d6580c08d258), `main` as inspected 2026-10-10 (Asia/Seoul).
>
> Strategy record: [General-purpose compute platform](../strategy/2026-10-10-general-compute-platform.md)
>
> **방법·한계:** GitHub의 실제 소스, 명세, 문서, 승인 상태, 관련 이슈와 테스트 코드를 확인한 정적 대조입니다. 별도의 로컬 빌드·브라우저/GPU 런타임 테스트나 성능 측정은 실행하지 않았습니다. `main`의 코드 존재는 해당 기능의 모든 경계 조건/성능 요구가 검증되었다는 의미가 아닙니다. 이 문서의 시점 이후 변경은 반영되지 않습니다.

**English summary.** The compiler, TypeScript surface, WebGPU/WebGL2 lowering, CPU oracle, host integration, resource residency, program runtime and significant autodiff machinery are real. The old 0–22 phase plan is stale in several key areas. There is no complete cross-operation execution graph, standalone Node build/loader workflow, WASM/CUDA/Python backend, general GPU profiling or caller-facing auto-differential verification loop. Accepted design records must not be conflated with full implementation.

## 1. 구현 상태 판정 방식

- **구현:** 해당 기능을 제공하는 실제 코드와 호출 경로가 존재. 범위와 제약을 함께 기록.
- **부분:** 중심 기능은 존재하지만 전체 사용자 시나리오 또는 연결 계층이 남음.
- **초안/설계:** 이슈 또는 `changes/` 문서만 존재하거나 승인되었어도 구현 일부가 남음.
- **미구현/확인 안 됨:** 해당 타깃·공개 기능을 제공하는 실제 코드 경로가 이 기준 커밋에서 확인되지 않음.
- **문서 불일치:** 문서의 진행 상태가 최신 소스·변경 제안·테스트보다 오래됨.

수치적 '완성도 80%' 같은 추정치를 사용하지 않습니다. 기능별로 **실제 실행 가능성과 누락된 계약을 따로** 관리합니다.

## 2. 주요 능력별 `main` 감사

| 요구 능력 | 실제 구현 근거 | 판단 및 제한 |
| --- | --- | --- |
| TypeScript → IR | `src/compiler/ts/`, `src/core/ir/nodes.ts` | **구현**. TS 문법 중 명시적으로 지원된 부분의 TypeShade 의미 |
| Typed IR·Source Span | `src/core/ir/`, `src/compiler/ts/` | **구현**. 다만 범용 계산/실행 IR이 따로 완성된 것은 아님 |
| WGSL, GLSL ES 3.00 | `src/core/backend.ts`, `src/core/backends/` | **구현**. Capability별로 Native/Lowered/Unsupported |
| CPU 참조 실행 | `src/core/debug/`, `src/core/cpu-codegen.ts` | **구현**. f64 oracle과 f32 호출 계층의 의미 구분 필요 |
| 정적 최적화 | `src/core/passes/opt/`, `src/core/measure.ts` | **구현**. DCE·CSE·GVN·LICM 및 연산량 보고 등; 실제 GPU 성능 측정과 다름 |
| Function Effects | `src/core/passes/effects.ts` | **구현**. 함수가 접근·변경하는 대상 분석의 기반 |
| 자동 병렬 루프 | `src/core/passes/parallel-loop.ts`, `src/core/passes/kernel-lower.ts` | **구현/제약**. 증명 가능한 루프와 Reduction/Scatter 패턴; 임의 루프의 자동 병렬화는 아님 |
| Host Import | `src/compiler/ts/host-face.ts`, `src/vite.ts` | **구현**. Vite 변환, 생성된 호스트 관점, TypeScript 타입 |
| Resident | `src/core/resident.ts` | **구현**. `read/write/destroy`, 호출 순서; 부분 갱신은 별도 초안 |
| Program Runtime | `src/runtime/runtime.ts`, `src/runtime/program.ts` | **구현**. Pack/Load, Compute/Render, Frame, Resource, Cache |
| WebGL2 Compute | `src/core/gl-compute.ts`, `src/runtime/gl.ts`, `src/core/passes/phase-split.ts` | **구현/제약**. `0054` 방식의 Phased Execution/Lowering. Native WGSL Compute와 동급 성능 주장은 불가 |
| Forward AD | `src/core/passes/grad.ts` | **구현**. 함수 단위 IR 변환 |
| Reverse AD | `src/core/passes/grad-reverse.ts` | **부분**. 함수 단위 VJP 및 Checkpointing; Storage/Kernel/Manifest 전체 파이프라인은 추가 필요 |
| Grad Check | `src/core/passes/grad-check.ts` | **구현**. Forward/Reverse에 대한 수치 미분 비교 |
| Determinism Report | `src/core/passes/determinism.ts` | **구현**. 드라이버별 차이 가능 연산 보고 |
| Portable IR / Manifest | `src/core/ir/portable.ts`, `src/core/manifest-types.ts` | **구현/제약**. Version-bound IR; `Pack` ABI가 모두 안정화된 것은 아님 |
| Node.js 독립 GPU 빌드 | `src/cli/run.ts`, `src/vite.ts` | **미완성**. `tshc check/sync`는 있으나 독립 `tshc build`/Node loader는 없음 |
| WASM 실행 Tier | `src/core/tiers.ts`, `changes/0042-wasm-tier.md` | **초안**. 현재 Tier는 `webgpu, webgl2, cpu` |
| CUDA 컴파일·실행 | 기존 Backend/Runtime 소스 | **미구현**. PTX/CUDA 네이티브 경로 없음 |
| Python 소스/호스트 | 현행 공개 기능 | **미구현**. 참조 Python 코드 생성 및 바인딩 별도 설계 필요 |
| 다중 호출 Execution Graph | `docs/use-typeshade-plan.md` Phase 18; 현행 `kernelQueue` | **미구현**. 함수 간 자동 Fusion/메모리 Live Range까지 담당하는 그래프 없음 |
| 자동 자원 Subrange 갱신 | `changes/0048-partial-buffer-write.md` | **초안**. `Resident.write(part, { offset })` 미제공 |
| GPU Timestamp/Profiler | [#542](https://github.com/typeshade/typeshade/issues/542), `src/runtime/` | **미구현**. Runtime의 GPU 타임스탬프 API 부재 |
| Caller-facing Explain/Verify | `docs/dx.md` X4, 로드맵 Item 19 | **미구현/부분 기반**. 내부 분석·진단·테스트는 존재 |

### 소스 수준에서 확인해야 할 중요한 미세 차이

**호출 순서와 Execution Graph는 다릅니다.** `src/core/resident.ts`의 `kernelQueue`는 이전 Promise를 완료시킨 다음 다음 호출을 실행합니다. 이는 순서·오류 처리 계약에는 유용하지만 독립 작업의 병렬 실행, 임시 자원 Live Range, 일반 커널 Fusion까지 의미하지 않습니다.

**WebGL2의 계산 능력을 과소평가하면 안 됩니다.** 현행 `src/runtime/gl.ts`와 `Pack.gl.computes`, `src/core/gl-compute.ts`는 0054의 단계형 계산을 지원합니다. 여전히 타깃별 기능 제한, 비용, 정확성을 명시해야 합니다.

**Reverse-mode는 실제로 일부 구현됐지만 제안 전체가 아닙니다.** 현재 `gradReverse`는 함수를 찾아 `f32` 스칼라·벡터·행렬의 매개변수에 대한 VJP를 만듭니다. `PackOptions`(`src/core/manifest.ts`)와 `Pack`(`src/core/manifest-types.ts`)에는 0056이 제안한 derivative 프로그램 삽입·런타임 실행 메타데이터가 보이지 않습니다. 따라서 제안서의 Storage Array/Compute Entry/Manifest 경로 전체를 Shipped로 표기하면 안 됩니다.

**Portable IR은 안정된 외부 ABI가 아닙니다.** `src/core/ir/portable.ts`의 설명대로 기록한 컴파일러 버전에서만 읽으며, Span 보존도 일부 종류에 한정됩니다. 향후 타깃 확장과 소스 수준 프로파일링을 진행할 때 별도 계약이 필요합니다.

## 3. 두 기존 로드맵의 날짜·용도·불일치

| 문서 | 역할 | 정확한 해석 |
| --- | --- | --- |
| [`docs/roadmap.md`](../roadmap.md) | 기존 `1.0.0` 목표 및 0.2~0.8 단계 | 기존의 우선순위/설계 결정 보존. 주석의 `Shipped`와 실제 구현 코드를 함께 확인 |
| [`docs/use-typeshade-plan.md`](../use-typeshade-plan.md) | TS Frontend Phase 0–22 역사적 실행 계획 | 일부 Phase 체크박스/설명이 현재 구현보다 오래됨 |
| [`docs/dx.md`](../dx.md) | 제품 UX 목표와 테스트할 Bar | 목적과 원칙은 유효. 목표 코드·현행 코드 구분 |
| [`docs/runtime-architecture.md`](../runtime-architecture.md) | 설계 방향 기록 | 'Runtime 없음', '일반 Host Import 없음' 등의 현행 상태 설명은 오래됨 |

### 0.2~0.8 기존 목표 vs 실제

| 기존 로드맵 | 실제로 확인한 범위 | 남은 질문 |
| --- | --- | --- |
| 0.2 Compute Complete | Atomics, Workgroup, Barrier, Shader Console 등 구현 | 타깃별 변환/정확성 |
| 0.3 TS Surface | `enum`, 클래스, 상속, Generics, Closure 등 지원 | 비지원 TS 형태의 설명과 일관성 |
| 0.4 Textures | Storage/Depth/Cube/3D 등 폭넓게 지원 | GLSL 타깃별 제약 |
| 0.5 Parallel Loop & Host Import | Kernel Proof, HostFace, Vite, Resident, Compute/Fragment Calls 구현 | 빌드·배포·호출 안정성 |
| 0.6 CPU/GPU Boundary | 런타임 호출·배열 전달·Residency 존재 | B1~B3 보류, B4~B7 열림, 전체 경계 그래프 미완 |
| 0.7 Derivatives & Verification | Forward AD, 함수 Reverse AD, GradCheck, Determinism 존재 | Storage/Entry/Manifest 확장, Caller-facing Divergence |
| DX X1~X6 | npm Package Journey, CPU Tier, Kernel Host Import 등 일부 도달 | X4 `explain`, 전반적 Cross-target dev 검증 |
| 0.8 Freeze | 공개 API 표면과 Schema 존재 | 지속적 안정화, 호환성·릴리스 정책 |

### Phase 0–22 문서에서 갱신해야 할 부분

- **Phase 16 ('Kernel not started')**: 현재 자동 Parallel Loop 및 `kernel-lower.ts` 구현이 존재합니다. 별도 `@kernel` 구문을 추가한다는 뜻은 아닙니다.
- **Phase 17 ('Host boundary not started')**: 현재 `host-face.ts`, `resident.ts`, `host-kernel.ts`, `host-compute.ts`가 있습니다. 남은 문제는 외부화·메모리·호스트 경계 확장입니다.
- **Phase 18 ('Execution graph not started')**: 일반적인 Cross-call Plan은 여전히 독립적인 미완성 작업으로 분류하는 것이 맞습니다.
- **Phase 19 ('Optimization partial')**: 이미 상당한 IR 최적화가 있으며 Fusion/Buffer Lifetime 등 프로그램 간 최적화는 별도로 남습니다.
- **Phase 20 ('Runtime not started')**: `createRuntime`, WebGPU/WebGL2 Program Runtime 등이 존재합니다. 핵심 미완성은 범용 Node 호스팅, 다중 타깃, 실행 계획 통합입니다.
- **Phase 21 ('Verification partial')**: Oracle·CPU Stepper·GradCheck·Determinism은 존재합니다. 자동 GPU Divergence 리포트와 전체 실행 분석은 별도입니다.
- **Phase 22 ('Tooling partial')**: `tshc check`, `tshc sync`, Vite, Language Service 존재. `build/inspect/profile/explain` 전체 기능은 구현되지 않았습니다.

기존 문서의 상태 수정은 원 계획이 '완료'되었다고 무조건 표시하는 방식이 아니라 **현재 구현된 범위와 원래 기대했던 최종 수준을 나누는 방식**이 필요합니다.

## 4. 변경 제안의 승인 상태 vs 구현 상태

| 제안 | 현재 설계 상태 | 구현 상태/다음 조치 |
| --- | --- | --- |
| [0042 WASM Tier](../../changes/0042-wasm-tier.md) | `draft` | 런타임 Tier/Codegen 추가 전 |
| [0048 Resident 부분 쓰기](../../changes/0048-partial-buffer-write.md) | `draft` | 실제 부분 갱신 API 추가 전 |
| [0054 WebGL2 Compute](../../changes/0054-webgl2-compute.md) | `accepted`, 추가 amendment 기록 확인 필요 | `gl-compute.ts` 및 `runtime/gl.ts` 등 실제 구현 존재 |
| [0056 Reverse AD](../../changes/0056-reverse-mode-grad.md) | `accepted` | 함수 VJP는 존재; 전체 Storage/Compute/Manifest 연계는 미완료. HEAD `fa8ac7f`는 GPU Scatter 임계 크기에 대한 **문서 amendment** |
| [#97 CPU/GPU Boundary](https://github.com/typeshade/typeshade/issues/97) | 설계 이슈 open | 부분 구현과 향후 Dependency Graph 구분 |
| [#198 One File / B1–B3](https://github.com/typeshade/typeshade/issues/198) | **Deferred** | 기존 Two-file Host Import가 제품 경로. 재추진에 새 결정 필요 |
| [#204 Multi-pass](https://github.com/typeshade/typeshade/issues/204), [#335 One Stack](https://github.com/typeshade/typeshade/issues/335) | 설계 이슈 open | 실제 Runtime 예제·프레임 지원이 일부 목표를 충족. 원 이슈를 자동 완료 처리하지 않음 |
| [#459 WASM](https://github.com/typeshade/typeshade/issues/459) | 설계 이슈 open | 별도 구현 단계 |
| [#535 Reverse AD](https://github.com/typeshade/typeshade/issues/535) | open | 대형 Store/Compute 역전파 및 파이프라인 계약 검증 |
| [#539 Stable Sort](https://github.com/typeshade/typeshade/issues/539) | open | GPU/CPU 공통 Sorting Kernel/Package 설계 필요 |
| [#542 GPU Timing](https://github.com/typeshade/typeshade/issues/542) | open | Timestamp Query·관측 API 필요 |

**HEAD 주의:** `fa8ac7f`의 메시지는 GPU Scatter의 Scratch가 장치 버퍼 크기를 넘을 때 다음 Tier로 실행을 넘기기로 한 **0056 설계 문서의 수정**입니다. 이를 근거로 GPU Scatter 최적화 자체나 전체 Reverse AD 경로가 이미 구현되었다고 표기하지 않습니다.

## 5. 현재 구현의 보존 우선순위

새 설계 시 반드시 재사용할 기반:

1. `src/core/ir/`의 타입/함수·Expression 모델 및 `declRef`.
2. `src/core/backend.ts`의 Capability/Target Lowering 계약.
3. `src/core/passes/effects.ts`, `parallel-loop.ts`의 분석 사실과 거부 근거.
4. `src/core/cpu-codegen.ts`, `debug/`, `grad-check.ts`의 참조 실행·검증.
5. `src/compiler/ts/host-face.ts`와 `src/vite.ts`의 일반 Host Import.
6. `src/core/resident.ts`, `src/runtime/`의 기존 Resource·Runtime 경계.
7. `src/core/manifest-types.ts` 및 `src/core/ir/portable.ts`의 빌드/런타임 분리.

새 Execution Plan이 생겨도 ***기존 IR을 다시 한 번 복제하는 독립 DSL***로 만들지 않습니다. Program/Function 참조와 자원 의존성만 추가한 얇은 층부터 시작합니다.

## 6. 권장 작업 목록과 측정 가능한 완료 기준

### P0 — 로드맵과 구현 사실 동기화 (문서)

- `use-typeshade-plan.md`의 Phase 16/17/20을 실제 구현 범위로 갱신합니다.
- `roadmap.md`의 0.7 Item 20 및 'Reverse-mode after 1.0'을 기존 결정·변경 제안과 재대조합니다.
- 각 `Shipped`에 API, Test/Journey, 지원 타깃, 후속 제한을 연결합니다.
- 변경 제안의 `accepted`, `implemented`, downstream 상태를 각각 표시합니다.

**통과 조건:** 과거 설계 문서의 단순 상태를 근거로 동일 기능에 대한 중복 작업을 열지 않아도 됨.

### P1 — 일반 TS 호스트 통합과 Node 실행

- Vite와 별개로 컴파일된 Package/Node Host 경로 정의 (예: `tshc build` 제안).
- Host Call Async/Mutation/Fallback 타입 계약을 Freeze 대상으로 관리.
- Node GPU는 주입된 GPUDevice 실행 테스트부터. Native Provider/배포는 명시적 설계.
- 생성된 Manifest·JS·타입 선언에서 소비자가 Compiler를 로드하지 않는 분리 유지.

**통과 조건:** 동일 `.shade.ts` 라이브러리를 실제 Node GPU 환경과 브라우저에서 호출·검증.

### P2 — GPU 메모리와 리소스 상호운용성

- 0048의 부분 쓰기 결정·구현·회귀 테스트.
- Buffer/Texture Read/Write/Ownership/Device/View Contract 정립.
- Compute→Render와 다른 함수가 같은 Resident를 사용할 때 복사와 동기화 추적.
- 호출 시점과 Readback/실패 처리의 계약 명문화.

**통과 조건:** GPU에 생성된 중간 결과를 GPU에서 계속 소비하고, 오류·복사 수를 측정할 수 있음.

### P3 — Plan 및 함수 간 최적화

- Compiler에서 Access/Effect Summary를 내보내되 기존 IR 스키마를 불필요하게 확장하지 않음.
- 작고 명시적인 Operation DAG를 프로토타입으로 작성.
- Queue/Pass Submit 묶기, Temporary Buffer Lifetime부터 검증.
- Fusion은 더 늦게, CPU Oracle 일치·GPU 실측 개선이 있는 패턴부터.

**통과 조건:** 호출 3~5개짜리 실제 Pipeline에서 중간 Copy/Submit 감소와 오차·시간 비교 기록.

### P4 — CPU/WASM, Native/CUDA, Python

- [0042](../../changes/0042-wasm-tier.md) 근거로 WASM 실행 의미와 Binary/Host ABI 먼저 설계.
- CUDA는 CPU Oracle과 동일한 연산 의미를 매핑할 수 있는 작은 GPU Kernel부터.
- Python은 (A) 읽을 수 있는 Source Export, (B) 컴파일된 실행 모듈의 Python Binding을 분리.
- 어느 타깃에서도 실행할 수 없는 Feature는 Diagnostic과 Capability Report를 제공.

**통과 조건:** 동일 입력·시드·정밀도 설정으로 실제 결과 및 비용을 비교; 미지원은 명시적으로 거부.

### P5 — Explain, Profile, Verify, Agent

- [#542](https://github.com/typeshade/typeshade/issues/542): GPU Timestamp; 불가하면 측정 불가로 보고.
- `explain`/`analyze`는 병렬화 근거, Fallback, 전송, 자원 사용 등 *검증 가능한 사실*을 보고.
- Oracle Divergence, `gradCheck`, 정적 최적화 리포트와 GPU 실측을 JSON 계약으로 통합.
- Agent는 구조화된 정보로 수정 → 검증 → 벤치 → 회귀 확인, 필요하면 Rollback.

**통과 조건:** 동일 소스/입력/장치에서 재현 가능한 보고를 생성하며 추정치와 실측치를 명확히 구분.

## 7. 최소 세 가지 소비자 테스트

| 소비자(별도 프로젝트) | 검증하는 TypeShade 능력 |
| --- | --- |
| GPU 입자 시뮬레이션 + 실시간 Render | Residency, Compute→Render, Resource Ownership, 순서 |
| 2D/3D Gaussian Splatting 기반 역문제 | 병렬 Scatter/Sort/Reduction, 역전파, 메모리·성능 |
| 대형 영상 필터·과학 계산 | 여러 Kernel, Fusion 후보, 데이터 스트리밍, CPU/WASM/GPU 비교 |

이 세 가지를 TypeShade Core에 합치지 않습니다. 테스트 Harness/외부 Repository가 공통으로 필요로 하는 API와 계약만 Core에서 해결합니다. 게임·GIS·암호학/AI는 같은 원칙의 추가 소비자 후보입니다.

## 8. 이 문서가 요청하지 않는 것

- 승인 없이 `docs/language-design.md`의 언어 규칙, `src/__api__/surface.md`의 공개 Export, numbered Surface, 진단 코드 또는 예제를 변경하지 않습니다.
- 기존 [`changes/README.md`](../../changes/README.md) 승인·구현·Downstream 절차를 우회하지 않습니다.
- `main`에 없는 CUDA/WASM/Native Node 기능이 동작한다고 주장하지 않습니다.
- 이미 구현된 Host Import, WebGL2 Compute, Reverse AD의 **일부 기능을 무시하고** 처음부터 다시 만들지 않습니다.
- 일정/버전/성능 수치를 증거 없이 선언하지 않습니다.

## 9. 참고 소스·설계 기록

- [`src/core/ir/nodes.ts`](../../src/core/ir/nodes.ts), [`src/core/backend.ts`](../../src/core/backend.ts), [`src/core/passes/parallel-loop.ts`](../../src/core/passes/parallel-loop.ts)
- [`src/core/passes/grad-reverse.ts`](../../src/core/passes/grad-reverse.ts), [`src/core/passes/grad-check.ts`](../../src/core/passes/grad-check.ts)
- [`src/compiler/ts/host-face.ts`](../../src/compiler/ts/host-face.ts), [`src/vite.ts`](../../src/vite.ts)
- [`src/core/resident.ts`](../../src/core/resident.ts), [`src/runtime/runtime.ts`](../../src/runtime/runtime.ts), [`src/runtime/gl.ts`](../../src/runtime/gl.ts)
- [`src/core/manifest.ts`](../../src/core/manifest.ts), [`src/core/manifest-types.ts`](../../src/core/manifest-types.ts), [`src/core/ir/portable.ts`](../../src/core/ir/portable.ts)
- [`src/core/tiers.ts`](../../src/core/tiers.ts), [`src/cli/run.ts`](../../src/cli/run.ts), [`journeys/engine/engine.mjs`](../../journeys/engine/engine.mjs)
- [기존 1.0 로드맵](../roadmap.md), [0–22 개발 계획](../use-typeshade-plan.md), [DX](../dx.md), [Runtime 아키텍처](../runtime-architecture.md)

**결론:** `main`은 이미 프로그래밍 언어·컴파일러·GPU Runtime으로서 강한 기반을 갖고 있습니다. 다음 핵심 과제는 새로운 게임/AI용 Core 문법이 아니라 **기존 모듈을 범용 호스트·메모리·실행 계획·검증 체계로 연결**하는 일입니다. 위 단계는 검토 우선순위이며 구현의 사전 승인이나 자동 이슈 완료 표시가 아닙니다.
