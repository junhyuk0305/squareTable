---
name: native-audit
description: 안드로이드/iOS 네이티브 앱에서 웹과 다르게 동작하거나 깨지는 지점을 실기기 없이 코드에서 사전 검출하고, 실기기 제보가 오면 원인 층을 확정해 반복 검증까지 끌고 가는 감사. 실기기 테스트 전, 네이티브 빌드 전, "앱에서 이상하다"는 제보가 왔을 때, 또는 UI·키보드·모달·탭바·제스처·애니메이션을 크게 고친 뒤에 반드시 실행한다. 트리거 — "네이티브 감사", "앱 검수", "실기기 전 점검", "안드로이드에서 다를 만한 곳", "웹은 되는데 앱은 안 됨", "모바일 실측 QA", "/native-audit".
---

# 네이티브 갈림길 감사 (native-audit)

이 앱은 한 코드가 웹(RN-web)과 네이티브(Android/iOS)로 나간다. **웹에서 5개월 멀쩡하던 코드가
실기기 첫 설치에서 5개 결함(09-02), 2차에서 2개(09-03)를 냈다** — 전부 "웹에선 값이 0이거나
no-op이거나, 웹 렌더러엔 없는 층이라 안 보이던" 부류다. 이 감사는 그 부류를 ①코드에서 미리 찾고
②실기기 제보가 오면 원인 층을 확정해 ③한 번에 닫는다.

## 왜 웹 QA가 못 잡는가 — 4가지 뿌리

1. **웹에선 값이 0**: safe-area inset(제스처바·노치)이 웹은 0 → 이중 적용·미적용이 똑같이 보인다.
2. **웹에선 no-op(목업)**: RN-web 공식 호환표가 "Mock"으로 적은 것들 — KeyboardAvoidingView·
   BackHandler·Keyboard·StatusBar·LayoutAnimation·Animated 네이티브 드라이버·Text `onLongPress`·
   Alert·RefreshControl. Stack 전환 애니메이션도 웹은 안 그린다 → 잘못 설정해도 웹은 티가 안 난다.
3. **웹에만 있는 것**: hover·wheel·window/document API → 네이티브에서 조용히 죽거나 기능이 사라진다.
4. **★안드로이드는 층(layer)으로 그린다**(09-03 신설): 웹은 CSS 합성이라 opacity가 서브트리 전체에
   한 번에 먹지만, Android는 **요소마다 알파를 따로 곱한다**(RN이 `hasOverlappingRendering=false`로 둔
   성능 기본값). 그래서 부모를 페이드하면 자식의 `elevation` 그림자는 알파를 안 따라가 **검게 먼저**
   뜨고, 고치려고 오프스크린 레이어를 켜면 그 레이어는 **뷰 상자 크기로 잘려** 상자 밖 그림자가 사라진다.
   웹 브라우저로는 영원히 재현 안 되는 축이다.

## 절차 A — 코드 사전 감사 (변경 후·빌드 전)

### 1단계 — 자동 스캔 (2분)

```bash
cd SquareTable
node .claude/skills/native-audit/scripts/scan.mjs
```

🔴(기기에서 깨짐)·🟡(눈에 보이는 결함 가능)·ℹ️(확인 권장)으로 나온다.
**🔴은 전건 열어 본다.** 🟡은 파일을 열어 맥락으로 판정한다(스캐너는 휴리스틱이라 오탐이 있다 —
오탐이면 그 줄에 `// native-audit: ok <이유>` 를 달면 다음 스캔부터 제외된다).

규칙 목록(2026-09-03 기준 11종): modal-back · kav-behavior · fixed · web-alert · double-inset ·
mouse-only · modal-autofocus · overflow · hover-only · persist-taps · **fade-elevation**(신설) ·
**replace-slide**(신설). 신설 2종의 근거는 `references/case_2026-09-03_android_fade_shadow.md`.

### 2단계 — 스캐너가 못 잡는 것 (references/checklist.md)

`references/checklist.md` 를 읽고 **이번에 바뀐 코드에 해당하는 항목만** 골라 점검한다.
전 항목 순회는 첫 감사 때 1회면 충분하다. 특히:
- replace/Redirect/탭 경로로 도달하는 화면의 애니메이션 (§내비게이션)
- 페이드·디밍이 걸리는 자리에 elevation 카드가 들어가는지 (§렌더링·층)
- 권한 플로우(카메라·마이크·사진) — 코드로는 문자열만 보이고 동작은 기기에서만 (§권한)
- Android 백그라운드 타이머·푸시 (§생명주기)

### 3단계 — 기존 게이트와 역할 분담 (중복 실행 금지)

| 무엇 | 담당 | 이 감사에서 할 일 |
|---|---|---|
| window/document/localStorage 누출 | `npm run native:preflight` (래칫) | 실행 여부만 확인 |
| .web 분기 짝·번들 생성 | `native:preflight` | EAS 빌드 전 1회 |
| 460px 레이아웃·터치 48dp | `qa:quiz-ui` (웹 브라우저) | 웹 쪽 보증으로 인정 |
| **KAV·inset·Modal·제스처·애니·층 갈림길** | **이 감사** | 1·2단계 |

### 4단계 — 보고

```
## 네이티브 감사 결과 (YYYY-MM-DD)
🔴 즉시 수정 N건: 파일:줄 — 증상 한 줄(사용자가 겪을 일) — 수정 방향
🟡 판정 필요 N건: (동일 형식, 오탐 판정 포함)
✅ 통과: 스캔 규칙 수 / 체크리스트에서 본 항목
📱 실기기에서만 확인 가능: (체크리스트 §실기기 항목 중 이번 변경에 해당하는 것)
```

**증상은 개발 용어가 아니라 사용자가 겪을 일로 쓴다** — "insets 미적용"이 아니라
"하단 버튼이 제스처바에 가려져 못 누른다".

## 절차 B — 실기기 제보 접수 루프 (★09-03 신설 — 이 스킬의 핵심)

사용자가 폰을 들고 "이게 이상해"라고 말한다. 나는 그 화면을 **볼 수 없고**, 웹 브라우저로는
**재현도 안 된다**(뿌리 4). 그래서 절차가 곧 능력이다. 그림자 결함 하나를 닫는 데 3회차가 걸렸고,
그중 2회차는 절차를 어겨서 낭비한 것이다(사례 문서 참조).

### B-1. 제보를 층으로 번역한다 (코드 열기 전)

사용자 말은 증상이다. 먼저 **어느 층의 일인지** 이름 붙인다 — 층이 다르면 고칠 파일이 다르다.

| 사용자 표현 | 층 | 먼저 볼 곳 |
|---|---|---|
| "옆으로 밀린다·슬라이드된다" | 내비게이션(react-native-screens) | 그 화면에 **도달하는 방법**(push/replace/Redirect/탭) → 해당 `Stack.Screen` 의 `animation` |
| "뜨긴 뜨는데 검은/이상한 상자가 먼저" · "그림자가 툭" | 렌더링·층(Android HWUI) | 그 요소를 감싼 opacity 애니(`Appear` 등) + 자식의 `Elevation` |
| "버튼이 가려진다·잘린다·높이가 다르다" | inset·edge-to-edge | SafeAreaView edges·탭바·Modal translucent |
| "키보드가 입력창을 덮는다·첫 탭이 안 먹는다" | 키보드 | KAV behavior·keyboardShouldPersistTaps |
| "눌러도 반응 없다" | 터치·제스처 | hover 전용·PanResponder 방향판정·겹친 형제 |
| "돌아왔더니 옛 데이터" | 생명주기 | AppState·setInterval |

층을 못 정하겠으면 **되묻는다** — "카드가 나타나기 전인가 후인가", "매장 안에서인가 허브에서인가".
한 문장 질문이 한 회차를 아낀다.

### B-2. 메커니즘을 문장으로 쓴 뒤에 고친다

"왜 이 층에서 이 증상이 나는가"를 **한 문단으로 설명할 수 없으면 아직 고치지 않는다.**
- 09-03 1회차(성공): "부모 페이드 중 자식 elevation 그림자가 알파를 안 따라간다" → 오프스크린 합성.
- 09-03 2회차(실패): 새 증상("그림자가 툭")을 **메커니즘 없이** 시점 조정(55%)으로 눌렀다 → 반려.
- 09-03 3회차(성공): "오프스크린 레이어는 상자 크기로 잘린다" → 상자를 넓혀 그림자를 레이어 안에.
2회차가 낭비인 이유: 새 증상은 **1회차 수정이 만든 것**인데 그 수정의 부작용 메커니즘을 묻지 않았다.
**수정이 새 증상을 만들면 그 수정이 무엇을 바꿨는지부터 되짚는다.**

### B-3. 공용 프리미티브에서 고친다

증상이 난 화면이 아니라 **그 동작을 만드는 한 곳**을 고친다(`Appear`·`BottomSheet`·`RoleTabBar`·
루트 `_layout`). 66개 파일이 `Appear` 를 쓰므로 한 곳 수정이 전부를 덮었다. 화면에서 개별 패치하면
같은 결함이 다음 화면에서 다시 제보된다.

### B-4. 사용자가 다시 보게 한다 — 새로고침 절차를 같이 준다

JS만 바꿨으면 재빌드 불필요. **보고 끝에 항상 적는다**: Metro 창에서 `r`, 또는 폰 흔들기 → Reload.
연결이 끊겼으면 `npm run device`(다른 Wi-Fi면 `-- --tunnel`) 후 앱 재시작.
그리고 **무엇을 어디서 보면 되는지 2줄**로 확인 포인트를 준다(예: "사장 홈 카드가 뜰 때 그림자가
카드와 같이 나오는지 · 카드 아래 버튼이 눌리는지").

### B-5. 회차마다 메모리에 남긴다

`memory/project_squaretable_android_*_YYYY-MM-DD.md` 에 회차별 (증상 → 층 → 메커니즘 → 수정 → 결과).
실패한 회차도 남긴다 — 다음 사람이 같은 우회로를 안 밟게.

## 수정 시 지킬 규칙 (이 프로젝트의 확정 패턴)

- **키보드**: 화면의 키보드 회피는 **공용 `KeyboardShift`**(`src/components/KeyboardShift.tsx`) 하나로 — KAV 직접 사용 금지
  (스캐너 `kav-shared` 🔴). 안에는 RN KAV 도 `measureInWindow` 도 없다(09-03 6회차 실기기 확정) — 키보드 이벤트 순간에
  **안쪽 `SafeAreaProvider` 의 `useSafeAreaFrame()`(네이티브 뷰 계층 실측·창 기준)** 으로 상자 바닥을 재서 겹침만큼 `paddingBottom`.
  ⛔`measureInWindow`·KAV `frame.y` 로 위치를 재지 말 것: 새 아키텍처의 measureInWindow 는 **shadow tree 좌표**라, 네이티브 헤더가
  있는 화면은 react-native-screens 의 헤더 높이 **추정치**만큼 어긋난다(업무 채팅만 멀쩡했던 이유 = headerShown:false).
  자식에겐 바깥 insets/frame 컨텍스트를 되돌려 준다(안쪽 시트의 `insets.bottom` 이 0 이 되는 것 방지).
  `position:absolute, bottom:` 메뉴는 패딩 받는 상자에 직접 두지 않는다(패딩 상자 기준이라 키보드 밑으로 들어간다) — KeyboardShift 가
  자식을 안쪽 View 에 담아 해결. (업계 권장은 `react-native-keyboard-controller` — 도입은 별건 결정.)
- **하단 inset은 탭바가 소유**: RoleTabBar/HubTabBar가 `insets.bottom`을 갖는다. 탭바를 그리는
  화면의 SafeAreaView에 `bottom` edge를 넣으면 이중이다.
- **바텀시트**: 공용 `BottomSheet` 사용이 기본. 직접 만들면 `statusBarTranslucent
  navigationBarTranslucent` + 시트 안 `insets.bottom` (BottomSheet.tsx 주석이 정본).
- **화면 전환 = "이동"과 "교체"를 나눈다** (09-03 확정): 뒤로 갈 곳이 있는 push만 슬라이드.
  탭 전환·매장 진입·Redirect·흐름 완료 후 replace는 `animation:'none'` — 웹과 같이 화면이 바뀌고
  `Appear` 가 등장을 맡는다. 08-08의 "방향이 층을 말해준다(stores slide_from_left)"는 **폐기**.
- **페이드는 `Appear` 하나로**: 자체 `opacity` 애니를 만들지 않는다(ui.md 프리미티브 2개 규칙).
  `Appear` 는 Android에서 재생 중 `needsOffscreenAlphaCompositing` + 상자 넓히기(`margin:-32/padding:32`,
  `pointerEvents:'box-none'`)로 그림자까지 함께 페이드시킨다. 예외 폴백(상자 속성 있는 style)은
  `Appear.tsx` 주석이 정본.
- **호버**: `onHoverIn`을 쓰면 같은 정보를 터치로도 닿게 한다(`onLongPress` 등).

## 근거 (전문가 출처 — 판단이 갈리면 여기로)

- RN-web 공식 호환표(무엇이 Mock인가): necolas.github.io/react-native-web/docs/react-native-compatibility
- Android opacity+elevation 아티팩트·`needsOffscreenAlphaCompositing`은 애니 중에만: github.com/DomiR/react-native-opacity-issue ·
  RN 이슈 "Elevation and border radius do not work well with opacity"
- Native Stack `animation` 값(‘none’ 포함)·Android/iOS 전용·웹 무시: reactnavigation.org/docs/native-stack-navigator
- Android 15 edge-to-edge 강제·adjustResize 무력화·safe-area bottom 0: github.com/react-native-community/discussions-and-proposals/discussions/827 ·
  expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- 키보드 심층(keyboard-controller 권장 근거): margelo.com/blog/deep-dive-in-keyboard-handling
