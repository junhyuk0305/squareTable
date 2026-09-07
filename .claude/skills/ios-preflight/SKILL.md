---
name: ios-preflight
description: iOS(아이폰)에서만 조용히 틀리는 지점을 실기기·시뮬레이터 없이 코드에서 전수로 찾아내고, 사용자가 폰으로 확인할 것만 추려 넘기는 iOS 전용 사전 QA. 화면상 전부 초록불인데 실제로는 안 되는 부류(푸시 미도달·그림자 소실·키보드 가림·권한 크래시·심사 반려)를 노린다. TestFlight 업로드 전, iOS 빌드 전, 아이폰 실측 제보가 왔을 때, App Store 심사 제출 전에 실행한다. 트리거 — "iOS QA", "아이폰 점검", "iOS 사전 점검", "아이폰에서 안 돼", "TestFlight 전 확인", "심사 전 점검", "iOS 조용한 오류", "/ios-preflight".
---

# iOS 사전 QA (ios-preflight)

## 이 스킬이 존재하는 이유

우리 개발 환경은 **윈도우**다. iOS 시뮬레이터를 띄울 수 없고, 브라우저로도 재현이 안 된다.
아이폰 화면을 볼 수 있는 사람은 사용자 한 명뿐이고, 그 사람의 1회차는 비싸다.
그래서 이 스킬의 목표는 **"내가 코드로 확정할 수 있는 것을 전부 확정하고, 폰으로만 알 수 있는 것만
추려서 넘기는 것"** 이다. 확인 요청 목록이 길면 스킬이 실패한 것이다.

그리고 iOS에는 **롤백이 없다.** 안드로이드는 이전 트랙으로 되돌릴 수 있지만 iOS는 심사를 다시 받아야
한다. 즉 iOS에서의 잘못 하나는 안드로이드에서의 잘못보다 비싸다. 게이트를 더 무겁게 잡는 근거다.

## native-audit 과의 역할 분담 (⛔중복 실행 금지)

| 축 | 담당 |
|---|---|
| 웹 ↔ 네이티브 갈림길 일반(KAV 공용규칙·inset 이중적용·Modal back·hover·persist-taps) | `native-audit` |
| **안드로이드 층(HWUI) 렌더링**(opacity+elevation·오프스크린 합성) | `native-audit` |
| **iOS만의 축 7가지**(아래 §핵심) | **이 스킬** |
| 의도한 플랫폼 분기의 설계·배치 | `/platform-split` |
| 출고 가능 여부(태그·미커밋·EAS 환경변수) | `npm run native:gate` |

증상이 안드로이드에도 같이 나면 이 스킬이 아니라 `native-audit` 이다.
**"아이폰에서만 그렇다"가 확인됐거나, iOS 빌드/심사를 앞두고 있을 때** 이 스킬을 쓴다.

## §핵심 — iOS만의 축 7가지 (조용한 오류의 뿌리)

### 1. 좌표계가 다르다 — iOS 프레임은 "창"이 아니라 "화면 뷰컨트롤러" 기준
`react-native-safe-area-context` 의 `useSafeAreaFrame()` 은 플랫폼마다 **기준점이 다르다.**
- Android: `rootView.offsetDescendantRectToMyCoords` → **창 기준**
- iOS: `convertRect:toView:RNCParentViewController(self).view` → **그 화면의 UIViewController 뷰 기준**

그리고 `react-native-screens` 는 헤더가 불투명일 때 `vc.edgesForExtendedLayout = UIRectEdgeAll - UIRectEdgeTop`
을 걸어 **VC 뷰 자체가 헤더 아래에서 시작**한다. 그래서 iOS에서 잰 프레임 y 는 **딱 헤더 높이만큼 작다.**
키보드 `endCoordinates.screenY` 는 창 기준이므로, 둘을 그대로 빼면 헤더 높이만큼 어긋난다.

→ **증상**: 네이티브 헤더가 있는 화면에서만 입력창이 키보드에 가린다. 헤더를 끈 화면은 멀쩡하다.
→ **보정값**: `HeaderHeightContext`(헤더 꺼짐 0, 중첩 스택이면 상위 헤더 높이) = VC 뷰의 창 기준 y.
→ 근거·수정 이력: `references/case_2026-09-06_ios_first_sweep.md`

**Android에서 멀쩡한 좌표 계산이 iOS에서 틀릴 수 있다** — 이 축을 항상 먼저 의심한다.

### 2. 그림자가 프로퍼티부터 다르다 — `elevation` 은 iOS에서 아무 일도 안 한다
Android는 `elevation`, iOS는 `shadowColor/shadowOffset/shadowOpacity/shadowRadius`.
`elevation` 만 쓴 요소는 **iOS에서 그림자가 그냥 없다.** 크래시도 경고도 없다 — 그냥 평평해진다.
디자인시스템이 "평면 금지"인 앱에서 이건 조용한 시각 결함이다.
→ 공용 `Elevation` 토큰(`src/lib/theme/elevation.ts`)은 양쪽을 다 갖는다. **직접 `elevation:` 을
쓴 곳만 위험**하다. 스캐너 `ios-shadow` 가 잡는다.

### 3. 권한 문구가 없으면 크래시한다 (Android는 안 그런다)
iOS는 카메라·마이크·사진·위치 API를 부르는 순간 `Info.plist` 에 해당 사용 목적 문구가 없으면
**앱이 즉시 죽는다.** 안드로이드는 그냥 권한 거부로 끝난다. 그래서 안드로이드 QA를 아무리 돌려도
안 잡힌다. 심사에서도 5.1.1 로 반려된다.
→ 스캐너 `ios-permission` 이 "쓰는 API ↔ app.json 문구"를 대조한다.

### 4. 키보드 이벤트 타이밍이 다르다
iOS는 `keyboardWillShow`(올라오기 **전**), Android는 `keyboardDidShow`(올라온 **후**)만 신뢰할 수 있다.
`Did` 만 쓰면 iOS에서 키보드가 다 올라온 뒤에야 화면이 움직여 **한 박자 늦게 덜컥**인다.
`LayoutAnimation` 으로 키보드 애니메이션 커브·duration 에 맞춰야 매끄럽다.
→ 스캐너 `ios-kb-event`.

### 5. 폰트가 글자마다 다르게 잡힌다 — 한글/ASCII 혼용 줄 상자
iOS는 한글을 Apple SD Gothic Neo 로, ASCII(공백·영문·숫자)를 San Francisco 로 그린다.
**한 `Text` 안에 둘이 섞이면 그 Text 의 줄 상자(ascent/descent)만 커진다.** 형제 Text 와 한 행에
놓으면 기준선이 어긋나 한쪽이 떠 보인다. 안드로이드는 폴백 체계가 달라 티가 안 난다.
→ 특히 `매장의{' '}` 처럼 **글자 Text 안에 띄어쓰기를 넣은 패턴**이 범인이다. 간격은 마진으로 준다.
→ 스캐너 `ios-mixed-run`.

### 6. 배달 경로에 애플이 끼어 있다 — APNs 없으면 전 구간 초록불인데 알림만 안 온다
아이폰 알림은 **반드시 APNs(애플 우체국)** 를 거친다. 우리 서버 → Expo Push → APNs → 아이폰.
애플에 접수하려면 **APNs 키**가 EAS 크리덴셜에 등록돼 있어야 한다. 없으면:

| 단계 | APNs 키 없을 때 |
|---|---|
| 권한 팝업 · 사용자 허용 | ✅ |
| `getExpoPushTokenAsync` | ✅ 성공 |
| DB 토큰 저장 | ✅ 저장됨 |
| **실제 도착** | ❌ **안 옴** |

코드로는 절대 알 수 없다. **사용자 터미널에서만** 확인된다(§절차 3단계).

### 7. 안드로이드에만 있는 옵션은 iOS에서 **경고 없이 사라진다**
`headerTitleAlign` 은 native-stack 공식 문서에 이렇게 적혀 있다 —
> "Not supported on iOS. It's always `center` on iOS and cannot be changed."

타입 오류도, 콘솔 경고도 없다. **안드로이드에서 의도대로 보이니 다 된 줄 안다.** 2026-09-07 실기기에서
헤더 제목이 iOS에서만 가운데로 뜬 것이 이것이었다 — 코드에는 왼쪽 정렬 의도가 주석까지 달려 있었다.

이 부류의 성질이 고약한 이유: **"안 되는 것"이 아니라 "다르게 되는 것"이라 스크린샷 없이는 못 잡는다.**

| iOS에서 무시되는 내비 옵션(안드로이드 전용) | iOS에서 같은 결과를 내려면 |
|---|---|
| `headerTitleAlign` | 슬롯을 바꾼다 — `headerTitle: () => null` + `headerLeft: () => <제목/>` |
| `navigationBarColor` · `navigationBarHidden` | iOS엔 해당 개념이 없다(홈 인디케이터는 `autoHideHomeIndicator`) |
| `sheetElevation` · `sheetResizeAnimationEnabled` · `sheetShouldOverflowTopInset` | iOS 시트 옵션(`sheetGrabberVisible` 등)으로 따로 낸다 |

컴포넌트 prop 에도 같은 부류가 있다. 대표는 접근성 쌍이다:
`importantForAccessibility`(안드로이드) ↔ `accessibilityElementsHidden`(iOS) — **한쪽만 쓰면 다른 쪽은 무방비다.**
화면으로는 절대 안 보이고 VoiceOver 를 켜야만 드러난다.

**반대 방향도 있다**(iOS 전용이라 안드로이드에서 사라지는 것): `gestureEnabled` · `fullScreenGestureEnabled` ·
`headerBackTitle` · `headerLargeTitle*` · `headerBlurEffect` · `autoHideHomeIndicator`.
이쪽은 `native-audit` 담당이지만, 같은 함정이라는 것만 기억한다.

## 절차

### 1단계 — 자동 스캔 (2분)

```bash
cd SquareTable
node .claude/skills/ios-preflight/scripts/scan-ios.mjs
```

🔴(iOS에서 깨짐 확실) · 🟡(결함 가능·사람이 판정) · ℹ️(확인 권장).
**🔴은 전건 연다.** 오탐이면 그 줄이나 윗줄에 `// ios-preflight: ok <이유>` 를 달아 근거를 코드에 남긴다.

규칙 9종: `ios-vc-frame` · `ios-header-inset` · `ios-shadow` · `ios-permission` · `ios-kb-event` ·
`ios-mixed-run` · `ios-scroll-inset` · `ios-ignored-nav-option` · `ios-a11y-pair`.

### 2단계 — 스캐너가 못 잡는 것 (`references/checklist-ios.md`)

체크리스트에서 **이번에 바뀐 코드에 해당하는 항목만** 본다. 전 항목 순회는 첫 감사 1회면 충분하다.

### 3단계 — 사용자 터미널 명령 (내가 못 하는 것)

`eas` 명령은 대화형 인증이 걸려 있어 **사용자 터미널에서만** 돈다. 내가 실행하지 않는다.
필요한 것을 **복사해 붙일 수 있는 형태로** 주고, 결과를 받아 판정한다.

| 확인할 것 | 명령 | 무엇을 보나 |
|---|---|---|
| APNs 키 등록 여부(§핵심 6) | `eas credentials -p ios` | iOS → Push Notifications 항목에 키가 있는가 |
| 빌드 크리덴셜 | `eas credentials -p ios` | Distribution Certificate · Provisioning Profile |
| 제출 상태 | `eas build:list --platform ios --limit 3` | 최근 빌드가 finished 인가 |

### 4단계 — 실기기 확인 요청서 (사용자에게 넘기는 것)

**추린다.** 코드로 확정한 것은 빼고, **폰으로만 알 수 있는 것만** 남긴다.
각 항목은 ①어디로 가서 ②무엇을 하고 ③무엇이 보이면 정상인지, 세 줄로 쓴다.

```
□ 1. 노하우 추가 → 입력창 탭 → 입력창이 키보드 바로 위에 붙어 보이는가(가리지 않는가)
□ 2. 업무 채팅 → 맨 위 → 상단 아이콘 줄이 상태바(시계) 아래에 있는가
```

### 5단계 — 보고

```
## iOS 사전 QA (YYYY-MM-DD)
🔴 즉시 수정 N건: 파일:줄 — 사용자가 겪을 일 한 줄 — 수정 방향
🟡 판정 필요 N건: (오탐 판정 포함)
🔑 사용자 터미널 필요 N건: 명령 + 결과를 어떻게 읽는지
📱 실기기에서만 N건: 위 4단계 확인 요청서
✅ 통과: 규칙 9종 / 체크리스트에서 본 항목
```

**증상은 개발 용어가 아니라 사용자가 겪을 일로 쓴다** — "safe-area top 미적용"이 아니라
"업무 채팅 아이콘이 시계와 겹친다".

## 실기기 제보가 왔을 때 (절차 B)

`native-audit` 의 절차 B(제보 → 층 번역 → 메커니즘 문장 → 공용 프리미티브 수정 → 새로고침 안내 →
메모리 기록)를 **그대로 따른다.** 여기서 더할 것은 하나뿐이다:

> **"안드로이드에서도 그런가?"를 먼저 묻는다.**
> 양쪽 다면 `native-audit` 축이다. iOS만이면 위 §핵심 7가지 중 어느 축인지 이름을 붙이고 시작한다.
> 축 이름을 못 붙이면 아직 고치지 않는다.

## 심사 리스크 (제출 전 1회)

| 조항 | 내용 | 우리 상태 |
|---|---|---|
| 3.1.1 | 앱 안에서 외부 결제 유도 금지 | `npm run native:gate` 의 "네이티브 결제 표면" 항목이 담당 — 그쪽 결과를 인용한다 |
| 5.1.1 | 권한 요청 목적 문구 필요 · 안 쓰는 권한 요청 금지 | 스캐너 `ios-permission` + `출시서류_iOS/02_*` |
| 5.1.1(v) | 계정 생성 앱은 **앱 안에서 계정 삭제** 제공 | `/account-deletion` 경로 존재 확인 |
| 4.0 | 알림 권한만 묻고 알림이 안 오면 지적 대상 | §핵심 6 (APNs) |

정본 문서는 `출시서류_iOS/` 다. 이 스킬은 **코드와 문서가 어긋났는지**만 본다 — 문서 내용을
여기에 복제하지 않는다.

## 근거 (판단이 갈리면 여기로)

- iOS 프레임 기준점: `node_modules/react-native-safe-area-context/ios/RNCSafeAreaProvider.m` (`convertRect:toView:RNCParentViewController`)
- 헤더가 VC 뷰를 밀어내는 지점: `node_modules/react-native-screens/ios/RNSScreenStackHeaderConfig.mm` (`edgesForExtendedLayout`)
- 그림자 플랫폼 차이: reactnative.dev/docs/shadow-props (iOS shadow* · Android elevation)
- Info.plist 권한 문구 누락 시 크래시: developer.apple.com — Protected resources / purpose strings
- Expo Push ↔ APNs 크리덴셜: docs.expo.dev/push-notifications/push-notifications-setup
- App Store Review Guidelines: developer.apple.com/app-store/review/guidelines
- 플랫폼별 지원 옵션(무엇이 무시되는가): reactnavigation.org/docs/native-stack-navigator — 각 옵션의 "Only supported on …" 표기가 정본
- 접근성 prop 의 플랫폼 쌍: reactnative.dev/docs/accessibility (importantForAccessibility=Android · accessibilityElementsHidden=iOS)
