// 직원 제안 취소·수정 서버 판정 QA(0355) — 실 백엔드 대상·자가정리 · LLM 호출 0회.
//
// 무엇을 증명하나(2026-11-05 · 줄기 A1):
//   1. 직원 A 가 올린 대기 제안을 A 가 취소(suggestion_withdraw) → 원래 테이블에서 행이 사라지고
//      보관 테이블(playbook_suggestions_withdrawn)에 남는다. 직원·사장 세션은 보관 테이블을 못 읽는다(0행).
//      ('withdrawn' 상태를 쓰지 않는 이유 = 옛 앱 칩 표에 없는 상태가 오면 화면이 죽는다 · 0355 머리말)
//   2. A 가 수정(suggestion_edit) → 본문(text)만 바뀌고 status 는 그대로 pending.
//   3. 같은 매장 직원 B 가 A 의 제안을 취소·수정 → forbidden. 사장도 남의 제안은 forbidden(사장은 검토 경로만).
//   4. 사장이 승인한 제안(옛 reviewSuggestion 모양 update)을 A 가 취소·수정 → not_pending. 취소한 제안을 다시 → not_found.
//   5. 사장 목록(fetchSuggestions 모양 select *)에 취소한 제안이 안 보이고, 상태가 옛 앱 칩 표 안에만 있다.
//      검토 대기 술어(status = 'pending' · 배지 파생 SSOT)에는 수정한 제안만 남는다.
//   6. 수정 patch 에 unit_id·status·proposer_id·kind 를 넣어도 안 바뀐다. 빈 본문은 invalid_argument.
//   + 오류 원문은 코드 그 자체다(컬럼 이름이 실리지 않는다 · AGENTS ⑨). 없는 id 는 not_found.
//   + 기존 경로 그대로: 직원 직접 update 는 여전히 0행(ps_update 무변경).
//
// 사용: node scripts/qa-suggestion-edit.mjs --local          (로컬 도커 · `npx -y supabase@2 status` 키)
//       node scripts/qa-suggestion-edit.mjs --allow-remote   (.env + .env.seed · 라이브는 0355 적용 뒤)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
import { guardResolvedUrls } from './lib/local-target-guard.mjs';
import { joinAsStaff } from './lib/qa-staff.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const LOCAL = process.argv.includes('--local');
let URL_, ANON, SRV;
if (LOCAL) {
  const st = Object.fromEntries(execFileSync('npx', ['-y', 'supabase@2.122.1', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  URL_ = st.API_URL; ANON = st.ANON_KEY; SRV = st.SERVICE_ROLE_KEY;
  if (!URL_ || !/^http:\/\/127\.0\.0\.1:/.test(URL_)) { console.error('중단: 로컬 도커 주소가 아니다 —', URL_); process.exit(2); }
} else {
  const env = { ...pe(here('../.env')), ...pe(here('../.env.seed')) };
  URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  SRV = env.SUPABASE_SERVICE_ROLE_KEY;
  guardResolvedUrls([URL_]);
}
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed 또는 --local)'); process.exit(2); }
console.log(`— 대상 ${LOCAL ? '로컬' : '원격(.env)'} ${URL_} —`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

const qaPhones = [0, 1, 2].map((n) => `010${String(n + 60).padStart(2, '0')}${s.slice(0, 6)}`);
let UNIT = null;
const made = { users: [] };

// 실세션: 계정은 service_role 로 만들고, 세션은 매직링크(generateLink → verifyOtp)로 받는다(AGENTS ⑥).
async function session(email, meta) {
  const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { birth_date: '1994-03-03', ...meta } });
  if (ce) throw new Error(`createUser(${email}): ${ce.message}`);
  made.users.push(cu.user.id);
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (le) throw new Error(`generateLink(${email}): ${le.message}`);
  const c = mk();
  const { error: ve } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (ve) throw new Error(`verifyOtp(${email}): ${ve.message}`);
  return { c, id: cu.user.id };
}

const rowOf = async (id) => {
  const { data, error } = await admin.from('playbook_suggestions').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('rowOf: ' + error.message);
  return data;
};
// 오류 원문이 코드 그 자체인가 — 컬럼 이름·SQLSTATE 문구가 붙으면 화면 문구 매핑이 깨진다(AGENTS ⑨).
const isCode = (r, code) => r.error?.message === code;
const errStr = (r) => r.error ? `err=${r.error.code ?? '-'} "${r.error.message}"` : `ok data=${JSON.stringify(r.data)}`;

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);
  const { c: owner, id: ownerId } = await session(`qa_se_o_${s}@example.com`, { name: 'QA사장', role: 'owner', phone: qaPhones[0] });
  const { data: c1, error: cse } = await owner.rpc('create_store', { p_store_name: 'SE 제안수정', p_industry: '카페·디저트', p_biz_no: null });
  if (cse) throw new Error('create_store: ' + cse.message);
  UNIT = c1?.[0]?.unit_id;
  const CODE = c1?.[0]?.invite_code;
  await owner.rpc('switch_active_unit', { p_unit_id: UNIT });
  const A = await session(`qa_se_a_${s}@example.com`, { name: 'QA직원A', role: 'junior', phone: qaPhones[1] });
  const B = await session(`qa_se_b_${s}@example.com`, { name: 'QA직원B', role: 'junior', phone: qaPhones[2] });
  for (const p of [A, B]) { await joinAsStaff(p.c, CODE); await p.c.rpc('switch_active_unit', { p_unit_id: UNIT }); }
  check('셋업: 매장 + 직원 2명 합류', !!UNIT, `unit=${UNIT}`);

  // 직원 A 가 앱 경로(insertSuggestion = RLS insert)로 제안 3개를 올린다. id 는 앱처럼 text(genId('sug')).
  const ids = { w: `sug_se_w_${s}`, e: `sug_se_e_${s}`, ap: `sug_se_ap_${s}` };
  for (const [k, id] of Object.entries(ids)) {
    const { error } = await A.c.from('playbook_suggestions').insert({
      id, unit_id: UNIT, kind: 'new', proposer_id: A.id, proposer_name: 'QA직원A', text: `원래 본문 ${k}`,
    });
    if (error) throw new Error(`insert ${k}: ${error.message}`);
  }
  check('셋업: 직원 A 제안 3개(pending)', (await rowOf(ids.w))?.status === 'pending');

  // ── 3. 남의 제안: 직원 B · 사장 → forbidden (행은 그대로) ──
  const bW = await B.c.rpc('suggestion_withdraw', { p_id: ids.w });
  check('3. 직원 B 가 A 제안 취소 → forbidden', isCode(bW, 'forbidden'), errStr(bW));
  const bE = await B.c.rpc('suggestion_edit', { p_id: ids.e, p_patch: { text: 'B 가 고침' } });
  check('3. 직원 B 가 A 제안 수정 → forbidden', isCode(bE, 'forbidden'), errStr(bE));
  const oW = await owner.rpc('suggestion_withdraw', { p_id: ids.w });
  check('3. 사장이 A 제안 취소 → forbidden(사장은 검토 경로만)', isCode(oW, 'forbidden'), errStr(oW));
  const after3 = await rowOf(ids.e);
  check('3. 거부 뒤 행 그대로(pending · 원래 본문)', after3?.status === 'pending' && after3?.text === '원래 본문 e', JSON.stringify({ st: after3?.status, t: after3?.text }));

  // 없는 id → not_found
  const nf = await A.c.rpc('suggestion_withdraw', { p_id: `sug_se_none_${s}` });
  check('+ 없는 id 취소 → not_found', isCode(nf, 'not_found'), errStr(nf));

  // ── 1. A 가 자기 대기 제안 취소 → 원래 테이블에서 사라지고 보관 테이블로 옮겨진다 ──
  const aW = await A.c.rpc('suggestion_withdraw', { p_id: ids.w });
  const rw = await rowOf(ids.w);
  const { data: arch, error: archErr } = await admin.from('playbook_suggestions_withdrawn').select('*').eq('id', ids.w).maybeSingle();
  check('1. A 가 자기 제안 취소 → 원래 테이블에 행 없음', !aW.error && rw == null, `${errStr(aW)} row=${rw ? rw.status : 'null'}`);
  check('1. 보관 테이블(service role)에 행 있음 · 원래 값 그대로 · withdrawn_by = A', !archErr && arch?.text === '원래 본문 w'
    && arch?.status === 'pending' && arch?.unit_id === UNIT && arch?.proposer_id === A.id && arch?.withdrawn_by === A.id && !!arch?.withdrawn_at,
    archErr?.message ?? JSON.stringify({ t: arch?.text, st: arch?.status, by: arch?.withdrawn_by === A.id }));
  for (const [who, c] of [['직원 A', A.c], ['직원 B', B.c], ['사장', owner]]) {
    const q = await c.from('playbook_suggestions_withdrawn').select('id').eq('unit_id', UNIT);
    check(`1. ${who} 세션으로 보관 테이블 select → 0행(권한 거부 42501 또는 RLS 0행)`, q.error ? q.error.code === '42501' : (q.data?.length ?? 0) === 0, q.error ? `err=${q.error.code}` : `rows=${q.data?.length}`);
  }
  const aW2 = await A.c.rpc('suggestion_withdraw', { p_id: ids.w });
  check('4. 이미 취소한 제안 다시 취소 → not_found', isCode(aW2, 'not_found'), errStr(aW2));
  const aEW = await A.c.rpc('suggestion_edit', { p_id: ids.w, p_patch: { text: '취소 뒤 수정' } });
  check('4. 취소한 제안 수정 → not_found', isCode(aEW, 'not_found'), errStr(aEW));

  // ── 2. A 가 수정 → 본문만 바뀜 · status 그대로 ──
  const aE = await A.c.rpc('suggestion_edit', { p_id: ids.e, p_patch: { text: '  고친 본문  ' } });
  const re = await rowOf(ids.e);
  check('2. A 가 수정 → 본문 바뀜(앞뒤 공백 정리) · pending 그대로', !aE.error && re?.text === '고친 본문' && re?.status === 'pending',
    `${errStr(aE)} ${JSON.stringify({ st: re?.status, t: re?.text })}`);

  // ── 6. patch 에 다른 열을 넣어도 안 바뀐다 ──
  const before6 = await rowOf(ids.e);
  const aE6 = await A.c.rpc('suggestion_edit', { p_id: ids.e, p_patch: {
    text: '열 끼워 넣기', unit_id: 'u_other', status: 'approved', proposer_id: B.id, kind: 'improve', reviewed_by: ownerId, resulting_entry_id: 'pb_x',
  } });
  const r6 = await rowOf(ids.e);
  check('6. patch 에 unit_id·status·proposer_id·kind 넣어도 본문만 바뀜', !aE6.error && r6?.text === '열 끼워 넣기'
    && r6?.unit_id === before6.unit_id && r6?.status === 'pending' && r6?.proposer_id === A.id && r6?.kind === 'new'
    && r6?.reviewed_by == null && r6?.resulting_entry_id == null,
    `${errStr(aE6)} ${JSON.stringify({ u: r6?.unit_id, st: r6?.status, p: r6?.proposer_id === A.id, k: r6?.kind })}`);
  const aE6b = await A.c.rpc('suggestion_edit', { p_id: ids.e, p_patch: { text: '   ' } });
  check('6. 빈 본문 → invalid_argument(not-null 제약 원문이 안 나감)', isCode(aE6b, 'invalid_argument'), errStr(aE6b));
  const aE6c = await A.c.rpc('suggestion_edit', { p_id: ids.e, p_patch: { status: 'withdrawn' } });
  check('6. 본문 없는 patch → invalid_argument', isCode(aE6c, 'invalid_argument'), errStr(aE6c));
  check('6. 거부 뒤 본문 그대로', (await rowOf(ids.e))?.text === '열 끼워 넣기');

  // + 기존 경로 그대로: 직원 직접 update 는 RLS(ps_update)가 막는다.
  const direct = await A.c.from('playbook_suggestions').update({ text: '직접' }).eq('id', ids.e).select('id');
  check('+ 직원 직접 update 는 여전히 0행(ps_update 무변경)', !direct.error && (direct.data?.length ?? 0) === 0, `rows=${direct.data?.length} ${direct.error?.message ?? ''}`);

  // ── 4. 사장 승인(옛 reviewSuggestion 모양) 뒤 A 취소·수정 → not_pending ──
  const ap = await owner.from('playbook_suggestions').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', ids.ap).select('id');
  check('셋업 4: 사장 승인(reviewSuggestion 모양) 1행', (ap.data?.length ?? 0) === 1, ap.error?.message ?? '');
  const aWap = await A.c.rpc('suggestion_withdraw', { p_id: ids.ap });
  check('4. 승인된 제안 취소 → not_pending', isCode(aWap, 'not_pending'), errStr(aWap));
  const aEap = await A.c.rpc('suggestion_edit', { p_id: ids.ap, p_patch: { text: '승인 뒤 수정' } });
  check('4. 승인된 제안 수정 → not_pending', isCode(aEap, 'not_pending'), errStr(aEap));
  const rap = await rowOf(ids.ap);
  check('4. 승인 행 그대로(approved · 원래 본문)', rap?.status === 'approved' && rap?.text === '원래 본문 ap');

  // ── 5. 사장 목록(fetchSuggestions 모양) ──
  const list = await owner.from('playbook_suggestions').select('*').order('created_at', { ascending: false }).limit(200);
  const mine = (list.data ?? []).filter((r) => r.unit_id === UNIT);
  console.log(`  · 사장 목록(select *): ${mine.map((r) => `${r.id.split('_')[2]}=${r.status}`).join(' ')}`);
  check('5. 사장 목록(fetchSuggestions 모양)에 취소한 제안 안 보임', !list.error && !mine.some((r) => r.id === ids.w), list.error?.message ?? '');
  check('5. 사장 목록 상태는 옛 앱 칩 표(pending·approved·rejected) 안에만 있다', mine.every((r) => ['pending', 'approved', 'rejected'].includes(r.status)));
  // 검토 대기 술어 = src/lib/utils/notifications.ts isPendingSuggestionToReview(status === 'pending' && 제안자 ≠ 나)
  const pendingToReview = mine.filter((r) => r.status === 'pending' && r.proposer_id !== ownerId).map((r) => r.id);
  check('5. 검토 대기(배지 파생 술어) = 수정한 제안 1개만', pendingToReview.length === 1 && pendingToReview[0] === ids.e, JSON.stringify(pendingToReview));
}

async function cleanup() {
  if (UNIT) {
    await admin.from('playbook_suggestions').delete().eq('unit_id', UNIT);
    const r = await admin.from('units').delete().eq('id', UNIT); if (r.error) console.error('  ! 정리 units:', r.error.message);
  }
  for (const id of made.users) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('  ! 정리 user:', r.error.message); }
  console.log(`  · 정리: 매장 ${UNIT ? 1 : 0} · 계정 ${made.users.length}`);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('  ✗ 예외:', e?.message ?? e);
} finally {
  await cleanup().catch((e) => console.error('  ! 정리 실패:', e?.message ?? e));
  await cleanupSeededPhones(URL_, SRV, qaPhones).catch(() => {});
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} / fail ${fail} · LLM 호출 0회`);
process.exitCode = fail === 0 ? 0 : 1;
