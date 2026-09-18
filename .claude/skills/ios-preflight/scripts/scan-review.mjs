#!/usr/bin/env node
// ios-preflight 심사 스캔 — **App Store 심사에서 반려될 지점**을 코드에서 검출한다.
// 규칙 근거·실사례: .claude/skills/ios-preflight/references/review-gates.md
//
// 사용: node .claude/skills/ios-preflight/scripts/scan-review.mjs           (SquareTable 루트)
//       … --fetch        앱이 여는 외부 URL 을 **실제로 받아** 결제 경로가 있는지 본다(네트워크)
//       … --introspect   expo config --type introspect 로 최종 Info.plist 를 뽑아 본다(느림·1~2분)
// 오탐 억제: 해당 줄(또는 바로 윗줄)에  // ios-preflight: ok <이유>
//
// ⛔scan-ios.mjs 와 규칙이 겹치지 않는다. 저쪽은 "iOS 에서 깨지는가", 여기는 "심사에서 반려되는가".
//   같은 5.1.1 이라도 저쪽은 **문구 누락 → 크래시**, 여기는 **안 쓰는 권한 선언 → 심사 질문**이다.
//
// ★이 스캐너가 존재하는 이유 = 우리는 2026-09-10(2.5.4)·09-12(3.1.1+3.1.3(c)) **두 번 반려됐고**,
//   둘 다 코드에서 미리 볼 수 있는 것이었다. 두 번째는 심지어 **앱 밖(웹사이트)** 까지 봤다.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
if (!existsSync(SRC)) {
  console.error('❌ src/ 가 없다. SquareTable 루트에서 실행하라.');
  process.exit(2);
}
const DO_FETCH = process.argv.includes('--fetch');
const DO_INTROSPECT = process.argv.includes('--introspect');

const files = [];
for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
  if (!e.isFile() || !/\.(ts|tsx)$/.test(e.name)) continue;
  // 웹 전용·안드로이드 전용은 iOS 바이너리에 안 들어간다 = 심사 표면이 아니다.
  if (/\.(web|android)\.(ts|tsx)$/.test(e.name) || e.name === '+html.tsx') continue;
  files.push(path.join(e.parentPath ?? e.path, e.name));
}

const findings = [];
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');
/** level: 🔴 반려 확실 · 🟡 심사관이 물어올 수 있음 · ℹ️ 사람이 확인 */
const add = (level, loc, rule, clause, msg) => findings.push({ level, loc, rule, clause, msg });
const manual = []; // 코드로 못 보는 것 — 사용자 터미널·콘솔에서 확인할 목록

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

const read = new Map();
for (const f of files) read.set(f, readFileSync(f, 'utf8'));
const allSrc = [...read.values()].join('\n');
const suppressed = (raw, line) => {
  const L = raw.split('\n');
  return [L[line - 1] ?? '', L[line - 2] ?? ''].some((l) => l.includes('ios-preflight: ok'));
};

// ── rev-outlink 🔴 — 앱이 여는 외부 링크가 **바깥 결제로 이어지는가** (3.1.1) ─────────────
// 2026-09-12 의 교훈: 애플은 "앱 화면에 결제 버튼이 있나"가 아니라 **개인이 돈을 내면 무엇이 풀리는가**를
// 보고, 그 과정에서 **우리 웹사이트까지 들어가 본다.** 앱에서 연 페이지가 한 번 더 링크해 결제에
// 닿으면 그것도 "외부 결제로 유도하는 CTA"다 — 한국 스토어프론트는 아웃링크 예외가 없다.
const SITE_ORIGIN = (() => {
  const m = allSrc.match(/SITE_ORIGIN\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
})();
const outlinks = new Map(); // url → 첫 위치
const dynamicOutlinks = []; // 목적지를 코드로 확정할 수 없는 것 — 한 줄로 모아 낸다
for (const [f, raw] of read) {
  const src = stripComments(raw);
  for (const m of src.matchAll(/(?:Linking\.openURL|openBrowserAsync)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    let url = m[1];
    if (url.startsWith('mailto:') || url.startsWith('tel:')) continue; // 문의 경로는 결제가 아니다
    if (url.startsWith('${SITE_ORIGIN}') && SITE_ORIGIN) url = url.replace('${SITE_ORIGIN}', SITE_ORIGIN);
    if (!/^https?:\/\//.test(url)) continue; // 변수로 만든 URL 은 아래 동적 경고에서 본다
    const line = lineOf(src, m.index);
    if (suppressed(raw, line)) continue;
    if (!outlinks.has(url)) outlinks.set(url, `${rel(f)}:${line}`);
  }
  // 변수로 조립한 외부 URL — 정적으로는 목적지를 모른다. 사람이 확인할 목록으로 넘긴다.
  for (const m of src.matchAll(/(?:Linking\.openURL|openBrowserAsync)\(\s*(?![`'"])([A-Za-z_$][\w$.]*)/g)) {
    const line = lineOf(src, m.index);
    if (suppressed(raw, line)) continue;
    // 같은 파일에서 그 변수가 mailto: 로 조립됐으면 결제 경로가 아니다(문의 메일).
    if (new RegExp(`${m[1].replace(/[$.]/g, '\\$&')}\\s*=\\s*[\`'"]mailto:`).test(src)) continue;
    dynamicOutlinks.push(`${rel(f)}:${line} (${m[1]})`);
  }
}

/**
 * 페이지가 **결제로 갈 수 있는 자리**인가. 단순히 요금을 설명하는 법률 문서와 구분한다.
 *
 * ★이 구분이 규칙의 전부다. 약관·처리방침은 "결제 수단·계좌번호를 수집한다"고 **설명**해야 하고
 *   그건 위반이 아니다(오히려 5.1.1(i) 요구사항이다). 위반은 **거기서 결제로 갈 수 있을 때**다.
 *   구분을 안 하면 법률 문서 링크마다 🔴이 뜨고, 그 순간 이 검사는 아무도 안 보는 검사가 된다.
 */
const LEGAL_PATHS = /\/(terms|privacy|ai-policy|business-info|dpa|account-deletion)(\/|$|\?)/i;
function purchasePathIn(url, html) {
  const hits = [];
  const isLegal = LEGAL_PATHS.test(url);
  const anchors = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  // 법률 문서라도 **결제 화면으로 가는 앵커**는 위반이다(설명이 아니라 길이다).
  const anchorRe = isLegal ? /\/(checkout|order|payment|subscribe)/i : /\/(pricing|plans|checkout|order|billing|payment)/i;
  for (const a of anchors) if (anchorRe.test(a)) hits.push(`결제/요금 페이지로 가는 링크: ${a}`);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // 법률 문서는 계좌·결제를 **서술**한다 → 행동 유도 문구만 본다.
  const words = isLegal ? ['결제하기', '구독하기', '카드 등록'] : ['계좌번호', '무통장', '입금 계좌', '입금해', '결제하기', '구독하기', '카드 등록'];
  for (const w of words) if (text.includes(w)) hits.push(`본문에 "${w}"`);
  // ★2026-09-14 사각지대 ① — 법률 문서의 결제 서술을 통째로 빼서 **요금 페이지 주소**와 **입금 절차**를 못 잡았다
  //   (09-13 약관 제11조의 "웹(https://dochackchack.com/pricing)"이 그대로 통과했다).
  //   오탐 기준: 서술(허용) = "계좌이체 방식으로 결제한다"·"계좌번호를 수집하지 않는다" 같은 사실 고지.
  //             길(🔴)   = 요금·결제 페이지 **주소**(링크가 아니어도 적어 두면 찾아간다) · 계좌번호 · 입금하라는 **절차**.
  if (isLegal) {
    for (const m of text.matchAll(/\S*\/(pricing|plans|billing|checkout)(?![\w-])/gi)) hits.push(`본문에 요금·결제 페이지 주소 "${m[0]}"`);
    for (const w of ['계좌로 입금', '입금해 주', '입금해주', '입금하시면', '아래 계좌']) if (text.includes(w)) hits.push(`본문에 입금 절차 "${w}"`);
    const acct = text.match(/(계좌|입금)[^.。]{0,30}?\d{2,6}-\d{2,6}-\d{2,8}/);
    if (acct) hits.push(`본문에 계좌번호 "${acct[0]}"`);
  }
  return [...new Set(hits)]; // 같은 앵커가 여러 번 나오는 페이지(메뉴·푸터)에서 한 줄만 낸다
}

if (outlinks.size > 0) {
  if (!DO_FETCH) {
    for (const [url, loc] of outlinks) {
      add('ℹ️', loc, 'rev-outlink', '3.1.1', `앱에서 이 페이지를 연다: ${url} — 이 페이지(와 거기서 다시 나가는 링크)에 결제 경로가 없어야 한다. 자동 확인: --fetch`);
    }
  } else {
    // --origin <주소>: 우리 사이트 주소를 이 주소로 바꿔 받는다 — 배포 **전에** 로컬 빌드(dist)를 검사할 때(예: npx serve dist).
    const originArg = process.argv.includes('--origin') ? process.argv[process.argv.indexOf('--origin') + 1]?.replace(/\/+$/, '') : null;
    const fetchUrl = (u) => (originArg && SITE_ORIGIN && u.startsWith(SITE_ORIGIN) ? originArg + u.slice(SITE_ORIGIN.length) : u);
    const pages = new Map(); // 받은 주소 → html(null = 실패). 2단 경로에서 같은 페이지를 다시 받지 않는다.
    const getPage = (u) => {
      if (!pages.has(u)) pages.set(u, fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000) }).then((r) => r.text()).catch(() => null));
      return pages.get(u);
    };
    const hopReported = new Set();
    for (const [url, loc] of outlinks) {
      const html = await getPage(fetchUrl(url));
      if (html === null) {
        add('ℹ️', loc, 'rev-outlink', '3.1.1', `${url} 를 받지 못했다(네트워크). 직접 열어 결제 경로를 확인하라.`);
        continue;
      }
      const hits = purchasePathIn(url, html);
      if (hits.length > 0) {
        add('🔴', loc, 'rev-outlink', '3.1.1', `앱에서 여는 ${url} 에 **앱 밖 결제로 가는 길**이 있다 — ${hits.join(' · ')}. 한국 스토어프론트는 외부결제 아웃링크가 금지다(예외는 미국뿐). 심사관은 웹사이트까지 들어가 본다(2026-09-12 실사례). 이 링크를 iOS 에서 감추거나, 그 페이지에서 결제 경로를 떼라.`);
      }
      // ★2026-09-14 사각지대 ② — 2단 경로. 앱이 연 페이지에서 **같은 사이트의 다른 페이지**로 한 번 더 가면 결제에 닿는가.
      //   09-13 까지 법률 페이지 푸터의 '홈으로' → 홈 → /pricing 이 클릭 두 번이었는데, 이 검사는 첫 페이지만 봤다.
      const base = new URL(fetchUrl(url));
      for (const m of html.matchAll(/href="([^"#]+)"/g)) {
        let hop;
        try { hop = new URL(fetchUrl(new URL(m[1], base).href)); } catch { continue; }
        if (hop.origin !== base.origin || hop.pathname === base.pathname || hopReported.has(hop.pathname)) continue;
        const hopHtml = await getPage(hop.href);
        if (hopHtml === null) continue;
        let hopHits = purchasePathIn(hop.href, hopHtml);
        // 루트는 JS 로 소개 페이지로 넘긴다(inject-landing-redirect) — 사람이 실제로 보는 페이지까지 본다.
        const jsNext = hopHtml.match(/location\.replace\('(\/[\w.-]+\.html)'\)/);
        if (jsNext) {
          const shown = await getPage(new URL(jsNext[1], base).href);
          if (shown !== null) hopHits = [...hopHits, ...purchasePathIn(jsNext[1], shown)];
        }
        if (hopHits.length > 0) {
          hopReported.add(hop.pathname);
          add('🔴', loc, 'rev-outlink', '3.1.1', `앱에서 여는 ${url} → 같은 사이트 ${hop.pathname} 로 한 번 더 가면 **결제로 가는 길**이 있다 — ${hopHits.join(' · ')}. 클릭 두 번도 외부결제 유도다(09-13 법률 페이지 푸터 '홈으로' 사례). 앱이 여는 페이지에서 그 링크를 떼라.`);
        }
      }
    }
  }
}

// 목적지를 코드로 못 정하는 링크는 **한 줄로 모아** 낸다(사진 열기 등이 대부분이라 건별로 내면 소음이다).
if (dynamicOutlinks.length > 0) {
  add('ℹ️', dynamicOutlinks[0].split(' ')[0], 'rev-outlink', '3.1.1', `변수로 만든 외부 링크 ${dynamicOutlinks.length}건 — 목적지를 코드로 확정할 수 없다. 결제 페이지에 닿는 것이 없는지 한 번 훑어라: ${dynamicOutlinks.join(' · ')}`);
}

// ── rev-iap-disclosure 🔴 — 구매 화면의 자동갱신 고지 4종 (3.1.2(a)·3.1.2(c)) ──────────────
// 애플이 가장 기계적으로 보는 자리다. 하나라도 없으면 3.1.2 로 반려된다 — 그리고 **앱 안에** 있어야 한다.
// (App Store Connect 의 설명·EULA 필드만으로는 부족하다. 반대로 앱에만 있고 콘솔에 없어도 반려된다.)
{
  const panel = [...read.keys()].find((f) => /IapPurchasePanel\.tsx$/.test(f));
  if (!panel) {
    add('🟡', 'src/components/IapPurchasePanel.tsx', 'rev-iap-disclosure', '3.1.2', '구매 화면 컴포넌트를 찾지 못했다. 파일명이 바뀌었으면 이 규칙의 대상도 같이 바꿔라.');
  } else {
    const src = stripComments(read.get(panel));
    const need = [
      ['자동 갱신 고지', /자동으로 갱신|자동 갱신/, '기간·자동갱신·해지 방법을 구매 버튼 근처에서 말해야 한다'],
      ['이용약관 링크', /\/terms/, '앱 안에서 열리는 이용약관(EULA) 링크가 구매 화면에 있어야 한다'],
      ['개인정보처리방침 링크', /\/privacy/, '앱 안에서 열리는 처리방침 링크가 구매 화면에 있어야 한다'],
      ['구매 복원', /restorePurchases|구매 복원/, '복원 수단이 없으면 3.1.1(restore mechanism)로 반려된다'],
      ['무엇이 열리는가', /무료|이용권/, '가격 앞에 "이 돈을 내면 무엇을 받는가"가 있어야 한다(3.1.2(c))'],
    ];
    for (const [name, re, why] of need) {
      if (!re.test(src)) add('🔴', rel(panel), 'rev-iap-disclosure', '3.1.2', `구매 화면에 **${name}**이 없다. ${why}.`);
    }
    // 가격을 코드에 적으면 스토어 표시가와 어긋난다 → 2.3.1(false price).
    for (const m of src.matchAll(/[₩]\s?\d{1,3}[,\d]*|\b\d{2},\d{3}\s*원/g)) {
      const line = lineOf(src, m.index);
      if (suppressed(read.get(panel), line)) continue;
      add('🟡', `${rel(panel)}:${line}`, 'rev-price-literal', '2.3.1', `구매 화면에 가격 문자열 "${m[0]}" 이 하드코딩돼 있다. 스토어가 내려주는 priceString 만 써야 한다 — 콘솔 가격을 바꾸면 여기가 거짓말이 되고, 그건 "false price" 로 본다.`);
    }
  }
}

// ── rev-account-delete 🔴 — 앱 안에서 계정 삭제 (5.1.1(v)) ────────────────────────────────
// 웹 URL 로 안내하는 것만으로는 부족하다. "앱 안에서" 지울 수 있어야 한다.
if (!/deleteAccount\s*\(/.test(allSrc)) {
  add('🔴', 'src/app/account-settings.tsx', 'rev-account-delete', '5.1.1(v)', '앱 안에서 계정을 삭제하는 경로가 안 보인다. 계정 생성을 지원하는 앱은 **앱 내 삭제**가 의무다(웹 링크로는 부족).');
}

// ── rev-perm-unused 🟡 — 선언했는데 안 쓰는 권한 (5.1.1) ──────────────────────────────────
// scan-ios 의 ios-permission 은 반대 방향(쓰는데 문구 없음 = 크래시)만 본다.
// 이쪽은 **쓰지도 않는데 선언**한 것 — 심사관이 "왜 필요한가"를 묻고, 답을 못 하면 반려된다.
// 2.5.4(백그라운드 오디오) 반려가 정확히 이 부류였다: 우리가 안 쓰는 것을 플러그인이 선언했다.
{
  const appJson = existsSync(path.join(ROOT, 'app.json')) ? readFileSync(path.join(ROOT, 'app.json'), 'utf8') : '';
  const DECLARED = [
    ['마이크', /microphonePermission|NSMicrophoneUsageDescription/, /expo-audio|AudioModule|requestRecordingPermissions/],
    ['사진 보관함', /photosPermission|NSPhotoLibraryUsageDescription/, /launchImageLibraryAsync|requestMediaLibraryPermissions/],
    ['카메라', /"cameraPermission":\s*"|NSCameraUsageDescription/, /launchCameraAsync|requestCameraPermissions/],
    ['위치', /locationWhenInUsePermission|NSLocationWhenInUseUsageDescription/, /expo-location|getCurrentPositionAsync/],
    ['연락처', /contactsPermission|NSContactsUsageDescription/, /expo-contacts/],
  ];
  for (const [name, declRe, useRe] of DECLARED) {
    if (declRe.test(appJson) && !useRe.test(allSrc)) {
      add('🟡', 'app.json', 'rev-perm-unused', '5.1.1', `${name} 권한 문구를 선언했는데 코드에서 쓰는 곳이 없다. 심사관이 "어디서 쓰는가"를 묻고, 답이 없으면 반려된다. 안 쓰면 선언을 지워라.`);
    }
  }
}

// ── rev-ai-consent 🟡 — 제3자 AI 로 개인정보가 나가는데 고지·동의가 있는가 (5.1.2(i)) ──────
// 2025-11-13 개정으로 **"third-party AI"** 가 조항 본문에 명시됐다: 제3자 AI 에 개인정보를 보내려면
// **어디로 가는지 밝히고 명시적 동의**를 받아야 한다. 우리 앱은 노하우·질문·음성·PDF 를 Gemini 로 보낸다.
{
  const sendsToAi = /supabase\.functions\.invoke\(\s*['"]ai['"]|callAi|askAi/.test(allSrc) || /lib\/ai\//.test([...read.keys()].map(rel).join('\n'));
  if (sendsToAi) {
    const legalFiles = ['src/app/legal/[doc].tsx', 'src/app/terms.tsx', 'src/app/privacy.tsx']
      .map((p) => path.join(ROOT, p))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    const named = /Gemini|Google/.test(legalFiles); // 수탁사 이름이 실제로 적혀 있는가
    const scoped = /보내지 않|제외|학습에 사용되지 않/.test(legalFiles); // 무엇이 안 나가는가
    if (!named) {
      add('🟡', 'src/app/legal/[doc].tsx', 'rev-ai-consent', '5.1.2(i)', 'AI 로 사용자 입력을 보내는데 동의 문서에 **수탁사 이름(Google Gemini)** 이 없다. 2025-11 개정 조항은 제3자 AI 를 이름까지 밝히고 명시적 동의를 받으라고 요구한다.');
    } else if (!scoped) {
      add('ℹ️', 'src/app/legal/[doc].tsx', 'rev-ai-consent', '5.1.2(i)', '수탁사는 밝혔으나 **무엇이 나가지 않는지**(전화번호·근로정보 등)가 없다. 범위를 적어 두면 심사관 질문이 줄고, 사실과도 맞아야 한다.');
    }
    manual.push(['5.1.2(i)', 'AI 호출 경로가 늘었다면 그 데이터가 동의 문서의 범위 안인가 — 새 경로마다 다시 본다(동의는 앱 실행 시점이 아니라 **호출 전**에 이미 받아 둔 것이어야 한다)']);
  }
}

// ── rev-ugc-safety 🟡 — 사용자끼리 글·사진을 올리는데 신고·차단이 없다 (1.2) ────────────────
// 우리 앱은 채팅·건의·노하우·게스트 퀴즈 링크로 사람이 쓴 내용이 다른 사람에게 보인다.
// 1.2 는 UGC 앱에 ①부적절 콘텐츠 걸러내기 ②신고 수단 ③차단 수단 ④연락처 공개를 요구한다.
// 폐쇄형 사내 도구라 지적 없이 넘어갈 수 있지만, 연령등급 설문에 "사용자 생성 콘텐츠 = 예"로
// 답해 뒀으므로 **심사관이 물어볼 자리**다(2026-09-07 제출 메모의 미해결 항목).
{
  const hasUgc = /chat\.tsx|suggest\.tsx/.test([...read.keys()].map(rel).join('\n'));
  const hasReport = /신고하기|차단하기|blockUser|reportContent/.test(allSrc);
  if (hasUgc && !hasReport) {
    add('🟡', 'src/app/junior/chat.tsx', 'rev-ugc-safety', '1.2', '사람이 쓴 내용이 다른 사람에게 보이는데 **신고·차단 수단이 앱에 없다**. 폐쇄형 사내 도구라는 근거(초대받은 같은 매장 구성원만·실명·사장이 내보낼 수 있음)를 심사 메모에 적어 두거나, 신고 수단을 넣어야 한다. 답을 준비하지 않은 채로 물어오면 그 회차를 통째로 잃는다.');
  }
}

// ── rev-seed-placeholder 🟡 — 심사관이 보는 데이터에 테스트 잔재 (2.1) ───────────────────
{
  const seed = path.join(ROOT, 'scripts/seed-appreview.mjs');
  if (existsSync(seed)) {
    const s = readFileSync(seed, 'utf8');
    // ★"테스트"라는 낱말 자체는 노하우 본문에 정상적으로 나온다("테스트 추출 후 폐기").
    //   플레이스홀더로만 쓰이는 형태에 한정한다 — 안 그러면 매 실행마다 오탐이 뜬다.
    for (const m of s.matchAll(/['"`][^'"`\n]*(테스트\s*(계정|매장|용)|샘플\s*(계정|매장)|더미|test\d|asdf|qwer|Www\d|lorem)[^'"`\n]*['"`]/gi)) {
      add('🟡', `scripts/seed-appreview.mjs:${lineOf(s, m.index)}`, 'rev-seed-placeholder', '2.1', `심사관 계정에 들어가는 문자열에 테스트 잔재가 있다: ${m[0]}. 플레이스홀더는 제출 전에 지워야 한다.`);
    }
  } else {
    add('ℹ️', 'scripts/seed-appreview.mjs', 'rev-seed-placeholder', '2.1', '심사관 계정 시드 스크립트를 찾지 못했다. 심사 계정과 그 데이터가 어디서 오는지 확인하라.');
  }
}

// ── rev-background-mode 🔴 — 최종 Info.plist 실측 (2.5.4·5.1.1) ─────────────────────────
// ★2026-09-10 반려의 원인: 우리가 app.json 에 쓴 적 없는 UIBackgroundModes 를 **플러그인 기본값**이
// 넣었다. app.json 을 읽는 것으로는 절대 안 보인다 — 최종 산출물을 뽑아야 보인다.
if (DO_INTROSPECT) {
  let cfg = null;
  try {
    cfg = JSON.parse(execSync('npx expo config --type introspect --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    add('ℹ️', 'app.json', 'rev-background-mode', '2.5.4', 'expo config --type introspect 실행에 실패했다. 직접 돌려 Info.plist 를 확인하라.');
  }
  if (cfg) {
    const plist = cfg.ios?.infoPlist ?? {};
    const modes = plist.UIBackgroundModes ?? [];
    const USED = { audio: /useAudioPlayer|AudioPlayer|setAudioModeAsync.*background/, location: /expo-location/, voip: /voip/i, fetch: /BackgroundFetch/ };
    for (const mode of modes) {
      const re = USED[mode];
      if (!re || !re.test(allSrc)) {
        add('🔴', 'app.json (introspect)', 'rev-background-mode', '2.5.4', `최종 Info.plist 의 UIBackgroundModes 에 "${mode}" 가 들어 있는데 코드에 그 기능이 없다. **2026-09-10 반려가 정확히 이것**이었다(expo-audio 의 enableBackgroundPlayback 기본값 true). 선언을 빼거나, 실제로 쓰는 화면녹화를 제출해야 한다.`);
      }
    }
    console.log(`\n■ introspect 실측: UIBackgroundModes = ${modes.length ? JSON.stringify(modes) : '(키 없음 ✅)'}`);
    // ★introspect 는 **빌드 프로파일을 모른다** — dev-client 전용 플러그인이 넣는 것까지 같이 나온다.
    //   예: expo-dev-launcher 의 NSLocalNetworkUsageDescription(영문). 프로덕션 빌드엔 안 들어간다.
    //   이걸 구분하지 않으면 "영문 권한 문구" 오탐이 매번 뜨고, 그러면 이 검사는 죽는다.
    const DEV_ONLY = /^(NSLocalNetworkUsageDescription|NSBonjourServices)$/;
    const purposeKeys = Object.keys(plist).filter((k) => /UsageDescription$/.test(k));
    const shipped = purposeKeys.filter((k) => !DEV_ONLY.test(k));
    console.log(`   권한 문구 ${shipped.length}종(출고분): ${shipped.join(', ') || '(없음)'}`);
    for (const k of purposeKeys) {
      if (DEV_ONLY.test(k)) {
        add('ℹ️', 'app.json (introspect)', 'rev-purpose-string', '5.1.1', `${k} 는 **개발 클라이언트 전용**(expo-dev-launcher)이라 프로덕션 빌드에는 안 들어간다. introspect 는 프로파일을 구분하지 못하므로 여기 같이 나온다 — 확정은 실제 production 빌드 산출물에서.`);
        continue;
      }
      if (/^[\x00-\x7F]*$/.test(String(plist[k]))) add('🟡', 'app.json (introspect)', 'rev-purpose-string', '5.1.1', `${k} 가 영문(또는 빈 값)이다. 한국 배포라 한국어로, 무엇에 쓰는지 구체적으로 적어야 한다.`);
    }
  }
} else {
  manual.push(['2.5.4', '최종 Info.plist 실측 — `node .claude/skills/ios-preflight/scripts/scan-review.mjs --introspect` (app.json 만 읽어서는 플러그인이 넣는 선언이 안 보인다)']);
}

// ── 코드로 못 보는 것 (사용자 터미널·콘솔) ────────────────────────────────────────────────
if (/HAS_IAP\s*=\s*Boolean/.test(allSrc)) {
  manual.push(['3.1.1', 'RC 키가 **빌드에** 들어갔는가 — `npx eas-cli env:list --environment production` 에 EXPO_PUBLIC_RC_IOS_KEY. 없으면 코드가 결제 표면을 스스로 숨기고, 그 빌드는 반려당한 빌드와 똑같아진다']);
}
if (/showIapSurface/.test(allSrc)) {
  manual.push(['3.1.1', '판매 스위치가 켜져 있는가 — `npm run iap:status` (꺼져 있으면 심사관 화면에서 구매 화면이 사라진다 · 심사 끝날 때까지 iap:off 금지)']);
  manual.push(['2.1(b)', '구독 상품이 콘솔에서 "제출 준비" 이고 **이 버전과 함께** 제출되는가 — 첫 구독은 앱 버전에 연결해야 심사를 받는다']);
}
manual.push(['2.1(a)', '심사관 계정으로 TestFlight 에서 **구매 화면이 눈에 보이는지** — 코드·키·상품이 다 맞아도 이 확인 없이는 제출하지 않는다']);

// ── 출력 ──────────────────────────────────────────────────────────────────────────────────
const order = { '🔴': 0, '🟡': 1, 'ℹ️': 2 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.loc.localeCompare(b.loc));

console.log('\n══ iOS 심사 스캔 (App Store Review Guidelines) ══');
console.log(`   ${DO_FETCH ? '외부 링크 실제 조회함' : '외부 링크 미조회(--fetch 로 켠다)'} · ${DO_INTROSPECT ? 'Info.plist 실측함' : 'Info.plist 미실측(--introspect 로 켠다)'}\n`);

if (findings.length === 0) {
  console.log('✅ 규칙에 걸린 것 없음.');
} else {
  let last = null;
  for (const x of findings) {
    if (x.level !== last) {
      console.log(`\n── ${x.level} ${x.level === '🔴' ? '반려 사유' : x.level === '🟡' ? '심사관이 물어올 자리' : '확인 권장'} ──`);
      last = x.level;
    }
    console.log(`  ${x.loc}  [${x.rule} · Guideline ${x.clause}]`);
    console.log(`    ${x.msg}`);
  }
  const n = (lv) => findings.filter((x) => x.level === lv).length;
  console.log(`\n── 합계 ── 🔴 ${n('🔴')} · 🟡 ${n('🟡')} · ℹ️ ${n('ℹ️')}`);
  console.log('오탐이면 그 줄이나 윗줄에  // ios-preflight: ok <이유>  를 달아라.');
}

console.log('\n── 🔑 코드로는 못 보는 것 (제출 직전에 사람이 확인) ──');
for (const [clause, what] of manual) console.log(`  · [${clause}] ${what}`);
console.log('\n전체 게이트 표: .claude/skills/ios-preflight/references/review-gates.md');

process.exit(findings.some((x) => x.level === '🔴') ? 1 : 0);
