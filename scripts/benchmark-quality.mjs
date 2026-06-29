// scripts/benchmark-quality.mjs — 노하우 파이프라인 품질·비용 회귀 벤치마크.
// 마스터지침/스키마/모델/임계값을 바꾼 뒤 "토큰은 줄어도 품질은 유지"를 증명하는 기준 측정.
// 기준 문서: 루트 `노하우_성능기준_v1.md` (골든셋·합격기준의 정본).
//
// 실행:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//   BENCH_EMAIL=owner@pilot.squaretable.app BENCH_PW=pilot1234 \
//   node scripts/benchmark-quality.mjs
//   (env 미지정 시 .env + 기본 계정 사용)
//
// 배포된 Edge(실 Gemini)를 그대로 호출 → 프롬프트 드리프트 없음. 토큰은 Edge가 반환하는 usage 사용.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));

function envFromFile() {
  try {
    const t = readFileSync(join(__dir, '..', '.env'), 'utf8');
    const g = (k) => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
    return { URL: g('EXPO_PUBLIC_SUPABASE_URL'), ANON: g('EXPO_PUBLIC_SUPABASE_ANON_KEY') };
  } catch { return {}; }
}
const fileEnv = envFromFile();
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || fileEnv.URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || fileEnv.ANON;
const EMAIL = process.env.BENCH_EMAIL || 'owner@pilot.squaretable.app';
const PW = process.env.BENCH_PW || 'pilot1234';
if (!URL || !ANON) { console.error('✗ SUPABASE URL/ANON 필요'); process.exit(1); }

// 마스터 지침(주입) — Edge가 받아 프롬프트에 삽입. 클라와 동일 소스 사용.
const masterTs = readFileSync(join(__dir, '..', 'src', 'data', 'extraction-master.ts'), 'utf8');
const MASTER = masterTs.slice(masterTs.indexOf('`') + 1, masterTs.lastIndexOf('`'));

const H = { apikey: ANON, 'Content-Type': 'application/json' };
const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: H, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
if (!auth.access_token) { console.error('✗ 로그인 실패', auth.error_description || ''); process.exit(1); }
const AH = { ...H, Authorization: `Bearer ${auth.access_token}` };
const ai = (task, payload) => fetch(`${URL}/functions/v1/ai`, { method: 'POST', headers: AH, body: JSON.stringify({ task, payload }) }).then(r => r.json());
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const tok = (u) => `${u?.promptTokenCount ?? '?'}in/${u?.candidatesTokenCount ?? '?'}out`;

// ── 골든셋: 구조화 ──
const STRUCT = [
  { raw: '아침에 셔터 올리고 에어컨 켜고 의자 내려놔', cat: 'Routine', need: (s) => s.square.action.steps.length >= 2 },
  { raw: '손님이 음료 식었다 하면 군말 말고 새로 만들어드려', cat: 'Event', need: (s) => !!s.square.extract.dont },
  { raw: '여분 시럽은 창고 맨 위 칸에 있어', cat: 'Context', need: (s) => s.square.action.steps.length === 0, nofab: true },
  { raw: '와이파이 비번은 매장 이름 뒤에 1234야', cat: 'Context', need: (s) => s.square.action.steps.length === 0, nofab: true },
  { raw: '단골 김부장님은 아이스 아메리카노 연하게 드셔', cat: 'Context', need: () => true },
  { raw: '우유 거품은 적당히 곱게 올려야 라떼아트가 잘 돼', cat: 'Know-how', need: () => true, scale: true },
  { raw: '고기는 가장자리에 핏물 살짝 올라오면 뒤집어야 딱 좋아', cat: 'Know-how', need: () => true },
  { raw: '아침엔 그라인더 청소하고 원두 채워. 그리고 진상 손님 오면 매니저 불러', split: ['Routine', 'Event'] },
];
// ── 골든셋: 검색(패러프레이즈) ──
const SEARCH = [
  { q: '영업 끝나면 정리 어디까지 해요?', want: '마감' },
  { q: '카드가 안 긁혀요', want: 'POS' },
  { q: '샷이 안 예쁘게 나와요', want: '에스프레소' },
  { q: '음료에 뭐 떠 있다고 손님이 뭐라 해요', want: '이물질' },
  { q: '사장님 없을 때 환불해줘도 돼요?', want: '권한' },
  { q: '화장실 청소 세제 뭐 써요?', want: null }, // 노하우 없음 → 매칭 실패 기대
];

console.log('═══════ 노하우 품질·비용 벤치마크 ═══════\n');
console.log('① 구조화 (분류·날조방지·척도·분리·토큰)');
let clsOK = 0, clsN = 0, fab = 0, scaleEdge = 0, scaleN = 0, splitOK = 0, errs = 0, inSum = 0, outSum = 0, n = 0;
const ents = await (await fetch(`${URL}/rest/v1/playbook_entries?select=id,title,category`, { headers: AH })).json();
for (const c of STRUCT) {
  const out = await ai('square', { storeId: 'store_001', rawText: c.raw, category: '', categoryGuide: MASTER });
  if (out.error) { errs++; console.log(`  ✗ "${c.raw.slice(0,20)}…" ${out.error}`); await wait(2500); continue; }
  const segs = out.segments || [];
  if (out.usage) { inSum += out.usage.promptTokenCount || 0; outSum += out.usage.candidatesTokenCount || 0; n++; }
  let line;
  if (c.split) {
    // 분리 카테고리는 flash-lite에서 ~75% 변동 → 단발 노이즈 방지로 3회 다수결(2/3↑ PASS).
    const judge = (sg) => sg.length >= 2 && c.split.every(x => sg.map(s => s.category).includes(x));
    let pass = judge(segs) ? 1 : 0;
    const attempts = [segs.map(s => s.category).join(',')];
    for (let k = 0; k < 2; k++) {
      await wait(2500);
      const o2 = await ai('square', { storeId: 'store_001', rawText: c.raw, category: '', categoryGuide: MASTER });
      const sg2 = o2.segments || [];
      attempts.push(sg2.map(s => s.category).join(','));
      if (judge(sg2)) pass++;
    }
    const ok = pass >= 2;
    if (ok) splitOK++;
    line = `분리 3회중 ${pass} PASS [${attempts.join(' | ')}] ${ok ? 'PASS' : 'FAIL'}`;
  } else {
    clsN++;
    const catOk = segs[0]?.category === c.cat; if (catOk) clsOK++;
    const needOk = c.need(segs[0]);
    if (c.nofab && segs[0]?.square.action.steps.length > 0) fab++;
    if (c.scale) { scaleN++; if (segs.some(s => s.scalePrompt)) scaleEdge++; }
    line = `${segs[0]?.category}(기대 ${c.cat}) ${catOk ? '✓' : '✗'} | ${needOk ? '구조✓' : '구조✗'}${c.scale ? ` | 척도(Edge)=${segs.some(s => s.scalePrompt) ? 'O' : 'X'}` : ''}`;
  }
  console.log(`  [${tok(out.usage)}] "${c.raw.slice(0,22)}…" → ${line}`);
  await wait(2500);
}

console.log('\n② 검색 (패러프레이즈 Top-1 + 밴드)');
const band = (s) => s >= 0.7 ? 'SERVE' : s >= 0.45 ? 'GENERATE' : 'DEFLECT';
let srOK = 0, srN = 0;
for (const c of SEARCH) {
  const r = await ai('search', { query: c.q });
  const top = (r.candidates || [])[0];
  const title = top ? (ents.find(e => e.id === top.id)?.title || top.id) : '(없음)';
  let verdict;
  if (c.want === null) { verdict = (r.topSimilarity ?? 0) < 0.7 ? 'PASS(미매칭/그라운딩처리)' : 'FAIL(오매칭 SERVE)'; if ((r.topSimilarity??0)<0.7) srOK++; srN++; }
  else { srN++; const ok = title.includes(c.want); if (ok) srOK++; verdict = ok ? 'PASS' : 'FAIL'; }
  console.log(`  "${c.q}" → ${title} (${(r.topSimilarity ?? 0).toFixed(3)}/${band(r.topSimilarity ?? 0)}) ${verdict}`);
  await wait(2000);
}

console.log('\n③ 답변 그라운딩 (근거있음→생성 / 근거없음→디플렉트)');
async function answerOf(q) {
  const r = await ai('search', { query: q });
  const ids = (r.candidates || []).slice(0, 3).map(c => c.id);
  if (!ids.length) return { grounded: false };
  const full = await (await fetch(`${URL}/rest/v1/playbook_entries?select=id,title,creator_name,version,updated_at,category,square&id=in.(${ids.join(',')})`, { headers: AH })).json();
  const sops = full.map(e => ({ id: e.id, title: e.title, category: e.category, situation: e.square?.situation || '', steps: e.square?.action?.steps || [], donts: e.square?.extract?.dont ? [e.square.extract.dont] : [], creatorName: e.creator_name, version: e.version, updatedAt: e.updated_at }));
  return ai('answer', { storeId: 'store_001', query: q, sops });
}
const a1 = await answerOf('카드 안 긁혀요'); await wait(2000);
const a2 = await answerOf('화장실 청소 세제 뭐 써요?');
const ansOK = (a1.grounded === true) && (a2.grounded === false);
console.log(`  "카드 안 긁혀요" grounded=${a1.grounded} (기대 true)`);
console.log(`  "화장실 세제" grounded=${a2.grounded} (기대 false→디플렉트)`);

// ── 합격 판정 ──
const avgIn = n ? Math.round(inSum / n) : 0, avgOut = n ? Math.round(outSum / n) : 0;
const R = [
  ['JSON/Edge 실패 = 0', errs === 0],
  ['분류 정확 ≥ 6/7', clsOK >= 6],
  ['날조(가짜 step) = 0', fab === 0],
  ['분리 [Routine,Event] 정확', splitOK >= 1],
  ['검색 Top-1 ≥ 5/6', srOK >= 5],
  ['답변 그라운딩 정확', ansOK],
  ['square 평균 입력 ≤ 1300', avgIn <= 1300],
  ['square 평균 출력 ≤ 350', avgOut <= 350],
];
console.log('\n═══════ 판정 ═══════');
console.log(`분류 ${clsOK}/${clsN} · 날조위반 ${fab} · 척도(Edge) ${scaleEdge}/${scaleN}(+클라폴백=100%) · 분리 ${splitOK}/1 · 검색 ${srOK}/${srN} · 그라운딩 ${ansOK ? 'OK' : 'NG'} · 실패 ${errs}`);
console.log(`square 토큰 평균: ${avgIn} in / ${avgOut} out (n=${n})`);
let pass = true;
for (const [name, ok] of R) { console.log(`  ${ok ? 'PASS ✅' : 'FAIL ❌'}  ${name}`); if (!ok) pass = false; }
console.log(`\n총평: ${pass ? '✅ 전 항목 합격' : '❌ 일부 미달 — 회귀 의심, 변경 재검토'}`);
