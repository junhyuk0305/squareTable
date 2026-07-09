// lib/analytics/posthog.ts
// PostHog 연동(웹 전용) — 반드시 track.ts 를 통해서만 쓴다(계측 진입점 SSOT).
// 역할 분담: Supabase app_events = 원본 데이터(우리 DB, 서버측 집계·해자 데이터셋),
//            PostHog = 탐색·시각화(DAU/리텐션/퍼널 대시보드 + autocapture/세션리플레이).
//
// track.ts 3원칙 그대로 적용:
//   ① 절대 throw 하지 않는다.  ② 실패는 조용히 삼킨다.
//   ③ 키(EXPO_PUBLIC_POSTHOG_KEY)가 없거나 웹이 아니면 무해하게 no-op
//      — 로컬 mock 개발/네이티브 빌드에선 아무것도 전송하지 않는다.
//
// phc_* 프로젝트 키는 공개돼도 되는 write-only 클라이언트 키(Supabase anon 키와 같은 성격).

import type { PostHog } from 'posthog-js';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let _ph: PostHog | null = null;

export function initPostHog(): void {
  try {
    if (_ph || !KEY) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return; // 웹 전용
    // 웹에서만 lazy require — 네이티브 런타임에선 호출되지 않아 실행 비용 0.
    const posthog = (require('posthog-js') as { default: PostHog }).default;
    posthog.init(KEY, {
      api_host: HOST,
      defaults: '2025-05-24', // SPA(history) pageview 자동 캡처 포함 권장 기본값
      person_profiles: 'identified_only', // 로그인 전 익명 이벤트는 프로필 미생성(비용·노이즈 절감)
      session_recording: { maskAllInputs: true }, // 리플레이 켜도 입력값(비번·전화번호)은 항상 마스킹
    });
    _ph = posthog;
  } catch {
    // 계측은 절대 앱을 깨지 않는다.
  }
}

// 세션 컨텍스트 변화(track.setAnalyticsContext)를 PostHog 신원에 반영.
// register: unit_id/role 을 super property 로 — autocapture 포함 모든 이벤트에 매장 태깅.
// identify: 로그인 시 1회(브라우저가 바뀌어도 같은 사람으로 합쳐짐).
// reset  : 로그아웃 전이(값→null)에만 — 공용 기기에서 다음 사용자와 섞이지 않게.
export function phSetContext(
  ctx: { userId: string | null; unitId: string | null; role: string | null },
  prevUserId: string | null,
): void {
  try {
    if (!_ph) return;
    _ph.register({ unit_id: ctx.unitId, role: ctx.role });
    if (ctx.userId) _ph.identify(ctx.userId, { role: ctx.role, unit_id: ctx.unitId });
    else if (prevUserId) _ph.reset();
  } catch {
    // no-op
  }
}

export function phCapture(event: string, props?: Record<string, unknown>): void {
  try {
    _ph?.capture(event, props);
  } catch {
    // no-op
  }
}
