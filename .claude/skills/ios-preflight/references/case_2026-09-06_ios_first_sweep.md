# 사례 — iOS 1차 실측 3건 (2026-09-06)

아이폰 첫 실측에서 나온 3건. 셋 다 **안드로이드에서는 안 보이던** 것이고, 셋 다 원인 층이 달랐다.
이 스킬의 §핵심 1·2·5가 여기서 나왔다.

## 1. 입력창이 키보드에 가린다 (§핵심 1 — 좌표계)

**제보**: "노하우 추가 입력창이 키보드에 가린다. 업무 채팅은 잘 된다."

**층**: 좌표계. 갈림길이 **네이티브 헤더의 유무**라는 게 결정적 단서였다.

**메커니즘**:
`react-native-safe-area-context` 의 프레임 기준점이 플랫폼마다 다르다.
- Android(`SafeAreaUtils.kt:90`): `rootView.offsetDescendantRectToMyCoords` → **창 기준**
- iOS(`RNCSafeAreaProvider.m:74`): `convertRect:toView:RNCParentViewController(self).view` → **화면 VC 뷰 기준**

그리고 `RNSScreenStackHeaderConfig.mm:489` 가 헤더 불투명일 때
`vc.edgesForExtendedLayout = UIRectEdgeAll - UIRectEdgeTop` 을 걸어 **VC 뷰가 헤더 아래에서 시작**한다.
→ iOS 프레임 y 가 헤더 높이만큼 작다. 키보드 `screenY` 는 창 기준이므로 그대로 빼면 헤더 높이만큼 덜 밀린다.
→ 헤더 없는 화면(업무 채팅, `headerShown:false`)은 어긋날 오프셋이 0이라 멀쩡했다.

**수정**: `KeyboardShift` 안에서 iOS일 때만 `HeaderHeightContext` 값을 더한다.
Android는 이미 창 기준이라 더하면 이중이므로 손대지 않는다.
`edgesForExtendedLayout` 은 top 만 빼므로 bottom 은 창 바닥과 같아 보정이 필요 없다.

**교훈**: 8월 안드로이드 수정이 iOS에서 "재발"한 게 아니다. **iOS에서는 처음부터 안 맞았고,
안드로이드만 고쳐놓고 창 기준이라고 주석에 적어 둔 것**이 다음 사람을 헤매게 했다.
플랫폼별 기준점은 **네이티브 소스를 직접 열어 확인**한다.

## 2. 업무 채팅이 화면 맨 위까지 올라온다 (§핵심 1 — 인셋 주인 없음)

**제보**: "업무채팅에서, 위에까지 올라옴."

**메커니즘**: 대화방·서랍은 네이티브 헤더를 끄는데(`headerShown:false`), 감싸는 `SafeAreaView` 가
`edges={[]}` 라 **상단 인셋을 아무도 안 줬다.** 떠 있는 헤더(`top:10`)와 방 칩바(`top:62`)는 고정
좌표라 그대로 상태바 밑으로 들어갔다.

**수정**: 헤더를 끈 뷰에만 `edges` 에 `top` 을 넣는다(`safeEdges` 로 한 곳에서 판정).
패널 뷰는 네이티브 헤더가 이미 내려주므로 넣으면 이중이다.

**교훈**: 인셋은 **주인을 정하는 문제**다. "헤더가 준다 / SafeAreaView 가 준다 / 컴포넌트가 준다"
중 하나여야 하고, 헤더를 끄는 순간 주인이 사라진다. 헤더를 끄는 코드와 인셋을 주는 코드는 붙여 둔다.

## 3. 스플래시 "매장의 정석" 이 한 줄로 안 맞는다 (§핵심 5 — 폰트 폴백)

**제보**: "'매장의정석' 로딩에서 줄이 약간 어긋나서 정석이 약간 올라와있음."

**메커니즘**: `<Text>매장의{' '}</Text>` 처럼 **글자 Text 안에 ASCII 공백을 넣었다.**
iOS는 한글을 Apple SD Gothic Neo, 공백을 San Francisco 로 그린다. 한 Text 안에 두 폰트가 섞이면
그 Text 의 줄 상자(ascent/descent)가 **두 폰트의 최대치**로 커진다. 형제 Text("정석")는 한글만이라
줄 상자가 작다 → 기준선이 어긋나 "정석"이 떠 보였다.

**수정**: 공백을 지우고 `marginRight` 로 간격을 주고, 행에 `alignItems:'baseline'` 을 건다.

**교훈**: 한글 UI에서 `{' '}` 는 공짜가 아니다. **간격은 글자가 아니라 레이아웃으로 준다.**

---

## 이 사례가 스킬에 남긴 것

| 발견 | 스캐너 규칙 |
|---|---|
| 1 | `ios-vc-frame` 🔴 |
| 2 | `ios-header-inset` 🟡 |
| 3 | `ios-mixed-run` 🟡 |

세 규칙 모두 수정 **전** 코드에서 발화하는 것을 픽스처로 확인했다(RED 확인).
규칙을 추가할 때는 반드시 같은 절차를 밟는다 — 안 잡히는 규칙은 없는 것만 못하다.
