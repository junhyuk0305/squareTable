---
name: android-preflight
description: 안드로이드에서만 조용히 틀리는 지점을 실기기 없이 코드·설정·최종 매니페스트에서 전수로 찾아내고, 폰으로만 알 수 있는 것만 추려 넘기는 안드로이드 전용 사전 QA. OS가 회수한 옵트아웃(edge-to-edge·방향고정·뒤로가기), 사용자가 바꾼 글씨 크기, 조용히 무시되는 시스템바 색, FCM 배달 경로, 그리고 app.json 에는 안 보이는 최종 권한 목록을 본다. 실기기에 올리기 전, 안드로이드 빌드 전, Play 업로드·트랙 승격 전, 안드로이드 실측 제보가 왔을 때 실행한다. 트리거 — "안드로이드 QA", "안드로이드 점검", "안드 사전 점검", "안드로이드에서 안 돼", "Play 업로드 전 확인", "aab 올리기 전", "안드로이드 조용한 오류", "/android-preflight".
---

# 안드로이드 사전 QA (android-preflight)

## 이 스킬이 존재하는 이유

`native-audit` 은 **"웹과 다른가"**를 묻고, `ios-preflight` 는 **"아이폰만 그런가"**를 묻는다.
둘 다 **우리 코드**를 본다. 그런데 안드로이드에서 비싸게 물린 것들은 우리 코드가 아니라 **바깥**에서 왔다:

1. **OS가 계약을 바꾼다.** Android 16(API 36)은 우리가 쓰던 옵트아웃을 **회수했다.** 코드는 그대로인데
   동작이 바뀐다. 컴파일도 되고 경고도 없다.
2. **기기가 제각각이다.** 아이폰은 글씨 크기 설정이 있어도 다들 기본으로 쓴다. 안드로이드 사용자,
   특히 **40~60대 사장님**은 '글씨 크게'·'화면 크게'를 실제로 켠다. 우리 타깃 사용자층이다.
3. **최종 산출물이 app.json 과 다르다.** 플러그인이 권한을 넣는다. `app.json` 을 백 번 읽어도 안 보인다.
4. **Play 가 따로 본다.** 바이너리가 멀쩡해도 정책·권한 신고·서명에서 막힌다.

iOS 와 반대로 **안드로이드에는 롤백이 있다**(이전 트랙으로 되돌린다). 그래서 게이트를 iOS 만큼
무겁게 잡지 않는다. 대신 **안 깨지고 "다르게 되는" 부류**를 노린다 — 그쪽이 롤백조차 못 하게 만드는
부류(사용자는 이미 봤다)이기 때문이다.

## 역할 분담 (⛔중복 실행 금지)

| 축 | 담당 |
|---|---|
| 웹 ↔ 네이티브 갈림길 일반(KAV·inset 이중·Modal back·hover·persist-taps) | `native-audit` |
| 안드로이드 **렌더링 층**(HWUI: opacity+elevation·오프스크린 합성·전환 애니) | `native-audit` |
| iOS 만의 축 8가지 + App Store 심사 | `ios-preflight` |
| **안드로이드 OS 계약·기기 다양성·FCM 배달·최종 매니페스트·Play 출고** | **이 스킬** |
| 의도한 플랫폼 분기의 설계·배치 | `/platform-split` |
| 재빌드/OTA 판정·EAS 환경변수·결제 CTA 누수 | `npm run native:gate` |
| 번들이 뜨는가·웹 전용 API 누출 | `npm run native:preflight` |

증상이 **아이폰에도 같이 나면** 이 스킬이 아니라 `native-audit` 이다.
**"안드로이드에서만 그렇다"가 확인됐거나, 안드로이드 빌드/Play 업로드를 앞두고 있을 때** 이 스킬을 쓴다.

---

## §핵심 — 안드로이드만의 축 8가지

### 1. OS가 옵트아웃을 회수했다 (API 36 / Android 16)

우리는 Expo SDK 56 · RN 0.85 → **targetSdk 36**이다. 셋이 동시에 바뀌었다.

**(a) edge-to-edge 를 끌 수 없다.**
`windowOptOutEdgeToEdgeEnforcement` 는 API 36 에서 **폐기·무효**다. 콘텐츠가 상태바·내비바 **아래로
깔린다.** 옵션이 아니라 전제다 → 인셋을 누가 소유하는지가 곧 레이아웃 정합성이다
(우리 규칙: **하단 inset 은 탭바가 소유**, `native-audit` §수정 규칙).

**(b) `orientation: portrait` 가 큰 화면에서 무시된다.** ★실측 확인
최종 매니페스트에 `android:screenOrientation="portrait"` 가 들어 있지만, API 36 부터
**최소 너비 600dp 이상 디스플레이에서는 `screenOrientation`·`resizableActivity`·`minAspectRatio`·
`setRequestedOrientation()` 이 전부 무시**된다. 폴더블을 펴거나 태블릿·데스크톱 모드에 올리면
**가로로 펴진다.** 우리는 `supportsTablet: false`(iOS)만 선언했고 안드로이드엔 그런 스위치가 없다.

→ **대응 완료(2026-09-18): `ResponsiveShell` 의 460px 폭 캡을 네이티브에도 걸었다.**
   그전까지 캡은 `isWeb` 안에만 있어서, 웹은 안 늘어나고 **네이티브만 늘어나는** 상태였다.
   `frameCapStyle`·`modalFrameStyle`(모달·시트)은 원래 플랫폼 공통이라 빠진 곳은 거기 하나뿐이었다.
   → 남은 것은 **눈으로 보는 확인**이다(가로에서 헤더·탭바가 어색하지 않은지). 레이아웃이 늘어나는 문제는 닫혔다.

**(c) 뒤로가기는 지금 방벽 하나로 버티고 있다.** ★함정
API 36 은 predictive back 을 기본으로 켠다. 켜지면 **`onBackPressed()` 가 호출되지 않고
`KEYCODE_BACK` 이 디스패치되지 않는다** — RN 의 `BackHandler` 와 `Modal` 의 `onRequestClose` 가
**조용히 죽는다.**

지금 우리를 지키는 것은 `app.json` 의 `"predictiveBackGestureEnabled": false` **딱 한 줄**이다
(최종 매니페스트에 `android:enableOnBackInvokedCallback="false"` 로 나간 것을 실측 확인).
그리고 코드에 **`BackHandler` 사용이 0건**이므로, 하드웨어 뒤로가기는 전적으로
**내비게이션 + `Modal onRequestClose`** 가 받는다 = `native-audit` 의 `modal-back` 규칙이 지키는 그 축이다.

> **이 한 줄이 true 로 뒤집히거나 사라지면, `native-audit` 이 통과시킨 모든 Modal 이 동시에 못 닫히게 된다.**
> 스캐너 `and-back-gate` 가 이 값만 지킨다.

**★"그럼 제대로 대응하면 되지 않나" — 2026-09-18 확인: 아직 못 한다(상류 미지원).**

| 층 | predictive back 지원 |
|---|---|
| React Native 코어 | 0.81+ 에서 지원 |
| **`react-native-screens`(우리 내비게이션)** | **미지원** — 구현 계획만 있고 릴리스 없음 |

`react-native-screens` 없이는 **뒤로가기가 화면 스택을 못 타고 앱이 그냥 종료된다**(API 36 사용자
다수가 겪은 증상). 메인테이너는 v4 의 동기 fragment 커밋 구조와 `FragmentManager` 백스택이
충돌해 간단히 못 고친다고 적었다. 그리고 **공식·커뮤니티가 함께 권하는 대응이 정확히
`enableOnBackInvokedCallback="false"`** 다.

> **결론: 지금 이 값은 "임시로 미뤄 둔 것"이 아니라 현재 유일한 정답이다.** 근본 해결은 우리 코드가
> 아니라 상류에 있다. **해제 조건 하나만 기억한다 — `react-native-screens` 가 predictive back 지원을
> 릴리스하면** 그때 `true` 로 올리고 전 화면 뒤로가기를 다시 본다. 그전에는 올리지 않는다.
> 근거: github.com/software-mansion/react-native-screens/discussions/2540

### 2. 사용자가 글씨 크기를 바꾼다 (fontScale)

안드로이드 접근성 '글씨 크게'는 **최대 2.0배**, '화면 크게'(displayScale)는 별도로 또 곱한다.
`allowFontScaling={false}` 는 우리 코드에 **3곳뿐**(스플래시·워드마크) — 나머지는 전부 따라 커진다.
**그게 맞다**(끄는 게 능사가 아니다). 문제는 **글자는 커지는데 상자가 안 커지는 곳**이다.

→ 고정 `height` 를 가진 상자 안의 텍스트는 **잘리거나 겹친다.** 웹·아이폰에선 안 보인다.
→ 우리 프로젝트 확정 규칙: **넘칠 수 있는 텍스트 상자는 `height` 가 아니라 `minHeight`.**
→ 스캐너 `and-fixed-height-text`.

### 3. 시스템바 색 지정이 조용히 무시된다

edge-to-edge 아래에서 `StatusBar` 의 `backgroundColor`·`translucent`, 내비바의 `navigationBarColor`·
`navigationBarHidden` 은 **Android 15+ 에서 무시된다**(폐기). 크래시도 경고도 없고, 그냥 **투명한
시스템바 위에 우리 콘텐츠가 비친다.** 의도한 색이 안 나오는데 코드에는 색이 적혀 있으니 원인을 못 찾는다.
→ 색이 필요하면 **우리가 그 영역에 뷰를 그린다**(인셋 높이만큼의 배경 View). 시스템바 속성으로 내지 않는다.
→ 스캐너 `and-statusbar-bg` · `and-navbar-color`.

### 4. `elevation` 은 배경색이 없으면 그려지지 않는다

안드로이드 그림자는 **뷰의 아웃라인**에서 나온다. 배경이 투명하면 아웃라인이 없고, 그림자도 없다.
`elevation: 4` 를 써 놓고 `backgroundColor` 를 안 준 상자는 **아이폰에선 `shadow*` 로 그림자가 나오는데
안드로이드에선 안 나온다.** `ios-preflight` §2(`elevation` 만 쓰면 iOS 에서 사라진다)의 **거울상**이다.
→ 스캐너 `and-elevation-bg`.

### 5. 알림 경로가 FCM 이다 — 세 곳이 동시에 맞아야 한다

| 무엇 | 틀렸을 때 |
|---|---|
| `google-services.json` 의 `package_name` ↔ `app.json` 의 `android.package` | 토큰 발급은 되는데 **발송이 조용히 실패** |
| 알림 채널(`setNotificationChannelAsync`) | Android 8+ 에서 **소리·헤드업 없이 묻힌다** |
| `POST_NOTIFICATIONS` 런타임 권한(Android 13+) | 권한 없이는 **한 건도 안 뜬다** |
| EAS 의 FCM 서비스 계정 키 | 전 구간 초록불인데 **도착만 안 한다** (iOS 의 APNs 와 같은 구조) |

현재 코드(`src/lib/push/nativepush.ts`)는 채널·포그라운드 핸들러를 **이미 올바르게** 세워 뒀다.
스캐너의 이 규칙들은 **새로 만드는 게 아니라 되돌아가는 것을 막는** 회귀 방지다.
마지막 항목(FCM 키)은 코드로 알 수 없다 — §절차 4단계의 사용자 터미널 명령으로만 확인된다.

### 6. 화면이 접혔다 펴진다 (Dimensions 캐시)

폴더블·멀티윈도우·데스크톱 모드에서 **앱이 살아 있는 동안 창 크기가 바뀐다.**
모듈 최상위에서 `const { width } = Dimensions.get('window')` 로 한 번 잰 값은 **영원히 그 값**이다.
아이폰에선 회전을 막아 두면 사실상 안 바뀌지만, 안드로이드는 §1(b) 때문에 **방향 고정도 안 먹는다.**
→ `useWindowDimensions()` 로 받는다.
→ 스캐너 `and-window-dim`.

### 7. ★최종 권한 목록은 `app.json` 에 없다

`app.json` 의 `android` 블록에는 `permissions` 가 **아예 없다.** 그런데 최종 매니페스트에는 8개가 있다 —
전부 **플러그인이 넣은 것**이다. 실측(`expo config --type introspect`) 결과:

```
INTERNET · VIBRATE · RECORD_AUDIO · MODIFY_AUDIO_SETTINGS
READ_EXTERNAL_STORAGE(maxSdk 32) · WRITE_EXTERNAL_STORAGE(maxSdk 32)
CAMERA(tools:node="remove")        ← cameraPermission:false 가 의도대로 제거함 ✅
SYSTEM_ALERT_WINDOW                ← ★우리가 선언한 적 없다 → blockedPermissions 로 제거함 ✅
```

**라이브러리가 병합하는 권한(`POST_NOTIFICATIONS`·`RECEIVE_BOOT_COMPLETED` 등)은 이 목록에 없다** —
introspect 는 앱 모듈 매니페스트만 주기 때문이다. **"없다"가 아니라 "여기선 안 보인다"**로 읽는다.

`SYSTEM_ALERT_WINDOW`("다른 앱 위에 표시")는 **Play 가 민감하게 보는 권한**이다. 우리는 그런 기능이 없다.

**출처 추적 완료(2026-09-18): `@expo/config-plugins` 의 베어 템플릿 매니페스트**
(`withAndroidBaseMods.js` → `getAndroidManifestTemplate`). 템플릿 자신이 주석으로
`<!-- OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED -->` 라고 적어 둔 그 블록이다.
**`src/main` 이라 릴리스 aab 에 그대로 들어간다.**
→ **조치 완료: `app.json` 에 `"blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"]`**
  (최종 매니페스트에서 `tools:node="remove"` 로 빠지는 것까지 확인).

> **★이 축에서 내가 한 번 틀렸다 — 그 오답이 이 문단의 진짜 교훈이다.**
> 같은 이름이 `react-native/ReactAndroid/src/debug/AndroidManifest.xml`(RN 개발 오버레이)**에도**
> 있어서, 그걸 출처로 단정하고 "디버그 전용이라 안 나간다"고 결론지었다. 그리고 스캐너가
> 디버그 매니페스트의 권한을 자동으로 걸러내게 고쳤다 — **진짜 올라가는 권한을 가리는 필터**였다.
>
> 두 가지를 놓쳤다:
> 1. **introspect 의 매니페스트는 앱 모듈 것뿐이다.** 라이브러리(AAR) 매니페스트는 병합 전이라
>    아예 안 들어온다 — `POST_NOTIFICATIONS` 가 안 보이는 것이 그 증거였다. 즉 RN 의 디버그 매니페스트는
>    **처음부터 이 목록에 기여할 수 없었다.**
> 2. **권한 이름이 겹칠 수 있다.** 한 곳에서 찾았다고 그게 유일한 출처가 아니다.
>
> **규칙: 출처를 하나 찾으면 거기서 멈추지 말고 "전부" 찾는다. 그리고 게이트는 가리는 쪽이 아니라
> 시끄러운 쪽으로 틀린다** — 오보는 사람이 판정하면 되지만, 가려진 것은 아무도 못 본다.

**규칙: 안드로이드 권한의 정본은 세 곳이고, 아래로 갈수록 강하다.**
1. `app.json` — 우리가 쓴 것 (가장 약함, 거의 비어 있다)
2. `introspect` — 플러그인 포함 (dev 전용이 섞인다)
3. **Play 콘솔 → 앱 번들 탐색기 → 권한** — 업로드된 aab 의 진실 (**정본**)

또 하나: `allowBackup` 의 **기본값은 true** 다. 우리 앱은 Supabase 세션을 AsyncStorage 에 넣으므로
(`src/lib/storage/authStorage.ts`) 그대로 두면 **로그인 상태가 구글 Auto Backup 으로 나가고,
기기를 바꾸면 만료된 세션이 되살아난다.**
→ **조치 완료(2026-09-18): `app.json` 에 `"allowBackup": false`.** 백업할 가치가 있는 로컬 데이터가
  세션뿐이라, 정밀한 제외 규칙(XML)을 만들 이유가 없다 — 통째로 끄는 쪽이 단순하고 안전하다.
  대가는 "폰을 바꾸면 다시 로그인"이고, 인증을 들고 있는 앱에선 그게 맞는 동작이다.
→ 스캐너 `and-allow-backup` 이 되돌아가는 것을 막는다.

### 8. 출고는 Play 가 따로 본다

| 게이트 | 지금 상태(실측) |
|---|---|
| target API 36 | Expo 56/RN 0.85 → 충족 |
| **16KB 페이지 크기**(2025-11-01 이후 필수) | RN ≥ 0.77 이면 엔진은 충족. **서드파티 네이티브 모듈**이 변수 |
| 업로드 키 | `credentials.json` → `../_로컬전용/android-signing/android.keystore` 실존 ✅ · gitignore ✅ |
| versionCode | `appVersionSource: remote` + `production.autoIncrement: true` → EAS 가 관리 |
| 권한 신고 | `출시서류_안드로이드/03_Play_데이터안전_신고표.md` 와 실제 권한 대조 |

★**업로드 키는 EAS 관리 키로 바꾸면 안 된다**(메모리 `project_squaretable_android_upload_key_2026-09-03`).
`eas.json` 의 `production.android.credentialsSource: "local"` 이 그 장치다 — 이게 지워지면
EAS 가 새 키를 만들어 서명하고, Play 는 **업로드를 거부한다.**

---

## 절차

### 1단계 — 코드·설정 자동 스캔 (2분)

```bash
cd SquareTable
node .claude/skills/android-preflight/scripts/scan-android.mjs
```

🔴(기기에서 깨짐 확실) · 🟡(결함 가능·사람이 판정) · ℹ️(확인 권장).
**🔴은 전건 연다.** 오탐이면 그 줄이나 윗줄에 `// android-preflight: ok <이유>` 를 달아 근거를 코드에 남긴다.

규칙 9종: `and-fcm-package` · `and-channel` · `and-back-gate` · `and-fixed-height-text` ·
`and-elevation-bg` · `and-statusbar-bg` · `and-navbar-color` · `and-window-dim` · `and-allow-backup`.

### 2단계 — 스캐너가 못 잡는 것 (`references/checklist-android.md`)

체크리스트에서 **이번에 바뀐 코드에 해당하는 항목만** 본다. 전 항목 순회는 첫 감사 1회면 충분하다.
안드로이드 고유 항목의 절반은 **코드가 아니라 그 폰의 설정**(글꼴 크기·내비게이션 모드·배터리 최적화)에서 온다.

### 3단계 — 출고 게이트 (Play 업로드·트랙 승격 전에만)

```bash
node .claude/skills/android-preflight/scripts/scan-play.mjs --introspect
```

`--introspect` 는 `expo config --type introspect` 로 **최종 매니페스트**를 뽑는다(1~2분).
**빼면 §핵심 7의 권한 대조를 못 한다** — 업로드 전에는 반드시 켠다.

규칙 6종(`play-*`)과, 코드로는 못 보는 것(FCM 키·번들 탐색기·데이터 안전 양식)은 맨 아래 **🔑** 목록으로 따로 나온다.
조항별 확인표는 `references/play-gates.md`.

### 4단계 — 사용자 터미널 명령 (내가 못 하는 것)

`eas` 명령은 대화형 인증이 걸려 있어 **사용자 터미널에서만** 돈다. 내가 실행하지 않는다.
복사해 붙일 수 있는 형태로 주고, 결과를 받아 판정한다.

| 확인할 것 | 명령 | 무엇을 보나 |
|---|---|---|
| FCM 키(§핵심 5 마지막 칸) | `eas credentials -p android` | Push Notifications → FCM V1 service account key 가 있는가 |
| 업로드 키(§핵심 8) | `eas credentials -p android` | Keystore 가 **로컬 것**인가(EAS 생성 키가 아닌가) |
| 최근 빌드 | `eas build:list --platform android --limit 3` | finished 인가 |
| **최종 권한 정본** | Play 콘솔 → 앱 번들 탐색기 → 권한 | `SYSTEM_ALERT_WINDOW` 가 실제 aab 에 있는가 |

### 5단계 — 실기기 확인 요청서 (사용자에게 넘기는 것)

**추린다.** 코드로 확정한 것은 빼고, **폰으로만 알 수 있는 것만** 남긴다.
각 항목은 ①어디로 가서 ②무엇을 하고 ③무엇이 보이면 정상인지, 세 줄로 쓴다.
안드로이드 고유 항목은 **설정을 바꾼 뒤 보는 것**이 많으므로, 설정 경로까지 적는다.

```
□ 1. 설정 → 디스플레이 → 글꼴 크기를 '가장 크게' → 앱 홈 → 카드 안 글자가 잘리거나 겹치지 않는가
□ 2. 아무 화면에서 뒤로가기 제스처(화면 왼쪽 끝에서 밀기) → 모달이 열려 있으면 모달만 닫히는가
□ 3. 앱 홈 맨 위 → 상단 아이콘이 상태바(시계) 아래에 있는가(겹치지 않는가)
```

### 6단계 — 보고

```
## 안드로이드 사전 QA (YYYY-MM-DD)
🔴 즉시 수정 N건: 파일:줄 — 사용자가 겪을 일 한 줄 — 수정 방향
🟡 판정 필요 N건: (오탐 판정 포함)
🔑 사용자 터미널·Play 콘솔 필요 N건: 명령 + 결과를 어떻게 읽는지
📱 실기기에서만 N건: 위 5단계 확인 요청서
✅ 통과: 규칙 9종(+출고 6종) / 체크리스트에서 본 항목
```

**증상은 개발 용어가 아니라 사용자가 겪을 일로 쓴다** — "fontScale 미대응"이 아니라
"글씨 크게 쓰는 사장님 폰에서 카드 글자가 잘린다".

## 실기기 제보가 왔을 때 (절차 B)

`native-audit` 의 절차 B(제보 → 층 번역 → 메커니즘 문장 → 공용 프리미티브 수정 → 새로고침 안내 →
메모리 기록)를 **그대로 따른다.** 여기서 더할 것은 둘이다:

> **1. "아이폰에서도 그런가?"를 먼저 묻는다.** 양쪽 다면 `native-audit` 축이다.
> **2. "폰 설정을 바꾼 적 있나?"를 묻는다.** 글씨 크기·화면 크기·제스처 내비게이션·배터리 최적화 —
>    안드로이드 고유 제보의 상당수는 **코드가 아니라 그 폰의 설정**에서 온다. 기기 모델과 안드로이드
>    버전도 같이 받는다(삼성 One UI 는 기본 동작이 다른 곳이 있다).

축 이름을 못 붙이면 아직 고치지 않는다.

## 근거 (판단이 갈리면 여기로)

- API 36 동작 변경 전체(edge-to-edge 옵트아웃 폐기·predictive back·600dp 방향 무시):
  developer.android.com/about/versions/16/behavior-changes-16
- edge-to-edge 가 SDK 54+ 에서 강제됨: expo.dev/blog/edge-to-edge-display-now-streamlined-for-android
- Expo SDK 56 / RN 0.85 / API 36: expo.dev/changelog/sdk-56
- predictive back 마이그레이션(`onBackPressed` 미호출): developer.android.com/guide/navigation/custom-back/predictive-back-gesture
- 16KB 페이지 크기 요구: android-developers.googleblog.com/2025/05/prepare-play-apps-for-devices-with-16kb-page-size.html
- Android 13+ `POST_NOTIFICATIONS` 런타임 권한: developer.android.com/develop/ui/views/notifications/notification-permission
- 알림 채널 필수(Android 8+): developer.android.com/develop/ui/views/notifications/channels
- 그림자는 아웃라인에서 나온다(투명 배경 = 그림자 없음): developer.android.com/develop/ui/views/theming/shadows-clipping
- 시스템바 색 속성 폐기: developer.android.com/reference/android/view/Window#setStatusBarColor(int)
- 프로젝트 내부 정본: `native-audit`(층·공용 프리미티브) · `출시서류_안드로이드/` · `00_핵심/실기기_테스트_런북_2026-08-31.md`
