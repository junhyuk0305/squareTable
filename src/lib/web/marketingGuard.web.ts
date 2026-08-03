// 마케팅 경로 가드(웹 전용) — "앱=실무 전용 / 웹=판매 전용" 경계를 런타임에서 강제한다.
//
// 왜 앱 코드에 있나: 판매 화면을 앱에 만드는 게 아니라, **앱이 마케팅 경로에서 뜨는 것을 막는** 가드다.
//   1차 방어는 vercel.json rewrite(정적 파일 직접 서빙 — 프로덕션에서 앱 번들이 아예 안 뜬다).
//   그런데 rewrite 는 Vercel 배포에만 있다. **Expo 개발 서버(localhost:8081)** 는 모든 경로를 SPA 로
//   넘기므로 /features 같은 주소가 앱 라우터로 들어가 404 화면(앱 레이아웃)이 뜬다.
//   그래서 개발·프로덕션 어디서든 동작하는 마지막 방어선을 앱 부팅 경로에 둔다.
//
// 실행 시점: RootLayout 모듈 평가 시(=React 렌더 전) 1회. 그래서 앱 UI 가 한 프레임도 그려지지 않는다.
// 로그인 여부는 보지 않는다 — 마케팅 경로는 누구에게나 웹 레이아웃이어야 한다(2026-08-03 사용자 확정).
import marketing from '@/data/marketing-paths.json';

const PAGES: string[] = marketing.pages;
const ALIASES: Record<string, string> = marketing.aliases;

export function guardMarketingRoutes(): void {
  if (typeof window === 'undefined' || !window.location) return;
  try {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return; // 루트는 세션 유무로 갈린다(별도 처리)

    const slug = path.slice(1);
    const alias = ALIASES[slug];
    if (alias) {
      window.location.replace(alias);
      return;
    }
    if (PAGES.includes(slug)) {
      // 해시(#ai 등 섹션 앵커)는 그대로 넘겨 도착 위치를 보존한다.
      window.location.replace(`/${slug}.html${window.location.hash}`);
    }
  } catch {
    // 가드 실패가 앱 부팅을 막아선 안 된다.
  }
}
