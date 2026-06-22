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
}
