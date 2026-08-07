// qa-blocks-browser.mjs — UI/UX 블록 어휘 개편(2026-08-05) 실브라우저 육안 확인 + 블록 존재 검증.
//
// 메가프롬프트 완료 정의의 "npm run web으로 눈으로 확인 — 사장 홈 / 노하우 / 퀴즈 / 직원 홈 4화면 최소"를 집행한다.
// 목업이 아니라 실 백엔드 + 실 세션이다(AGENTS.md ⑥ 라이브 증명).
//
//   B1 사장 홈    — AlertRow(확인이 필요한 노하우) · InboxHeroCard(답 기다리는 질문) · ActionRow 5칸 · MiniStats · 오늘 업무 3건
//   B2 노하우      — AlertRow(상단 미검증) · VerifyBadge(파란 체크)
//   B3 퀴즈        — ProgressRing(통과한 직원 n/m) · AlertRow(문항 없는 노하우) · 직원별 목록
//   B4 직원 홈     — 오늘 할 일이 Primary(최상단) · MiniStats · 노하우 물어보기는 2번
//   B5 색 역할     — 렌더된 DOM에서 500 면 위 흰 글자 / 저대비 글자 실측
//   B6 콘솔 에러 0
//
// 실행: node scripts/qa-blocks-browser.mjs   (.env+.env.seed, QA_ORIGIN 기본 localhost:8081)
// 자가정리: delete_my_account ×2 + OTP 시드 정리. 스크린샷 → ./qa-shots/blocks/
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const SHOTS = './qa-shots/blocks';
mkdirSync(SHOTS, { recursive: true });
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 미설치'); process.exit(2); }

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, extra)); };

const projectRef = new URL(URL_).hostname.split('.')[0];
async function passwordSession(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

// ── 색 대비 실측(WCAG 상대휘도) — 렌더된 DOM에서 잰다 ──
const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const parseRgb = (str) => {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v));
  if (p.length >= 4 && p[3] === 0) return null; // 투명 = 상속이라 여기서 못 잰다
  return [p[0], p[1], p[2]];
};

/**
 * 저대비 텍스트 추출 + 책임 분리.
 * ink3(#a4a29b, 흰 배경 2.55)는 이번 개편 이전부터 있던 '흐린 메타' 토큰이다 — 이번 변경의 회귀가 아니라
 * 기존 부채다. 섞어서 세면 "이번 작업이 접근성을 깼다"는 잘못된 결론이 난다 → 따로 센다.
 */
const INK3 = 'rgb(164, 162, 155)';
const lowContrast = (texts) =>
  texts
    .map((t) => {
      if (t.occluded) return null; // 가려진 것은 대비를 잴 수 없다 — report()의 가려짐 체크가 따로 잡는다
      const c = parseRgb(t.color), b = parseRgb(t.bg);
      if (!c || !b) return null;
      const ratio = contrast(c, b);
      const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
      return ratio < (large ? 3 : 4.5) ? { ...t, ratio, preexisting: t.color === INK3 } : null;
    })
    .filter(Boolean);
const fmt = (t) => `"${t.text}" ${t.color} on ${t.bg} = ${t.ratio.toFixed(2)} @${t.size}px/${t.weight}`;
const report = (id, screen, texts, bad) => {
  // ★가려짐 게이트가 먼저다. 모달·스크림이 화면을 덮은 채로 재면 대비값도 통과 여부도 전부 거짓이다.
  //   (2026-08-06: 직원 홈이 JuniorWelcomeCoach 모달에 덮인 채 B4 전체가 green으로 나왔다.)
  const occ = texts.filter((t) => t.occluded);
  check(`${id}o ${screen} 측정 시점에 가려진 텍스트 0건`, occ.length === 0,
    `${occ.length}개 가려짐 — 모달/오버레이를 닫고 재야 한다: ` + occ.slice(0, 3).map((t) => `"${t.text}"`).join(' '));

  const mine = bad.filter((t) => !t.preexisting);
  const old = bad.filter((t) => t.preexisting);
  check(`${id} ${screen} 신규 저대비 0건 (검사 ${texts.length}개)`, mine.length === 0, mine.slice(0, 6).map(fmt).join(' | '));
  if (old.length) console.log(`     ↳ 참고: 기존 ink3(#a4a29b) 저대비 ${old.length}건 — 이번 변경 밖의 부채`);
};

let ownerId, juniorId, oEmail, jEmail, hEmail, eEmail;

async function main() {
  // ── 셋업: 사장+매장+직원 합류, 노하우 3건(1건 미검증), 미답변 질문 2건, 오늘 업무 4건 ──
  //    + 허브 3상태 검증용 미합류 직원 1명(B5에서 ①→②→③으로 태운다)
  const owner = mk(), junior = mk();
  const phoneO = `0107${s.slice(0, 7)}`, phoneJ = `0108${s.slice(0, 7)}`, phoneH = `0109${s.slice(0, 7)}`;
  await seedVerifiedPhones(URL_, SRV, [phoneO, phoneJ, phoneH]);
  oEmail = `qa_blk_o_${s}@example.com`; jEmail = `qa_blk_j_${s}@example.com`; hEmail = `qa_blk_h_${s}@example.com`;
  const oUp = await owner.auth.signUp({ email: oEmail, password: pw, options: { data: { name: 'QA블록사장', role: 'owner', phone: phoneO, birth_date: '1980-01-15' } } });
  if (oUp.error) throw new Error('owner signUp: ' + oUp.error.message);
  ownerId = oUp.data.user?.id;
  const jUp = await junior.auth.signUp({ email: jEmail, password: pw, options: { data: { name: 'QA블록직원', role: 'junior', phone: phoneJ, birth_date: '2000-05-05' } } });
  if (jUp.error) throw new Error('junior signUp: ' + jUp.error.message);
  juniorId = jUp.data.user?.id;
  const hub = mk();
  const hUp = await hub.auth.signUp({ email: hEmail, password: pw, options: { data: { name: 'QA허브직원', role: 'junior', phone: phoneH, birth_date: '2001-03-03' } } });
  if (hUp.error) throw new Error('hub junior signUp: ' + hUp.error.message);
  const hubId = hUp.data.user?.id;

  const { data: c1, error: e1 } = await owner.rpc('create_store', { p_store_name: 'QA블록카페', p_industry: '카페·디저트', p_biz_no: null });
  const storeRow = Array.isArray(c1) ? c1[0] : c1;
  if (e1 || !storeRow?.unit_id) throw new Error('create_store: ' + (e1?.message ?? 'no row'));
  const UNIT = storeRow.unit_id;
  await admin.rpc('admin_activate_store', { p_unit_id: UNIT, p_days: 1, p_plan: 'multi' });
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  await junior.rpc('join_by_invite', { p_code: storeRow.invite_code });
  const { error: apErr } = await owner.rpc('approve_member', { p_uid: juniorId });
  if (apErr) throw new Error('approve_member: ' + apErr.message);
  await junior.rpc('switch_active_unit', { p_unit_id: UNIT });

  const now = new Date().toISOString();
  const mkEntry = (id, title, situation, opts = {}) => ({
    id, unit_id: UNIT, creator_id: ownerId, creator_name: 'QA블록사장',
    category: 'Know-how', subcategory: '일반', title, tags: [], search_keywords: [title],
    square: { situation, action: { steps: [], scripts: [] }, extract: { do: '바로 알려요', dont: '혼자 판단하지 않아요' }, result: { before: '', after: '', metric: '' }, uncover: '', quagmire: '' },
    execution: { tone: '친절', timing: '필요할 때', channel: '구두', stakeholders: [] },
    stats: { thumbs_up: 0, thumbs_down: 0, last_used_at: now, query_hits_30d: opts.hits ?? 7, resolution_rate: 0.8 },
    photos: [], version: 1, status: 'published', quality_score: 0.6,
    created_at: now, updated_at: now, is_template: false, pack_id: null,
    needs_review: opts.needsReview ?? false, correction_points: [], section: null, order_index: 0,
    // ★ `??`를 쓰지 않는다 — null도 fallback시켜 "미검증으로 심으려던 행"이 owner_verified로 들어갔다(2026-08-06).
    //   미검증을 심으려면 verification: null을 명시해야 하고, 그 null이 그대로 저장돼야 한다.
    verification: 'verification' in opts ? opts.verification : { state: 'owner_verified', verified_at: now, verified_by: ownerId },
  });
  {
    const { error } = await owner.from('playbook_entries').insert([
      mkEntry(`pb_blk1_${s}`, '원두 채우기', '그라인더 호퍼가 3분의 1 밑으로 내려가면 새 원두를 채워요. 봉투에 개봉일을 적어요.'),
      mkEntry(`pb_blk2_${s}`, '가스 밸브 잠그기', '마감 때 주방 가스 밸브를 잠그고 손으로 한 번 더 확인해요.', { verification: { state: 'field_tested', verified_at: now, verified_by: juniorId } }),
      // ★미검증 1건 — 사장 홈·노하우 목록의 AlertRow를 띄우는 조건
      mkEntry(`pb_blk3_${s}`, '포스 시재 확인', '오픈할 때 시재 5만원을 세고 장부에 적어요.', { needsReview: true, verification: null, hits: 0 }),
    ]);
    if (error) throw new Error('노하우 시드: ' + error.message);
  }

  // 미답변 질문 2건 — InboxHeroCard(사장 홈 히어로)를 띄우는 조건
  // ★2026-08-06: 두 건 모두 asked_at=now 라 **대기시간 정렬을 검증하지 못했다**(동점이라 항상 conf로 갈림).
  //   sortByUrgency 1차 기준이 confidence → 대기시간으로 바뀌었으므로, 시각을 갈라 규칙을 실제로 태운다.
  const uq = (id, text, conf, similar, askedAt = now) => ({
    id, unit_id: UNIT, junior_id: juniorId, junior_name: 'QA블록직원',
    query_text: text, asked_at: askedAt,
    presumed_category: 'Event', presumed_subcategory: '응대',
    match_attempted: true, best_match_confidence: conf, best_match_entry_id: null,
    status: 'pending_owner_answer', fallback_action: '사장님께 알림 전송됨.',
    owner_notified_at: now, owner_will_answer: true,
    similar_queries_count: similar, anonymous: false, ai_general_answer: '',
  });
  {
    // ★두 건이 서로 반대 결론을 내도록 심는다 — 이게 정렬 규칙의 회귀 증명이다.
    //   파라솔: confidence 높음(0.35) + 26시간 대기 → **새 규칙(대기시간 1차)의 히어로**
    //   기프티콘: confidence 최저(0.12) + 1시간 대기 → 옛 규칙(confidence 1차)이었다면 이게 히어로였다
    //   즉 히어로에 '파라솔'이 떠야 새 규칙이 실제로 걸린 것이다.
    const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    const { error } = await admin.from('unknown_queries').insert([
      uq(`uq_blk1_${s}`, '기프티콘 유효기간 지난 거 가져오시면 어떻게 해요?', 0.12, 2, hoursAgo(1)),
      uq(`uq_blk2_${s}`, '테라스 파라솔 바람 불면 접어야 하나요?', 0.35, 0, hoursAgo(26)),
    ]);
    if (error) throw new Error('미답변 질문 시드: ' + error.message);
  }

  // 오늘 업무 4건(매일 반복) — 사장 홈 '오늘 업무 3건', 직원 홈 '오늘 할 일'
  {
    const rows = [
      { id: `wt_blk1_${s}`, text: '오픈 청소', section: 'open' },
      { id: `wt_blk2_${s}`, text: '원두 재고 확인', section: 'open' },
      { id: `wt_blk3_${s}`, text: '냉장고 온도 점검', section: 'mid' },
      { id: `wt_blk4_${s}`, text: '마감 정산', section: 'close' },
    ].map((r) => ({ ...r, unit_id: UNIT, scope: 'shared', created_at: now, recurrence: { weekly: [0, 1, 2, 3, 4, 5, 6] } }));
    const { error } = await owner.from('work_templates').insert(rows);
    if (error) throw new Error('업무 시드: ' + error.message);
  }

  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (email) => {
    const session = await passwordSession(email);
    const page = await browser.newPage({ viewport: { width: 460, height: 1200 } });
    page.setDefaultTimeout(25000);
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
    await page.addInitScript(([key, val]) => localStorage.setItem(key, val), [`sb-${projectRef}-auth-token`, JSON.stringify(session)]);
    return page;
  };
  const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
  const wait = (page, t, timeout = 20000) =>
    page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const see = (page, t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);

  /** 렌더된 DOM 전수 — 글자색 vs 실제 배경색 대비를 재서 저대비 텍스트를 잡는다. */
  const lowContrastTexts = (page) =>
    page.evaluate(() => {
      const out = [];
      /**
       * 실효 배경색 — **반투명 면은 부모와 알파 합성한다.**
       * 옛 판본은 alpha가 0만 아니면 그대로 반환해서, 검정 히어로 위에 얹힌
       * rgba(255,255,255,0.12) 오버레이를 '흰 배경'으로 읽었다. 그 위 흰 글자가 1.00으로 나온다
       * (2026-08-06 실측에서 오탐으로 드러남).
       */
      const bgOf = (el) => {
        const layers = [];
        let n = el;
        while (n && n !== document.documentElement) {
          const m = String(getComputedStyle(n).backgroundColor).match(/rgba?\(([^)]+)\)/);
          if (m) {
            const p = m[1].split(',').map(parseFloat);
            const a = p.length >= 4 ? p[3] : 1;
            if (a > 0) {
              layers.push([p[0], p[1], p[2], a]);
              if (a >= 1) break; // 불투명 면을 만나면 그 아래는 안 보인다
            }
          }
          n = n.parentElement;
        }
        // 아래(마지막)부터 위로 덮어 합성. 최하단은 흰 종이.
        let [r, g, b] = [255, 255, 255];
        for (let i = layers.length - 1; i >= 0; i--) {
          const [lr, lg, lb, la] = layers[i];
          r = lr * la + r * (1 - la);
          g = lg * la + g * (1 - la);
          b = lb * la + b * (1 - la);
        }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      };
      // 아이콘 폰트(Ionicons)는 사용자 영역(U+E000~U+F8FF) 글리프를 텍스트로 렌더한다.
      // 이건 '텍스트'가 아니라 '그림'이므로 WCAG 비텍스트 3:1 대상이고, 여기서는 제외한다.
      const isIconGlyph = (t) => [...t].every((ch) => ch.codePointAt(0) >= 0xe000 && ch.codePointAt(0) <= 0xf8ff);

      /**
       * 이 요소가 **다른 최상위 레이어**(모달·포털)에 덮여 있는가.
       * Playwright의 isVisible()은 겹침을 보지 않아서 모달 뒤 DOM도 '보인다'고 답한다(2026-08-06 사고).
       *
       * ★같은 트리 안의 고정 탭바·헤더에 가린 것은 세지 않는다 — 스크롤하면 비켜나므로
       *   '닫아야 보이는' 모달과 성격이 다르다. RN <Modal>은 웹에서 body 바로 밑 별도 노드로 포털되므로
       *   "body의 어느 자식 밑에 있나"가 둘을 정확히 가른다.
       * 뷰포트 밖(스크롤 아래)은 판정 불가라 false — 여기서 true를 주면 화면 하단이 조용히 검사에서 빠진다.
       */
      const layerOf = (el) => {
        let n = el;
        while (n.parentElement && n.parentElement !== document.body) n = n.parentElement;
        return n;
      };
      const occludedAt = (el, r) => {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
        const top = document.elementFromPoint(cx, cy);
        if (!top || top === el || el.contains(top) || top.contains(el)) return false;
        return layerOf(top) !== layerOf(el);
      };

      for (const el of document.querySelectorAll('*')) {
        // ★ textContent가 아니라 '자기가 직접 가진 텍스트 노드'만 본다.
        //   RNW의 중첩 <Text>(강조 span을 품은 문단)는 children이 있어도 직접 텍스트를 갖는다 —
        //   옛 `children.length > 0 → skip`은 그런 문단을 통째로 건너뛰었다.
        let txt = '';
        for (const n of el.childNodes) if (n.nodeType === 3) txt += n.nodeValue;
        txt = txt.trim();
        // ★ 길이 상한을 두지 않는다. 40자 컷은 '읽어서 판단해야 하는 본문'(안내문·에러·빈 화면 문구)을
        //   정확히 걸러냈다 — 대비 하한이 가장 중요한 텍스트가 검사 밖에 있었다(2026-08-06).
        if (!txt || isIconGlyph(txt)) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({
          text: txt.slice(0, 30),
          color: cs.color,
          bg: bgOf(el),
          size: parseFloat(cs.fontSize) || 0,
          weight: parseInt(cs.fontWeight, 10) || 400,
          occluded: occludedAt(el, r),
        });
      }
      return out;
    });

  try {
    // ═══════════ B1 사장 홈 ═══════════
    const po = await newPage(oEmail);
    console.log('\n[B1] 사장 홈 — 블록 5종');
    await po.goto(`${ORIGIN}/owner/dashboard`, { waitUntil: 'domcontentloaded' });
    check('B1-0 홈 진입', await wait(po, '오늘도 고생 많으세요', 40000));
    await po.waitForTimeout(2500); // 스토어 하이드레이션(노하우·질문·업무)
    check('B1-1 AlertRow — 확인이 필요한 노하우', await see(po, '확인이 필요한 노하우'));
    check('B1-2 히어로 = 답 기다리는 질문(가장 오래 기다린 것)', await see(po, '가장 오래 기다린 질문'));
    // ★정렬 규칙 회귀 — 파라솔(conf 0.35·26시간)이 기프티콘(conf 0.12·1시간)을 이겨야 한다.
    //   기프티콘이 뜨면 sortByUrgency 1차 기준이 confidence 로 되돌아간 것이다(2026-08-06 교체분).
    check('B1-3 히어로 = 가장 오래 기다린 건(파라솔)', await see(po, '테라스 파라솔'));
    check('B1-3b 옛 규칙(confidence 최저=기프티콘)이 히어로가 아니다', !(await see(po, '기프티콘 유효기간')));
    check('B1-4 히어로 CTA', await see(po, '답변하기'));
    // 대기열 규모 — 히어로 1건만 보이면 "이거 하나만 하면 되는구나"로 읽힌다(pending 2건 → 외 1건).
    check('B1-4b 히어로 하단 "외 n건"', await see(po, '외 1건'));
    // ★ see()(부분 문자열)로 세지 않는다 — '노하우'는 AlertRow·MiniStats·하단 탭에도 있어서
    //   ActionRow를 통째로 지워도 통과했다(2026-08-06). ActionRow가 실제로 그린 버튼만 센다:
    //   accessibilityRole="button" + accessibilityLabel=라벨, 그리고 5개가 **한 부모** 밑에 있어야 한다.
    const actionRow = await po.evaluate((labels) => {
      const btns = labels.map((l) =>
        [...document.querySelectorAll('[role="button"]')].find((el) => (el.getAttribute('aria-label') ?? '') === l),
      );
      if (btns.some((b) => !b)) return { found: btns.filter(Boolean).length, sameRow: false };
      const parents = new Set(btns.map((b) => b.parentElement));
      return { found: btns.length, sameRow: parents.size === 1 };
    }, ['노하우', '업무', '퀴즈', '직원', '근무']);
    check('B1-5 ActionRow 5칸(한 행 · aria-label 정확일치)', actionRow.found === 5 && actionRow.sameRow, JSON.stringify(actionRow));
    check('B1-6 MiniStats — 30일간 대신 답함', await see(po, '30일간 대신 답함'));
    check('B1-7 오늘 업무 목록 + 전체보기', (await see(po, '오늘 업무')) && (await see(po, '전체보기')));
    check('B1-8 옛 히어로("반복 질문을 AI가 대신 받았어요") 제거됨', !(await see(po, '반복 질문을 AI가 대신 받았어요')));
    await shot(po, '01-owner-home');

    console.log('\n[B1-색] 렌더 DOM 대비 실측');
    const homeTexts = await lowContrastTexts(po);
    report('B1-9', '사장 홈', homeTexts, lowContrast(homeTexts));

    // ═══════════ B2 노하우 ═══════════
    console.log('\n[B2] 노하우 목록 — AlertRow + 파란 검증 배지');
    await po.goto(`${ORIGIN}/owner/knowledge`, { waitUntil: 'domcontentloaded' });
    await po.waitForTimeout(2500);
    check('B2-1 상단 AlertRow(미검증 개수)', await see(po, '확인이 필요한 노하우'));
    check('B2-2 검증 배지 — 사장님 검증', await see(po, '사장님 검증'));
    check('B2-3 검증 배지 — 현장 검증', await see(po, '현장 검증'));
    check('B2-4 옛 배너 문구 제거됨', !(await see(po, '업종 표준값이에요')));
    const badgeBlue = await po.evaluate(() => {
      // 파란 원 = mention 500(#2B87FF). 배지 원형 요소의 배경색을 수집한다.
      const seen = new Set();
      for (const el of document.querySelectorAll('div')) {
        const cs = getComputedStyle(el);
        if (cs.borderRadius && parseFloat(cs.borderRadius) > 0 && cs.backgroundColor) seen.add(cs.backgroundColor);
      }
      return [...seen];
    });
    check('B2-5 파란 원(rgb(43,135,255)) 실제 렌더', badgeBlue.some((c) => c.replace(/\s/g, '') === 'rgb(43,135,255)'),
      badgeBlue.slice(0, 8).join(' '));
    await shot(po, '02-owner-knowhow');
    // 이 화면도 대비를 잰다 — 옛 판본은 사장 홈·직원 홈 2개만 재서, 실제로 배지 색을 바꾼 화면이 검사 밖이었다.
    const kTexts = await lowContrastTexts(po);
    report('B2-6', '노하우 목록', kTexts, lowContrast(kTexts));

    // ═══════════ B3 퀴즈 ═══════════
    console.log('\n[B3] 퀴즈 — 진행 링 + 직원별 + 문항 없는 노하우');
    await po.goto(`${ORIGIN}/owner/training`, { waitUntil: 'domcontentloaded' });
    await po.waitForTimeout(2500);
    const presetScreen = await see(po, '어떤 퀴즈부터 만들까요');
    check('B3-0 퀴즈 화면 진입', presetScreen || (await see(po, '퀴즈 종류 설정')));
    if (presetScreen) {
      await po.getByLabel('첫 출근 만들기', { exact: true }).last().dispatchEvent('click');
      await wait(po, '담을 노하우 고르기');
      await po.getByLabel('닫기', { exact: true }).last().dispatchEvent('click');
      await po.waitForTimeout(1500);
    }
    check('B3-1 ProgressRing — 통과한 직원', await see(po, '통과한 직원'));
    check('B3-2 직원별 섹션', await see(po, '직원별'));
    check('B3-3 상태 문구가 링 아래로 흡수됨', await see(po, '비어 있음') || await see(po, '문항 없는 노하우'));
    check('B3-4 옛 워딩 "문제 없는 노하우" 제거됨', !(await see(po, '문제 없는 노하우')));
    await shot(po, '03-owner-quiz');
    const qTexts = await lowContrastTexts(po);
    report('B3-5', '퀴즈', qTexts, lowContrast(qTexts));

    // ═══════════ B4 직원 홈 ═══════════
    // 최우선(가장 큰 것)=오늘 할 일 · Primary(유일한 채운 버튼)=노하우 물어보기. **둘은 다른 자리다.**
    // 2026-08-06 이전엔 셋째 자리 '출근하기'가 유일한 옐로 채움+글로우 버튼이라 1등석을 갖고 있었다.
    console.log('\n[B4] 직원 홈 — 최우선=오늘 할 일 · Primary=물어보기');
    const pj = await newPage(jEmail);
    await pj.goto(`${ORIGIN}/junior/home`, { waitUntil: 'domcontentloaded' });
    check('B4-0 직원 홈 진입', await wait(pj, '오늘도 화이팅이에요', 40000));
    await pj.waitForTimeout(2500);

    // ★합류 직후 1회 뜨는 라이트 온보딩(JuniorWelcomeCoach)을 먼저 닫는다.
    //   신규 직원은 항상 이걸 보므로, 안 닫으면 아래 검사 전부가 '모달에 덮인 홈'을 통과시킨다(2026-08-06).
    const coachOpen = await see(pj, '여기서 이렇게 쓰면 돼요');
    check('B4-0b 신규 직원 라이트 온보딩이 떴다', coachOpen);
    if (coachOpen) {
      await pj.getByText('알겠어요, 시작할게요', { exact: false }).last().dispatchEvent('click');
      await pj.getByText('여기서 이렇게 쓰면 돼요', { exact: false }).first()
        .waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
      await pj.waitForTimeout(600);
    }

    check('B4-1 오늘 할 일 블록', await see(pj, '오늘 할 일'));
    check('B4-2 할 일 목록 렌더(오픈 청소)', await see(pj, '오픈 청소'));
    check('B4-3 노하우 물어보기는 남아 있다', await see(pj, '노하우 물어보기'));
    check('B4-4 MiniStats — 나를 언급', await see(pj, '나를 언급'));
    // 순서 검증: '오늘 할 일'이 '노하우 물어보기'보다 위에 있어야 한다(Primary 교체의 핵심)
    const order = await pj.evaluate(() => {
      const y = (t) => {
        for (const el of document.querySelectorAll('div,span')) {
          if ((el.textContent ?? '').trim() === t) return el.getBoundingClientRect().top;
        }
        return null;
      };
      return { todo: y('오늘 할 일'), ask: y('노하우 물어보기') };
    });
    check('B4-5 ★오늘 할 일이 노하우 물어보기보다 위', order.todo !== null && order.ask !== null && order.todo < order.ask,
      JSON.stringify(order));

    // ★Primary 위계 — "화면당 채운 버튼 1개"를 **렌더된 배경색으로** 잰다.
    //   선언(주석)·순서만 검사하면 '출근하기가 유일한 옐로 채움'인 상태가 계속 green 으로 통과한다(2026-08-06 실패 원인).
    //   브랜드 옐로 #FEE500 = rgb(254,229,0). 폭 200px 이상 = 바 형태 버튼만(칩·원형 아이콘 제외).
    const yellowBtns = await pj.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="button"]')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.backgroundColor === 'rgb(254, 229, 0)' && r.width >= 200) {
          out.push((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20));
        }
      }
      return out;
    });
    check(`B4-5b Primary 채운 버튼은 1개 — 실측 ${JSON.stringify(yellowBtns)}`, yellowBtns.length === 1, JSON.stringify(yellowBtns));
    check('B4-5c 그 1개가 물어보기다', yellowBtns.length === 1 && yellowBtns[0].includes('물어보기'), JSON.stringify(yellowBtns));
    await shot(pj, '04-junior-home');

    console.log('\n[B4-색] 직원 홈 대비 실측');
    const jTexts = await lowContrastTexts(pj);
    report('B4-6', '직원 홈', jTexts, lowContrast(jTexts));

    // ═══════════ B7 사장 허브 현황 ═══════════
    // 앱 골격은 /hub ↔ /stores ↔ 매장 앱 3층인데 블록 어휘 개편은 매장 앱 층만 했다.
    // 허브 현황은 '제목 → 카드' 5연속이었다(개편 전 사장 홈과 같은 증상). 2026-08-06 정리분을 지킨다.
    console.log('\n[B7] 사장 허브 현황 — 카드 나열 해체');
    await po.goto(`${ORIGIN}/hub`, { waitUntil: 'domcontentloaded' });
    check('B7-0 허브 진입', await wait(po, '현황', 40000));
    await po.waitForTimeout(3000);
    check('B7-1 AlertRow — 답 기다리는 질문(맨 위로 승격)', await see(po, '답 기다리는 질문'));
    check('B7-2 옛 "받은질문" 행은 확인 필요에서 빠졌다', !(await see(po, '받은질문')));
    check('B7-3 MiniStats — 지금 근무중', await see(po, '지금 근무중'));
    check('B7-4 퀴즈가 별도 섹션이 아니다(확인 필요 카드로 흡수)', await see(po, '퀴즈'));
    // ★워딩 드리프트 — 같은 needs_review 를 허브만 '검증 필요'라 부르고 있었다(승인 어휘 8개 밖 신조어).
    //   매장 앱은 전부 '확인 필요'다. 세 렌즈가 동시에 걸린 자리라 회귀 검사를 남긴다.
    //   ('사장님 검증' 배지(D4)는 별개 — 여기서 금지하는 건 지표 라벨의 '검증'이다.)
    check('B7-4b 지표 라벨이 매장 앱과 같은 말(확인이 필요한 노하우)', await see(po, '확인이 필요한 노하우'));
    check('B7-4c 옛 라벨(검증이 필요한 노하우) 사라짐', !(await see(po, '검증이 필요한 노하우')));
    // 카드(흰 면 + 보더 + 그림자) 개수 — 옛 판본은 5장이었다. 배치 규칙 ⑤: 화면당 1~2장만 남긴다.
    const hubCards = await po.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll('div')) {
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === 'rgb(255, 255, 255)' && parseFloat(cs.borderTopWidth) >= 1
            && parseFloat(cs.borderRadius) >= 12 && el.getBoundingClientRect().width > 300) n++;
      }
      return n;
    });
    check(`B7-5 카드 ≤3장 (옛 5장) — 실측 ${hubCards}`, hubCards <= 3, String(hubCards));
    await shot(po, '08-owner-hub-status');
    const hubTexts = await lowContrastTexts(po);
    report('B7-6', '허브 현황', hubTexts, lowContrast(hubTexts));

    // ═══════════ B8 직원 둘러보기 — 렌즈 동어반복 방지 ═══════════
    // 대시보드의 세 렌즈(인기·최근·해결률)는 같은 목록을 정렬만 바꿔 자른다.
    // 노하우가 적으면 세 섹션이 **같은 카드를 3번** 보여준다(2026-08-06 실측: 3건 매장에서 전부 동일).
    // 시드는 노하우 3건 = SECTION_LIMIT*2 미만이므로 목록 하나로 떨어져야 한다.
    console.log('\n[B8] 직원 둘러보기 — 노하우가 적으면 렌즈를 나누지 않는다');
    await pj.goto(`${ORIGIN}/junior/chat`, { waitUntil: 'domcontentloaded' });
    await pj.waitForTimeout(2500);
    await pj.getByText('둘러보기', { exact: false }).first().dispatchEvent('click');
    await pj.waitForTimeout(2000);
    check('B8-1 렌즈 섹션(인기 노하우) 안 뜸', !(await see(pj, '인기 노하우')));
    check('B8-2 렌즈 섹션(최근 추가됨) 안 뜸', !(await see(pj, '최근 추가됨')));
    check('B8-3 렌즈 섹션(잘 통하는 노하우) 안 뜸', !(await see(pj, '잘 통하는 노하우')));
    check('B8-4 죽은 대시보드/목록 토글도 숨겼다', !(await see(pj, '대시보드')));
    check('B8-5 목록으로 노하우는 보인다', await see(pj, '원두 채우기'));
    await shot(pj, '09-junior-browse');

    // ═══════════ B5 직원 허브 3상태 ═══════════
    // 이 화면은 성격이 다른 세 상태를 겸한다(2026-08-06 상태 분기). 셋 다 실제로 태워서 본다.
    console.log('\n[B5] 직원 허브 — ① 미합류 · ② 승인 대기 · ③ 매장 있음');
    const ph = await newPage(hEmail);

    // ① 매장 0개 — 할 일은 '코드 넣기' 하나. 곁가지가 없어야 한다.
    await ph.goto(`${ORIGIN}/junior/hub`, { waitUntil: 'domcontentloaded' });
    check('B5-1 ① 진입', await wait(ph, '안녕하세요', 40000));
    await ph.waitForTimeout(2000);
    check('B5-2 ① 코드 입력이 곧바로 보인다', await see(ph, '매장 추가하기'));
    check('B5-3 ① 가짜 버튼(히어로 "코드를 받으셨나요?") 제거됨', !(await see(ph, '코드를 받으셨나요')));
    check('B5-4 ① 중복 안내("아래에 초대코드를 입력") 제거됨', !(await see(ph, '아래에 초대코드를 입력')));
    check('B5-5 ① 기능 소개 캐러셀 제거됨', !(await see(ph, '이런 걸 할 수 있어요')));
    await shot(ph, '05-junior-hub-1-empty');
    const hTexts = await lowContrastTexts(ph);
    report('B5-6', '허브 ①', hTexts, lowContrast(hTexts));

    // ② 승인 대기 — 코드 입력이 사라지고 대기 카드만 남아야 한다.
    await hub.rpc('join_by_invite', { p_code: storeRow.invite_code });
    await ph.reload({ waitUntil: 'domcontentloaded' });
    await ph.waitForTimeout(2500);
    check('B5-7 ② 승인 대기 카드', await see(ph, '사장님 승인 대기 중'));
    check('B5-8 ② 대기 중엔 코드 입력을 숨긴다', !(await see(ph, '코드가 없으신가요')));
    await shot(ph, '06-junior-hub-2-pending');

    // ③ 매장 있음 — 코드 입력은 접힌 한 줄로 강등. 펼치면 아래로 열린다.
    const { error: apErr2 } = await owner.rpc('approve_member', { p_uid: hubId });
    if (apErr2) throw new Error('approve_member(hub): ' + apErr2.message);
    await ph.reload({ waitUntil: 'domcontentloaded' });
    await ph.waitForTimeout(2500);
    check('B5-9 ③ 매장 카드', await see(ph, 'QA블록카페'));
    check('B5-10 ③ 코드 입력이 접혀 있다', !(await see(ph, '코드가 없으신가요')));
    await ph.getByLabel('코드로 매장 추가 — 초대코드 입력', { exact: true }).last().dispatchEvent('click');
    await ph.waitForTimeout(700);
    check('B5-11 ③ 펼치면 코드 입력이 열린다', await see(ph, '코드가 없으신가요'));
    await shot(ph, '07-junior-hub-3-joined');

    // ═══════════ B10 카드 3연속 해체 6화면 — 형태를 DOM에서 실측 ═══════════
    // "제목 → 카드" 반복이 이번 개편이 없애려던 증상이다. 배치 규칙 ①(같은 형태 연속 3회 이상 금지).
    // 정적 grep으로는 판정 못 한다(형태는 렌더돼야 안다) → 형제 노드를 훑어 카드 런(run)을 잰다.
    console.log('\n[B10] 카드 3연속 해체 — 6화면');
    /** 스크롤 컨테이너의 형제들 중 '카드'(흰 면+보더/그림자+라운드)가 몇 개나 연달아 있나. */
    const maxCardRun = (page) =>
      page.evaluate(() => {
        const isCard = (el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return (
            cs.backgroundColor === 'rgb(255, 255, 255)' &&
            parseFloat(cs.borderRadius) >= 10 &&
            (parseFloat(cs.borderTopWidth) >= 1 || cs.boxShadow !== 'none') &&
            r.width > 260
          );
        };
        // 카드를 가장 많이 품은 부모 = 화면 본문 컨테이너로 본다.
        let best = null, bestN = 0;
        for (const p of document.querySelectorAll('div')) {
          const n = [...p.children].filter((c) => c.nodeType === 1 && isCard(c)).length;
          if (n > bestN) { bestN = n; best = p; }
        }
        // ★형제 인접만 보면 놓친다: SettingsSection처럼 <래퍼><제목/><카드/></래퍼> 구조면
        //   카드마다 부모가 달라 run이 늘 1로 나온다(2026-08-06 실측에서 /account-settings가 1로 오판).
        //   card-stack 증상은 DOM 중첩이 아니라 **세로로 쌓인 카드 수**다 → 문서 전체에서
        //   '카드 안에 든 카드'를 뺀 최상위 카드를 Y 순으로 세고, 그 사이에 다른 형태가 있는지 본다.
        const allCards = [...document.querySelectorAll('div')].filter(isCard);
        const topCards = allCards
          .filter((el) => !allCards.some((o) => o !== el && o.contains(el)))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .sort((a, b) => a.r.top - b.r.top);
        if (topCards.length === 0) return { run: 0, cards: 0 };
        // 세로로 연달아 놓인 카드의 최대 개수. 두 카드 사이 간격이 좁으면(제목 한 줄 정도 = 56px 이하)
        // '연속'으로 본다. 그보다 벌어져 있으면 사이에 다른 형태(통계·경고행·버튼)가 들어간 것으로 본다.
        let run = 1, cur = 1;
        for (let i = 1; i < topCards.length; i++) {
          const gap = topCards[i].r.top - (topCards[i - 1].r.top + topCards[i - 1].r.height);
          if (gap <= 56) cur++; else cur = 1;
          run = Math.max(run, cur);
        }
        return { run, cards: topCards.length };
      });
    /** 솔리드 풀폭 버튼(=Primary로 읽히는 것) 개수. 검정/브랜드 면 + 흰 글자 + 폭 260↑. */
    const primaryCount = (page) =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="button"]')].filter((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width < 260 || r.height < 40) return false;
          const bg = cs.backgroundColor;
          return /^rgb\((17, 17, 17|204, 42, 42|254, 229, 0)\)$/.test(bg.replace(/\s+/g, ' '));
        }).length,
      );

    for (const [path, name] of [
      ['/owner/staff', '직원·급여'],
      ['/owner/store-config', '매장 정보'],
      ['/owner/payroll', '급여 설정'],
      ['/junior/settings', '직원 설정'],
      ['/account-edit', '프로필 편집'],
      // 2026-08-06: 섹션 6개(카드 6장·연속 4)를 4개로 합쳐 해체했다. 되돌아오면 여기서 잡힌다.
      ['/account-settings', '계정 설정'],
      // 2026-08-06: 안내·계좌·입금자명 3연속 카드를 '입금하기' 한 카드로 합쳤다.
      ['/billing', '요금제'],
    ]) {
      const pg = name === '직원 설정' ? pj : po;
      await pg.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(2600);
      const { run, cards } = await maxCardRun(pg);
      const prim = await primaryCount(pg);
      check(`B10 ${name} — 카드 연속 ≤2 (실측 ${run} · 카드 ${cards})`, run <= 2, `run=${run}`);
      check(`B10 ${name} — Primary ≤1 (실측 ${prim})`, prim <= 1, `primary=${prim}`);
      await shot(pg, `11-cards-${path.split('/').pop()}`);
    }
    // 직원 근무표는 세그먼트 안이라 따로 — '교대 요청' 탭에서 3연속이었다.
    await pj.goto(`${ORIGIN}/junior/schedule`, { waitUntil: 'domcontentloaded' });
    await pj.waitForTimeout(2400);
    const swapTab = pj.getByText('교대', { exact: false }).first();
    if (await swapTab.isVisible().catch(() => false)) {
      await swapTab.dispatchEvent('click');
      await pj.waitForTimeout(1600);
    }
    const sched = await maxCardRun(pj);
    check(`B10 근무표(교대 요청) — 카드 연속 ≤2 (실측 ${sched.run})`, sched.run <= 2, `run=${sched.run}`);
    await shot(pj, '11-cards-junior-schedule');

    // ═══════════ B11 예산 초과 후보 실측 — 정적 상한을 실화면으로 검증한다 ═══════════
    // `npm run ia`는 조건부 블록을 전부 세는 **상한 추정치**를 낸다(스크립트가 스스로 밝히는 한계).
    // 그래서 "절대 예산 초과 10개"가 진짜인지 부풀린 건지 정적으로는 판정할 수 없다.
    // 여기서 카드 런·Primary를 DOM에서 재서 **실제 상태를 기록**한다. 실패시키지 않고 표로 남긴다 —
    // 판정(감축이냐 ADR이냐)은 사람이 한다.
    console.log('\n[B11] 예산 초과 후보 — 실화면 실측(판정용 기록, 실패 아님)');
    const budgetRows = [];
    for (const [pg, path, name] of [
      [po, '/account-settings', '계정 설정'],
      [po, '/owner/categories', '노하우(탭)'],
      // 2026-08-07: '받은질문' 탭이 노하우 탭 '할 일' 세그먼트로 흡수됐다(/owner/inbox 는 리다이렉트).
      // 재는 대상은 그 세그먼트가 실제로 그리는 면이다.
      [po, '/owner/categories?seg=todo', '노하우 탭 · 할 일'],
      [po, '/hub', '허브 현황'],
      [po, '/owner/staff', '직원·급여'],
      [po, '/billing', '결제(다른 작업 소유 — 읽기만)'],
      [pj, '/junior/attendance', '출퇴근'],
      [pj, '/junior/schedule', '근무표'],
    ]) {
      await pg.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await pg.waitForTimeout(2400);
      const m = await maxCardRun(pg).catch(() => ({ run: -1, cards: -1 }));
      const p = await primaryCount(pg).catch(() => -1);
      budgetRows.push({ name, path, run: m.run, cards: m.cards, primary: p });
      await shot(pg, `12-budget-${path.replace(/\//g, '_')}`);
    }
    console.log('    화면              카드런  카드수  Primary');
    for (const r of budgetRows) {
      const flag = r.run >= 3 ? ' ← 카드 3연속' : r.primary > 1 ? ' ← Primary 다수' : '';
      console.log(`    ${r.name.padEnd(16)}  ${String(r.run).padStart(4)}  ${String(r.cards).padStart(5)}  ${String(r.primary).padStart(6)}${flag}`);
    }
    const budgetReal = budgetRows.filter((r) => r.run >= 3 || r.primary > 1);
    console.log(`    → 실측으로 규칙 위반이 남은 화면: ${budgetReal.length ? budgetReal.map((r) => r.name).join(', ') : '없음'}`);

    // ═══════════ B9 빈 화면 문구 대비 — ★데이터 0인 매장으로 따로 잰다 ═══════════
    // 이 하니스의 구조적 공백이었다: 위 시드가 노하우 3건·업무 4건·질문 2건을 넣고 돌기 때문에
    // **빈 화면이 한 번도 렌더되지 않았다.** 2026-08-06 조사에서 "문제 없는 곳 39건을 세고,
    // 진짜 문제인 빈 화면 문구 34곳을 0건으로 셌다"가 드러났다.
    // → 아무것도 없는 매장을 하나 더 세워 빈 화면만 훑는다. 여기서 재는 게 진짜 본문이다.
    console.log('\n[B9] 빈 화면 문구 — 데이터 0 매장');
    const empty = mk();
    const phoneE = `0106${s.slice(0, 7)}`;
    await seedVerifiedPhones(URL_, SRV, [phoneE]);
    eEmail = `qa_blk_e_${s}@example.com`;
    const eUp = await empty.auth.signUp({ email: eEmail, password: pw, options: { data: { name: 'QA빈매장사장', role: 'owner', phone: phoneE, birth_date: '1985-06-06' } } });
    if (eUp.error) throw new Error('empty owner signUp: ' + eUp.error.message);
    const { data: c2, error: e2 } = await empty.rpc('create_store', { p_store_name: 'QA빈카페', p_industry: '카페·디저트', p_biz_no: null });
    const row2 = Array.isArray(c2) ? c2[0] : c2;
    if (e2 || !row2?.unit_id) throw new Error('create_store(empty): ' + (e2?.message ?? 'no row'));
    await admin.rpc('admin_activate_store', { p_unit_id: row2.unit_id, p_days: 1, p_plan: 'multi' });
    await empty.rpc('switch_active_unit', { p_unit_id: row2.unit_id });

    const pe = await newPage(eEmail);
    // 빈 화면이 실제로 뜨는 경로들 — 노하우 0 · 직원 0 · 근무표 0 · 제안 0 · 질문 0 · 퀴즈 0
    const EMPTY_ROUTES = [
      ['/owner/staff', '직원'],
      ['/owner/schedule', '근무표'],
      ['/owner/suggestions', '제안함'],
      ['/owner/categories?seg=todo', '노하우 탭 · 할 일'],
      ['/owner/training', '퀴즈'],
      ['/owner/knowledge', '노하우'],
    ];
    let emptyChecked = 0;
    const emptyBad = [];
    const emptyOcc = [];
    for (const [path, name] of EMPTY_ROUTES) {
      await pe.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
      await pe.waitForTimeout(2600);
      const texts = await lowContrastTexts(pe);
      emptyChecked += texts.length;
      emptyOcc.push(...texts.filter((t) => t.occluded).map((t) => `${name}:"${t.text}"`));
      // ★대상은 **본문(≥15sp)만**이다. simplicity-voice §4가 하한을 거는 자리가 정확히 그것이고,
      //   2026-08-06에 고친 34곳도 전부 ≥15sp였다(그래서 '진짜 문제'로 분류된 것).
      //   탭 라벨·배지·카운트·칩·섹션 힌트(10~13sp)는 규칙이 명시적으로 하한 대상에서 뺀 자리라 세지 않는다.
      // preexisting(ink3) 면제도 여기서는 쓰지 않는다 — 이 34곳이 정확히 그 ink3였고, 그래서 고친 것이다.
      emptyBad.push(...lowContrast(texts.filter((t) => t.size >= 15)).map((t) => ({ ...t, screen: name })));
      await shot(pe, `10-empty-${path.split('/').pop()}`);
    }
    check(`B9-0 빈 화면 측정 시점에 가려진 텍스트 0건`, emptyOcc.length === 0, emptyOcc.slice(0, 3).join(' '));
    check(
      `B9-1 ★빈 화면 본문(≥15sp) 저대비 0건 (6화면 · 텍스트 ${emptyChecked}개 스캔)`,
      emptyBad.length === 0,
      emptyBad.slice(0, 8).map((t) => `[${t.screen}] ${fmt(t)}`).join(' | '),
    );

    // ═══════════ B6 콘솔 에러 ═══════════
    const fatal = errors.filter((e) => !/favicon|Download the React DevTools|ResizeObserver/.test(e));
    check(`B6 콘솔 치명 에러 0 (총 ${errors.length})`, fatal.length === 0, fatal.slice(0, 4).join(' | '));
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('\n✗ 예외:', e.message);
} finally {
  // ── 자가정리 ──
  try {
    for (const email of [oEmail, jEmail, hEmail, eEmail]) {
      if (!email) continue;
      const c = mk();
      const r = await c.auth.signInWithPassword({ email, password: pw });
      if (!r.error) await c.rpc('delete_my_account');
    }
    await cleanupSeededPhones(URL_, SRV, [`0107${s.slice(0, 7)}`, `0108${s.slice(0, 7)}`, `0109${s.slice(0, 7)}`, `0106${s.slice(0, 7)}`]);
  } catch (e) { console.log('  (정리 일부 실패:', e.message, ')'); }
  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — 블록 어휘 실화면 QA · 통과 ${pass} / 실패 ${fail}`);
  console.log(`   스크린샷: ${SHOTS}/`);
  process.exitCode = fail === 0 ? 0 : 1;
}
