#!/usr/bin/env node
// qa-notify-prefs.mjs — 알림 수신 선호(푸시 on/off·방해금지)가 실제 발송을 게이팅하는지 회귀 검증
//                       (실 배포 백엔드 대상·자가정리)
//
// 왜 있나: 예전엔 설정의 "푸시 알림"·"방해 금지 시간" 토글이 localStorage 에만 저장돼 서버가 못 읽었고,
//   → 토글을 꺼도 푸시가 가고 방해금지 시간에도 핸드폰 알림이 울렸다(완전 무력). 0050(notification_prefs
//   SSOT + save_notification_prefs RPC) + push 엣지함수의 수신자별 억제로 근본 수정했다.
//   이 하네스는 그 계약을 결정적으로 증명한다: push 엣지함수 응답의 recipients = "억제 후 실제 발송 대상 수".
//   구독 유무와 무관하게 recipients 로 억제를 검증할 수 있다(가짜 구독 불필요).
//
// ⚠️ 이 테스트가 PASS 하려면 (1) 0050 마이그레이션 적용(테이블+RPC) (2) push 엣지함수 재배포 가 모두 필요.
//   둘 중 하나라도 안 됐으면 FAIL 이 나며, 그게 곧 "아직 라이브에 반영 안 됨"의 증거다(전→후 증명).
//
// 커버:
//   기본:     선호 미설정 수신자는 기본=켜짐(발송 대상 유지)
//   ★push off: 수신자가 push_enabled=false → 그 수신자만 recipients 에서 빠짐
//   push on:  다시 켜면 복귀
//   ★quiet 이관(0076): 방해금지 판정은 매장별 unit_member_prefs 로 이동 — 전역 quiet 를 지금 포함
//             구간으로 켜도 push 는 더 이상 억제하지 않는다(매장별 억제는 qa-push T12~T14가 검증)
//   격리:     남의 notification_prefs 는 RLS 로 못 봄 / 시간 형식 이상은 RPC 가 거부
//
// 자가정리: 만든 계정은 끝에 delete_my_account 로 삭제.
// 실행: node scripts/qa-notify-prefs.mjs   (npm run qa:notify)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  // .env.seed 는 phone_otps 인증 시드용 service_role 키 확보 목적(없으면 시드 스킵 — 게이트 미적용 환경).
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 파일 없음 */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY; // 있으면 phone_otps 시드(게이트 0088 대비)
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
async function invokePush(client, body) {
  const { data: sess } = await client.auth.getSession();
  const token = sess.session?.access_token ?? ANON;
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}
async function savePrefs(client, { push = true, quiet = false, start = '22:00', end = '08:00' }) {
  return client.rpc('save_notification_prefs', {
    p_push_enabled: push, p_quiet_enabled: quiet, p_quiet_start: start, p_quiet_end: end,
  });
}

// KST 현재 시각(엣지와 동일 방식) + 분 단위 helper — '지금을 포함/제외하는' 방해금지 구간을 동적으로 만든다.
function kstNowMin() {
  const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 5);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
const hhmm = (min) => { const x = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// 0088 게이트 라이브 — 아래 signUp 이 쓰는 번호(ph 51~53) 전부를 '인증됨'으로 선등록.
const qaPhones = ['51', '52', '53'].map((tag) => `010${tag}${s.slice(0, 6)}`);
const seededRes = await seedVerifiedPhones(URL, SERVICE, qaPhones);
if (seededRes.skipped) console.log(`  (phone_otps 시드 스킵: ${seededRes.skipped})`);

const cleanup = [];
try {
  const ph = (tag) => `010${tag}${s.slice(0, 6)}`;

  // ── 셋업: 매장 A 사장 + 직원2(가입→신청→승인) ─────────────────────────────
  const ownerA = mk();
  await signUpSession(ownerA, `qa_np_oa_${s}@example.com`, { name: 'NPOwnerA', role: 'owner', phone: ph('51'), store_name: 'NPA', industry: '카페·디저트' });
  cleanup.push(ownerA);
  const { data: csA, error: csAErr } = await ownerA.rpc('create_store', { p_store_name: 'NPA', p_industry: '카페·디저트', p_biz_no: null });
  if (csAErr) throw new Error(`create_store A: ${csAErr.message}`);
  const codeA = (Array.isArray(csA) ? csA[0] : csA).invite_code;

  const staffA1 = mk();
  const staffA1Id = await signUpSession(staffA1, `qa_np_sa1_${s}@example.com`, { name: 'NPStaffA1', role: 'junior', phone: ph('52') });
  cleanup.push(staffA1);
  await staffA1.rpc('join_by_invite', { p_code: codeA });
  await ownerA.rpc('approve_member', { p_uid: staffA1Id });

  const staffA2 = mk();
  const staffA2Id = await signUpSession(staffA2, `qa_np_sa2_${s}@example.com`, { name: 'NPStaffA2', role: 'junior', phone: ph('53') });
  cleanup.push(staffA2);
  await staffA2.rpc('join_by_invite', { p_code: codeA });
  await ownerA.rpc('approve_member', { p_uid: staffA2Id });

  console.log(`\n[셋업 완료] staffA1=${staffA1Id.slice(0, 8)} staffA2=${staffA2Id.slice(0, 8)} (KST now=${hhmm(kstNowMin())})\n`);

  // 선행 확인: RPC 존재(0050 적용 여부). 없으면 전체가 "미적용" 이므로 명확히 알린다.
  const probe = await savePrefs(staffA1, { push: true });
  check('T0 save_notification_prefs RPC 존재(0050 적용)', !probe.error, probe.error?.message ?? '');
  if (probe.error) throw new Error('0050 미적용 — 마이그레이션/엣지 배포 후 재실행');

  // ── T1 기본: 선호 미설정(staffA2) 포함, 둘 다 켜짐 → ownerA→staff recipients=2 ──
  const t1 = await invokePush(ownerA, { audience: 'staff', title: '공지' });
  check('T1 기본(둘 다 켜짐): ownerA→staff recipients=2', t1.status === 200 && t1.json?.recipients === 2, JSON.stringify(t1.json));

  // ── T2 ★push off: staffA1 알림 끔 → recipients=1(staffA2만) ──────────────────
  const off = await savePrefs(staffA1, { push: false });
  check('T2a save push_enabled=false 성공', !off.error, off.error?.message ?? '');
  const t2 = await invokePush(ownerA, { audience: 'staff', title: '공지' });
  check('T2b ★push off: staffA1 억제 → recipients=1', t2.status === 200 && t2.json?.recipients === 1, JSON.stringify(t2.json));

  // ── T3 push 다시 켬 → recipients=2 복귀 ──────────────────────────────────────
  await savePrefs(staffA1, { push: true });
  const t3 = await invokePush(ownerA, { audience: 'staff', title: '공지' });
  check('T3 push 재개: recipients=2 복귀', t3.status === 200 && t3.json?.recipients === 2, JSON.stringify(t3.json));

  // ── T4 ★quiet 이관(0076): 전역 방해금지를 지금 포함 구간으로 켜도 push 는 억제하지 않는다 ──
  //  방해금지 판정은 매장별 unit_member_prefs 가 새 SSOT. 이 케이스가 FAIL(recipients=1)이면
  //  push 엣지가 아직 전역 quiet 를 읽는 구버전 = 이관 미배포의 증거다(전→후 증명).
  const now = kstNowMin();
  const inStart = hhmm(now - 30), inEnd = hhmm(now + 30); // 지금을 감싸는 60분 창
  const q1 = await savePrefs(staffA1, { push: true, quiet: true, start: inStart, end: inEnd });
  check('T4a save 전역 quiet(지금 포함 구간) 성공', !q1.error, q1.error?.message ?? '');
  const t4 = await invokePush(ownerA, { audience: 'staff', title: '공지' });
  check(`T4b ★전역 quiet 지금 포함(${inStart}~${inEnd})이어도 발송 유지 → recipients=2(매장별로 이관됨)`, t4.status === 200 && t4.json?.recipients === 2, JSON.stringify(t4.json));

  // ── T6 격리: 남의 notification_prefs 는 RLS 로 못 본다 ────────────────────────
  const { data: mine } = await staffA1.from('notification_prefs').select('user_id, push_enabled').maybeSingle();
  check('T6a 본인 선호는 읽힘(SSOT readback)', mine?.user_id === staffA1Id, `user=${mine?.user_id?.slice(0, 8)}`);
  const { data: notMine } = await staffA2.from('notification_prefs').select('user_id').eq('user_id', staffA1Id).maybeSingle();
  check('T6b ★남의 선호는 RLS 로 못 봄', !notMine, `seen=${notMine?.user_id ?? 'none'}`);

  // ── T7 검증: 잘못된 시간 형식은 RPC 가 거부(저장 데이터 형식 무결성 — RPC 계약 유지) ──
  const bad = await savePrefs(staffA1, { push: true, quiet: true, start: '9:00', end: '08:00' });
  check('T7 시간 형식 이상(9:00) → RPC 거부', !!bad.error, bad.error?.message ?? 'no error(FAIL)');

} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  for (const c of cleanup) {
    try { await c.rpc('delete_my_account'); } catch { /* best-effort */ }
  }
  await cleanupSeededPhones(URL, SERVICE, qaPhones);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
