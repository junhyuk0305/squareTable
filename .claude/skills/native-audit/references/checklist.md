# 웹 ↔ 안드로이드 갈림길 전체 목록 (전문가 체크리스트)

스캐너(scan.mjs)가 자동으로 잡는 것은 ✂️ 표시. 나머지는 사람이/실기기에서 본다.
출처: RN/Expo 공식 문서(SDK 56)·RN-web 공식 호환표·Android 15 edge-to-edge 강제·실기기 실측(09-02 5건·09-03 2건).

## §0. RN-web이 "Mock"으로 적어둔 것 — 웹에선 무조건 no-op (호환표 원문)
이 API가 코드에 있으면 **웹 QA는 그 동작을 0% 보증한다.** 기기 확인 항목으로 자동 승격.
- 컴포넌트: `KeyboardAvoidingView`(Mock) · `StatusBar`(Mock) · `RefreshControl`(미구현) · `Alert`(미구현) · `TouchableNativeFeedback`(미구현)
- 부분: `Text` **onLongPress 없음** · `ScrollView` 모멘텀 이벤트 없음 · `TextInput` 자동 확장 없음 · `Image` 다중 소스/헤더 없음
- API: `BackHandler`(Mock) · `Keyboard`(Mock) · `LayoutAnimation`(웹 변환 없음) · `Animated` **useNativeDriver 없음**(JS 폴백 — 웹은 느려도 되고 네이티브는 되는데 웹은 안 되는 방향의 갈림길) · `AccessibilityInfo`(Mock) · `I18nManager`(Mock) · `Share`(HTTPS만)
- 내비게이션: Native Stack `animation`·`animationTypeForReplace` 는 **Android/iOS 전용, 웹 무시**.

## §키보드
- ✂️ **KAV 직접 사용** — 공용 `KeyboardShift` 로만. RN KAV 의 겹침 계산 = (부모 기준 y + 높이) − (창 기준 키보드 y − offset).
  네이티브 헤더·세그먼트 아래에 놓이면 **그 높이만큼 덜 올라가** 입력창이 가려진다(09-03 실기기: 노하우 추가·물어보기).
  헤더 없는 업무 채팅만 정상이었고, iOS 하드코딩 64 가 바로 이 보정이었다. `KeyboardShift` 는 창 기준 y 를 재서 뺀다.
- ✂️ KAV `behavior` 미지정·'height' — Android 15 edge-to-edge에서 adjustResize 무시 → 입력창이 키보드에 덮임.
- ✂️ TextInput 있는 파일의 ScrollView에 `keyboardShouldPersistTaps` 없음 — 키보드 연 채 버튼을 누르면
  **첫 탭이 키보드만 닫고** 버튼은 두 번째 탭에야 눌린다(웹은 한 번에 됨).
- Modal 안 `autoFocus` — Android에서 키보드가 안 올라오는 기종이 있다. 열림 애니 후 `focus()` 지연 호출이 안전.
- 📱 키보드 열림/닫힘 전환 중 레이아웃 튐 — 코드로 판정 불가, 기기에서 채팅 왕복으로 확인.
- (참고) 업계 권장은 `react-native-keyboard-controller`(edge-to-edge 전용 설계). 도입은 별건 결정.

## §safe-area · edge-to-edge (웹=0이라 안 보이는 축)
- ✂️ 탭바(RoleTabBar/HubTabBar) 그리는 화면의 SafeAreaView `bottom` edge — 이중 inset → 탭바 높이가 화면마다 다름.
- ✂️ `<Modal>`에 `onRequestClose` 없음 — **Android 하드웨어/제스처 뒤로가기가 모달을 못 닫는다**(웹은 무관).
- 바텀시트류 Modal에 `insets.bottom` 미반영 — 하단 버튼이 네비게이션 바에 가려짐. 공용 BottomSheet를 쓰면 해결됨.
- `position:'absolute', bottom: 0` 고정 요소(FAB·배너) — 부모가 inset을 안 가지면 제스처바와 겹침.
  (FAB이 탭바 위 콘텐츠 영역 안이면 안전 — 이 앱의 FAB은 안전 패턴.)
- Android 15 일부 기기에서 safe-area-context `bottom` 이 **0** 으로 온다(커뮤니티 보고) — `Math.max(insets.bottom, 8)` 같은 하한이 있어야 한다(탭바는 이미 준수).
- `contentInsetAdjustmentBehavior` 는 iOS 전용 — Android ScrollView는 inset 을 스스로 안 피한다.
- 📱 상태바 아이콘 색과 배경 대비(StatusBar style) — 밝은 배경 + 밝은 아이콘 기종별 확인.

## §내비게이션
- ✂️ **도달 경로 전수**: `router.replace`·`<Redirect>`·탭바 `path:` 로 도달하는 화면의 `Stack.Screen` 은
  `animation:'none'` — **네이티브에선 replace 도 슬라이드를 탄다.** 09-02 는 탭 루트만 봐서 루트 Stack 의
  `stores`·`owner`·`junior` 그룹을 놓쳤다(09-03 재제보). 규칙: **뒤로 갈 곳이 있는 push 만 슬라이드**.
- 08-08 "층 신호(stores slide_from_left)"는 폐기 — 실기기에선 그냥 "옆으로 밀림"으로만 읽혔다.
- Android 예측 뒤로가기(predictiveBackGestureEnabled) — 현재 false. true로 바꾸면 커스텀 뒤로가기 처리 전수 재점검.
- 📱 딥링크·푸시 탭 착지 — 웹 URL 라우팅과 네이티브 링킹이 다른 코드 경로다. 기기에서 푸시 탭 1회 확인.

## §터치 · 제스처 (웹=마우스, 앱=손가락)
- ✂️ `onHoverIn`만 있고 터치 대체(onLongPress/onPressIn) 없는 인터랙션 — 앱에서 그 정보에 닿을 길이 없다.
- ✂️ `onWheel`·`cursor:` 등 마우스 전용 — 네이티브에서 무동작. 가로 스크롤은 ScrollView horizontal이면 터치 OK.
- hitSlop: 네이티브는 **먹는다**(RN-web과 반대). 단 겹친 형제 위로는 안 뻗으므로 48dp는 상자 크기가 원칙(기존 규칙 유지).
- 가로 ScrollView/PanResponder가 세로 스크롤 부모 안에 있으면 — 방향 판정(|dx|>|dy|) 없이 응답을 가져가면 세로 스크롤을 뺏는다.
- 겹친 투명 뷰가 아래 형제의 터치를 먹는다 — 의도적으로 상자를 넓힌 뷰(`Appear` bleed)는 `pointerEvents:'box-none'` 필수.
  Android 히트테스트는 box-none 뷰를 건너뛰고 **아래 형제로 계속 내려간다**.
- 왼쪽 가장자리 32dp 는 `SwipeBack`(루트, Android)이 가로 드래그를 받는다 — 가장자리에 붙는 가로 스크롤/슬라이더를 새로 만들면 경쟁한다.
  iOS 기본 가장자리 스와이프와 같은 관례라 허용하되, 그 요소는 왼쪽 거터를 유지한다.
- 눌림 피드백: Android 사용자는 리플, iOS 는 페이드를 기대 — `Pressable` 의 `android_ripple` 유무는 취향이 아니라 관례.
- 📱 스와이프 감도·롱프레스 시간 — 기기에서만 체감 가능.

## §렌더링 · 층 (RN-web엔 없는 Android 특성)
- ✂️ **부모 opacity 페이드 + 자식 elevation** — Android는 요소마다 알파를 따로 곱해(`hasOverlappingRendering=false`)
  자식 그림자가 알파를 안 따라간다 → 페이드 중 **검은 사각 상자**. 처방 = 재생 중에만 `needsOffscreenAlphaCompositing`.
  ★단 오프스크린 레이어는 **뷰 상자 크기로 잘려** 상자 밖 그림자가 사라진다 → 상자를 그림자만큼 넓힌다(`Appear` 정본).
  자체 페이드 금지 — `Appear` 하나로. 디밍(`opacity: 0.55` 고정)도 같은 축(StoreToggle 은 기기 확인 대상).
- Android는 `overflow:'visible'`이 **View에서 안 먹는다**(자식이 부모 밖으로 못 나감) — 웹에서 삐져나오게
  그린 배지·툴팁이 앱에선 잘린다.
- 그림자: 웹 boxShadow ↔ Android `elevation`. Elevation 토큰(e1~e3)만 쓰면 안전. 커스텀 shadow*는 Android에서 무시될 수 있음.
  elevation 그림자의 퍼짐은 대략 2×elevation dp 안 — `Appear` 의 BLEED(32)가 e3(12)까지 덮는 근거.
- Text: Android는 **폰트 패딩을 자동 추가**(`includeFontPadding`) → 세로 정렬이 iOS/웹과 어긋난다. `lineHeight < fontSize×1.2`면 받침이 잘린다. 고정 height 금지(기존 규칙과 동일).
- fontWeight: iOS/웹은 100~900 아무 값, Android는 **해당 굵기 폰트 파일이 없으면 normal/bold 둘로 뭉갠다** — 500·600 을 쓰는 자리는 기기에서 굵기 차이가 사라졌는지 확인.
- ✂️ `position:'fixed'` — 네이티브에 없다(absolute로 오인 동작).
- zIndex: Android에서 형제 간만 유효 + elevation과 상호작용(elevation 이 높은 쪽이 zIndex 를 이긴다). 겹침 UI(드롭다운·톱니 패널)는 기기에서 1회 확인.
- 📱 이미지: 웹은 브라우저 캐시, 네이티브는 RN Image 캐시 — 큰 사진 목록 스크롤 성능은 기기에서.

## §접근성 (같은 prop 이 플랫폼마다 다르게 먹는다)
- `accessible={false}` 는 iOS 에서만 스크린리더에서 숨긴다 — Android 는 `importantForAccessibility="no"` 를 같이 줘야 한다.
- `accessibilityRole` 이 없는 Pressable 은 Android TalkBack 이 "버튼"이라 안 읽는다.

## §생명주기 · 플랫폼 API
- `setInterval` 폴링(이 앱: 세션 20~30초 재동기화) — Android 백그라운드에서 스로틀/정지된다.
  포그라운드 복귀 시 즉시 1회 동기화(AppState listener)가 없으면 "돌아왔는데 옛 데이터"가 된다.
- 날짜/로케일: Hermes Intl은 지원되나 웹 브라우저와 포맷 미세 차이 가능 — 'ko-KR' 명시(이미 준수)면 무난.
- 📱 권한 플로우: 마이크(음성)·사진(첨부) — **거부 후 재시도 경로**가 진짜 시험이다. 기기에서 거부→안내→설정 이동 확인.
- 📱 푸시: 웹 푸시(VAPID)와 FCM은 완전 별개 경로 — FCM 크리덴셜 미등록 상태(현황 LIVE 참조)면 앱 푸시는 전멸이 정상.
- 📱 앱 아이콘 배지·스플래시·폰트 로딩 — 기기 전용.

## §실기기 최소 체크리스트 (감사 후 5분)
1. 탭 4~5개 왕복 + **허브 ↔ 매장 진입 왕복** — 슬라이드 없음·탭바 높이 동일
2. **카드 등장 3곳(사장 홈·허브 현황·노하우 탭)** — 검은 상자 없음·그림자가 카드와 같이 나옴·카드 아래 버튼 눌림
3. 업무 채팅 입력 — 키보드 위로 입력창·전송 버튼 첫 탭에 눌림
4. 바텀시트 2종(노하우 상세·ⓘ) — 하단 버튼 안 가림·**뒤로가기 제스처로 닫힘**
5. 히어로 스와이프·가로 캐러셀 — 세로 스크롤 안 뺏김
6. 백그라운드 1분 → 복귀 — 데이터 갱신·화면 안 깨짐
7. 음성 버튼 — 권한 요청 → 거부 → 재시도 안내
