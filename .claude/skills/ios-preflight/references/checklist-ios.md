# iOS 전용 갈림길 체크리스트 (스캐너가 못 잡는 것)

스캐너는 문법 패턴만 본다. 여기 있는 것은 **맥락을 읽어야 판정되는** 항목이다.
이번에 바뀐 코드에 해당하는 절만 본다. ⛔웹↔네이티브 일반 항목은 `native-audit/references/checklist.md` 담당.

## §좌표 · 레이아웃 (iOS 기준점이 다른 축)

- [ ] `useSafeAreaFrame()` 결과를 **창 기준으로 가정**하는 계산이 있는가 → iOS는 화면 VC 뷰 기준이다.
- [ ] 네이티브 헤더가 **있는** 화면과 **없는**(`headerShown:false`) 화면에서 같은 컴포넌트가 다르게 동작하는가
      → 헤더 유무가 갈림길이면 십중팔구 이 축이다.
- [ ] 헤더를 끈 화면에서 상단 인셋을 **누가** 주는가 (SafeAreaView `edges`? 컴포넌트 자체 `insets.top`?)
      → 아무도 안 주면 노치·다이나믹 아일랜드 밑으로 파고든다. 둘 다 주면 이중이다.
- [ ] 홈 인디케이터(하단 바) 영역 — 탭바가 `insets.bottom` 을 소유한다. 화면에서 또 주면 이중이다.
- [ ] `Modal` 안은 safe-area 컨텍스트가 끊긴다 — 시트 안에서 `insets` 를 다시 읽는지 확인.

## §키보드 (iOS 타이밍·커브)

- [ ] 키보드 회피는 공용 `KeyboardShift` 하나인가 (KAV 직접 사용 금지 — `native-audit` 규칙)
- [ ] `keyboardWillShow`(iOS) / `keyboardDidShow`(Android) 로 갈렸는가
- [ ] `LayoutAnimation` duration·easing 을 키보드 이벤트에서 받아 쓰는가 → 안 그러면 화면이 키보드와 따로 논다
- [ ] 입력창 위에 `position:'absolute', bottom:` 으로 뜨는 메뉴가 패딩 받는 상자에 직접 붙어 있지 않은가
- [ ] 한글 조합 중(`onChangeText`) 글자가 씹히지 않는가 — **실기기 확인 항목**

## §그림자 · 시각 (iOS는 조용히 평평해진다)

- [ ] 공용 `Elevation` 토큰을 쓰는가 (직접 `elevation:` 은 iOS에서 무효)
- [ ] `overflow:'hidden'` 카드 안에 그림자 요소를 넣지 않았는가 — iOS는 부모 밖 그림자가 잘린다
- [ ] `borderRadius` + `shadow*` 조합 — iOS는 `backgroundColor` 가 없으면 그림자가 안 그려진다

## §알림 (§핵심 6 — 조용한 오류의 본산)

- [ ] APNs 키가 EAS에 등록돼 있는가 → **`eas credentials -p ios` (사용자 터미널)**. 코드로는 못 본다.
- [ ] 포그라운드 수신 시 배너를 보이게 `setNotificationHandler` 를 설정했는가 (기본은 숨김)
- [ ] 앱 아이콘 배지를 쓸 것인가 — `shouldSetBadge:false` 면 배지가 영영 안 붙는다(의도면 그대로)
- [ ] 알림 탭 → 라우팅이 **역할별로** 교정되는가 (사장/직원 접두사)
- [ ] 권한 팝업을 앱 시작 즉시 띄우지 않는가 → 심사 지적 대상. 맥락 있는 자리에서 물어야 한다.

## §권한 · 심사

- [ ] 쓰는 권한마다 app.json 에 iOS 목적 문구가 있는가 (없으면 **크래시** — 스캐너 `ios-permission`)
- [ ] **안 쓰는** 권한을 선언하지 않았는가 → 심사에서 "왜 필요한지" 물어온다
- [ ] 앱 안에서 계정 삭제가 가능한가 (5.1.1(v)) — 공개 웹 URL만으로는 부족하다
- [ ] 앱 안에 외부 결제 유도가 없는가 (3.1.1) → `npm run native:gate` 의 결제 표면 항목 인용
- [ ] 권한 문구가 **한국어**이고 무엇에 쓰는지 구체적인가 (영문 잔재 확인)

## §오디오 · 미디어

- [ ] 녹음 후 `allowsRecording:false` 로 세션을 되돌리는가 → 안 그러면 이후 소리가 작아진다(iOS 전용)
- [ ] 무음 스위치가 켜져 있어도 들려야 하면 `playsInSilentMode:true`
- [ ] 사진 선택 결과가 HEIC일 수 있다 — 업로드·압축 경로가 HEIC를 처리하는가

## §제스처 · 내비게이션

- [ ] iOS 엣지 스와이프 뒤로가기 — `replace` 로 들어간 화면에서 스와이프하면 어디로 가는가
- [ ] `Modal` 을 아래로 스와이프해 닫을 수 있는가 / 닫히면 안 되는 화면인가
- [ ] 상태바를 탭하면 스크롤이 맨 위로 간다 — 스크롤뷰가 여럿이면 엉뚱한 것이 올라간다

## §글자 크기 (Dynamic Type)

- [ ] 시스템 글자 크기를 크게 했을 때 깨지는 고정 높이가 있는가
- [ ] 로고·숫자처럼 커지면 안 되는 곳에 `allowFontScaling={false}` 가 있는가

## §플랫폼 전용 옵션 (iOS에서 조용히 사라지는 것)

정본은 reactnavigation.org/docs/native-stack-navigator 의 각 옵션 "Only supported on …" 표기다.
**의심되면 여기를 먼저 열어 본다** — 타입도 통과하고 경고도 없으므로 코드만 봐서는 절대 모른다.

- [ ] `headerTitleAlign` 을 쓰고 있는가 → **iOS는 항상 가운데**다(문서 명시). 왼쪽 정렬은 `headerLeft` 슬롯으로
- [ ] `navigationBarColor` · `navigationBarHidden` → 안드로이드 전용
- [ ] `sheetElevation` · `sheetResizeAnimationEnabled` · `sheetShouldOverflowTopInset` → 안드로이드 전용
- [ ] 검색바 옵션 `inputType` · `hintTextColor` · `headerIconColor` · `shouldShowHintSearchIcon` → 안드로이드 전용
- [ ] `importantForAccessibility` 만 쓰고 `accessibilityElementsHidden`(iOS 짝)을 빠뜨리지 않았는가
- [ ] `textAlignVertical` → 안드로이드 전용. iOS 멀티라인 입력은 기본이 top 이라 보통 무해하지만,
      `'center'` 로 세로 중앙을 노렸다면 iOS에서는 **안 먹는다**(패딩으로 따로 맞춰야 한다)
- [ ] `android_ripple` 이 **유일한 누름 피드백**이 아닌가 → iOS엔 눌린 표시가 없다
- [ ] 반대 방향(iOS 전용이라 안드로이드에서 사라짐): `gestureEnabled` · `fullScreenGestureEnabled` ·
      `headerBackTitle` · `headerLargeTitle*` · `headerBlurEffect` · `autoHideHomeIndicator`

## §펼침·접힘(아코디언)·측정 기반 레이아웃

- [ ] `onLayout` 으로 잰 높이를 **영구히 씌우고 있지 않은가** → 측정이 한 번 낡으면 그대로 굳어 내용이 잘린다.
      공용 `Collapse` 는 여는 애니메이션이 끝나면 높이 구속을 **놓는다**(2026-09-07 할일 잘림 사고)
- [ ] 사진·비동기 콘텐츠가 나중에 들어오는 자리에 고정 높이가 있는가
- [ ] 부모가 `overflow:'hidden'` + 고정 높이인데 자식이 그보다 커질 수 있는가

## §실기기에서만 알 수 있는 것 (사용자에게 넘길 후보)

폰트 렌더링 · 키보드 애니메이션의 매끄러움 · 알림 실제 도착 · 권한 팝업 문구 ·
햅틱 · 스와이프 제스처 감각 · 한글 조합 입력 · 다이나믹 아일랜드 겹침 · 실제 성능
