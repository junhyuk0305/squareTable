#!/usr/bin/env node
// qa-ai-units.mjs — AI 캡 가중치(0193 + 엣지 AI_UNITS) 라이브 증명.
//
// 새 무료 매장 하나로 태스크마다 엣지를 실제로 부르고 ai_usage_monthly 증가량을 잰다.
//   ① 직원 질문 답변 = 1
//   ② 퀴즈 문항 만들기(quiz_item) 1회 = 2
//   ③ PDF 3쪽 = 3 · 1쪽 = 1 (쪽수 = IMAGE 토큰 ÷ 520, 실측 상수)
//   ④ 노하우 정리(square)·의도 추출(intent) = 0
//   ⑤ 모델을 안 부른 결과(모르는 퀴즈 형태 → rejected) = 0
//   ⑥ 사전판정은 필요 단위로 — 남은 1이면 퀴즈(2)는 402, 답변(1)은 200
//   ⑦ PDF 는 최소 1로 사전판정 → 남은 1이어도 3쪽이 통과하고 3 차감(캡을 넘을 수 있음 — 의도된 허용)
//   ⑧ 옛 호출 호환 — consume_ai_quota·ai_quota_status 를 **인자 없이** 불러도 동작(옛 앱 빌드)
//   ⑨ 클라가 음수 단위로 사용량을 되돌리지 못한다
//
// 에스컬레이션(직원 질문 → 사장 1탭)은 엣지를 부르지 않는다(useChatStore 가 질문 행만 쓴다) — 코드 판정, 여기서 안 본다.
// ⚠️ LLM 을 실제로 부른다(답변·퀴즈·PDF·정리 각 1~2회). 실행: node scripts/qa-ai-units.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const file of ['.env', '.env.seed']) {
  try {
    for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* 없음 */ }
}
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('FAIL: URL/ANON/SERVICE_ROLE env 필요'); process.exit(2); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

// 쪽 수가 정해진 텍스트 PDF(엣지는 쪽을 이미지로 센다 — 텍스트 PDF 도 IMAGE 토큰이 잡힌다, 실측).
function makePdf(n) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`);
  objs.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const s = `BT /F1 24 Tf 72 700 Td (Page ${i + 1} open the store at 9) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1').toString('base64');
}

const SOP = {
  id: 'qa_units_sop', title: '오픈 준비', situation: '매장 문을 열 때',
  steps: ['조명을 켠다', '포스기를 켠다', '출입문 잠금을 푼다'], donts: ['현금함을 열어둔 채 자리를 비우지 않는다'],
};

let client, token, unit, phone;
async function edge(task, payload) {
  const res = await fetch(`${URL}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, payload }),
  });
  const body = await res.json().catch(() => null);
  await sleep(6500); // 엣지 레이트리밋(사용자 10/분) — 붙여 쏘면 429 가 측정 실패로 섞인다
  return { status: res.status, body };
}
async function used() {
  const { data } = await admin.from('ai_usage_monthly').select('used').eq('unit_id', unit).eq('month', kstMonth).maybeSingle();
  return data?.used ?? 0;
}
async function setUsed(n) {
  const { error } = await admin.from('ai_usage_monthly').upsert({ unit_id: unit, month: kstMonth, used: n }, { onConflict: 'unit_id,month' });
  if (error) throw new Error(`setUsed 실패: ${error.message}`);
}
async function delta(label, task, payload, expect) {
  const before = await used();
  const r = await edge(task, payload);
  const after = await used();
  check(`${label} = ${expect}`, r.status === 200 && after - before === expect, `status=${r.status} Δ=${after - before}${r.body?.error ? ` err=${r.body.error}` : ''}`);
  return r;
}

let origTrial = null, origFree = null;
async function restore() {
  if (origTrial !== null) await admin.from('app_config').update({ value: origTrial }).eq('key', 'signup_trial_days');
  if (origFree !== null) await admin.from('app_config').update({ value: origFree }).eq('key', 'billing_free_mode');
}

async function main() {
  const cfg = await admin.from('app_config').select('key, value').in('key', ['signup_trial_days', 'billing_free_mode']);
  origTrial = cfg.data?.find((r) => r.key === 'signup_trial_days')?.value ?? null;
  origFree = cfg.data?.find((r) => r.key === 'billing_free_mode')?.value ?? null;
  await admin.from('app_config').update({ value: '0' }).eq('key', 'signup_trial_days');
  await admin.from('app_config').update({ value: 'false' }).eq('key', 'billing_free_mode');

  try {
    client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    phone = `0107${String(Date.now()).slice(-7)}`;
    await seedVerifiedPhones(URL, SERVICE, [phone]);
    const { data: su, error: se } = await client.auth.signUp({
      email: `qa_units_${Date.now()}@example.com`, password: 'Test1234!qa',
      options: { data: { name: 'QA단위사장', role: 'owner', phone, birth_date: '1990-01-15' } },
    });
    if (se || !su.session) throw new Error(`signUp 실패: ${se?.message}`);
    token = su.session.access_token;
    const { data: cs, error: ce } = await client.rpc('create_store', { p_store_name: 'QA 단위점', p_industry: '카페·디저트', p_biz_no: null });
    if (ce) throw new Error(`create_store 실패: ${ce.message}`);
    unit = cs[0].unit_id;

    await delta('① 답변', 'answer', { query: '오픈할 때 뭐부터 하나요', sops: [SOP] }, 1);
    await delta('② 퀴즈 만들기 1회', 'quiz_item', { format: 'mc4', kind: 't0', sops: [SOP], count: 1 }, 2);
    await delta('③ PDF 3쪽', 'doc_extract', { mimeType: 'application/pdf', docBase64: makePdf(3) }, 3);
    await delta('③ PDF 1쪽', 'doc_extract', { mimeType: 'application/pdf', docBase64: makePdf(1) }, 1);
    await delta('④ 노하우 정리(square)', 'square', { rawText: '오픈할 때 조명과 포스기를 켜고 문 잠금을 푼다', category: '오픈' }, 0);
    await delta('④ 의도 추출(intent)', 'intent', { query: '오픈할 때 뭐부터 하나요' }, 0);
    const rj = await delta('⑤ 모르는 퀴즈 형태(모델 안 부름)', 'quiz_item', { format: 'no_such_format', kind: 't0', sops: [SOP] }, 0);
    check('⑤ rejected 로 돌아온다', rj.body?.rejected === 'no_generation', JSON.stringify(rj.body).slice(0, 80));

    // ⑥ 사전판정 — 무료 캡 200, 남은 1
    await setUsed(199);
    const q402 = await edge('quiz_item', { format: 'mc4', kind: 't0', sops: [SOP], count: 1 });
    check('⑥ 남은 1 → 퀴즈(2) 402', q402.status === 402 && q402.body?.error === 'ai_quota_exceeded', `status=${q402.status}`);
    check('⑥ 402 는 차감 없음', (await used()) === 199);
    const a200 = await edge('answer', { query: '오픈할 때 뭐부터 하나요', sops: [SOP] });
    check('⑥ 남은 1 → 답변(1) 200', a200.status === 200, `status=${a200.status}`);

    // ⑦ PDF 는 최소 1로 사전판정
    await setUsed(199);
    const p = await edge('doc_extract', { mimeType: 'application/pdf', docBase64: makePdf(3) });
    const afterPdf = await used();
    check('⑦ 남은 1 → PDF 3쪽 통과 · 3 차감(캡 초과 허용)', p.status === 200 && afterPdf === 202, `status=${p.status} used=${afterPdf}`);
    const p402 = await edge('doc_extract', { mimeType: 'application/pdf', docBase64: makePdf(1) });
    check('⑦ 캡을 넘은 뒤 PDF 는 402', p402.status === 402, `status=${p402.status}`);

    // ⑧ 옛 호출 호환(인자 없음)
    await setUsed(10);
    const { data: st, error: stErr } = await client.rpc('ai_quota_status');
    const stRow = Array.isArray(st) ? st[0] : st;
    check('⑧ ai_quota_status() 무인자 동작 · 무료 캡 200', !stErr && stRow?.cap_count === 200 && stRow?.exceeded === false, stErr?.message ?? JSON.stringify(stRow));
    const { data: cq, error: cqErr } = await client.rpc('consume_ai_quota');
    const cqRow = Array.isArray(cq) ? cq[0] : cq;
    check('⑧ consume_ai_quota() 무인자 = 1 차감', !cqErr && cqRow?.used_count === 11, cqErr?.message ?? JSON.stringify(cqRow));

    // ⑨ 음수 단위 차단
    const { data: neg } = await client.rpc('consume_ai_quota', { p_units: -100 });
    const negRow = Array.isArray(neg) ? neg[0] : neg;
    check('⑨ 음수 단위는 1로 올린다(되돌리기 불가)', negRow?.used_count === 12, JSON.stringify(negRow));
  } finally {
    await restore();
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
}

main()
  .catch(async (e) => { console.error('FATAL:', e?.message ?? e); fail += 1; await restore(); })
  .finally(async () => {
    try { await client?.rpc('delete_my_account'); } catch { /* best-effort */ }
    if (phone) await cleanupSeededPhones(URL, SERVICE, [phone]);
    process.exit(fail === 0 ? 0 : 1);
  });
