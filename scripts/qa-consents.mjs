#!/usr/bin/env node
// qa-consents.mjs — 가입 동의 저장 · 만 14세 미만 차단 · 0240 (로컬 도커 전용)
//
// 무엇을 못박나:
//   [1] J12 동의 저장 — 이메일 가입이 메타데이터에 consents·consent_version 을 실어도 서버에 0행이었다.
//       별도 AFTER INSERT 트리거가 user_consents 에 남긴다. 잘못된 값이 와도 가입은 절대 실패하지 않는다.
//       동의가 없는 가입(옛 앱)도 그대로 성공한다(서버 게이트 없음).
//   [2] record_my_consents — 구글 가입 프로필 완성용. 허용 목록·버전 형식·채널을 검사하고 중복은 넣지 않는다.
//   [3] 표 권한 — 본인 행만 읽는다. 앱 역할은 쓰지 못한다(기록은 트리거와 RPC 로만).
//   [4] 만 14세 미만(KST) — ensure_birth_date 를 지나는 create_store·join_by_invite·complete_profile 이 under_14 로 막는다.
//       경계: 오늘이 만 14세 생일이면 통과, 하루 모자라면 차단.
//
// ★로컬 전용: 실행할 때마다 계정을 가입시킨다. 라이브에서 돌리면 고정 계정 규칙 위반이라 URL 이 로컬이 아니면 멈춘다.
// 실행: node scripts/qa-consents.mjs   자가정리(계정·매장·OTP 시드).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
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
    } catch { /* skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SRV) { console.error('FAIL: URL/ANON/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) {
  console.error(`중단: 로컬 도커 전용 하니스다(계정을 가입시킨다). 대상=${URL_}`);
  process.exit(2);
}
console.log(`대상 DB = 로컬 ${URL_}`);

const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const s = String(Date.now()).slice(-9);
const pw = 'Test1234!qa';
const VER = '2026-09-29';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

// KST 오늘 기준 만 14세 경계 생일
const kstToday = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const [ty, tm, td] = kstToday.split('-').map(Number);
const iso = (d) => d.toISOString().slice(0, 10);
const exact14 = iso(new Date(Date.UTC(ty - 14, tm - 1, td)));       // 오늘 만 14세가 됨
const dayShort = iso(new Date(Date.UTC(ty - 14, tm - 1, td + 1)));  // 내일 만 14세가 됨

const phones = ['0191', '0192', '0193', '0194', '0195', '0196', '0197', '0198', '0199', '0190'].map((p) => `${p}${s.slice(0, 7)}`);
const users = [];
const units = [];
const up = async (i, data) => {
  const c = mk();
  const r = await c.auth.signUp({ email: `qa_cns_${i}_${s}@example.com`, password: pw, options: { data } });
  users.push({ c, id: r.data?.user?.id });
  return { c, id: r.data?.user?.id, error: r.error };
};
const consentsOf = async (uid) => {
  const r = await admin.from('user_consents').select('item, version, channel').eq('user_id', uid);
  return { rows: r.data ?? [], error: r.error };
};
const createStore = async (c, name, birth) => {
  const r = await c.rpc('create_store', { p_store_name: name, p_industry: '카페·디저트', p_biz_no: null, ...(birth ? { p_birth_date: birth } : {}) });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (row?.unit_id) units.push(row.unit_id);
  return { error: r.error, row };
};

try {
  await seedVerifiedPhones(URL_, SRV, phones);

  // ═══════ 1. 이메일 가입 메타데이터 → user_consents ═══════
  console.log('\n[1] 이메일 가입 동의가 user_consents 에 남는다');
  const A = await up(0, { name: 'QA동의사장', role: 'owner', phone: phones[0], birth_date: '1985-01-01',
    consents: ['age14', 'terms', 'privacy_collect', 'marketing'], consent_version: VER });
  check('1-1 동의를 실은 가입이 성공한다', !A.error && !!A.id, A.error?.message ?? '');
  {
    const { rows, error } = await consentsOf(A.id);
    const items = rows.map((r) => r.item).sort().join(',');
    check('1-2 ★필수 동의 3행이 email_signup 으로 남는다', !error && items === 'age14,privacy_collect,terms'
      && rows.every((r) => r.channel === 'email_signup' && r.version === VER), error?.message ?? `rows=${JSON.stringify(rows)}`);
    check('1-3 허용 목록 밖(marketing)은 남기지 않는다', !rows.some((r) => r.item === 'marketing'), `rows=${JSON.stringify(rows)}`);
  }
  const B = await up(1, { name: 'QA동의직원', role: 'junior', phone: phones[1], birth_date: '2000-01-01',
    consents: ['age14', 'terms', 'privacy_collect', 'labor'], consent_version: VER });
  {
    const { rows, error } = await consentsOf(B.id);
    check('1-4 직원 가입은 labor 를 포함해 4행', !error && rows.length === 4 && rows.some((r) => r.item === 'labor'),
      error?.message ?? `rows=${JSON.stringify(rows)}`);
  }
  const C = await up(2, { name: 'QA옛앱', role: 'owner', phone: phones[2], birth_date: '1990-01-01' });
  {
    const { rows, error } = await consentsOf(C.id);
    check('1-5 동의 없이 가입(옛 앱)도 성공하고 0행', !C.error && !!C.id && !error && rows.length === 0,
      C.error?.message ?? error?.message ?? `rows=${rows.length}`);
  }
  const D = await up(3, { name: 'QA오염', role: 'owner', phone: phones[3], birth_date: '1990-01-01',
    consents: 'age14,terms', consent_version: 'not-a-date;drop table' });
  {
    const { rows, error } = await consentsOf(D.id);
    check('1-6 consents 가 배열이 아니고 버전이 엉망이어도 가입은 성공하고 0행', !D.error && !!D.id && !error && rows.length === 0,
      D.error?.message ?? error?.message ?? `rows=${rows.length}`);
  }
  const E = await up(4, { name: 'QA버전', role: 'owner', phone: phones[4], birth_date: '1990-01-01',
    consents: ['age14', 'terms'], consent_version: 'x'.repeat(40) });
  {
    const { rows, error } = await consentsOf(E.id);
    check('1-7 버전 형식이 틀리면 가입은 성공하고 0행', !E.error && !!E.id && !error && rows.length === 0,
      E.error?.message ?? error?.message ?? `rows=${rows.length}`);
  }

  // ═══════ 2. 표 권한 ═══════
  console.log('\n[2] user_consents 권한 = 본인 select 만');
  {
    const own = await A.c.from('user_consents').select('item');
    check('2-1 본인은 자기 동의 3행을 읽는다', !own.error && (own.data ?? []).length === 3, own.error?.message ?? `rows=${(own.data ?? []).length}`);
    const other = await B.c.from('user_consents').select('item').eq('user_id', A.id);
    check('2-2 남의 동의는 0행', !other.error && (other.data ?? []).length === 0, other.error?.message ?? `rows=${(other.data ?? []).length}`);
    const ins = await A.c.from('user_consents').insert({ user_id: A.id, item: 'labor', version: VER, channel: 'reconsent' });
    check('2-3 앱 역할은 직접 INSERT 못 한다(42501)', ins.error?.code === '42501', `code=${ins.error?.code ?? '-'} ${ins.error?.message ?? ''}`);
    const del = await A.c.from('user_consents').delete().eq('user_id', A.id).select('id');
    const left = (await consentsOf(A.id)).rows.length;
    check('2-4 앱 역할은 직접 DELETE 못 한다', !!del.error && left === 3, `err=${del.error?.code ?? '-'} left=${left}`);
    const upd = await A.c.from('user_consents').update({ version: '2000-01-01' }).eq('user_id', A.id).select('id');
    check('2-5 앱 역할은 직접 UPDATE 못 한다', !!upd.error, `err=${upd.error?.code ?? '-'} rows=${(upd.data ?? []).length}`);
    const an = await mk().from('user_consents').select('item');
    check('2-6 anon 은 읽지 못한다', !!an.error || (an.data ?? []).length === 0, `rows=${(an.data ?? []).length}`);
  }

  // ═══════ 3. record_my_consents (구글 가입) ═══════
  console.log('\n[3] record_my_consents');
  {
    const r1 = await C.c.rpc('record_my_consents', { p_items: ['age14', 'terms', 'privacy_collect'], p_version: VER, p_channel: 'google_signup' });
    const after1 = (await consentsOf(C.id)).rows;
    check('3-1 ★구글 가입 동의 3행이 google_signup 으로 남는다', !r1.error && r1.data === 3 && after1.length === 3
      && after1.every((x) => x.channel === 'google_signup'), r1.error?.message ?? `rpc=${r1.data} rows=${after1.length}`);
    const r2 = await C.c.rpc('record_my_consents', { p_items: ['age14', 'terms', 'terms'], p_version: VER, p_channel: 'reconsent' });
    const after2 = (await consentsOf(C.id)).rows.length;
    check('3-2 같은 항목·버전은 다시 넣지 않는다', !r2.error && r2.data === 0 && after2 === 3, r2.error?.message ?? `rpc=${r2.data} rows=${after2}`);
    const bi = await C.c.rpc('record_my_consents', { p_items: ['age14', 'marketing'], p_version: VER, p_channel: 'google_signup' });
    check('3-3 허용 목록 밖 항목은 거부(consent_item_invalid)', /consent_item_invalid/.test(bi.error?.message ?? ''), bi.error?.message ?? `rpc=${bi.data}`);
    const bv = await C.c.rpc('record_my_consents', { p_items: ['labor'], p_version: '최신', p_channel: 'google_signup' });
    check('3-4 버전 형식이 틀리면 거부(consent_version_invalid)', /consent_version_invalid/.test(bv.error?.message ?? ''), bv.error?.message ?? `rpc=${bv.data}`);
    const bc = await C.c.rpc('record_my_consents', { p_items: ['labor'], p_version: VER, p_channel: 'email_signup' });
    check('3-5 email_signup 채널은 RPC 로 못 쓴다(consent_channel_invalid)', /consent_channel_invalid/.test(bc.error?.message ?? ''), bc.error?.message ?? `rpc=${bc.data}`);
    const be = await C.c.rpc('record_my_consents', { p_items: [], p_version: VER, p_channel: 'google_signup' });
    check('3-6 빈 목록은 거부(consent_item_invalid)', /consent_item_invalid/.test(be.error?.message ?? ''), be.error?.message ?? `rpc=${be.data}`);
    const left = (await consentsOf(C.id)).rows.length;
    check('3-7 거부된 호출은 아무것도 남기지 않는다', left === 3, `rows=${left}`);
    const an = await mk().rpc('record_my_consents', { p_items: ['terms'], p_version: VER, p_channel: 'google_signup' });
    check('3-8 anon 은 실행 권한이 없다(42501)', an.error?.code === '42501', `code=${an.error?.code ?? '-'} ${an.error?.message ?? ''}`);
  }

  // ═══════ 4. 만 14세 미만 차단 ═══════
  console.log(`\n[4] 만 14세 미만(KST) — 오늘 ${kstToday} · 경계 통과 ${exact14} · 경계 차단 ${dayShort}`);
  {
    const K = await up(5, { name: 'QA어린사장', role: 'owner', phone: phones[5], birth_date: '2013-12-01' });
    const r = await createStore(K.c, 'QA어린카페');
    check('4-1 ★생일 2013-12-01(메타) 사장은 create_store 가 under_14', /under_14/.test(r.error?.message ?? ''), r.error?.message ?? `unit=${r.row?.unit_id}`);

    const L = await up(6, { name: 'QA경계사장', role: 'owner', phone: phones[6], birth_date: exact14 });
    const r2 = await createStore(L.c, 'QA경계카페');
    check('4-2 오늘 만 14세가 된 사장은 create_store 통과', !r2.error && !!r2.row?.unit_id, r2.error?.message ?? '');

    const M = await up(7, { name: 'QA하루모자람', role: 'owner', phone: phones[7], birth_date: dayShort });
    const r3 = await createStore(M.c, 'QA하루카페');
    check('4-3 하루 모자란 사장은 create_store 가 under_14', /under_14/.test(r3.error?.message ?? ''), r3.error?.message ?? `unit=${r3.row?.unit_id}`);

    // 생일 없이 만든 계정(구글 가입 모양)이 p_birth_date 로 어린 생일을 넣는 경로
    const N = await up(8, { name: 'QA구글어린', role: 'owner' });
    const r4 = await createStore(N.c, 'QA구글카페', '2015-05-05');
    check('4-4 create_store(p_birth_date=2015-05-05) 도 under_14', /under_14/.test(r4.error?.message ?? ''), r4.error?.message ?? `unit=${r4.row?.unit_id}`);
    const bd4 = (await admin.from('profiles').select('birth_date').eq('id', N.id).single()).data?.birth_date ?? null;
    check('4-5 막힌 호출은 생일을 저장하지 않는다(롤백)', bd4 === null, `birth_date=${bd4}`);
    const cp = await N.c.rpc('complete_profile', { p_name: 'QA구글어린', p_phone: null, p_birth_date: '2015-05-05' });
    check('4-6 complete_profile 도 under_14', /under_14/.test(cp.error?.message ?? ''), cp.error?.message ?? 'ok');

    // 직원 합류: 성인 사장 L 의 매장에 어린 직원이 합류하려 한다
    const code = r2.row?.invite_code;
    const J = await up(9, { name: 'QA어린직원', role: 'junior', phone: phones[9], birth_date: '2013-12-01' });
    const j = await J.c.rpc('join_by_invite', { p_code: code });
    check('4-7 ★생일 2013-12-01 직원은 join_by_invite 가 under_14', !!code && /under_14/.test(j.error?.message ?? ''), j.error?.message ?? `code=${code} data=${JSON.stringify(j.data)}`);

    const ad = await createStore(A.c, 'QA성인카페');
    check('4-8 성인 사장(1985)은 그대로 통과', !ad.error && !!ad.row?.unit_id, ad.error?.message ?? '');
  }
} catch (e) {
  fail++; console.log('  FAIL 예외:', e.message);
} finally {
  for (const u of users) { try { await u.c.rpc('delete_my_account'); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.auth.admin.deleteUser(u.id); } catch { /* best-effort */ } }
  for (const id of units) { try { await admin.from('units').delete().eq('id', id); } catch { /* best-effort */ } }
  for (const u of users) { try { if (u.id) await admin.from('user_consents').delete().eq('user_id', u.id); } catch { /* best-effort */ } }
  try { await cleanupSeededPhones(URL_, SRV, phones); } catch { /* best-effort */ }
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
