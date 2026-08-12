/* analytics.js — 방문자 계측. 마케팅 정적 페이지 전용(앱 SPA·법무 페이지 제외).
 *
 * 왜 이 파일이 따로 필요한가: 앱(SPA)의 PostHog 는 번들 안에서 초기화되는데
 *   (src/lib/analytics/posthog.ts), 미로그인 방문자는 dist/index.html 에 주입된 랜딩 리다이렉트
 *   (scripts/inject-landing-redirect.mjs)에 걸려 **번들이 실행되기 전에** /welcome.html 로 튕긴다.
 *   즉 정적 마케팅 페이지는 번들 밖이라 계측이 전혀 닿지 않았고, 홈페이지 방문자수는
 *   지금까지 한 건도 집계되지 않았다(2026-08-12 라이브 확인). 그 구멍을 여기서 메운다.
 *   각 페이지는 <script defer src="/analytics.js"></script> 한 줄만 갖는다(promo.js 와 같은 방식).
 *
 * ★앱과 같은 프로젝트 키를 쓴다 — 같은 도메인이라 distinct_id 쿠키가 공유되고,
 *   방문 → 가입 → 매장 생성이 하나의 퍼널로 이어진다. 키를 바꾸면 여기와 Vercel 환경변수
 *   EXPO_PUBLIC_POSTHOG_KEY 를 **함께** 옮긴다(어긋나면 한 사람이 둘로 쪼개져 퍼널이 죽는다).
 *   phc_* 는 공개돼도 되는 write-only 클라이언트 키다(Supabase anon 키와 같은 성격).
 *
 * 앱 쪽 설정과 일부러 다른 2가지:
 *   · 세션 리플레이 끔 — 정적 소개 페이지는 볼 것이 없고 녹화 쿼터만 먹는다.
 *   · 프로덕션 호스트에서만 발화 — 로컬 개발(npm run web)·프리뷰 배포가 실데이터를 오염시키지 않게.
 *
 * 계측이 페이지를 깨뜨리면 안 된다(track.ts 3원칙과 동일) — 전부 try 안에서 돌고 실패는 삼킨다.
 */
(function () {
  var KEY = 'phc_wZNLeSj3hYqBCuS8kPDedzGoRsMfSGHUFqXoZwSxmiw2';
  var HOSTS = ['dochackchack.com', 'www.dochackchack.com'];

  try {
    if (HOSTS.indexOf(location.hostname) === -1) return;

    var s = document.createElement('script');
    s.src = 'https://us-assets.i.posthog.com/static/array.js';
    s.async = true;
    s.crossOrigin = 'anonymous';
    // array.js 는 로드되면 스스로 window.posthog 를 등록한다(공식 스텁 없이도 init 호출 가능).
    s.onload = function () {
      try {
        window.posthog.init(KEY, {
          api_host: 'https://us.i.posthog.com',
          defaults: '2025-05-24', // SPA/정적 공통 권장 기본값(pageview·autocapture 포함)
          person_profiles: 'identified_only', // 익명 방문자는 프로필 미생성 — 비용·노이즈 절감(앱과 동일)
          disable_session_recording: true,
        });
      } catch (e) {}
    };
    document.head.appendChild(s);
  } catch (e) {}
})();
