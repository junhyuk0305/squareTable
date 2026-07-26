// 스토어 심사 규칙 때문에 플랫폼별로 감춰야 하는 표면의 판정 SSOT.
// 화면은 이 파일의 상수만 읽는다 — Platform.OS 를 화면에서 직접 보지 않는다(2곳 복제 금지).
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
// 웹(Platform.OS==='web')과 Android 는 둘 다 true — 기존 동작이 그대로 유지된다.

import { Platform } from 'react-native';

export const IS_IOS_NATIVE = Platform.OS === 'ios';

/** 결제·가격·요금제 표면을 노출해도 되는가. */
export const SHOW_BILLING = !IS_IOS_NATIVE;

/** 소셜 로그인 버튼을 노출해도 되는가. */
export const SHOW_SOCIAL_LOGIN = !IS_IOS_NATIVE;
