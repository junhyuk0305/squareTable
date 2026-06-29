import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * 웹 전용 루트 HTML (native에는 영향 없음).
 * Pretendard Variable 폰트를 주입해 전 화면 타이포그래피를 정제한다.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* ── PWA: "홈 화면에 추가" 설치 + 전체화면 + 푸시 토대 ───────────── */}
        {/* 안드로이드/크롬: manifest 로 설치 배너·아이콘·standalone 모드 활성화 */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F7F5F0" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* iOS Safari: manifest 를 거의 안 보므로 아래 메타로 전체화면·아이콘 지정 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="착착" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        {/* ──────────────────────────────────────────────────────────────── */}

        {/* Pretendard 가변폰트(약 1MB)를 렌더 블로킹으로 받지 않는다.
            ① preconnect 로 CDN(TLS/DNS) 연결을 첫 페인트 전에 미리 연다.
            ② 스타일시트는 인라인 스크립트로 비동기 주입 → 첫 페인트는 아래
               FONT_CSS 의 시스템 한글폰트(Apple SD Gothic / Noto Sans KR / 맑은고딕)로
               즉시 그리고, 폰트 로드가 끝나면 Pretendard 로 자연 swap 된다.
            JSX 의 onLoad="..." 문자열 핸들러는 정적 HTML 로 직렬화되지 않으므로
            media=print/onload 트릭 대신 스크립트 주입을 쓴다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var l=document.createElement('link');" +
              "l.rel='stylesheet';" +
              "l.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css';" +
              'document.head.appendChild(l);})();',
          }}
        />
        <noscript>
          <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
          />
        </noscript>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// !important 를 쓰지 않는다 — 아이콘 폰트(@expo/vector-icons)는 인라인 font-family로
// 지정되므로, important 없는 전역 규칙이면 인라인이 이겨 아이콘이 깨지지 않는다.
// 본문 텍스트는 인라인 폰트가 없어 이 전역 규칙(Pretendard)을 그대로 상속한다.
const FONT_CSS = `
html, body, #root, #__next {
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont,
    system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 스크롤바 숨김(웹 전역) — 스크롤은 유지, 오른쪽/하단 바만 제거 */
* { scrollbar-width: none; -ms-overflow-style: none; }
*::-webkit-scrollbar { display: none; width: 0; height: 0; }

/*
 * 모바일 프레임 중앙 정렬 — CSS로 첫 페인트부터 적용해 새로고침 깜빡임을 제거.
 * (JS 측정 시 SSR→하이드레이션 사이에 풀폭→가운데 점프가 보임)
 * 임계폭 500px = ResponsiveShell의 MAX_W(460) + 거터(40). id는 nativeID로 주입됨.
 */
@media (min-width: 501px) {
  #st-outer {
    align-items: center;
    background-color: #E9E7E0;
  }
  #st-frame {
    max-width: 460px;
    border-left: 1px solid #E8E6DF;
    border-right: 1px solid #E8E6DF;
    box-shadow: 0 0 24px rgba(0, 0, 0, 0.06);
  }
}
`;
