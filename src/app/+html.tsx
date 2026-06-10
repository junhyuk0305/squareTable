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
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
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
