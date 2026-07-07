// 노하우 추가/다중 추출 정확도 QA — 실 Edge(ai·square) 호출 + 정답셋 대조 채점.
// 카드 개수 정확 / 내용 재현율 / 카테고리 / 특수(잡음거절·초과경고·금지·언어·날조방지).
// square 태스크는 DB에 안 씀(embed만) → 오염 없음.
// 사용: QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-knowhow-accuracy.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수 필요(파일럿 계정).'); process.exit(1); }
const MAX_SPLIT_PUBLISH = 5;
// SSOT 미러(buildEntry.isSquarePublishable): 할 일·멘트, 또는 사실형 상황(≥4자)이면 발행 가능.
const isPub = (s) => ((s?.square?.action?.steps?.length || 0) >= 1) || ((s?.square?.action?.scripts?.length || 0) >= 1) || ((s?.square?.situation || '').trim().length >= 4);

function loadGuide() { const s = readFileSync(here('../src/data/extraction-master.ts'), 'utf8'); return s.match(/export const EXTRACTION_MASTER = `([\s\S]*?)`;/)?.[1] ?? ''; }
async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
async function callSquare(token, guide, rawText) {
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${URL_}/functions/v1/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: JSON.stringify({ task: 'square', payload: { rawText, category: 'Routine', categoryGuide: guide } }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, ms: Date.now() - t0, body: j };
      if (res.status < 500) return { ok: false, status: res.status, ms: Date.now() - t0, body: j };
    } catch (e) { if (attempt >= 2) return { ok: false, status: 0, ms: Date.now() - t0, body: { error: String(e) } }; }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const norm = (s) => (s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

// 정답셋: count=사용자에게 보여야 할 카드 수, tol=허용오차, must=핵심정보(재현율)
const CASES = [
  { id: 'C1', label: '번호 3개 나열', text: '1. 오픈하면 화장실 청소  2. 마감 때 포스기 정산  3. 재고 확인하고 부족하면 발주', count: 3, tol: 0, must: ['화장실', '정산', '재고'] },
  { id: 'C2', label: '단일 레시피(연속 절차·안 쪼개져야)', text: '아이스 아메리카노는 얼음 가득 채운 컵에 에스프레소 2샷 넣고 물 200ml 부어. 시럽은 손님이 요청할 때만 넣어.', count: 1, tol: 0, must: ['얼음', '에스프레소', '200', '시럽'] },
  { id: 'C3', label: '위치 사실(날조 금지·Context)', text: '여분 컵이랑 빨대는 창고 맨 위 칸에 있어. 확인해봐.', count: 1, tol: 1, must: ['창고'], cat: 'Context', noFabStep: true },
  { id: 'C4', label: '돌발대응+금지(Event)', text: '손님이 음료 식었다고 하면 군말 말고 바로 새로 만들어드려. 절대 손님이랑 언쟁하지 마.', count: 1, tol: 0, must: ['새로'], cat: 'Event', dont: ['언쟁', '다투', '군말'] },
  { id: 'C5', label: '혼합(반복+돌발·카테고리 분리)', text: '아침엔 그라인더 청소하고 원두 채워. 그리고 진상 손님 오면 바로 매니저 불러.', count: 2, tol: 0, must: ['그라인더', '원두', '매니저'], catSet: ['Routine', 'Event'] },
  { id: 'C6', label: '긴 인수인계서 7개(초과경고)', text: ['오픈은 8시고 들어오면 에어컨이랑 음악 켜.', '그라인더는 매일 아침 청소하고 원두 가득 채워.', '점심 피크 전에 시럽 재고 확인하고 모자라면 사장한테 문자 줘.', '손님이 음료 식었다 하면 군말 없이 새로 만들어드려.', '진상 손님은 직접 상대하지 말고 매니저 불러.', '마감은 10시고 포스기 정산 후 현금은 금고에 넣어.', '마감 청소는 그릴 끄고 바닥 물청소까지 해.'].join('\n'), count: 5, tol: 0, overflow: true, must: ['그라인더', '정산', '매니저', '재고'] },
  { id: 'C7', label: '레시피 3종(각각)', text: '아이스티는 원액 1 물 4 비율로 타. 자몽에이드는 자몽청 2스푼에 탄산수 부어. 밀크티는 홍차 우린 물에 우유 반반.', count: 3, tol: 0, must: ['아이스티', '자몽', '밀크티'] },
  { id: 'C8', label: '판단기준(Know-how)', text: '스팀 우유는 손으로 못 만질 정도로 뜨거우면 이미 과열된 거야. 63도쯤에서 멈춰.', count: 1, tol: 0, must: ['63'], cat: 'Know-how' },
  { id: 'C9', label: '영어 섞임(한국어 정규화)', text: 'morning에 grinder 청소하고 원두 채워. 그리고 POS기 오픈 준비해.', count: 2, tol: 1, must: ['그라인더', '포스'], koreanOnly: true },
  { id: 'C10', label: '잡음(거절)', text: 'ㅋㅋㅋ 오늘 개바쁨 ㅠㅠ asdf 뭐하지 아 힘들어', count: 0, tol: 0, noise: true },
  { id: 'C11', label: '불릿 5개(경계)', text: '- 오픈하면 매장 청소\n- 그라인더 청소하고 원두 채우기\n- 마감 포스기 정산\n- 진상 손님 오면 매니저 호출\n- 마감 재고 확인', count: 5, tol: 0, overflow: false, must: ['청소', '원두', '정산', '매니저', '재고'] },
  { id: 'C12', label: '한 문단 3규칙(실사용 케이스)', text: '손님 응대는 이렇게 해. 진동벨 울리면 맛있게 드세요 인사하고, 노트북 손님은 창가 2인석으로 안내하고, 화장실 번호는 영수증에 적어드려.', count: 3, tol: 1, must: ['진동벨', '노트북', '화장실'] },
];

function normalizeSegs(b) {
  let segs = Array.isArray(b.segments) ? b.segments : [];
  if (segs.length === 0 && b.square) segs = [{ category: b.category || 'Routine', title: b.title, keywords: b.keywords || [], square: b.square }];
  return segs;
}
function segText(s) { const sq = s.square || {}; return [s.title, sq.situation, ...(sq.action?.steps || []), ...(sq.action?.scripts || []), sq.extract?.dont].filter(Boolean).join(' '); }

const main = async () => {
  const guide = loadGuide();
  const token = await signIn();
  console.log(`✓ 로그인 ${EMAIL} · 가이드 ${guide.length}자 · 케이스 ${CASES.length}개\n`);
  const results = [];
  let totalTokens = 0;
  for (const c of CASES) {
    const r = await callSquare(token, guide, c.text);
    await new Promise((res) => setTimeout(res, 6500));
    if (!r.ok) { console.log(`──── ${c.id} ${c.label}  [ERR ${r.status}]\n`); results.push({ c, err: true }); continue; }
    const b = r.body;
    const usable = b.usable !== false;
    const segs = normalizeSegs(b);
    const pub = segs.filter(isPub);
    const overflow = pub.length > MAX_SPLIT_PUBLISH;
    const published = usable ? pub.slice(0, MAX_SPLIT_PUBLISH).length : 0;
    totalTokens += b.usage?.totalTokenCount || 0;
    const allText = norm(segs.map(segText).join(' '));
    const hit = (c.must || []).filter((m) => allText.includes(norm(m)));
    const recall = c.must?.length ? hit.length / c.must.length : null;
    const cats = segs.map((s) => s.category);
    const countExact = published === c.count;
    const countClose = Math.abs(published - c.count) <= (c.tol ?? 1);
    let catOk = null;
    if (c.cat) catOk = cats.includes(c.cat);
    if (c.catSet) catOk = c.catSet.every((x) => cats.includes(x));
    let dontOk = null;
    if (c.dont) dontOk = segs.some((s) => c.dont.some((d) => norm(s.square?.extract?.dont).includes(norm(d))));
    let noiseOk = null;
    if (c.noise) noiseOk = (usable === false) || published === 0;
    let overflowOk = null;
    if (c.overflow !== undefined) overflowOk = overflow === c.overflow;
    let korOk = null;
    if (c.koreanOnly) { const latin = (segs.map(segText).join(' ').match(/[a-z]{3,}/gi) || []); korOk = latin.length === 0; if (!korOk) c._latin = latin; }
    let noFabOk = null;
    if (c.noFabStep) noFabOk = segs.every((s) => (s.square?.action?.steps?.length || 0) === 0);
    results.push({ c, published, detected: segs.length, usable, overflow, cats, recall, hit, countExact, countClose, catOk, dontOk, noiseOk, overflowOk, korOk, noFabOk });

    console.log(`──── ${c.id} · ${c.label}  [${r.status} · ${r.ms}ms]`);
    console.log(`  기대 카드:${c.count}  실제 발행:${published}  (감지 ${segs.length} / 발행가능 ${pub.length})  ${countExact ? '✅정확' : countClose ? '△근접' : '❌오차'}${c.overflow !== undefined ? `  경고 ${overflow ? '⚠️예' : '아니오'}${overflowOk ? '✓' : '✗'}` : ''}`);
    console.log(`  제목: ${segs.map((s, i) => `${i + 1})${s.title || '∅'}${isPub(s) ? '' : '·비발행'}`).join('  ') || '(없음)'}`);
    console.log(`  카테고리: ${cats.join(', ') || '-'}${catOk === null ? '' : catOk ? '  (cat✓)' : `  (cat✗ 기대 ${c.cat || c.catSet})`}`);
    if (recall !== null) console.log(`  내용재현: ${hit.length}/${c.must.length} [${hit.join(',')}] ${c.must.filter(m => !hit.includes(m)).length ? '누락:' + c.must.filter(m => !hit.includes(m)).join(',') : ''}`);
    if (dontOk !== null) console.log(`  금지문구: ${dontOk ? '✓ 포착' : '✗ 놓침'}`);
    if (noiseOk !== null) console.log(`  잡음거절: ${noiseOk ? '✓' : '✗ (노하우로 오인)'}  usable=${usable}`);
    if (korOk !== null) console.log(`  한국어화: ${korOk ? '✓' : '✗ 영어잔존 ' + c._latin.join(',')}`);
    if (noFabOk !== null) console.log(`  날조방지(steps 비움): ${noFabOk ? '✓' : '✗ 가짜 단계 생성'}`);
    console.log('');
  }

  const done = results.filter((x) => !x.err);
  const N = done.length;
  const exact = done.filter((x) => x.countExact).length;
  const close = done.filter((x) => x.countClose).length;
  const recalls = done.filter((x) => x.recall !== null).map((x) => x.recall);
  const recallAvg = recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0;
  const catCases = done.filter((x) => x.catOk !== null);
  const catOkN = catCases.filter((x) => x.catOk).length;
  const sp = (arr) => { const a = arr.filter((x) => x !== null && x !== undefined); return a.length ? `${a.filter(Boolean).length}/${a.length}` : '-'; };
  console.log('════════════════════ 정확도 요약 ════════════════════');
  console.log(`케이스: ${N}${results.length - N ? ` (에러 ${results.length - N})` : ''}   총 토큰: ${totalTokens}`);
  console.log(`① 카드 개수 정확(완전일치):   ${exact}/${N}  (${Math.round(exact / N * 100)}%)`);
  console.log(`② 카드 개수 근접(±허용오차):  ${close}/${N}  (${Math.round(close / N * 100)}%)`);
  console.log(`③ 내용 재현율(핵심정보 보존): ${Math.round(recallAvg * 100)}%  (${recalls.length}개 케이스 평균)`);
  console.log(`④ 카테고리 정확:              ${catOkN}/${catCases.length}`);
  console.log(`⑤ 특수: 잡음거절 ${sp(done.map(x => x.noiseOk))} · 초과경고 ${sp(done.map(x => x.overflowOk))} · 금지포착 ${sp(done.map(x => x.dontOk))} · 한국어화 ${sp(done.map(x => x.korOk))} · 날조방지 ${sp(done.map(x => x.noFabOk))}`);
  console.log('─────────────────────────────────────────────────────');
  console.log('오차 케이스:', done.filter(x => !x.countExact).map(x => `${x.c.id}(기대${x.c.count}→${x.published})`).join('  ') || '없음');
  // 게이트: 완전일치 ≥80% AND 근접 100% AND 재현율 ≥85% AND 특수 전부 통과(있는 것만)
  const specials = [...done.map(x => x.noiseOk), ...done.map(x => x.overflowOk), ...done.map(x => x.dontOk), ...done.map(x => x.noFabOk)].filter(x => x !== null && x !== undefined);
  const gate = (exact / N >= 0.8) && (close === N) && (recallAvg >= 0.85) && specials.every(Boolean);
  console.log(`\n${gate ? '✅ PASS' : '❌ FAIL'} — 게이트(정확≥80% · 근접100% · 재현≥85% · 특수전부통과)\n`);
  process.exit(gate ? 0 : 1);
};
main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
