#!/usr/bin/env node
// qa-push.mjs — 웹푸시 발송 엣지함수(push) 회귀 매트릭스 (실 배포 백엔드 대상·자가정리)
//
// 왜 있나: 푸시 발송은 "누구에게 보내지느냐"가 곧 테넌트 격리다. 한 줄만 느슨하면 남의 매장
//   사장/직원에게 알림이 새거나(크로스테넌트 유출), 발송자 본인에게 메아리가 울린다. 발송 자체는
//   실 브라우저 구독(FCM/Mozilla 엔드포인트)이 있어야 end-to-end로 확인되지만, **수신자 해석·
//   테넌트 격리·인증·자기제외**는 엣지함수의 recipients 카운트로 결정적으로 검증할 수 있다
//   (recipients = 구독 유무와 무관한 "대상 사용자 수"라, 가짜 구독 없이도 계약을 증명한다).
//
// 커버:
//   인증:   유저 JWT 없으면 401
//   검증:   title/audience 누락 → 400
//   해석:   owners/staff/user 대상이 "호출자 매장"으로 정확히 좁혀짐
//   격리:   audience=user 로 남의 매장 유저 지정 → 403 cross_tenant (★보안 핵심)
//   자기제외: 발송자 본인은 recipients 에서 빠짐
//   합류:   join_owners 는 신청자의 pending_unit_id 사장에게 (아직 소속 아님)
//   방어:   unit 없는 유저 → 403 no_unit
//
// 자가정리: 만든 모든 테스트 계정은 끝에 delete_my_account 로 삭제.
// 실행: node scripts/qa-push.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* no .env */ }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('FAIL: EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 필요'); process.exit(2); }
const PUSH_URL = `${URL}/functions/v1/push`;

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? (pass++, console.log('  PASS', name, extra)) : (fail++, console.log('  FAIL', name, extra)); };

async function signUpSession(client, email, meta) {
  const { data, error } = await client.auth.signUp({ email, password: pw, options: { data: { birth_date: '1990-01-15', ...meta } } });
  if (error || !data.session) throw new Error(`signUp failed (${email}): ${error?.message ?? 'no session'}`);
  await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return data.user.id;
}

// 배포된 push 함수를 호출자(client)의 유저 JWT로 때린다.
async function invokePush(client, body) {
  const { data: sess } = await client.auth.getSession();
  const token = sess.session?.access_token ?? ANON;
  return invokePushRaw(token, body);
}
async function invokePushRaw(bearer, body) {
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const cleanup = [];
try {
  // ── 셋업: 매장 A(사장 + 직원2) · 매장 B(사장 + 직원1) · 신청대기자 · unit없는 유저 ──
  const ph = (tag) => `010${tag}${s.slice(0, 6)}`;

  // 매장 A 사장
  const ownerA = mk();
  const ownerAId = await signUpSession(ownerA, `qa_push_oa_${s}@example.com`, { name: 'PushOwnerA', role: 'owner', phone: ph('41'), store_name: 'PushA', industry: '카페·디저트' });
  cleanup.push(ownerA);
  const { data: csA, error: csAErr } = await ownerA.rpc('create_store', { p_store_name: 'PushA', p_industry: '카페·디저트', p_biz_no: null });
  if (csAErr) throw new Error(`create_store A: ${csAErr.message}`);
  const rowA = Array.isArray(csA) ? csA[0] : csA;
  const codeA = rowA.invite_code, unitA = rowA.unit_id;

  // 매장 A 직원 2명(가입 → 신청 → 사장 승인 → 소속 확정)
  const staffA1 = mk();
  const staffA1Id = await signUpSession(staffA1, `qa_push_sa1_${s}@example.com`, { name: 'PushStaffA1', role: 'junior', phone: ph('42') });
  cleanup.push(staffA1);
  await staffA1.rpc('join_by_invite', { p_code: codeA });
  await ownerA.rpc('approve_member', { p_uid: staffA1Id });

  const staffA2 = mk();
  const staffA2Id = await signUpSession(staffA2, `qa_push_sa2_${s}@example.com`, { name: 'PushStaffA2', role: 'junior', phone: ph('43') });
  cleanup.push(staffA2);
  await staffA2.rpc('join_by_invite', { p_code: codeA });
  await ownerA.rpc('approve_member', { p_uid: staffA2Id });

  // 매장 B 사장 + 직원1(크로스테넌트 표적)
  const ownerB = mk();
  const ownerBId = await signUpSession(ownerB, `qa_push_ob_${s}@example.com`, { name: 'PushOwnerB', role: 'owner', phone: ph('44'), store_name: 'PushB', industry: '카페·디저트' });
  cleanup.push(ownerB);
  const { data: csB, error: csBErr } = await ownerB.rpc('create_store', { p_store_name: 'PushB', p_industry: '카페·디저트', p_biz_no: null });
  if (csBErr) throw new Error(`create_store B: ${csBErr.message}`);
  const rowB = Array.isArray(csB) ? csB[0] : csB;
  const codeB = rowB.invite_code;
  const staffB1 = mk();
  const staffB1Id = await signUpSession(staffB1, `qa_push_sb1_${s}@example.com`, { name: 'PushStaffB1', role: 'junior', phone: ph('45') });
  cleanup.push(staffB1);
  await staffB1.rpc('join_by_invite', { p_code: codeB });
  await ownerB.rpc('approve_member', { p_uid: staffB1Id });

  // 매장 A 신청 대기자(승인 전 — pending_unit_id=A, unit_id=null)
  const pendingA = mk();
  await signUpSession(pendingA, `qa_push_pa_${s}@example.com`, { name: 'PushPending', role: 'junior', phone: ph('46') });
  cleanup.push(pendingA);
  await pendingA.rpc('join_by_invite', { p_code: codeA });

  // unit 없는 유저(가입만)
  const nobody = mk();
  await signUpSession(nobody, `qa_push_nb_${s}@example.com`, { name: 'PushNobody', role: 'junior', phone: ph('47') });
  cleanup.push(nobody);

  console.log(`\n[셋업 완료] unitA=${unitA} ownerA=${ownerAId.slice(0,8)} staffA1=${staffA1Id.slice(0,8)} staffA2=${staffA2Id.slice(0,8)} ownerB=${ownerBId.slice(0,8)} staffB1=${staffB1Id.slice(0,8)}\n`);

  // ── T1 인증: 유저 JWT 없이(anon 토큰만) → 401 ──────────────────────────────
  const t1 = await invokePushRaw(ANON, { audience: 'owners', title: 't' });
  check('T1 인증: anon-only 호출 거부(401)', t1.status === 401, `status=${t1.status}`);

  // ── T2 검증: title/audience 누락 → 400 ────────────────────────────────────
  const t2a = await invokePush(ownerA, { audience: 'owners' });
  check('T2a 검증: title 누락 → 400', t2a.status === 400, `status=${t2a.status} ${JSON.stringify(t2a.json)}`);
  const t2b = await invokePush(ownerA, { title: 'x' });
  check('T2b 검증: audience 누락 → 400', t2b.status === 400, `status=${t2b.status}`);

  // ── T3 owners 해석: 직원A1 → 매장A 사장 1명 ───────────────────────────────
  const t3 = await invokePush(staffA1, { audience: 'owners', title: '합류', body: 'b' });
  check('T3 owners 해석: staffA1→ownerA 1명', t3.status === 200 && t3.json?.recipients === 1, `status=${t3.status} ${JSON.stringify(t3.json)}`);

  // ── T4 staff 해석 + 자기제외 ──────────────────────────────────────────────
  //  직원A1 → staff: 자기 빼고 staffA2 1명.  사장A → staff: staffA1+staffA2 = 2명.
  const t4a = await invokePush(staffA1, { audience: 'staff', title: '공지' });
  check('T4a staff 자기제외: staffA1→ staffA2 1명(본인 제외)', t4a.status === 200 && t4a.json?.recipients === 1, `${JSON.stringify(t4a.json)}`);
  const t4b = await invokePush(ownerA, { audience: 'staff', title: '공지' });
  check('T4b staff 전체: ownerA→ staffA1+staffA2 2명', t4b.status === 200 && t4b.json?.recipients === 2, `${JSON.stringify(t4b.json)}`);

  // ── T5 owners 자기제외: 사장A → owners: 매장A 사장은 본인뿐 → 0명 ──────────
  const t5 = await invokePush(ownerA, { audience: 'owners', title: 'x' });
  check('T5 owners 자기제외: ownerA→ 0명(본인뿐)', t5.status === 200 && t5.json?.recipients === 0, `${JSON.stringify(t5.json)}`);

  // ── T6 user 같은 매장: 사장A → user=staffA1 → 1명 ─────────────────────────
  const t6 = await invokePush(ownerA, { audience: 'user', userId: staffA1Id, title: '교대 확정' });
  check('T6 user 같은 매장: ownerA→staffA1 1명', t6.status === 200 && t6.json?.recipients === 1, `${JSON.stringify(t6.json)}`);

  // ── T7 ★크로스테넌트 격리: 사장A → user=ownerB → 403 cross_tenant ─────────
  const t7 = await invokePush(ownerA, { audience: 'user', userId: ownerBId, title: '침투' });
  check('T7 ★격리: ownerA→user=ownerB 거부(403 cross_tenant)', t7.status === 403 && t7.json?.error === 'cross_tenant', `status=${t7.status} ${JSON.stringify(t7.json)}`);
  const t7b = await invokePush(ownerA, { audience: 'user', userId: staffB1Id, title: '침투2' });
  check('T7b ★격리: ownerA→user=staffB1 거부(403 cross_tenant)', t7b.status === 403 && t7b.json?.error === 'cross_tenant', `status=${t7b.status} ${JSON.stringify(t7b.json)}`);

  // ── T8 join_owners: 신청 대기자 → 매장A 사장 1명(아직 소속 아님) ──────────
  const t8 = await invokePush(pendingA, { audience: 'join_owners', title: '합류 신청' });
  check('T8 join_owners: pending→ownerA 1명', t8.status === 200 && t8.json?.recipients === 1, `${JSON.stringify(t8.json)}`);

  // ── T9 방어: unit 없는 유저 → 403 no_unit ─────────────────────────────────
  const t9 = await invokePush(nobody, { audience: 'owners', title: 'x' });
  check('T9 방어: unit 없는 유저 owners → 403 no_unit', t9.status === 403 && t9.json?.error === 'no_unit', `status=${t9.status} ${JSON.stringify(t9.json)}`);

  // ── T10 방어: unit 없는 유저가 join_owners 인데 pending도 없음 → 403 no_unit ─
  const t10 = await invokePush(nobody, { audience: 'join_owners', title: 'x' });
  check('T10 방어: pending 없는 유저 join_owners → 403 no_unit', t10.status === 403 && t10.json?.error === 'no_unit', `status=${t10.status} ${JSON.stringify(t10.json)}`);

  // ── T11 ★push_subscriptions 크로스유저 endpoint 재사용(RLS): 재로그인 소유권 이전 ──
  //  같은 브라우저 endpoint 를 다른 계정(staffA2)이 재구독하면, 옛 클라 upsert 경로는 '남의 행 UPDATE'
  //  로 빠져 RLS(USING) 위반이 났다(라이브 사고: "violates RLS policy (USING expression)").
  //  save_push_subscription(0049) 이 endpoint 소유권을 현재 로그인 사용자로 이전(reassign)해 근본 차단.
  //  이 케이스가 회귀하면 '같은 기기에서 재로그인한 유저'의 알림 구독이 조용히 죽는다.
  const pep = `https://qa-push.example/sub/${s}`;
  const sub1 = await staffA1.rpc('save_push_subscription', { p_endpoint: pep, p_p256dh: 'p1', p_auth: 'a1', p_unit_id: unitA, p_ua: 'qa1' });
  check('T11a save_push_subscription: 최초 등록 성공', !sub1.error, sub1.error?.message ?? '');
  // 다른 유저가 같은 endpoint 로 저장 → RLS 위반 없이 성공(소유권 이전)해야 한다. 옛 upsert면 여기서 FAIL.
  const sub2 = await staffA2.rpc('save_push_subscription', { p_endpoint: pep, p_p256dh: 'p2', p_auth: 'a2', p_unit_id: unitA, p_ua: 'qa2' });
  check('T11b ★크로스유저 재구독: RLS 위반 없이 성공(소유권 이전)', !sub2.error, sub2.error?.message ?? '');
  const { data: owned } = await staffA2.from('push_subscriptions').select('user_id').eq('endpoint', pep).maybeSingle();
  check('T11c 소유권이 재구독 유저(staffA2)로 이전됨', owned?.user_id === staffA2Id, `owner=${owned?.user_id?.slice(0, 8)}`);
  const { data: notOwned } = await staffA1.from('push_subscriptions').select('user_id').eq('endpoint', pep).maybeSingle();
  check('T11d 이전 유저(staffA1)는 그 구독을 더 못 봄(RLS 격리)', !notOwned, `seen=${notOwned?.user_id ?? 'none'}`);
  await staffA2.from('push_subscriptions').delete().eq('endpoint', pep); // 정리(소프트삭제는 이 행을 안 지움)

} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
