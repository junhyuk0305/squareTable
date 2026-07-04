/**
 * PWA 헤드 태그 런타임 주입 (웹 전용).
 *
 * 왜 런타임 주입인가: app.json 이 web.output="single" (SPA) 이라
 * Expo 가 export 시 +html.tsx 를 무시하고 기본 index.html 만 생성한다.
 * 그래서 manifest·apple-touch-icon·전체화면 메타를 빌드 결과에 못 넣는다.
 * → 앱 부팅 시 document.head 에 직접 주입한다.
 *
 * 안전성: 같은 selector 가 이미 있으면 건너뛴다(static 모드로 바꿔
 * +html.tsx 가 살아나도 중복 생성 안 됨). native 에서는 document 가 없어 즉시 반환.
 */
export function injectPwaHead(): void {
  if (typeof document === 'undefined') return;

  document.documentElement.lang = 'ko';

  // iOS PWA: 입력창을 탭/포커스할 때 화면이 확대(zoom)되는 기본 동작을 막는다.
  // output=single 빌드의 기본 index.html viewport 에는 maximum-scale 가 없어,
  // 폰트 16px 미만 input 에 포커스하면 Safari 가 확대된다. 여기서 런타임에 덮어쓴다.
  // (고정 모바일 프레임 앱이라 핀치줌은 필요 없다.)
  {
    const vpContent =
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    const vp = document.head.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', vpContent);
    else {
      const m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      m.setAttribute('content', vpContent);
      document.head.appendChild(m);
    }
  }

  // 브라우저 탭 제목 = 브랜드명. (output=single 빌드의 index.html 은 app.json name 을
  // 쓰므로 app.json 도 '착착' 으로 맞췄고, 여기서 런타임에도 한 번 더 보장한다.)
  document.title = '착착';

  // 브라우저 탭 favicon — Expo 기본 아이콘(∧)을 우리 로고로 교체한다.
  // dev/단일빌드(index.html)에 기본 icon 링크가 이미 있어 ensure() 로는 못 덮으므로,
  // 기존 rel="icon" / "shortcut icon" 을 지우고 새로 단다. (apple-touch-icon 은 단일 토큰이라 보존)
  // PWA·홈화면 아이콘(/icon.png)과 같은 이미지를 써서 탭·설치앱 아이콘을 통일한다.
  document.head
    .querySelectorAll('link[rel~="icon"]')
    .forEach((el) => el.parentNode?.removeChild(el));
  const favicon = document.createElement('link');
  favicon.setAttribute('rel', 'icon');
  favicon.setAttribute('type', 'image/png');
  favicon.setAttribute('href', '/icon.png');
  document.head.appendChild(favicon);

  const ensure = (
    tag: 'meta' | 'link',
    selector: string,
    attrs: Record<string, string>,
  ) => {
    if (document.head.querySelector(selector)) return;
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  };

  // 안드로이드/크롬: 설치 배너·아이콘·standalone
  ensure('link', 'link[rel="manifest"]', { rel: 'manifest', href: '/manifest.json' });
  ensure('meta', 'meta[name="theme-color"]', { name: 'theme-color', content: '#F7F5F0' });
  ensure('meta', 'meta[name="mobile-web-app-capable"]', {
    name: 'mobile-web-app-capable',
    content: 'yes',
  });

  // iOS Safari: manifest 를 거의 안 보므로 아래로 전체화면·아이콘 지정
  ensure('meta', 'meta[name="apple-mobile-web-app-capable"]', {
    name: 'apple-mobile-web-app-capable',
    content: 'yes',
  });
  ensure('meta', 'meta[name="apple-mobile-web-app-status-bar-style"]', {
    name: 'apple-mobile-web-app-status-bar-style',
    content: 'default',
  });
  ensure('meta', 'meta[name="apple-mobile-web-app-title"]', {
    name: 'apple-mobile-web-app-title',
    content: '착착',
  });
  ensure('link', 'link[rel="apple-touch-icon"]', {
    rel: 'apple-touch-icon',
    href: '/icon.png',
  });

  // 스크롤바 숨김(웹 전역) — 스크롤 기능은 유지하고 오른쪽/하단 바만 시각적으로 제거.
  // SPA(output=single)라 +html 의 <style> 이 빌드에 안 들어가므로 런타임에 주입한다.
  if (!document.head.querySelector('#st-no-scrollbar')) {
    const style = document.createElement('style');
    style.id = 'st-no-scrollbar';
    style.textContent =
      '*{scrollbar-width:none !important;-ms-overflow-style:none !important;}' +
      '*::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important;}';
    document.head.appendChild(style);
  }

  // 전역 기본 배경 — 미지정 시 브라우저 흰색이 로딩·오버스크롤·프레임 밖에서 새어 나온다.
  // (output=single 빌드는 +html 의 <style> 이 안 들어가므로 런타임에 주입한다.)
  // 모바일: 페이퍼(#F1EFE9 = 앱 메인 배경·스플래시와 동일). 넓은 화면: 프레임 밖 거터색.
  if (!document.head.querySelector('#st-base-bg')) {
    const bg = document.createElement('style');
    bg.id = 'st-base-bg';
    bg.textContent =
      'html,body{background-color:#F1EFE9;}' +
      '@media(min-width:501px){html,body{background-color:#E9E7E0;}}';
    document.head.appendChild(bg);
  }

  // 전역 폰트 — Pretendard + 폴백 스택. output=single 빌드엔 +html 의 FONT_CSS 가 안 실려
  // 프로덕션이 브라우저 기본 세리프(Times New Roman)로 렌더됐고, 굵은 한글은 브라우저가
  // 가짜볼드(글자를 살짝 겹쳐 찍어 굵기 흉내)로 합성해 잔상/깨짐이 생겼다.
  // font-synthesis:none 으로 흉내를 끄고 폴백 폰트의 실제 굵기를 쓰게 해 어떤 기기든 또렷하게.
  if (!document.head.querySelector('#st-font')) {
    const font = document.createElement('style');
    font.id = 'st-font';
    font.textContent =
      "html,body,#root{font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont," +
      "system-ui,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif;" +
      '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-synthesis:none;}';
    document.head.appendChild(font);
  }
  // Pretendard 가변폰트(CDN). 이미 링크가 있으면(+html/static 모드) 중복 주입을 건너뛴다.
  if (!document.head.querySelector('link[href*="pretendard"]')) {
    const pre = document.createElement('link');
    pre.setAttribute('rel', 'stylesheet');
    pre.setAttribute(
      'href',
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css',
    );
    document.head.appendChild(pre);
  }
}
