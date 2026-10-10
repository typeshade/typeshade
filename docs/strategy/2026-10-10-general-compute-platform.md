# TypeShade 범용 계산 플랫폼: 비전 및 설계 논의 기록

> Status: **discussion record / proposed direction** — 확정된 언어 규칙, 공개 API 또는 구현 약속이 아닙니다.
>
> Recorded: **2026-10-10 (Asia/Seoul)**
>
> Baseline: [typeshade/typeshade main @ fa8ac7f](https://github.com/typeshade/typeshade/commit/fa8ac7fbaa1ca4e1aec12aa93ed8d6580c08d258)
>
> Companion: [같은 날짜의 구현·로드맵 대조](../reviews/2026-10-10-main-platform-gap.md)
>
> 원칙: 이 문서는 대화에서 탐색한 요구와 제안을 구조화한 **논의 기록**입니다. 대화 전문을 그대로 옮긴 것이 아니며, 새로운 기능의 승인·완료를 선언하지 않습니다. 확정 언어 계약은 [language design](../language-design.md), [surface](../use-typeshade-surface.md), 수용된 [change proposals](../../changes/README.md)가 우선합니다.

**English summary.** TypeShade should evolve as a general-purpose, TypeScript-authored accelerated-computation compiler and runtime, not a game engine, ML framework, browser-only GPU DSL, or wrapper for every WebGPU primitive. Retain one computation semantics and typed IR; support ordinary host imports, GPU-resident data, portable execution, independently verifiable results, and optional lower-level escape hatches. Node.js and browsers are equal host environments. WebGPU/WebGL2/CPU exist today in defined scopes; WASM, CUDA, Python integration and whole-program planning are future work. The following is a strategy discussion, not a release commitment.

## 1. 제품 정의와 변경하지 말아야 할 철학

목표: **일반 TypeScript 프로그램이 계산을 TypeShade 소스로 작성·가져와 사용하고, CPU/GPU 경계를 필요 이상으로 관리하지 않으면서 여러 실행 환경에서 정확한 계산 결과를 얻는다.**

- 작성 언어: TypeScript 문법과 `"use typeshade"` 선언을 사용합니다. **모든 JavaScript/TypeScript의 동적 의미를 GPU에서 실행한다는 약속은 아닙니다.** 지원 범위는 명세와 진단으로 정의합니다.
- 기본 경험: 일반 호스트 `.ts`가 `.shade.ts`의 공개 함수를 import하고 호출합니다. GPU의 장치·바인딩·파이프라인은 가능하면 호출자의 문제가 아닙니다.
- 기준 의미: CPU Oracle을 계산의 참조 구현으로 유지합니다. 허용 오차·하드웨어 의존 동작은 투명하게 명시하며 모든 백엔드에서 비트 단위 동일성을 무조건 약속하지 않습니다.
- 범용성: 동일한 Core가 엔진·렌더러·GIS·과학 계산·AI·영상·암호학용 **외부 라이브러리**를 지원합니다.
- 플랫폼 비종속성: 브라우저 또는 Node.js 한쪽을 제품의 유일한 중심으로 삼지 않습니다. **Node.js 독립 GPU 실행은 다음 실행 환경 확장의 우선 투자 후보**입니다.
- 정책: 새로운 도메인 API를 Core에 넣기보다 그 도메인이 요구하는 **공통 계산·메모리·실행 능력**을 추출합니다.

슬로건 후보: **One TypeScript, many compute targets.** / **The GPU is an optimization level.** 단, 두 문구 모두 제품 목표이지 모든 프로그램의 자동 가속을 보장하는 기술적 명세는 아닙니다.

## 2. 시스템의 경계: 얼마나 책임질 것인가

```text
Application / domain libraries
  game engine | renderer | image processing | ML | GIS | scientific computing
                              |
                    ordinary TypeScript API
                              |
TypeShade host integration ----+---- authored "use typeshade" modules
                              |
Compiler: TypeScript frontend -> typed computation IR
          analysis -> transforms -> backend-specific lowering
                              |
Execution planning: operations, dependencies, access, lifetime, fusion candidates
                              |
Runtime: resources, devices, transfers, pipelines, queues, submission, errors
                              |
              WebGPU | WebGL2 | CPU/JS | future WASM/CUDA
```

| 질문 | TypeShade 담당 | 바깥에 남겨둘 책임 |
| --- | --- | --- |
| 무엇을 계산하는가? | 소스의 타입·계산 의미·효과 해석 | 구체적 알고리즘과 비즈니스 규칙 |
| 병렬화·특화가 가능한가? | 안전성 증명, Lowering, 최적화와 보고 | 도메인에서 필요한 정밀도/정책 선택 |
| 여러 함수는 어떻게 이어지는가? | 필요할 때 얇은 Execution Plan과 종속성 추적 | 장면, 엔티티, 모델, 타임라인 같은 도메인 그래프 |
| 데이터는 어디에 있는가? | CPU/GPU Residency, 수명, 접근·동기화 | 고수준 객체의 소유권·캐시 정책 |
| 어디서 실행하는가? | 기능 확인, 백엔드 선택, 실행, 명시적 오류 | 사용자가 정하는 비용·기기·보안 제약 |
| 결과를 신뢰할 수 있는가? | Oracle, Differential Testing, 수치 계약, 보고 | 알고리즘 자체의 과학적 타당성 |
| 무엇을 제품으로 제공하는가? | 컴파일러·런타임·검증 인프라 | 게임 엔진, AI 프레임워크, 영상 툴, GIS |

**하지 말아야 할 일:** Core에서 `GameObject`, `Scene`, `World`, `Tensor`, Neural Network Layer, Path Tracer, GIS Projection 등을 필수 API로 정의하는 것. 필요하면 별도 패키지/예제/연구 구현으로 배포합니다. 행렬 곱셈·FFT·Sort 등의 최적화는 라이브러리 API와 컴파일러가 인식하는 연산 계약을 분리하는 방식을 검토합니다.

## 3. 개발자가 경험해야 하는 세 가지 층

### A. 일반 TypeScript 호출자 — 제로 GPU 문법

```ts
import { simulate } from "./simulation.shade.ts";

const positions = new Float32Array(100_000);
// 목표 호스트 UX: GPU 런타임의 세부사항을 직접 구성하지 않는다.
await simulate(positions, 1 / 60);
```

호출자는 버퍼·워크그룹·바인드그룹을 알아야 하지 않습니다. 그러나 **동기/비동기 결과의 시점**, 변경 가능한 배열, 호출 오류, 지원되지 않는 타깃의 처리 정책은 타입과 문서에 드러나야 합니다. 자동 CPU Fallback은 실행 의미를 보존해야 하며, `explain`에서 이유가 보여야 합니다.

### B. 고성능 라이브러리 작성자 — 명시적인 Residency

```ts
import { resident } from "typeshade";
import { step } from "./simulation.shade.ts";

const state = resident(new Float32Array(100_000));
for (let frame = 0; frame < 600; frame++) step(state, 1 / 60);
const output = await state.read();
state.destroy();
```

`resident`는 **현재 존재하는 공개 개념**입니다. 입력 파일, 컴파일러 지원 루프/함수와 런타임 백엔드는 실제 코드의 계약을 따라야 합니다. CPU Readback이 없을 때만 이득이 큰 워크로드가 많으므로, 호출 결과·자원 소유권·읽기 시점을 숨겨서는 안 됩니다.

### C. 엔진 제작자 — 명시적인 Runtime/Escape Hatch

```ts
import { createRuntime } from "typeshade/runtime";

const rt = await createRuntime({ device }); // 주입되는 장치가 있는 예시
const program = rt.load(compiledManifest);
const kernel = await program.compute("step");
const frame = rt.frame();
frame.dispatch(kernel, bindings, workgroups);
await frame.submit();
```

호스트 함수 호출과 저수준 프로그램 Runtime은 **서로 다른 컴파일러·메모리 체계를 만들지 않고** 같은 Manifest, Resource, Device를 공유하는 것이 목표입니다. `compiledManifest`, `bindings`, `workgroups`는 애플리케이션이 준비하는 값입니다.

### 배포 단계의 결정적 기준

TypeShade를 내부적으로 쓰는 라이브러리는 최종 소비자가 `import { processImage } from "@vendor/image"`만으로 사용할 수 있어야 합니다. 앱 개발자에게 Vite 플러그인이나 GPU 초기화를 불필요하게 강제하면 안 됩니다. 이를 위해 빌드 타임 산출물, 런타임 Manifest/ABI, 네이티브 실행 타깃의 분리가 필요합니다.

## 4. 하나의 소스, 여러 실행 타깃

| 타깃 | 역할과 형태 | 상태에 대한 주의 |
| --- | --- | --- |
| WebGPU | WGSL로 GPU Compute/Render. 브라우저와 WebGPU 제공 Node 호스트 | 현재 지원되는 기본 GPU 경로 |
| WebGL2 | GLSL ES 3.00, 프로그램별 Lowering/Phased Compute | 현재 실제 실행기가 있음. 기능·성능이 WebGPU와 같지는 않음 |
| CPU/JavaScript | GPU 없이 결과 검증, 작은 문제, Fallback | 현재 Oracle 및 CPU 호출 계층 |
| WASM | 별도 CPU 실행 타깃, 선택적 SIMD·Worker | 계획/초안. GPU 공유 메모리로 오해 금지 |
| CUDA | CUDA C++/PTX 등 네이티브 실행 경로와 NVIDIA 특화 | 아직 백엔드 없음. 별도 네이티브 호스트·메모리 계약 필요 |
| Python | 참조 `.py` 코드 또는 컴파일된 TypeShade 호출 바인딩 | Python은 CUDA/WGSL과 **성격이 다른 통합 타깃** |

**중요한 계약:** `Native / Lowered / Unsupported`를 타깃·기능별로 보고합니다. CUDA의 특화 기능이 WebGPU나 WASM에서 동일한 성능으로 구현될 수 있다는 약속은 하지 않습니다. Python으로 코드 생성했다고 GPU 가속되는 것도 아닙니다.

`ModuleDecl`은 지금은 셰이더 중심의 IR입니다. 통째로 교체하지 말고, 공통 계산 의미를 재사용하면서 셰이더 Stage/Binding·Backend 전용 Raw 문법과 일반 계산 연산을 점진적으로 분리할 수 있는지 검증합니다. 직렬화 가능한 Portable IR과 실행 Manifest는 버전·레이아웃·필요 기능을 명확히 표현해야 합니다.

## 5. 컴파일러가 제공할 것

**필수:** 타입·레이아웃·정밀도·메모리 접근·부작용 분석, 데이터 의존성 기반 안전한 루프 병렬화, 스칼라/벡터/행렬 변환, 타깃 기능 검사, 상수 계산·DCE·CSE·GVN·LICM 등의 정적 최적화, 소스 위치와 거부 근거.

**전략적 확장:** 함수 간 Access/Effect Summary; Reduction·Scan·Sort 같은 재사용 가능한 커널의 합성 계약; Shape/Range/Alignment 분석; 특화, 메모리·전송 비용 추정, Fusion 후보 및 실측 기반 선택; 함수 및 향후 프로그램 단위 자동 미분.

- Fusion은 항상 빠른 것이 아닙니다. 레지스터·공유 메모리·추가 동기화 비용을 고려하고, 정확성과 성능을 따로 검증합니다.
- 수치 연산의 재정렬은 오류 범위를 바꿀 수 있습니다. CPU Oracle 및 Determinism 계약과 함께 다뤄야 합니다.
- 자동 미분은 함수 단위 VJP/JVP와 **Storage/Kernel/실행 단계 전체의 역전파**를 구분합니다.
- 프런트엔드가 TypeScript AST를 준다고 GPU가 전체 JavaScript 의미를 지원하는 것은 아닙니다. 지원하지 않는 문법은 정확한 진단으로 거부합니다.

## 6. Execution Planner와 Runtime이 제공할 것

**Planner의 단위는 도메인 객체가 아니라 계산 Operation**입니다. 현재 `ModuleDecl` 본문을 반복 보관하지 말고, 함수 참조, 읽기·쓰기 자원, 접근 범위, 의존성, 요구 기능, 실행 후보, 임시 자원의 수명 같은 메타데이터만 표현합니다.

점진적 발전 순서:

1. 단일 장치 안에서 호출 순서 및 오류 전파의 계약을 안정화합니다.
2. 임시 자원의 수명·읽기/쓰기 의존성을 추적합니다.
3. 불필요한 업로드·다운로드·중간 버퍼·중복 파이프라인 생성 비용을 줄입니다.
4. 독립 실행이 안전한 경우에만 Batch/병렬 제출 및 Fusion을 추가합니다.
5. 여러 디바이스와 자동 배치는 **실제 성능 증거가 있을 때** 검토합니다.

**Runtime의 필수:** 장치와 Backend, Capability/Limits, Resource Residency, 버퍼·텍스처 수명, 명시적 Readback, Pipeline Cache, 큐와 동기화, 오류 전파, 관측 가능성. 외부 WebGPU 리소스를 받아 같은 장치 내에서 Compute → Render로 재사용할 수 있어야 합니다.

**메모리 규칙:** 일반 JS 값과 GPU-resident 값은 동일하게 행동하지 않습니다. GPU 결과의 CPU Readback은 비동기입니다. 자동 복사가 불가피할 때는 비용과 시점을 보고할 수 있어야 합니다. Web Worker/SharedArrayBuffer는 JS·WASM 간 공유에 유용하지만 **WASM과 GPU의 무복사 공유를 자동 보장하지 않습니다.**

**Web/Node 균형:** 웹은 배포·데모·UX에, Node.js는 긴 연구 실험·서버 처리·네이티브 가속에 강점이 있습니다. 우선 독립 Node 호스트의 실제 GPU 컴퓨트를 정립하되 브라우저 웹 실행의 1급 지원을 유지합니다.

## 7. 논문 구현과 연구용 Workbench

성공 기준: 연구자가 논문의 계산을 TypeShade 함수로 옮겨 CPU에서 검증한 다음 **동일한 알고리즘**을 WebGPU/WASM/향후 CUDA에서 시험할 수 있는가.

연구 워크플로:
1. 수식·자료형·가정·경계 조건 파악.
2. TypeShade 함수/커널 구현.
3. Oracle과 작은 입력의 수치 검증, 필요하면 `gradCheck`.
4. GPU/WASM 실행 및 허용 오차 검증.
5. 연산량·메모리·GPU 타임·장치·컴파일 옵션·버전·재현 가능한 입력을 기록.
6. 최적화 전후의 **정확성**과 **실측 성능**을 따로 비교.

대상 사례: 입자 시뮬레이션, 대규모 영상 필터, Gaussian Splatting 및 미분·정렬·Scatter가 필요한 역문제. 이러한 사례는 Core 기능의 **외부 소비자/수용 테스트**이지 Core의 도메인 전용 API가 아닙니다.

## 8. AI Agent Experience (AX)

제안된 가치는 'AI가 TypeShade 문법을 추측하기 쉽다'보다 **에이전트가 작성한 코드를 TypeShade가 독립적으로 검증한다**는 데 있습니다.

- 공개 타입·메모리 레이아웃·입력 변경 계약과 타깃 기능을 기계적으로 읽을 수 있어야 합니다.
- 컴파일 실패는 코드·원인·소스 Span·관련 규칙·수정 가능한 대안을 구조화된 진단(JSON)으로 제공합니다.
- `explain`은 "어디서 실행하는가, 왜 그 타깃인가, 어떤 메모리가 이동하는가, 병렬화가 거부된 이유"를 알려줍니다.
- 성능 리포트는 **정적 추정 vs 실제 GPU 측정**을 구분합니다. 캐시 미스 40% 같은 주장에 관측 근거가 없다면 수치화하지 않습니다.
- 검증 루프: Compile → Oracle/Differential/Gradient Check → Profile → 비교 → 승인·수정·롤백. 무제한 자동 탐색 대신 실행 예산과 회귀 기준을 둡니다.
- Agent 친화적인 Manifest/CLI/JSON을 먼저 제공하고, MCP나 특정 Agent 하네스 통합은 소비자 패키지로 분리할 수 있습니다.
- LLM 추론 자체가 정적 검증을 100% 수행한다는 약속은 하지 않습니다. 검증 주체는 컴파일러와 테스트입니다.

예시 도구 명칭 `tshc analyze`, `tshc explain`, `tshc verify`, `tshc profile`, `tshc diff`는 **미래 명령 제안**입니다. 현재 CLI에 모두 존재하는 명령이 아닙니다.

## 9. 미래 시장 시나리오와 기술적 경계

- **온디바이스 AI:** 데이터 상주·모델 로딩·Reduction/Matmul·양자화/혼합 정밀도·메모리 예산이 핵심입니다. Tensor Core 활용은 타깃별 선택적 최적화로 다룹니다.
- **브라우저 게임·렌더러:** Compute → Render의 GPU 내 리소스 공유, Frame/Pass Composition, Resource Lifetime이 핵심입니다. RT/BVH는 별도 렌더러가 만들고 TypeShade는 범용 계산과 리소스 계약을 제공합니다. 브라우저에서 하드웨어 RT를 범용적으로 사용할 수 있다고 전제하지 않습니다.
- **암호학 가속:** 정수·Bit 연산·검증 가능한 병렬 수학이 필요하지만 GPU 실행 속도가 암호 구현의 기밀성이나 부채널 안전성을 보증하지 않습니다.
- **VFX/Radiance:** 카메라 포즈 추정, 영상 분할, 학습·렌더링, 머티리얼/시뮬레이션 등 이질적 워크로드가 공통 런타임의 재사용성을 검증합니다.
- **GIS/지도:** 넓은 좌표 범위의 정밀도, 타일/Geometry, 렌더링을 하나의 TS 애플리케이션에서 연결하는 테스트에 적합합니다.

하드웨어 특화 기술은 브라우저 표준/구현/실제 장치가 지원할 때만 노출합니다. WebGPU가 미래에 CUDA Tensor Core나 하드웨어 RT를 직접 제어할 것이라고 확정해서는 안 됩니다.

## 10. 제안된 순서와 완료 기준 — 기존 1.0 정책과 분리

| 단계 | 초점 | 증거 기반 완료 기준 |
| --- | --- | --- |
| P0 | 현재 구현·로드맵 정합성 | 각 기능에 구현/부분 구현/초안/미구현, 적용 커밋, 테스트, 타깃 한계 연결 |
| P1 | Host API, Native Node build / 실행 | 같은 `.shade.ts` 패키지를 Browser와 Node에서 수정 없이 실제 GPU/CPU 경로로 호출 |
| P2 | Resource/Residency 강화 | 부분 갱신, 소유권, Compute→Render 재사용, 불필요한 Readback 제거 |
| P3 | Execution Plan·함수 간 최적화 | 커널 연쇄의 의존성/메모리 수명 추적, 검증된 성능 개선 |
| P4 | WASM/CUDA/Python 통합 | 같은 계산을 타깃별로 실행·검증하고 차이와 제한을 보고 |
| P5 | Explain/Verify/Profile/Agent 도구 | 버전 관리되는 JSON 결과, GPU 측정과 정적 추정 구분, 자동 회귀 검사 |

이는 **제안된 플랫폼 확장 순서**입니다. 원래 [1.0 로드맵](../roadmap.md) 항목을 자동 변경하거나 구현 일정을 승인하지 않습니다. P0~P2의 일부는 1.0 안정화와 병행하며, 최소 진단·검증 표준은 P5까지 늦추지 않습니다.

## 11. 반드시 유지할 설계 제약

- CPU Oracle은 계산의 기준입니다. 데이터 의존성을 증명하지 못한 루프를 무단 병렬화하지 않습니다.
- Backend별 Capability와 정밀도 차이를 명시합니다. 자동 Fallback은 관측 가능해야 합니다.
- 소스 API는 보통 TypeScript 함수입니다. 하위 Escape Hatch는 필요할 때만 사용합니다.
- 브라우저 WebGPU, Native GPU, WASM/Workers의 메모리 모델을 '동일한 물리 메모리'처럼 꾸미지 않습니다.
- Runtime은 Compiler를 불필요하게 끌어오지 않는 현재의 경계를 유지합니다. Portable IR은 명시적으로 요청할 때만 운반합니다.
- Zero/near-zero dependency에 대한 기존 프로젝트 원칙을 유지하되, Node Native CUDA/WebGPU를 위한 별도 선택적 패키지·어댑터를 검토합니다.
- 새로운 언어 규칙, 수출 API, 사이트·에디터 동작 변경은 [change proposal 절차](../../changes/README.md)를 따릅니다.
- 합성·자동 미분·최적화의 각 확장마다 정확성 테스트와 **실제 소비자 워크로드**를 먼저 둡니다.

## 12. 열려 있는 결정 질문

1. Node.js의 Native WebGPU Provider/Loader 및 패키지 배포 계약은 무엇인가? 호스트가 주입한 장치 vs 자동 생성은 어떻게 구분하는가?
2. CPU 배열/Resident/Texture 사이 호출 타입, 오류 전파, 일관된 비동기 시점은 어디까지 보장하는가?
3. 함수/리소스별 Access Summary를 현재 IR에 어떻게 부착할 것인가? Alias/부분 범위 정보의 실패 시 정책은?
4. Execution Plan은 어느 범위의 호출을 관측하고, 어떤 시점에 Fusion/Batch 경계를 확정하는가?
5. CUDA/WASM Backend가 기존 ShaderType과 충돌하는 곳을 어떤 공통 의미 계약으로 해결하는가?
6. Reverse AD를 현재 함수에서 Storage/Kernel/Manifest로 확장할 때 중간 메모리·Checkpointing 책임은 어디인가?
7. 저수준 Performance Probe와 Agent용 `explain/verify/profile` 중 **어떤 최소 조각부터** 공개할 것인가?
8. TypeShade 작성 라이브러리의 npm AOT 패키지를 사용할 때 소비자 설치·번들링·동적 Backend 선택의 계약은 무엇인가?

## 13. 근거와 연결 이슈

- 철학: [DX — GPU as an optimization level](../dx.md), [기존 Runtime Architecture](../runtime-architecture.md)
- 현재 공개 계획: [Roadmap to 1.0.0](../roadmap.md), [Use TypeShade Plan](../use-typeshade-plan.md)
- 호스트 경계: [#97](https://github.com/typeshade/typeshade/issues/97), [#198](https://github.com/typeshade/typeshade/issues/198)
- 다중 패스·엔진 소비자: [#204](https://github.com/typeshade/typeshade/issues/204), [#335](https://github.com/typeshade/typeshade/issues/335)
- 병렬 루프: [#252](https://github.com/typeshade/typeshade/issues/252)
- WASM: [#459](https://github.com/typeshade/typeshade/issues/459), [0042 draft](../../changes/0042-wasm-tier.md)
- Reverse AD / Sort / GPU Timestamp: [#535](https://github.com/typeshade/typeshade/issues/535), [#539](https://github.com/typeshade/typeshade/issues/539), [#542](https://github.com/typeshade/typeshade/issues/542)
- Part-write / WebGL2 Compute / Reverse AD: [0048 draft](../../changes/0048-partial-buffer-write.md), [0054 accepted](../../changes/0054-webgl2-compute.md), [0056 accepted design](../../changes/0056-reverse-mode-grad.md)

**요약:** TypeShade는 '고성능 도메인 엔진'이 아니라, **다양한 엔진의 계산 부분을 신뢰할 수 있게 실행하는 기반**이 되어야 합니다. 이 기록 자체는 실행 약속을 확정하지 않으며, 후속 구현은 근거·테스트·변경 제안으로 개별 심사합니다.
