// 플랫폼 **정책 차이**(스토어 규정·법·사업 판단으로 "보이나/안 보이나·어느 채널인가"가 갈리는 것)의 판정 SSOT.
// 화면은 이 파일의 상수만 읽는다 — Platform.OS 를 화면에서 직접 보지 않는다(2곳 복제 금지).
// 상수 이름은 플랫폼이 아니라 이유로 짓는다(IS_IOS ✗ → SHOW_BILLING ✓). 각 상수 위에 근거를 남긴다.
// 플랫폼 API 가 달라 코드가 갈리는 **구현 차이**는 여기가 아니라 확장자 쌍(.web/.ios/.android)으로 —
// 절차: .claude/rules/platform.md · /platform-split.
//
// ★ SHOW_BILLING=false (iOS 네이티브) — **웹 PG·계좌이체 표면만** 가리는 상수다.
//   근거: 3.1.1(a)에 따라 한국 스토어프론트는 외부결제 버튼·링크·CTA도 금지된다(미국 스토어프론트만 예외).
//   한국 전기통신사업법 대응인 StoreKit External Purchase Entitlement(KR)는 26% 수수료 +
//   한국 전용 별도 바이너리 + 월별 정산 보고 의무라 채택하지 않는다.
//   → iOS 앱 안에서는 계좌번호·"웹에서 결제" 안내·외부 링크가 **한 글자도** 나오지 않는다.
//
// ★ 2026-09-12 애플 거절(빌드 1.0(4), Guideline 3.1.1 + 3.1.3(c))로 전제가 바뀌었다.
//   "조직에 파는 기업용"이라고 선언했으나 같은 서비스를 개인 사장에게도 팔고 있었고,
//   유료 게이팅(무료 좌석 3명·AI 월 150건·2번째 매장부터 multi)이 앱 안에 살아 있는 채
//   그 해제만 웹에서 받았다 → "IAP 없이 개인에게 판매"로 판정됐다.
//   → 3.1.3(f) Free Stand-alone Apps 면제 주장은 **폐기**한다. 개인(단일)·다점포 모두 iOS IAP 로 판다.
//   → 웹 결제는 프랜차이즈 본사·조직 계약용으로 존치하되 iOS 빌드 경로에서는 계속 비노출이다.
//
// ★ SHOW_SOCIAL_LOGIN=false (iOS·안드 네이티브)
//   근거: Guideline 4.8. 제3자 소셜 로그인(Google Sign-In)으로 주계정을 만들면 동등한 다른 로그인
//   서비스(사실상 Sign in with Apple)를 함께 제공해야 한다. iOS에서 Google 버튼을 감추면
//   "앱이 오로지 자사 계정 시스템만 사용" 예외에 해당해 면제된다.
//   Sign in with Apple 추가는 9월 1.1 과제.
//   2026-10-04 Q1: 안드도 숨긴다. 앱에 네이티브 구글 로그인 모듈이 없어 버튼을 누르면 무한 로딩이었다.
//
// ★ 2026-08-27: Android 네이티브도 SHOW_BILLING=false.
//   근거: Google Play 결제 정책 — 앱 안에서 쓰는 구독은 Play 결제만 허용, 계좌이체 안내·외부결제 유도는 위반.
//   ⚠️2026-09-13 갱신: 여기 있던 "결제 표면은 웹에서만 보인다"는 더 이상 사실이 아니다.
//   `SHOW_BILLING`(웹 PG·계좌이체)은 양 네이티브에서 계속 false 지만, iOS 는 **다른 축**인
//   `SHOW_IAP` 로 앱 안에서 판다. 두 축을 한 문장으로 읽으면 판정을 또 틀린다.

import { Platform } from 'react-native';
import { socialLoginVisible } from './social-login';

export const IS_IOS_NATIVE = Platform.OS === 'ios';
const IS_NATIVE = Platform.OS !== 'web';

/** 결제·가격·요금제 표면을 노출해도 되는가(플랫폼 축 — 빌드 시점에 고정). 웹에서만 true. */
export const SHOW_BILLING = !IS_NATIVE;

/**
 * 결제 표면을 지금 보여도 되는가 — **플랫폼 축 + 운영 축을 합친 최종 판정.**
 *
 * `freeMode` = 서버 스위치 `app_config.billing_free_mode`(세션의 `freeMode`).
 * 전면 무료를 켜 둔 동안 "무료입니다"라고 공지하면서 같은 앱에서 계좌번호와 입금 버튼을 띄우면
 * 사장은 내야 하는 줄 알고 돈을 보낸다 — 받을 이유가 없는 돈이라 환불 응대가 남는다.
 *
 * ★화면마다 `freeMode ? … : …`를 새로 적지 말 것. 2026-08-11 실측 QA [P8-#5]가 잡은 것이
 * 정확히 그 상태였다 — 설정 화면에만 분기가 있고 `/billing` 에는 없어 두 화면이 다른 말을 했다.
 */
export function showPaymentSurface(freeMode: boolean): boolean {
  return SHOW_BILLING && !freeMode;
}

/**
 * 인앱결제(스토어 결제) 표면을 노출해도 되는가 — **플랫폼별 스토어 관문 축.**
 *
 * `SHOW_BILLING`(웹 PG·계좌이체 표면)과 다른 축이다. 둘을 한 상수로 합치면 웹 결제 문구가
 * 앱에 새거나(스토어 위반) 그 반대가 된다 — 채널이 다르므로 판정도 따로다.
 *
 *   - iOS: **2026-09-12 개방.** 3.1.1 + 3.1.3(c) 거절의 시정이라 관문을 기다리지 않는다 —
 *     IAP 가 없는 채로는 재제출해도 같은 사유로 또 거절된다. 심사 메모의 3.1.3(f) 면제 주장도 같이 지운다
 *     (정본 = `출시서류_iOS/03_AppStoreConnect_입력텍스트_전체목록_2026-09-04.md` §7).
 *   - Android: **2026-09-18 개방.** 사장이 앱 안에서 이용권을 살 수 있는 경로를 iOS 와 같게 둔다
 *     (사용자 결정 — 한쪽만 팔면 같은 제품이 기기에 따라 다른 물건이 된다).
 *     ★여는 조건은 코드가 아니라 콘솔에 있다: Play 구독 상품 5개 + RevenueCat Android 앱·서비스계정 +
 *     빌드에 `EXPO_PUBLIC_RC_ANDROID_KEY`. 키가 없으면 `HAS_IAP` 가 false 라 표면은 어차피 안 뜬다.
 */
const IAP_READY_IOS = true;
const IAP_READY_ANDROID = true;

export const SHOW_IAP =
  Platform.OS === 'ios' ? IAP_READY_IOS : Platform.OS === 'android' ? IAP_READY_ANDROID : false;

/**
 * 웹 카드 정기결제(토스페이먼츠 빌링, 0208) 표면을 그려도 되는가 — 웹 결제 축(`SHOW_BILLING`) 안의 하위 채널.
 *
 * 스위치 = 클라이언트 키(`EXPO_PUBLIC_TOSS_CLIENT_KEY`, Vercel 환경변수). 키가 없으면 계좌이체만 보인다 —
 * 카드사 심사 전후로 켜고 끄는 데 코드 변경이 필요 없다. 테스트 키로 켜 둔 동안 누가 결제할 수 있는지는
 * 서버(card-billing 엣지의 허용 목록)가 정한다.
 * ⛔네이티브에서는 항상 false — `SHOW_BILLING` 과 같은 근거(앱 안 외부결제 금지).
 */
export const SHOW_CARD_BILLING = SHOW_BILLING && !!process.env.EXPO_PUBLIC_TOSS_CLIENT_KEY;

/**
 * 지금 앱에서 이용권을 팔아도 되는가 — **빌드 축(SHOW_IAP) + 서버 축(iapEnabled) + 운영 축(freeMode).**
 *
 * ★서버 축이 있는 이유 = **롤백.** 네이티브는 OTA 가 없으므로(expo-updates 미사용) 빌드 상수만으로는
 * 문제가 생겼을 때 새 빌드 + 스토어 심사(며칠) 없이 되돌릴 수 없다. 판매 중단은 서버 행 하나로 즉시.
 *
 * ⚠️ 이 함수가 false 가 되어도 **이미 산 사람의 구독은 스토어가 계속 청구한다.** 우리가 끌 수 있는 것은
 * "새로 파는 것"뿐이다 — 진짜 중단은 스토어 콘솔에서 상품을 내리고 기존 구독을 취소·환불하는 일이다.
 * 그래서 웹훅은 이 스위치와 무관하게 계속 처리한다(돈 낸 사람이 잠기는 쪽이 더 큰 사고다).
 */
export function showIapSurface(iapEnabled: boolean, freeMode: boolean): boolean {
  return SHOW_IAP && iapEnabled && !freeMode;
}

/**
 * `/billing` 으로 **가는 길**(설정의 구독 행·매장 추가·다점포 안내)을 보여도 되는가 — 채널 무관.
 *
 * ★2026-09-12: `SHOW_IAP` 만 열면 iOS 에서 결제 경로가 **여전히 0개**다. `/billing` 진입점 4곳이
 * 전부 `SHOW_BILLING`(웹 PG 축)으로 잠겨 있어 사장이 그 화면에 도달할 수 없었다
 * (사장 페이월 강제 라우팅은 2026-08-06 에 제거됐고, 남은 강제 진입은 잠긴 직원뿐이다).
 * 도착지의 표면 판정(`showPaymentSurface`·`showIapSurface`)과 **가는 길의 판정은 다른 물음**이라
 * 여기서 한 번만 합친다 — 화면마다 `||` 를 새로 적지 않는다.
 *
 * 읽는 곳 = `stores.tsx`(매장 추가) · `PlanUpgradeNotice.tsx`(다점포 가드) · `owner/onboarding.tsx`(첫 안내).
 * `account-settings.tsx` 만 두 축을 각각 본다 — 길만 갈리는 게 아니라 **그리는 것이 다르기 때문**이다
 * (웹은 `PricingTable`(웹 가격 정본), 스토어 축은 가격 없는 행 하나 — 두 채널의 금액이 다르다).
 */
export function showBillingEntry(iapEnabled: boolean, freeMode: boolean): boolean {
  return showPaymentSurface(freeMode) || showIapSurface(iapEnabled, freeMode);
}

/**
 * 한도 안내(AI 사용량 도달 등)에서 "요금제를 바꾸면 된다"고 말해도 되는가 —
 * **사장**이면서 `/billing` 으로 가는 길이 열린 채널일 때만(매니저·직원은 요금제를 못 바꾼다).
 * 읽는 곳 = `quiz-new.tsx` · `QuizEditorSheet.tsx` · `HandoverImport.tsx`(tiers.aiCapNextStep 에 넘긴다).
 */
export function showUpgradeHint(s: { role: string | null; iapEnabled: boolean; freeMode: boolean }): boolean {
  return s.role === 'owner' && showBillingEntry(s.iapEnabled, s.freeMode);
}

/**
 * 매장을 **늘릴 때** 오늘 얼마를 받고 결제일이 어떻게 되는가 — 사장에게 하는 말이 갈리는 유일한 자리다.
 *
 *   - `refund`(애플): 새 요금 **전액**을 오늘 받고, 안 쓴 기간은 결제 수단으로 환불한다. 결제일은 오늘 기준으로 초기화.
 *   - `prorated`(플레이): 남은 기간의 **차액만** 오늘 받고, **결제일은 그대로**다(CHARGE_PRORATED_PRICE).
 *
 * 스토어가 실제로 하는 일이 다르므로 문구를 통일할 수 없다. 하나를 골라 양쪽에 쓰면 한쪽 사장은
 * 오지 않는 환불을 기다리거나, 안 나갈 금액을 각오하고 버튼을 누른다. 결제 동작 자체는 `lib/iap/purchases.ts`.
 */
export const UPGRADE_CREDIT: 'refund' | 'prorated' = Platform.OS === 'android' ? 'prorated' : 'refund';

/** 소셜 로그인 버튼을 노출해도 되는가. 웹에서만 true(= !IS_NATIVE). 근거는 social-login.ts. */
export const SHOW_SOCIAL_LOGIN = socialLoginVisible(Platform.OS);

/**
 * 사용 안내 팝업 가이드(GuideHost)를 띄워도 되는가 — **단계적 적용 축**.
 *
 * 코드 자체는 플랫폼을 가리지 않는다(ConfirmModal 과 같은 Modal + frameCapStyle).
 * 다만 네이티브는 edge-to-edge 에서 Modal 이 translucent 로 강제되는 자리가 있어
 * 딤이 상태바·내비바까지 제대로 덮는지 **실기기로 봐야** 판정이 선다.
 * → 웹에서 먼저 검증하고, 실기기 확인이 끝나면 이 상수만 지운다(화면 코드는 안 건드린다).
 */
export const SHOW_GUIDE_POPUP = !IS_NATIVE;

/**
 * 본사 대시보드(`/hq/*`)를 띄워도 되는가 — **채널 축**.
 *
 * 본사 담당자는 넓은 데스크톱 화면에서만 일한다(기획정본 §5-1: 본사 화면에 폰 레이아웃 금지).
 * 스토어 앱에는 본사 화면이 존재할 이유가 없어, 네이티브에서는 라우트 자체를 안내 화면으로 막는다.
 * 읽는 곳 = `src/app/hq/_layout.tsx` · `components/shell/AppShell.web.tsx`.
 */
export const SHOW_HQ_CONSOLE = !IS_NATIVE;

/**
 * 사장·매니저가 웹에서 넓은 사장 웹 셸(사이드바)을 보는가 — **사업 판단 축**(2026-10-02 사용자 결정).
 *
 * 본사 대시보드를 머지할 때 사장 웹 화면은 그대로 두기로 했다. Toss 카드사 심사관이 사장 계정으로
 * 웹 결제 화면을 보고 있어서, 심사 중에 그 화면의 모양이 바뀌면 안 된다.
 * false 면 사장·매니저도 폰 프레임(ResponsiveShell)이다. 심사가 끝나면 이 값만 true 로 바꾼다.
 * 읽는 곳 = `components/shell/AppShell.web.tsx` 하나(TwoPane 은 셸 종류를 따라 같이 꺼진다).
 */
export const SHOW_OWNER_WEB_SHELL = false;

/**
 * 웹에서 'PWA 설치(홈 화면에 추가)'를 권해도 되는가 — **채널 축**.
 *
 * 네이티브 앱이 양쪽 스토어에 나가 있으므로 웹에서 설치를 따로 권하지 않는다(2026-09-22 결정).
 * ★헤드 주입·서비스워커 등록·정적 규약 파일(`apple-touch-icon` 등)은 그대로 둔다 —
 *   캐치올 리라이트가 없는 파일을 404 대신 HTML 로 돌려주는 불변식 때문이다(PWA 메모리).
 * 지금 가리는 자리 = `NotificationEnableCard` 의 iOS 사파리 설치 안내 하나(실측 2026-09-22,
 * `beforeinstallprompt` 사용처 0건).
 */
export const SHOW_PWA_INSTALL = false;

/**
 * 웹 푸시 구독을 등록해도 되는가 — **채널 축**.
 *
 * 알림은 폰 앱이 받는다(2026-09-22 결정). 네이티브 푸시는 이 상수와 무관하다.
 * 읽는 곳 = `usePushBootstrap`(자동 재구독) · `NotificationEnableCard`(켜기 CTA) ·
 * `NotificationPermissionSheet`(첫 진입 시트) — 웹 분기 셋 전부.
 */
export const WEB_PUSH_ENABLED = false;
