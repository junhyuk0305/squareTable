#!/usr/bin/env node
// qa-session-bootstrap.mjs — 0354 session_bootstrap() == 개별 RPC 합성 (2026-11-05 · M3 세션 로딩 · 계획 §4 ②)
//
// 무엇을 증명하나: 클라 loadProfile 이 따로 부르던 11개 읽기(profiles · session_unit · units · unit_subscriptions ·
//   billing_free_mode · iap_enabled · needs_downgrade_choice · my_units · my_seat_locked · my_unit_locked · my_brand)와
//   session_bootstrap() 한 번의 결과가 **같은 실세션에서 키마다 deepEqual** 이다. 다르면 새 클라의 라우팅이 옛 클라와 갈라진다.
//   축: A 사장(매장 2개·활성 S1) · B 활성 직원(S1 · 좌석 지킴) · 닫힌 매장 직원(S2 · my_unit_locked) · 좌석 잠긴 직원(S1 · my_seat_locked)
//       · 브랜드 담당자(my_brand) · 탈퇴 계정({deleted:true}) · profiles 행 없음(profile=null) · anon 거부 · search_path·volatile·grant.
//   축이 실제로 그 상태인지(잠김 true · 브랜드 non-null · 매장 2개)도 같이 잰다 — 아니면 deepEqual 이 아무것도 증명하지 않는다.
//
// 셋업: 매장은 billing_free_mode=true 인 채로 만들고(슬롯 캡 우회), 그 뒤 app_config 를 'false' 로 내려 잠금 규칙을 켠다.
//   끝나면 원래 값으로 되돌린다(공유 로컬 DB · 그 몇 초 동안 다른 하니스의 무료 모드 판정이 바뀔 수 있다).
// 세션: 계정은 service_role 로 만들고, 로그인은 매직링크(generateLink → verifyOtp)로 실세션을 받는다(AGENTS ⑥).
// 접두사 qa_sb_ · 끝나면 자가 정리. AI 호출 없음.
// 실행: npm run qa:session-bootstrap:local (--local · 로컬 도커 키) / npm run qa:session-bootstrap (--allow-remote)
import './lib/require-local-target.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { guardResolvedUrls } from './lib/local-target-guard.mjs';
import { joinAsStaff } from './lib/qa-staff.mjs';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

const here = (r) => fileURLToPath(new URL(r, import.meta.url));
function pe(f) { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch { /* 없는 파일 */ } return o; }
const LOCAL = process.argv.includes('--local');
let URL_, ANON, SRV;
if (LOCAL) {
  // ⚠️맨 `npx supabase` 는 CLI 3.0 이 잡혀 config.toml [inbucket] 에서 죽는다(AGENTS.md) — 반드시 supabase@2.
  const st = Object.fromEntries(execFileSync('npx', ['-y', 'supabase@2', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] })
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

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const mk = () => createClient(URL_, ANON, opts);
const admin = createClient(URL_, SRV, opts);
const s = String(Date.now()).slice(-9);
let pass = 0, fail = 0, skip = 0;
const check = (n, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`  ${ok ? '✓' : '✗'}`, n, extra); };
const skipped = (n, why) => { skip++; console.log('  - skip', n, `(${why})`); };

// 사장 0 · 직원 1~5 · 브랜드 6 · 탈퇴 7 · 행없음 8
const qaPhones = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `010${String(n).padStart(2, '0')}${s.slice(0, 6)}`);
const made = { users: [], units: [], brands: [] };
let freeModeBefore = null; // app_config.billing_free_mode 원래 값(없으면 'absent')

async function session(tag, meta) {
  const email = `qa_sb_${tag}_${s}@example.com`;
  const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { birth_date: '1994-03-03', ...meta } });
  if (ce) throw new Error(`createUser(${email}): ${ce.message}`);
  made.users.push(cu.user.id);
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (le) throw new Error(`generateLink(${email}): ${le.message}`);
  const c = mk();
  const { error: ve } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (ve) throw new Error(`verifyOtp(${email}): ${ve.message}`);
  return { c, id: cu.user.id, tag };
}
const must = (label, r) => { if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data; };

// 클라 loadProfile 이 지금 부르는 11개를 같은 세션으로 그대로 부르고 0354 의 키 모양으로 합성한다.
// 조건부 호출(role !== 'owner' · unitId · SHOW_IAP)은 두지 않는다 — 서버가 대상 아님에 false 를 돌려주는 규칙 그대로.
async function composed(c, uid) {
  const unitId = must('session_unit', await c.rpc('session_unit')) ?? null;
  const profile = must('profiles', await c.from('profiles').select('id, name, role, unit_id, active_unit_id, pending_unit_id, bio, phone, deleted_at').eq('id', uid).maybeSingle()) ?? null;
  const unit = unitId ? (must('units', await c.from('units').select('store_name, invite_code, invite_expires_at, industry').eq('id', unitId).maybeSingle()) ?? null) : null;
  const sub = unitId ? (must('unit_subscriptions', await c.from('unit_subscriptions').select('status, trial_ends_at, paid_until, plan').eq('unit_id', unitId).maybeSingle()) ?? null) : null;
  const fm = must('billing_free_mode', await c.rpc('billing_free_mode'));
  const ie = must('iap_enabled', await c.rpc('iap_enabled'));
  const dg = must('needs_downgrade_choice', await c.rpc('needs_downgrade_choice'));
  const dgRow = Array.isArray(dg) ? dg[0] : dg;
  const mu = must('my_units', await c.rpc('my_units'));
  const sl = must('my_seat_locked', await c.rpc('my_seat_locked'));
  const ul = must('my_unit_locked', await c.rpc('my_unit_locked'));
  const mb = must('my_brand', await c.rpc('my_brand'));
  return {
    deleted: false, profile, unit_id: unitId, unit, subscription: sub,
    free_mode: fm === true, iap_enabled: ie === true,
    needs_downgrade_choice: dgRow?.need_store === true || dgRow?.need_seats === true,
    my_units: mu ?? [], my_seat_locked: sl === true, my_unit_locked: ul === true,
    my_brand: Array.isArray(mb) && mb.length > 0 ? mb[0] : null,
  };
}
const KEYS = ['deleted', 'profile', 'unit_id', 'unit', 'subscription', 'free_mode', 'iap_enabled', 'needs_downgrade_choice', 'my_units', 'my_seat_locked', 'my_unit_locked', 'my_brand'];
async function compare(label, who, assertAxis) {
  // bootstrap 을 먼저 부른다 — 첫 session_unit 호출(세션 매장 고정)이 bootstrap 안에서 일어나야 한다(계획 §3).
  const { data: boot, error } = await who.c.rpc('session_bootstrap');
  if (error) { check(`${label}: session_bootstrap 호출`, false, error.message); return; }
  const exp = await composed(who.c, who.id);
  check(`${label}: 키 집합이 계약과 같다`, isDeepStrictEqual(Object.keys(boot).sort(), [...KEYS].sort()), Object.keys(boot).join(','));
  for (const k of KEYS) {
    check(`${label}: ${k}`, isDeepStrictEqual(boot[k], exp[k]), isDeepStrictEqual(boot[k], exp[k]) ? '' : `boot=${JSON.stringify(boot[k])} 개별=${JSON.stringify(exp[k])}`);
  }
  assertAxis?.(boot);
}

async function main() {
  await seedVerifiedPhones(URL_, SRV, qaPhones);

  // ── 셋업(무료 모드 true 인 채로 · 슬롯 캡 우회) ─────────────────────────────
  const O = await session('owner', { name: 'QA사장', role: 'owner', phone: qaPhones[0], store_name: 'SB1', industry: '카페·디저트' });
  const s1 = must('create_store S1', await O.c.rpc('create_store', { p_store_name: 'qa_sb S1', p_industry: '카페·디저트', p_biz_no: null }));
  const S1 = s1?.[0]?.unit_id, CODE1 = s1?.[0]?.invite_code;
  const s2 = must('create_store S2', await O.c.rpc('create_store', { p_store_name: 'qa_sb S2', p_industry: '카페·디저트', p_biz_no: null }));
  const S2 = s2?.[0]?.unit_id, CODE2 = s2?.[0]?.invite_code;
  if (!S1 || !S2 || !CODE1 || !CODE2) throw new Error('create_store 결과가 비었다');
  made.units.push(S1, S2);

  const JA = await session('active', { name: 'QA직원A', role: 'junior', phone: qaPhones[1] });
  const JC = await session('closed', { name: 'QA직원C', role: 'junior', phone: qaPhones[2] });
  const JK = await session('kept', { name: 'QA직원K', role: 'junior', phone: qaPhones[3] });
  const JL1 = await session('lock1', { name: 'QA직원L1', role: 'junior', phone: qaPhones[4] });
  const JL2 = await session('lock2', { name: 'QA직원L2', role: 'junior', phone: qaPhones[5] });
  for (const j of [JA, JK, JL1, JL2]) await joinAsStaff(j.c, CODE1); // S1 직원 4명(좌석 잠금은 4명째부터 · seat_locked_for)
  await joinAsStaff(JC.c, CODE2);                                      // S2 직원 1명(곧 닫힌다)

  const B = await session('brand', { name: 'QA본사', role: 'junior', phone: qaPhones[6] });
  const BRAND = `qa_sb_brand_${s}`;
  must('brands insert', await admin.from('brands').insert({ id: BRAND, name: 'qa_sb 브랜드' }));
  made.brands.push(BRAND);
  must('brand_members insert', await admin.from('brand_members').insert({ brand_id: BRAND, user_id: B.id }));

  const D = await session('deleted', { name: 'QA탈퇴', role: 'junior', phone: qaPhones[7] });
  must('profiles deleted_at', await admin.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', D.id));

  const N = await session('norow', { name: 'QA행없음', role: 'junior', phone: qaPhones[8] });
  const nDel = await admin.from('profiles').delete().eq('id', N.id).select('id');
  const noRowReady = !nDel.error && (nDel.data ?? []).length === 1;

  // ── 잠금 규칙 켜기: 무료 모드 false → 사장이 S1 을 남기고(S2 닫힘) · S1 좌석 2명(JA·JK)만 남긴다 ──
  // ★app_config 는 전 사용자 공용이다 — 라이브에서 몇 초라도 무료 모드를 끄면 전 매장 잠금 규칙이 켜진다. **로컬에서만 토글**한다.
  //   원격(--allow-remote)은 잠금 두 축의 "=true" 단언만 skip 으로 찍고, bootstrap == 개별 합성 비교는 그대로 한다(2026-11-05 verify 지적).
  if (LOCAL) {
    const fmRow = await admin.from('app_config').select('value').eq('key', 'billing_free_mode').maybeSingle();
    if (fmRow.error) throw new Error('app_config read: ' + fmRow.error.message);
    freeModeBefore = fmRow.data ? fmRow.data.value : 'absent';
    must('app_config billing_free_mode=false', await admin.from('app_config').upsert({ key: 'billing_free_mode', value: 'false' }, { onConflict: 'key' }));

    must('choose_kept_store S1', await O.c.rpc('choose_kept_store', { p_unit: S1 }));
    must('switch_active_unit S1', await O.c.rpc('switch_active_unit', { p_unit_id: S1 }));
    must('choose_kept_seats JA·JK', await O.c.rpc('choose_kept_seats', { p_uids: [JA.id, JK.id] }));
  } else {
    must('switch_active_unit S1', await O.c.rpc('switch_active_unit', { p_unit_id: S1 }));
  }
  check('셋업: 매장 2 · S1 직원 4 · S2 직원 1 · 브랜드 1 · 탈퇴 1', true, `S1=${S1} S2=${S2} · 잠금 규칙=${LOCAL ? '켬(로컬)' : '안 켬(원격 · app_config 불변)'}`);

  // ── 4축 + 브랜드: bootstrap == 개별 합성 ────────────────────────────────────
  await compare('A 사장(활성 S1)', O, (b) => {
    check('A 축 확인: my_units 2개 · S1 활성 · owner', b.my_units.length === 2 && b.my_units.find((u) => u.unit_id === S1)?.is_active === true && b.my_units.every((u) => u.role === 'owner'));
    check('A 축 확인: 사장은 좌석·매장 잠금 대상 아님(서버 false)', b.my_seat_locked === false && b.my_unit_locked === false);
    check('A 축 확인: unit·subscription 행이 있다', !!b.unit && !!b.subscription && b.unit.invite_code === CODE1);
  });
  await compare('B 활성 직원(S1 · 좌석 지킴)', JA, (b) => {
    check('B 축 확인: unit_id=S1 · junior · 잠김 없음', b.unit_id === S1 && b.my_units[0]?.role === 'junior' && b.my_seat_locked === false && b.my_unit_locked === false);
  });
  await compare('닫힌 매장 직원(S2)', JC, (b) => {
    if (LOCAL) check('닫힘 축 확인: my_unit_locked=true · unit_id=S2', b.my_unit_locked === true && b.unit_id === S2);
    else skipped('닫힘 축 확인: my_unit_locked=true', '원격은 app_config 를 토글하지 않는다(합성 비교만)');
  });
  await compare('좌석 잠긴 직원(S1 · 명단 밖)', JL2, (b) => {
    if (LOCAL) check('좌석 축 확인: my_seat_locked=true · my_unit_locked=false', b.my_seat_locked === true && b.my_unit_locked === false);
    else skipped('좌석 축 확인: my_seat_locked=true', '원격은 app_config 를 토글하지 않는다(합성 비교만)');
  });
  await compare('브랜드 담당자', B, (b) => {
    check('브랜드 축 확인: my_brand.brand_id', b.my_brand?.brand_id === BRAND && b.my_brand?.brand_name === 'qa_sb 브랜드');
  });

  // ── 탈퇴 · 행 없음 · anon ───────────────────────────────────────────────────
  {
    // 0335 뒤 탈퇴 계정의 REST 요청은 pre-request(require_active_account)가 PT401 로 막아 함수에 닿지 않는다.
    // 클라의 지금 profiles select 도 같은 오류를 받는다 → 두 길이 같은 오류 경로(profileErr)로 떨어지는지 잰다.
    const boot = await D.c.rpc('session_bootstrap');
    const prof = await D.c.from('profiles').select('id, deleted_at').eq('id', D.id).maybeSingle();
    check('탈퇴 계정: REST 는 bootstrap·profiles select 둘 다 같은 거부(0335 PT401)',
      !!boot.error && !!prof.error && boot.error.message === prof.error.message, `${boot.error?.message} / ${prof.error?.message}`);
    // 함수 본문의 {deleted:true} 는 pre-request 없이 직접 부를 때만 보인다 — 로컬은 psql 로 authenticated 역할을 흉내 낸다.
    if (LOCAL) {
      const DBC = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
      try {
        const out = execFileSync('docker', ['exec', '-i', DBC, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
          `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${D.id}","role":"authenticated"}', true); select public.session_bootstrap()::text; rollback;`],
        { encoding: 'utf8' }).trim().split('\n').filter((l) => l.startsWith('{')).pop();
        check('탈퇴 계정: 함수 본문은 {deleted:true} 만 돌려준다', isDeepStrictEqual(JSON.parse(out ?? 'null'), { deleted: true }), out);
      } catch (e) {
        skipped('탈퇴 계정 함수 본문', `docker psql 실패: ${e?.message ?? e}`);
      }
    } else {
      skipped('탈퇴 계정 함수 본문', '원격은 pre-request 를 우회할 길이 없다(로컬 psql 로만 잰다)');
    }
  }
  if (noRowReady) {
    const { data, error } = await N.c.rpc('session_bootstrap');
    check('profiles 행 없음 → profile=null · deleted=false · 오류 없음', !error && data?.deleted === false && data?.profile === null && data?.unit_id === null, error?.message ?? '');
  } else {
    skipped('profiles 행 없음', `행을 지우지 못했다: ${nDel.error?.message ?? '0행'}`);
  }
  {
    const { error } = await mk().rpc('session_bootstrap');
    check('anon 호출 거부', !!error, error?.message ?? '오류 없이 응답');
  }

  // ── 함수 속성(search_path 고정 · volatile · grant) — 로컬은 도커 psql 로 pg_proc 를 본다 ──
  if (LOCAL) {
    const DBC = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
    try {
      const out = execFileSync('docker', ['exec', '-i', DBC, 'psql', '-U', 'postgres', '-At', '-F', '|', '-c',
        "select array_to_string(proconfig, ','), provolatile, prosecdef, has_function_privilege('anon', oid, 'execute'), has_function_privilege('authenticated', oid, 'execute') from pg_proc where oid = 'public.session_bootstrap()'::regprocedure;"],
      { encoding: 'utf8' }).trim();
      const [cfg, vol, secdef, anonX, authX] = out.split('|');
      check('search_path=public 고정', (cfg ?? '').includes('search_path=public'), cfg);
      check('volatile(session_unit 첫 호출 쓰기)', vol === 'v', vol);
      check('security invoker(테이블 읽기는 클라와 같은 RLS)', secdef === 'f', secdef);
      check('grant: anon 없음 · authenticated 있음', anonX === 'f' && authX === 't', `${anonX}/${authX}`);
    } catch (e) {
      skipped('pg_proc 속성', `docker psql 실패: ${e?.message ?? e}`);
    }
  } else {
    skipped('pg_proc 속성', '원격은 pg_proc 를 REST 로 못 읽는다 · 0354 자가점검(do 블록)이 적용 시점에 같은 것을 본다');
  }
}

async function cleanup() {
  if (freeModeBefore !== null) {
    const r = freeModeBefore === 'absent'
      ? await admin.from('app_config').delete().eq('key', 'billing_free_mode')
      : await admin.from('app_config').upsert({ key: 'billing_free_mode', value: freeModeBefore }, { onConflict: 'key' });
    if (r.error) console.error('  ! 정리 app_config:', r.error.message);
  }
  for (const u of made.units) { const r = await admin.from('units').delete().eq('id', u); if (r.error) console.error('  ! 정리 units:', r.error.message); }
  for (const b of made.brands) { const r = await admin.from('brands').delete().eq('id', b); if (r.error) console.error('  ! 정리 brands:', r.error.message); }
  for (const id of made.users) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('  ! 정리 user:', r.error.message); }
  console.log(`  · 정리: 매장 ${made.units.length} · 브랜드 ${made.brands.length} · 계정 ${made.users.length} · 무료 모드 복원 ${freeModeBefore ?? '(안 바꿈)'}`);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error('  ✗ 셋업/실행 실패:', e?.message ?? e);
} finally {
  await cleanup().catch((e) => console.error('  ! 정리 실패:', e?.message ?? e));
  await cleanupSeededPhones(URL_, SRV, qaPhones).catch(() => {});
}
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} pass ${pass} / fail ${fail} / skip ${skip} · AI 호출 0회`);
process.exitCode = fail === 0 ? 0 : 1;
