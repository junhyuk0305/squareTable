// SEO 후처리 (웹 빌드 전용) — `npx expo export -p web` 직후 dist 를 패치한다.
//
// 왜 이 방식인가:
//   web.output="single"(SPA)이라 Expo 는 +html.tsx 를 무시하고 내용 없는 index.html 만 낸다
//   (crawler 는 <html lang="en"> + title 뿐인 빈 껍데기를 본다). 실제 마케팅 콘텐츠는
//   정적 welcome.html 에 있는데 JS 리다이렉트로만 도달 → 네이버 Yeti(JS 약함)·카톡/인스타
//   공유 스크래퍼가 루트에서 아무것도 못 본다. 그래서 빌드 산출물(dist)에 후처리로
//   메타·og·JSON-LD·noscript 를 심고 robots.txt/sitemap.xml 을 생성한다.
//
//   런타임 앱 코드(index.tsx·+html.tsx)는 전혀 건드리지 않는다 — 크롤러가 보는 정적 HTML 만
//   풍부하게 만든다. 사람은 여전히 기존 JS 리다이렉트로 welcome.html 을 본다.
//
// 안전성: 모든 주입은 마커(<!-- seo:start --> … <!-- seo:end -->)로 감싸 idempotent.
//   재실행 시 기존 블록을 걷어내고 다시 넣으므로 중복되지 않는다.
//
// 도메인은 아래 SITE_URL 단일 상수(Vercel 환경변수 SEO_SITE_URL 로 override 가능).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

// ── 설정 ───────────────────────────────────────────────────────────────
const SITE_URL = (process.env.SEO_SITE_URL || 'https://dochackchack.com').replace(/\/+$/, '');
const OG_IMAGE = `${SITE_URL}/icon-512.png`; // TODO: 1200×630 전용 OG 이미지로 교체 권장(현재 정사각 아이콘 임시)
const BRAND = '착착';
const TITLE = '착착 — 할 일이 착착 끝나는 가게';
const DESC =
  '사장님 머릿속 노하우를 가게 전용 AI로. 직원이 묻는 순간, 우리 가게 방식 그대로 답이 나옵니다. 카페·헬스장·학원·미용실 매장 운영 AI, 착착.';
const OG_DESC = '사장님이 한 번 알려주면, 직원이 물을 때 AI가 우리 가게 방식 그대로 대신 답해요.';
// 검색엔진 소유확인(선택) — Vercel 환경변수로 넣으면 자동 주입. 없으면 생략.
const NAVER_VERIFY = process.env.SEO_NAVER_VERIFY || '';
const GOOGLE_VERIFY = process.env.SEO_GOOGLE_VERIFY || '';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ── 공통 조각 ───────────────────────────────────────────────────────────
const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: BRAND,
      url: `${SITE_URL}/`,
      logo: OG_IMAGE,
      email: 'contact@team-roundtable.com',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: BRAND,
      inLanguage: 'ko-KR',
      publisher: { '@id': `${SITE_URL}/#org` },
    },
    {
      '@type': 'SoftwareApplication',
      name: BRAND,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      url: `${SITE_URL}/`,
      description: DESC,
      inLanguage: 'ko-KR',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
      featureList: [
        '우리 가게 노하우를 AI가 즉시 답변',
        '업무 체크 시 채팅 자동 기록·사장님 알림',
        '알바 교대 근무 요청과 사장님 승인',
        '여러 매장 한 계정 관리·노하우 매장 간 복제',
        '출퇴근·인건비 자동 집계',
      ],
      publisher: { '@id': `${SITE_URL}/#org` },
    },
  ],
});

/** 공용 메타(og/twitter/canonical/robots/JSON-LD). canonicalPath 는 항상 루트로 통일해 링크 신호를 한 곳에 모은다. */
function metaBlock({ withDescription }) {
  const lines = [];
  lines.push('<!-- seo:start (scripts/seo-postbuild.mjs) -->');
  if (withDescription) lines.push(`<meta name="description" content="${esc(DESC)}" />`);
  lines.push('<meta name="robots" content="index,follow,max-image-preview:large" />');
  lines.push(`<link rel="canonical" href="${SITE_URL}/" />`);
  if (NAVER_VERIFY) lines.push(`<meta name="naver-site-verification" content="${esc(NAVER_VERIFY)}" />`);
  if (GOOGLE_VERIFY) lines.push(`<meta name="google-site-verification" content="${esc(GOOGLE_VERIFY)}" />`);
  // Open Graph
  lines.push('<meta property="og:type" content="website" />');
  lines.push('<meta property="og:site_name" content="착착" />');
  lines.push('<meta property="og:locale" content="ko_KR" />');
  lines.push(`<meta property="og:url" content="${SITE_URL}/" />`);
  if (withDescription) {
    lines.push(`<meta property="og:title" content="${esc(TITLE)}" />`);
    lines.push(`<meta property="og:description" content="${esc(OG_DESC)}" />`);
  }
  lines.push(`<meta property="og:image" content="${OG_IMAGE}" />`);
  lines.push('<meta property="og:image:width" content="512" />');
  lines.push('<meta property="og:image:height" content="512" />');
  // Twitter
  lines.push('<meta name="twitter:card" content="summary_large_image" />');
  lines.push(`<meta name="twitter:title" content="${esc(TITLE)}" />`);
  lines.push(`<meta name="twitter:description" content="${esc(OG_DESC)}" />`);
  lines.push(`<meta name="twitter:image" content="${OG_IMAGE}" />`);
  // 구조화 데이터
  lines.push(`<script type="application/ld+json">${jsonLd}</script>`);
  lines.push('<!-- seo:end -->');
  return lines.join('\n    ');
}

/** noscript 마케팅 요약 — JS 미실행 크롤러(네이버 Yeti 등)가 읽을 실제 한글 콘텐츠. */
const NOSCRIPT = `<noscript>
    <!-- seo:noscript:start -->
    <div style="max-width:680px;margin:0 auto;padding:32px 20px;font-family:'Malgun Gothic',sans-serif;line-height:1.7;color:#111">
      <h1>착착 — 할 일이 착착 끝나는 가게</h1>
      <p>사장님 머릿속 노하우를 가게 전용 AI로. 직원이 묻는 순간, 우리 가게 방식 그대로 답이 나옵니다. 카페·헬스장·학원·미용실 매장 운영 AI, 착착.</p>
      <h2>이런 순간, 있으시죠</h2>
      <ul>
        <li>알바가 바뀔 때마다 같은 걸 몇 번씩 다시 설명</li>
        <li>쉬는 날에도 울리는 “사장님, 이건 어떻게 해요?” 전화</li>
        <li>노하우가 머릿속에만 있어 내가 없으면 멈추는 가게</li>
        <li>카톡 공지·메모지·말로 전한 지시가 흩어져 아무도 제대로 안 봄</li>
      </ul>
      <h2>착착이 하는 일</h2>
      <ul>
        <li>우리 가게 노하우, AI가 즉시 답변 — 사장님이 한 번 남긴 답을 직원이 물을 때 대신 답해요</li>
        <li>채팅 업무 — 직원이 할 일을 체크하면 업무 채팅에 자동 기록되고 사장님께 알림</li>
        <li>교대 근무 — 알바끼리 근무를 맞바꾸고 사장님은 승인 한 번으로 끝</li>
        <li>여러 매장을 한 계정에서 — 매장을 오가고 검증된 노하우를 매장 간에 복제</li>
        <li>출퇴근·인건비 자동 집계</li>
      </ul>
      <p>신용카드 없이 무료로 시작 · 매장 1곳 · 직원 3명 · AI 월 300건 무료. 파일럿 매장 무료 모집 중.</p>
      <p><a href="/welcome.html">착착 소개 페이지 보기</a> · <a href="/signup">무료로 시작</a></p>
    </div>
    <!-- seo:noscript:end -->
  </noscript>`;

// ── 유틸 ────────────────────────────────────────────────────────────────
function stripMarker(html, start, end) {
  const re = new RegExp(`[ \\t]*${start}[\\s\\S]*?${end}\\n?`, 'g');
  return html.replace(re, '');
}
function injectBeforeHeadClose(html, block) {
  return html.replace(/<\/head>/i, `    ${block}\n  </head>`);
}

// ── 1) dist/index.html — 루트 SPA 껍데기를 크롤 가능하게 ──────────────────
function patchIndex() {
  const p = resolve(DIST, 'index.html');
  if (!existsSync(p)) throw new Error(`[seo] dist/index.html 없음 — expo export 가 먼저 성공했는지 확인: ${p}`);
  let html = readFileSync(p, 'utf8');

  html = html.replace(/<html lang="[^"]*">/i, '<html lang="ko">');
  // 검색 스니펫 제목 = 설명형. 앱 런타임(head.ts)이 로드 후 document.title 을 '착착'으로 덮으므로
  // 실제 탭 제목엔 영향 없고, JS 미실행 크롤러·검색결과 헤드라인만 풍부해진다.
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(TITLE)}</title>`);
  html = stripMarker(html, '<!-- seo:start \\(scripts/seo-postbuild\\.mjs\\) -->', '<!-- seo:end -->');
  html = injectBeforeHeadClose(html, metaBlock({ withDescription: true }));

  // 기본 noscript(“You need to enable JavaScript”)를 마케팅 콘텐츠로 교체(있으면).
  html = stripMarker(html, '<!-- seo:noscript:wrap:start -->', '<!-- seo:noscript:wrap:end -->');
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, NOSCRIPT);
  if (!/seo:noscript:start/.test(html)) {
    // 기본 noscript 가 없던 경우 body 끝에 삽입
    html = html.replace(/<\/body>/i, `  ${NOSCRIPT}\n</body>`);
  }

  writeFileSync(p, html, 'utf8');
  console.log('[seo] dist/index.html 패치 완료 (lang=ko·description·og·twitter·canonical·JSON-LD·noscript)');
}

// ── 2) dist/welcome.html — 소셜 공유 카드 완성 ────────────────────────────
function patchWelcome() {
  const p = resolve(DIST, 'welcome.html');
  if (!existsSync(p)) {
    console.warn('[seo] dist/welcome.html 없음 — 건너뜀');
    return;
  }
  let html = readFileSync(p, 'utf8');
  // welcome.html 은 이미 og:title/description 을 갖고 있으므로 그 둘은 다시 넣지 않는다.
  html = stripMarker(html, '<!-- seo:start \\(scripts/seo-postbuild\\.mjs\\) -->', '<!-- seo:end -->');
  html = injectBeforeHeadClose(html, metaBlock({ withDescription: false }));
  writeFileSync(p, html, 'utf8');
  console.log('[seo] dist/welcome.html 패치 완료 (og:image·og:url·canonical·twitter·JSON-LD)');
}

// ── 3) robots.txt ────────────────────────────────────────────────────────
function writeRobots() {
  // 마케팅 루트(및 welcome.html)만 색인. 나머지 앱 라우트는 CSR 빈 껍데기라 색인 가치 없음 → 제외.
  const body = [
    'User-agent: *',
    'Allow: /$',
    'Allow: /welcome.html',
    'Allow: /manifest.json',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /stores',
    'Disallow: /owner',
    'Disallow: /junior',
    'Disallow: /billing',
    'Disallow: /complete-profile',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
  writeFileSync(resolve(DIST, 'robots.txt'), body, 'utf8');
  console.log('[seo] dist/robots.txt 생성');
}

// ── 4) sitemap.xml ───────────────────────────────────────────────────────
function writeSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  writeFileSync(resolve(DIST, 'sitemap.xml'), xml, 'utf8');
  console.log('[seo] dist/sitemap.xml 생성');
}

// ── 실행 ────────────────────────────────────────────────────────────────
console.log(`[seo] SITE_URL=${SITE_URL}`);
patchIndex();
patchWelcome();
writeRobots();
writeSitemap();
console.log('[seo] 후처리 완료');
