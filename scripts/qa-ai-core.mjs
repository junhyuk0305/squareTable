// AI 핵심 플로우 실통신 QA — 노하우 수정(patch) · 노하우 질문(answer) · 의도추출(intent).
// (추가/다중입력 square는 qa-knowhow-accuracy.mjs / qa-knowhow-multi.mjs 가 커버)
// square/patch/answer/intent 모두 DB에 안 씀(embed만) → 오염 없음.
// 사용: QA_EMAIL=owner@pilot.squaretable.app QA_PASSWORD=pilot1234 node scripts/qa-ai-core.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; }
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
if (!URL_ || !ANON) { console.error('env(.env) 누락'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수 필요(파일럿 계정).'); process.exit(1); }
const guide = (() => { const s = readFileSync(here('../src/data/extraction-master.ts'), 'utf8'); return s.match(/EXTRACTION_MASTER = `([\s\S]*?)`;/)?.[1] ?? ''; })();
const norm = (s) => (typeof s === 'string' ? s : JSON.stringify(s || '')).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

async function signIn() {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('로그인 실패: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
async function call(token, task, payload) {
  const t0 = Date.now();
  for (let a = 1; a <= 2; a++) {
    try {
      const res = await fetch(`${URL_}/functions/v1/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: JSON.stringify({ task, payload }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, ms: Date.now() - t0, body: j };
      if (res.status < 500) return { ok: false, status: res.status, ms: Date.now() - t0, body: j };
    } catch (e) { if (a >= 2) return { ok: false, status: 0, ms: Date.now() - t0, body: { error: String(e) } }; }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const sop = (o) => ({ id: o.id, title: o.title, category: o.category || 'Routine', situation: o.situation || '', steps: o.steps || [], donts: o.donts || [], creatorName: '사장님', version: 1, updatedAt: '2026-07-01T00:00:00Z' });

let pass = 0, fail = 0;
const chk = (c, n, d) => { if (c) { pass++; console.log(`    ✓ ${n}`); } else { fail++; console.log(`    ✗ ${n}${d ? ' → ' + d : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 노하우 수정(patch): 요청 반영 + 기존 보존 + 칸 정확 ──
const PATCH = [
  { id: 'P1', label: '단계 추가', cur: { title: '아이스 아메리카노 제조', category: 'Routine', situation: '아이스 아메리카노 주문 시', steps: ['얼음을 가득 채운다', '에스프레소 2샷을 넣는다', '물 200ml를 붓는다'], dont: '' },
    instr: '마지막에 시럽은 손님이 요청할 때만 넣으라는 걸 추가해줘', add: ['시럽'], keep: ['얼음', '200'] },
  // P2(멘트 추가)는 2026-08-08 멘트 칸 폐기와 함께 삭제. 번호는 안 당긴다(로그 대조용 고정 id).
  { id: 'P3', label: '금지 추가', cur: { title: '디카페인 제조', category: 'Routine', situation: '디카페인 주문 시', steps: ['디카페인 원두로 내린다'], dont: '' },
    instr: '일반 원두랑 절대 섞지 말라고 금지 추가해줘', add: ['섞'], keep: ['디카페인'], where: 'dont' },
  { id: 'P4', label: '수치 수정', cur: { title: '아이스티 제조', category: 'Routine', situation: '아이스티 주문 시', steps: ['원액과 물을 1대 4로 섞는다'], dont: '' },
    instr: '비율을 1대 5로 바꿔줘', add: ['5'], keep: ['원액'] },
  { id: 'P5', label: '보존 확인(제목/상황 유지)', cur: { title: '마감 청소', category: 'Routine', situation: '영업 마감 후', steps: ['그라인더 원두를 비운다', '바닥을 청소한다'], dont: '' },
    instr: '행주 삶는 단계 하나만 더 추가해줘', add: ['행주'], keep: ['그라인더', '바닥', '마감'] },
];
// ── 노하우 질문(answer): 그라운딩 + 출처바인딩 + 환각금지 + 사실형 응답 ──
const SOPS = {
  aa: sop({ id: 'sop_aa', title: '아이스 아메리카노 제조', category: 'Routine', situation: '아이스 아메리카노 주문 시', steps: ['얼음을 가득 채운다', '에스프레소 2샷을 넣는다', '물 200ml를 붓는다'] }),
  clean: sop({ id: 'sop_clean', title: '마감 청소', category: 'Routine', situation: '영업 마감 후', steps: ['그라인더 원두를 비운다', '바닥을 물청소한다'] }),
  cup: sop({ id: 'sop_cup', title: '여분 컵 보관 위치', category: 'Context', situation: '여분 컵과 빨대는 창고 맨 위 칸에 보관한다', steps: [] }),
  refund: sop({ id: 'sop_refund', title: '환불 응대', category: 'Event', situation: '손님이 환불을 요청할 때', steps: ['영수증을 확인한다', '포스에서 환불 처리한다'] }),
  refundNr: sop({ id: 'sop_refund_nr', title: '환불 — 영수증 없는 경우', category: 'Event', situation: '환불 요청 — 영수증이 없는 경우', steps: ['사장님께 전화로 확인 후 처리한다'] }),
};
// cov: 조건 커버리지 기대값. partial 이면 caveat(미커버 조건 고지) 비어있으면 안 됨.
const ANSWER = [
  { id: 'A1', label: '직접 매칭(그라운딩)', q: '아이스 아메리카노 어떻게 만들어요?', sops: [SOPS.aa, SOPS.clean], grounded: true, cite: 'sop_aa', must: ['200'], cov: 'full' },
  { id: 'A2', label: '근거 없음(환각 방지)', q: '환불 정책이 어떻게 되나요?', sops: [SOPS.aa, SOPS.clean], grounded: false },
  { id: 'A3', label: '사실형 SOP 답변(C3 연계)', q: '여분 컵 어디 있어요?', sops: [SOPS.cup, SOPS.clean], grounded: true, cite: 'sop_cup', must: ['창고'] },
  { id: 'A4', label: '여러 후보 중 정답 선택', q: '마감 때 뭐 해요?', sops: [SOPS.aa, SOPS.clean, SOPS.cup], grounded: true, cite: 'sop_clean', must: ['청소'] },
  // 예외상황 정확도(2026-07-10) — 질문의 조건("영수증 없이")을 SOP가 다루는가.
  { id: 'A5', label: '예외 미커버 → partial 고지', q: '영수증 없이 환불해 달라는데 어떻게 해요?', sops: [SOPS.refund, SOPS.clean], grounded: true, cite: 'sop_refund', cov: 'partial' },
  { id: 'A6', label: '예외 SOP 존재 → 그걸로 full', q: '영수증 없이 환불해 달라는데 어떻게 해요?', sops: [SOPS.refund, SOPS.refundNr], grounded: true, cite: 'sop_refund_nr', must: ['사장'], cov: 'full' },
];
const INTENT = [
  { id: 'I1', label: '장황한 질문 핵심추출', q: '아 그 왜 아침에 커피 기계 있잖아요 그거 뭐 어떻게 하더라', kw: ['청소', '그라인더', '커피', '기계', '아침'] },
];
// ── 의도 게이트(triage): 잡담·도메인밖=chat / 대상불명=vague / 실질 질문=question ──
// 근거 실측(2026-07-10): 잡담도 벡터 0.58~0.67로 GENERATE 컷 전부 통과 → 2/6 확신 오답.
// expect 는 허용 집합 — 경계 케이스(T6)만 관용, 실질 질문 오차단(T7~T10)은 무관용.
const TRIAGE = [
  { id: 'T1', label: '도메인 밖(날씨)', q: '오늘 날씨 어때?', expect: ['chat'] },
  { id: 'T2', label: 'AI 자체 질문', q: '너 이름 뭐야?', expect: ['chat'] },
  { id: 'T3', label: '잡담(식사)', q: '오늘 뭐 먹을까?', expect: ['chat'] },
  { id: 'T4', label: '잡담(심심)', q: '심심한데 재밌는 얘기 해줘', expect: ['chat'] },
  { id: 'T5', label: '지시대명사(모호)', q: '이거 뭐야?', expect: ['vague'] },
  { id: 'T6', label: '경계(안부/업무 중의)', q: '오늘 뭐해?', expect: ['chat', 'vague'] },
  { id: 'T7', label: '실질 질문(마감)', q: '마감 때 뭐 해요?', expect: ['question'] },
  { id: 'T8', label: '경계-실질("뭐해" 포함)', q: '오늘 마감 뭐 해야 돼요?', expect: ['question'] },
  { id: 'T9', label: '경계-실질(지시대명사+대상)', q: '포스기 이거 어떻게 써요?', expect: ['question'] },
  { id: 'T10', label: '실질 질문(환불)', q: '환불 어떻게 해요?', expect: ['question'] },
  { id: 'T11', label: '잡음(자모뿐, LLM 미호출)', q: 'ㅁㄴㅇㄹ', expect: ['vague'] },
];

const main = async () => {
  const token = await signIn();
  console.log(`✓ 로그인 ${EMAIL} · 가이드 ${guide.length}자\n`);

  console.log('━━━━━━━━━━ [1] 노하우 수정 (patch) ━━━━━━━━━━');
  for (const c of PATCH) {
    const r = await call(token, 'patch', { storeId: 'store_001', instruction: c.instr, current: c.cur, categoryGuide: guide });
    await sleep(6500);
    if (!r.ok) { chk(false, `${c.id} ${c.label}`, `HTTP ${r.status}`); continue; }
    const sq = r.body.square || {};
    const outText = norm([sq.situation, ...(sq.action?.steps || []), sq.extract?.dont, r.body.title].join(' '));
    console.log(`  ${c.id} · ${c.label} [${r.status} ${r.ms}ms]  "${c.instr}"`);
    console.log(`     steps: ${JSON.stringify(sq.action?.steps)}  dont:"${sq.extract?.dont || ''}"`);
    chk(c.add.every((t) => outText.includes(norm(t))), `${c.id} 요청 반영(${c.add.join(',')})`, `누락 ${c.add.filter(t => !outText.includes(norm(t)))}`);
    chk(c.keep.every((t) => outText.includes(norm(t))), `${c.id} 기존 보존(${c.keep.join(',')})`, `유실 ${c.keep.filter(t => !outText.includes(norm(t)))}`);
    if (c.where === 'dont') chk(!!(sq.extract?.dont || '').trim(), `${c.id} 금지 칸에 반영`);
  }

  console.log('\n━━━━━━━━━━ [2] 노하우 질문 (answer) ━━━━━━━━━━');
  for (const c of ANSWER) {
    const r = await call(token, 'answer', { storeId: 'store_001', query: c.q, sops: c.sops });
    await sleep(6500);
    if (!r.ok) { chk(false, `${c.id} ${c.label}`, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0,120)}`); continue; }
    const b = r.body;
    const grounded = b.grounded === true && b.block != null;
    const cited = Array.isArray(b.usedSopIds) ? b.usedSopIds : [];
    const bt = norm(b.block);
    console.log(`  ${c.id} · ${c.label} [${r.status} ${r.ms}ms]  "${c.q}"`);
    console.log(`     grounded=${b.grounded}  block=${b.block ? '있음' : 'null'}  cite=${JSON.stringify(cited)}  degraded=${b.degraded || false}`);
    chk(grounded === c.grounded, `${c.id} 그라운딩 판정=${c.grounded}`, `실제 grounded=${b.grounded}/block=${b.block ? '있음' : 'null'}`);
    if (c.grounded && c.cite) chk(cited.includes(c.cite), `${c.id} 출처 정확(${c.cite})`, `실제 ${JSON.stringify(cited)}`);
    if (c.must) chk(c.must.every((t) => bt.includes(norm(t))), `${c.id} 내용 포함(${c.must.join(',')})`, '답변에 핵심정보 누락');
    if (!c.grounded) chk(!cited.length || b.block == null, `${c.id} 환각 안 함(빈 출처/null)`, `cite=${JSON.stringify(cited)}`);
    if (c.cov) {
      chk(b.coverage === c.cov, `${c.id} coverage=${c.cov}`, `실제 ${b.coverage} caveat="${b.caveat || ''}"`);
      if (c.cov === 'partial') chk(!!(b.caveat || '').trim(), `${c.id} caveat(미커버 조건) 고지`, 'caveat 비어있음');
    }
  }

  console.log('\n━━━━━━━━━━ [3] 의도추출 (intent) ━━━━━━━━━━');
  for (const c of INTENT) {
    const r = await call(token, 'intent', { query: c.q });
    await sleep(6500);
    if (!r.ok) { chk(false, `${c.id} ${c.label}`, `HTTP ${r.status}`); continue; }
    const kws = norm((r.body.keywords || []).join(' ')) + norm(r.body.rewritten || '');
    console.log(`  ${c.id} · ${c.label} [${r.status} ${r.ms}ms]`);
    console.log(`     rewritten="${r.body.rewritten}"  keywords=${JSON.stringify(r.body.keywords)}`);
    chk(c.kw.some((t) => kws.includes(norm(t))), `${c.id} 핵심어 추출(${c.kw.join('/')} 중 1+)`, '핵심어 전무');
  }

  console.log('\n━━━━━━━━━━ [4] 의도 게이트 (triage) ━━━━━━━━━━');
  for (const c of TRIAGE) {
    const r = await call(token, 'triage', { query: c.q });
    await sleep(6500);
    if (!r.ok) { chk(false, `${c.id} ${c.label}`, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); continue; }
    const t = r.body.type;
    console.log(`  ${c.id} · ${c.label} [${r.status} ${r.ms}ms]  "${c.q}" → type=${t}`);
    chk(c.expect.includes(t), `${c.id} 판정∈{${c.expect.join(',')}}`, `실제 ${t}`);
  }

  console.log('\n━━━━━━━━━━ [5] 노하우 정리 — 예외분기 분리 (square) ━━━━━━━━━━');
  {
    const raw = '환불은 영수증 확인하고 해줘. 근데 단골손님이면 영수증 없어도 그냥 해드려';
    const r = await call(token, 'square', { storeId: 'store_001', rawText: raw, category: 'Event', categoryGuide: guide });
    await sleep(6500);
    if (!r.ok) { chk(false, 'S1 예외분기 분리', `HTTP ${r.status}`); }
    else {
      const segs = r.body.segments || [];
      const segText = (s) => norm([s.title, s.square?.situation, ...(s.square?.action?.steps || []), (s.keywords || []).join(' ')].join(' '));
      console.log(`  S1 · "${raw}" → entries ${segs.length}개`);
      segs.forEach((s, i) => console.log(`     [${i + 1}] "${s.title}" situation="${s.square?.situation}" steps=${JSON.stringify(s.square?.action?.steps)}`));
      chk(segs.length >= 2, 'S1 예외를 별도 entry로 분리(≥2)', `실제 ${segs.length}개`);
      const hasException = segs.some((s) => segText(s).includes(norm('단골')));
      chk(hasException, 'S1 예외 entry에 조건(단골) 명시', '조건 단어 유실');
      const hasGeneral = segs.some((s) => segText(s).includes(norm('영수증')) && !segText(s).includes(norm('단골')));
      chk(hasGeneral, 'S1 본 규칙 entry(영수증 확인) 보존', '일반 절차 유실');
    }
  }

  console.log(`\n════════════ ${fail === 0 ? '✅ PASS' : `❌ FAIL(${fail})`} — AI 핵심플로우 QA · 통과 ${pass} / 실패 ${fail} ════════════\n`);
  process.exit(fail === 0 ? 0 : 1);
};
main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
