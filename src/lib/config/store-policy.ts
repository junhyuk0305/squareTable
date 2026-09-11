// 플랫폼 **정책 차이**(스토어 규정·법·사업 판단으로 "보이나/안 보이나·어느 채널인가"가 갈리는 것)의 판정 SSOT.
// 화면은 이 파일의 상수만 읽는다 — Platform.OS 를 화면에서 직접 보지 않는다(2곳 복제 금지).
// 상수 이름은 플랫폼이 아니라 이유로 짓는다(IS_IOS ✗ → SHOW_BILLING ✓). 각 상수 위에 근거를 남긴다.
// 플랫폼 API 가 달라 코드가 갈리는 **구현 차이**는 여기가 아니라 확장자 쌍(.web/.ios/.android)으로 —
// 절차: .claude/rules/platform.md · /platform-split.
//
// ★ SHOW_BILLING=false (iOS 네이티브)
//   근거: App Review Guideline 3.1.3(f) Free Stand-alone Apps —
//   "provided there is no purchasing inside the app, or calls to action for purchase outside of the app."
//   3.1.1(a)에 따라 한국 스토어프론트는 외부결제 버튼·링크·CTA도 금지된다(미국 스토어프론트만 예외).
//   한국 전기통신사업법 대응인 StoreKit External Purchase Entitlement(KR)는 26% 수수료 +
//   한국 전용 별도 바이너리 + 월별 정산 보고 의무라 채택하지 않는다.
//   → iOS 앱은 "유료 웹 서비스의 무료 컴패니언"으로 두고, 결제는 dochackchack.com 에서만 받는다.
//
// ★ SHOW_SOCIAL_LOGIN=false (iOS 네이티브)
//   근거: Guideline 4.8. 제3자 소셜 로그인(Google Sign-In)으로 주계정을 만들면 동등한 다른 로그인
//   서비스(사실상 Sign in with Apple)를 함께 제공해야 한다. iOS에서 Google 버튼을 감추면
//   "앱이 오로지 자사 계정 시스템만 사용" 예외에 해당해 면제된다.
//   Sign in with Apple 추가는 9월 1.1 과제.
//
// ★ 2026-08-27: Android 네이티브도 SHOW_BILLING=false.
//   근거: Google Play 결제 정책 — 앱 안에서 쓰는 구독은 Play 결제만 허용, 계좌이체 안내·외부결제 유도는 위반.
//   1차 스토어 제출은 양 플랫폼 모두 결제 표면 없이 나가고, 인앱결제(IAP)는 2차에서 붙인다.
//   결제 표면은 웹(dochackchack.com)에서만 보인다.

import { Platform } from 'react-native';

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
 * ⛔ 아래 두 상수를 켜는 것은 **각 스토어 관문을 통과한 뒤**이고, 그 변경만 담은 별도 커밋으로 낸다.
 *   - iOS: 1.0.0 승인·출시 후. 지금 심사 중인 1.0 은 심사 메모에 "앱 안에 인앱결제·가격 표시가 없다"
 *     (Guideline 3.1.3(f) Free Stand-alone Apps)라고 선언해 뒀다 — 여기를 먼저 켜면 그 선언이 거짓이 된다.
 *     IAP 를 붙인 1.1 을 낼 때 심사 메모도 함께 고친다
 *     (정본 = `출시서류_iOS/03_AppStoreConnect_입력텍스트_전체목록_2026-09-04.md` §7).
 *   - Android: 프로덕션 액세스(개인 계정 = 테스터 12명 × 14일) 통과 후.
 */
const IAP_READY_IOS = false;
const IAP_READY_ANDROID = false;

export const SHOW_IAP =
  Platform.OS === 'ios' ? IAP_READY_IOS : Platform.OS === 'android' ? IAP_READY_ANDROID : false;

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

/** 소셜 로그인 버튼을 노출해도 되는가. */
export const SHOW_SOCIAL_LOGIN = !IS_IOS_NATIVE;

/**
 * 사용 안내 팝업 가이드(GuideHost)를 띄워도 되는가 — **단계적 적용 축**.
 *
 * 코드 자체는 플랫폼을 가리지 않는다(ConfirmModal 과 같은 Modal + frameCapStyle).
 * 다만 네이티브는 edge-to-edge 에서 Modal 이 translucent 로 강제되는 자리가 있어
 * 딤이 상태바·내비바까지 제대로 덮는지 **실기기로 봐야** 판정이 선다.
 * → 웹에서 먼저 검증하고, 실기기 확인이 끝나면 이 상수만 지운다(화면 코드는 안 건드린다).
 */
export const SHOW_GUIDE_POPUP = !IS_NATIVE;
