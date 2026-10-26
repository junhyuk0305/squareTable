---
name: layout-check
description: 앱 화면을 고친 뒤 "칩·버튼 줄바꿈이 깨지는지"와 "키보드가 입력칸·버튼을 가리는지"를 사용자 대신 에이전트가 먼저 판정하는 절차. 좁은 폭(320~430)·큰 글씨(1.3·1.5배) 웹 측정 하니스와 키보드 정적 스캔을 돌리고, 스크린샷을 직접 본 뒤, 도구가 증명하지 못한 것만 사용자 확인 목록으로 넘긴다. 화면(src/**/*.tsx)을 바꾼 작업의 완료 보고 전, "두 플랫폼에서 볼 화면" 목록을 쓰기 전에 반드시 쓴다. 트리거 — "칩 줄바꿈", "키보드 가림", "글씨 크게 하면 깨져", "좁은 폰에서", "레이아웃 확인", "화면 깨지는지 봐줘", "/layout-check".
---

# 화면 배치·키보드 판정 (layout-check)

사용자가 매번 폰으로 확인하지 않게 하는 것이 목적이다. 에이전트가 먼저 재고, 도구가 못 재는 것만 넘긴다.
넘길 때는 "무엇을 재서 무엇이 통과했고, 왜 이것만 남는지"를 같이 쓴다.

## 무엇이 무엇을 재는가

| 걱정 | 도구 | 믿는 범위 | 사용자에게 남는 것 |
|---|---|---|---|
| 칩이 감길 때 잘림·겹침·가로 넘침 | `qa:layout-stress` S1·S2·S3 | 일부러 넣은 3종(칩 줄 높이 고정+숨김 · 칩 줄 높이 고정 · 칩 높이 고정)을 잡는 것을 10-26 에 확인했다. 말줄임(numberOfLines)은 의도일 수 있어 경고만 | 여유가 8px 안쪽인 경계 사례 — 웹과 폰 글꼴 폭이 몇 % 다르다 · 떠 있는 요소(absolute) 사이의 겹침 |
| 감긴 뒤 터치 크기·가려짐 | S4·S5 | 화면 상자 기준 | `hitSlop` 을 준 요소 — 웹은 hitSlop 을 무시해 작게 잰다(코드로 확인하면 끝) |
| 큰 글씨에서 짧은 라벨이 두 줄 | S6 | 1.3배까지 실패, 1.5배는 경고 | 없음 |
| 키보드 가림(Android) | native-audit `kb-no-shift`·`kav-*`·`persist-taps` | 공용 `KeyboardShift` 안이면 통과로 본다(09-03 실기기 6회차로 확정된 부품) | 새 배치 패턴만: `position:absolute; bottom` 입력줄, 직접 만든 Modal 안 입력칸 |
| 키보드 가림(iOS) | 같은 스캔 + `ios-preflight` | KeyboardShift 가 iOS 에서만 헤더 높이를 더해 보정한다 | 불투명 헤더가 있고 화면 아래쪽에 입력칸이 있는 화면 |
| 노치·홈 인디케이터 | `ios-preflight` 스캔 | 정적 | 그 스캔이 넘긴 항목 |

에뮬레이터·시뮬레이터는 쓰지 않는다(2026-10-26 사용자 결정 · Android 에뮬레이터 설치 안 함 · iOS 는 Mac 이 없다).
사용자가 먼저 말하기 전에는 설치를 다시 제안하지 않는다.

## 절차

### 1. 잴 화면을 고른다
- `git diff --name-only origin/main...HEAD -- src` 로 바뀐 파일을 본다.
- `src/app/**` 은 그 경로가 화면이다(`index.tsx` = 폴더 경로, `[id]` 는 실제 id 로).
- `src/components/**` 는 `grep -rln "<부품이름" src/app` 으로 쓰는 화면을 찾는다. 3개 넘으면 대표 3개만 잰다.
- 로그인 화면이면 역할을 정한다. `/owner/*` 와 사장 전용 화면은 `--role=owner`, `/junior/*` 는 `--role=junior`.

### 2. 키보드 정적 스캔
```bash
node .claude/skills/native-audit/scripts/scan.mjs | grep -E "kb-no-shift|kav-|persist-taps|kb-inset"
```
고른 화면이 걸리면 파일을 열어 판정한다. 입력칸이 화면 위쪽뿐이면(검색창) 그 **화면 파일 머리 15줄 안**에 `// native-audit: ok <이유>` 를 단다(다른 규칙은 그 줄·윗줄이다).
이 규칙이 못 보는 것: `.ts` 재수출(index.ts)을 거친 입력칸 · KeyboardShift 를 쓰는 파일 안에서 그 밖에 둔 입력칸. 둘 다 놓치는 쪽이라 화면을 고쳤으면 그 파일은 눈으로 본다.
화면 아래쪽 입력칸이면 `KeyboardShift` 로 감싸는 것이 수정이다. 새 키보드 계산을 만들지 않는다.
iOS 축은 `node .claude/skills/ios-preflight/scripts/scan-ios.mjs` 도 같이 본다.

### 3. 웹 측정
개발 서버가 필요하다.
- main 체크아웃: `npm run web`(라이브 `.env` · 고정 QA 계정 · 이 하니스는 쓰기를 하지 않는다).
- 작업 복사본(키 없음): Docker Desktop 과 로컬 스택을 켜고 로컬 env 로 서버를 띄운다.
  ```bash
  eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
  export EXPO_PUBLIC_SUPABASE_URL="$API_URL" EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
  npx expo start --web --port 8081        # 백그라운드로. CI=1 을 붙이면 파일 수정이 반영되지 않는다
  ```
  ⛔ 로컬 스택은 다른 작업 복사본과 같이 쓴다(project_id 공통). `supabase db reset` 하지 않는다.

그다음:
```bash
MSYS_NO_PATHCONV=1 npm run qa:layout-stress -- --routes=/signup,/account-edit --role=owner
```
- 폭 320·360·393·430 × 배율 1·1.3·1.5. 실패 = 폭 360 이상 · 배율 1.3 이하. 나머지는 경고.
- npm 스크립트는 `qa:crawl` 처럼 `--allow-remote` 를 붙인다(쓰기 없음). 그래서 접속 대상 가드가 막아 주지 않는다. 작업 복사본에서는 위 export 로 로컬을 가리킨 셸에서만 돌린다.
- 배율 1.5 는 앱 '크게'(1.18) × 시스템 1.3 에 해당한다. 배지처럼 `maxFontSizeMultiplier` 를 준 글자는 웹이 그 상한을 몰라 1.5 에서 오탐이 날 수 있다.
- 실패가 나오면 고치기 전에 이 diff 때문인지 가른다. 아래 "알려진 기존 결함"에 있으면 기존이다. 없으면 바뀐 줄을 잠깐 되돌려 다시 재고 즉시 복구한다(⛔`git stash` — 다른 세션과 공유된다).

### 4. 스크린샷을 직접 본다
`tmp/layout-stress/<화면>/<폭>x<배율>.png` 는 스크롤 끝까지 찍힌다. 숫자가 전부 통과여도 최소 두 장을 Read 로 연다.
- `360x1.3.png`: 실패 기준선. 감긴 칩 줄의 간격, 줄 끝 칩 하나만 남는 모양, 버튼 정렬을 본다.
- `320x1.5.png`: 가장 거친 조합. 무엇이 먼저 무너지는지 본다.
`tmp/` 는 커밋하지 않는다.

### 5. 보고
완료 보고의 "두 플랫폼에서 볼 화면" 목록을 이렇게 줄인다.
- **에이전트가 확인함**: 화면 · 잰 조합 수 · 실패/경고 수 · 본 스크린샷.
- **사용자 확인 필요**: 위 표의 "사용자에게 남는 것"에 해당하는 항목만. 화면 경로 + 누를 것 + 기대 결과로 쓴다.
- 남는 항목이 없으면 "실기기 확인 없이 닫아도 되는 이유"를 한 줄 쓴다.

## 도구가 거짓말하는 자리
- **스플래시·첫 사용 팝업**: 덮개를 재면 모든 버튼이 '가려짐'이 된다. 하니스는 `SETTLED` 로 스플래시를 기다리고, `firstRunSeedJs` 로 팝업 플래그를 심는다(둘 다 `scripts/lib/qa-oracles.mjs`). 새 첫 사용 팝업을 만들면 그 함수에 키를 더한다.
- **role 없는 Pressable**: RN-web 에선 `div[tabindex="0"]` 로만 보인다. 공용 판정 `PROBE` 는 이걸 안 센다. 이 하니스는 `probeFor()` 로 넣어 센다. `qa:crawl` 은 아직 안 센다.
- **화면 밖 요소**: 공용 `r3` 는 화면 밖을 건너뛴다. 이 하니스는 창을 콘텐츠 길이만큼 늘려 터치 크기를 잰다.
- **판정을 믿기 전에 RED**: 판정 규칙을 고치면 칩 줄에 `height` 고정·`overflow:'hidden'`, 칩에 `minHeight:0, height:16` 을 잠깐 넣어 S2·S3·S5 가 실제로 실패하는지 본다. 공용 칩은 `minHeight:34` 라 `height` 만 넣으면 안 깨진다.

## 알려진 기존 결함 (2026-10-26)
- 업종 칩 높이 34px(`src/lib/theme/chip.ts` `minHeight: 34`) → S5 실패. 가입·프로필 완성·매장 추가·계정 편집 전부. 공용 칩 스타일에서 오는 값이라 고치면 칩 전체가 바뀐다 — 사용자 결정 전.
