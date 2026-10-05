#!/usr/bin/env node
// qa-audit-store.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 매장·직원 묶음 재현 검사.
//   [C1] 무료 매장 좌석 잠금은 한 판정을 쓴다. 직원이 3명 이하면 아무도 잠그지 않는다.
//        매장이 유료가 되면 옛 "계속 함께할 직원" 명단을 비운다. 사장 화면 잠김 수도 같은 판정으로 센다.
//   [C2·C6·C8·C9·B8] 2026-10-06 사장님 결정(논리점검_결정기록_2026-10-06.md §1).
//        서버 동작은 로컬 도커 DB 트랜잭션(되돌림)으로도 본다. 도커가 꺼져 있으면 그 부분만 SKIP.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 실행: node --no-warnings scripts/qa-audit-store.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const sqlStrip = (s) => s.replace(/--.*$/gm, '');
const migDir = new URL('../supabase/migrations/', import.meta.url);
const migFiles = () => readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

// 함수의 마지막 정의 본문(가장 큰 번호 마이그레이션). create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  let body = '', file = '';
  for (const f of migFiles()) {
    const s = readFileSync(new URL(f, migDir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
const fileHas = (file, text) => !!file && read(`supabase/migrations/${file}`).includes(text);

console.log('[C1] 무료 매장 좌석 잠금은 한 판정 — 3명 이하면 아무도 안 잠그고, 유료가 되면 옛 명단을 비운다');
{
  const p = lastDef('seat_locked_for');
  const idxCount = p.body.search(/<= 3 then return false/);
  const idxList = p.body.indexOf('unit_kept_seat_uids');
  check('★한 판정(seat_locked_for)이 있고, 직원 3명 이하 검사가 명단 검사보다 먼저다',
    !!p.file && idxCount > 0 && idxList > idxCount, p.file || '없음');
  check('판정은 유료·전면 무료 모드에서 잠그지 않는다',
    /billing_free_mode\(\)/.test(p.body) && /effective_plan\(p_unit\) <> 'free'/.test(p.body));
  check('명단이 없으면 합류 순서(seat_rank > 3)로 정한다', /seat_rank\(p_unit, p_uid\)/.test(p.body) && /> 3/.test(p.body));
  check('seat_locked_for 는 내부 판정이다(클라 실행 불가)',
    fileHas(p.file, 'revoke all on function public.seat_locked_for(text, uuid) from public, anon, authenticated;'));

  const m = lastDef('my_seat_locked');
  check('★my_seat_locked 가 그 판정을 쓴다', /public\.seat_locked_for\(v_unit, v_uid\)/.test(m.body), m.file);
  check('my_seat_locked 권한 유지(authenticated)',
    fileHas(m.file, 'grant execute on function public.my_seat_locked() to authenticated;'));

  const s = lastDef('unit_seat_status');
  check('★unit_seat_status 의 잠김 수도 같은 판정으로 센다',
    /public\.seat_locked_for\(v_unit, m\.user_id\)/.test(s.body) && !/greatest\(total - cap, 0\)/.test(s.body), s.file);
  check('unit_seat_status 권한 유지(authenticated)',
    fileHas(s.file, 'grant execute on function public.unit_seat_status() to authenticated;'));

  const t = lastDef('clear_kept_seats_on_paid');
  check('★매장이 유료가 되면 그 매장의 옛 명단을 비운다(unit_subscriptions 트리거)',
    /effective_plan\(new\.unit_id\) <> 'free'/.test(t.body) && /delete from public\.unit_kept_seats where unit_id = new\.unit_id/.test(t.body)
      && fileHas(t.file, 'after insert or update on public.unit_subscriptions'), t.file || '없음');
}

// 함수를 마지막으로 손댄 파일(create function 또는 0254 식 본문 치환 pg_get_functiondef) 과 그 내용.
const lastTouch = (name) => {
  let file = '';
  for (const f of migFiles()) {
    const s = read(`supabase/migrations/${f}`);
    if (new RegExp(`create (or replace )?function public\\.${name}\\(`).test(s) || s.includes(`pg_get_functiondef('public.${name}()'`)) file = f;
  }
  return { file, text: sqlStrip(read(`supabase/migrations/${file}`)) };
};

console.log('\n[C4] 닫힌(잠긴) 매장에는 할일·퀴즈 알림을 보내지 않는다');
{
  const t = lastTouch('due_task_reminders');
  check('★할일 알림 후보에서 잠긴 매장을 뺀다(due_task_reminders)',
    /and not public\.unit_access_locked\(w\.unit_id\)/.test(t.text), t.file);
  check('할일 알림 함수는 service_role 전용 그대로(anon 실행 불가 자가점검)',
    /has_function_privilege\('anon', 'public\.due_task_reminders\(\)', 'execute'\)/.test(t.text));
  const q = lastTouch('due_quiz_sends');
  check('★퀴즈 발송 후보에서 잠긴 매장을 뺀다(due_quiz_sends)',
    /and not public\.unit_access_locked\(u\.id\)/.test(q.text), q.file);
  check('퀴즈 발송 함수는 service_role 전용 그대로(anon 실행 불가 자가점검)',
    /has_function_privilege\('anon', 'public\.due_quiz_sends\(\)', 'execute'\)/.test(q.text));
}

console.log('\n[C5] 닫힌 매장·탈퇴한 사장 매장의 코드로는 합류 신청을 받지 않는다');
{
  const j = lastDef('join_by_invite');
  const guard = j.body.match(/if v_deleted is not null[\s\S]*?end if;/)?.[0] ?? '';
  check('★삭제 대기·잠긴 매장이면 신청을 넣지 않고 store_not_accepting 으로 거부한다',
    /unit_access_locked\(v_unit\)/.test(guard) && /raise exception 'store_not_accepting'/.test(guard)
      && j.body.indexOf('store_not_accepting') < j.body.indexOf('set pending_unit_id = v_unit'), j.file);
  check('join_by_invite 권한 유지(authenticated)',
    fileHas(j.file, 'grant execute on function public.join_by_invite(text, date) to authenticated;'));
  const sess = read('src/lib/store/useSessionStore.ts');
  check('★앱이 store_not_accepting 을 쉬운 문구로 보여 준다',
    /store_not_accepting/.test(sess) && /합류 신청을 받지 않는 매장이에요/.test(sess));
}

console.log('\n[C7] "매장 추가"는 남은 이용권을 보고 길을 정한다');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const r = lastDef('my_can_add_store');
  check('★서버가 "지금 매장을 더 열 수 있나"를 create_store 와 같은 규칙으로 답한다(빈 이용권·무료 모드·첫 매장·가입 체험)',
    /from public\.store_slots/.test(r.body) && /consumed_at is null and paid_until > now\(\)/.test(r.body)
      && /billing_free_mode\(\)/.test(r.body) && /owner_signup_trial_ends\(v_uid\)/.test(r.body) && /role = 'owner'/.test(r.body), r.file || '없음');
  check('my_can_add_store 는 authenticated 만 실행',
    fileHas(r.file, 'revoke all on function public.my_can_add_store() from public, anon, authenticated;')
      && fileHas(r.file, 'grant execute on function public.my_can_add_store() to authenticated;'));
  const stores = strip(read('src/app/stores.tsx'));
  const add = stores.match(/const addStore = [\s\S]*?\n  };/)?.[0] ?? '';
  check('★매장 목록의 "매장 추가"가 그 답(fetchMyCanAddStore)으로 만들기 폼과 결제 화면을 가른다',
    /fetchMyCanAddStore\(\)/.test(add) && !/if \(canUseMultistore\(plan, freeMode\)\) return router\.push\('\/owner\/create-store'\)/.test(add));
  const sess = read('src/lib/store/useSessionStore.ts');
  check('createStore 가 no_store_slot 을 화면이 가를 수 있는 code 로 돌려준다', /'NO_STORE_SLOT'/.test(sess));
  const cs = strip(read('src/app/owner/create-store.tsx'));
  check('★매장 만들기에서 이용권이 없으면 "이용권 보기"로 이어 준다',
    /cs\.code === 'NO_STORE_SLOT'/.test(cs) && /label: '이용권 보기'/.test(cs) && /router\.push\('\/billing/.test(cs));
}

console.log('\n[C10] 사장이 매장 행을 직접 고칠 수 있는 열은 업종 하나뿐이다');
{
  let file = '';
  for (const f of migFiles()) if (/revoke update on (table )?public\.units from/.test(sqlStrip(read(`supabase/migrations/${f}`)))) file = f;
  const s = file ? sqlStrip(read(`supabase/migrations/${file}`)) : '';
  check('★units 의 통째 update 권한을 클라(anon·authenticated)에서 거둔다',
    !!file && /revoke update on public\.units from anon, authenticated;/.test(s), file || '없음');
  check('★업종(industry) 열만 다시 연다', /grant update \(industry\) on public\.units to authenticated;/.test(s));
  const db = read('src/lib/db.ts');
  const writes = [...db.matchAll(/from\('units'\)\s*\.update\(\{([^}]*)\}/g)].map((m) => m[1].trim());
  check('앱이 units 에 직접 쓰는 열은 industry 하나뿐이다(권한과 맞다)', writes.length > 0 && writes.every((w) => w === 'industry'), JSON.stringify(writes));
}

// ── 로컬 도커 DB(트랜잭션 · 되돌림 · 고정 계정 store_001) ─────────────────────
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
};
const tail = (o) => o.split('\n').filter((l) => /^R=|ERR=/.test(l)).join(' ').slice(0, 200);
let dbUp = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { dbUp = false; }
const IDS = `
begin;
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);
select set_config('qa.m', (select id::text from auth.users where email = 'staff@pilot.squaretable.app'), true);
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
`;
// 고정 계정 사장에게 매장 하나를 더 만든다(전화 인증 트리거 등은 끄고 넣는다 · 끝나면 되돌림).
const extraUnit = (id, code, extra = '') => `
set local session_replication_role = replica;
insert into public.units (id, store_name, owner_id, invite_code) values ('${id}', 'QA ${id}', current_setting('qa.o')::uuid, '${code}');
insert into public.unit_members (unit_id, user_id, role) values ('${id}', current_setting('qa.o')::uuid, 'owner') on conflict do nothing;
${extra}
set local session_replication_role = origin;
`;
const as = (who) => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);
`;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

console.log('\n[C2] 매장이 닫히면(unit_access_locked) 그 매장이 활성인 직원·매니저도 막는다');
{
  const f = lastDef('my_unit_locked');
  check('★서버 판정 my_unit_locked 가 활성 매장(auth_unit_id)의 잠금(unit_access_locked)을 직원·매니저에게만 돌려준다',
    !!f.file && /public\.auth_unit_id\(\)/.test(f.body) && /public\.unit_access_locked\(v_unit\)/.test(f.body) && /'junior', 'manager'/.test(f.body), f.file || '없음');
  check('my_unit_locked 는 authenticated 만 실행',
    fileHas(f.file, 'revoke all on function public.my_unit_locked() from public, anon, authenticated;')
      && fileHas(f.file, 'grant execute on function public.my_unit_locked() to authenticated;'));
  const r = lastDef('reopen_store');
  check('사장 "다시 열기"가 직원을 빼는 동작은 그대로다(close_member_tenure reopen · 알림 없음)',
    /perform public\.close_member_tenure\(p_unit, r\.user_id, 'reopen', false\)/.test(r.body), r.file);
  const db = strip(read('src/lib/db.ts'));
  check('★db: fetchMyUnitLocked 가 my_unit_locked 를 부른다', /export async function fetchMyUnitLocked[\s\S]*?rpc\('my_unit_locked'\)/.test(db));
  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  check('★세션이 unitLocked 를 들고, 사장 아닌 역할일 때 서버 판정으로 채운다(로그아웃 때 비운다)',
    /unitLocked: boolean;/.test(ss) && /fetchMyUnitLocked\(\)/.test(ss) && /\n\s+unitLocked,\n/.test(ss) && /seatLocked: false, unitLocked: false/.test(ss));
  const scr = strip(read('src/components/StoreClosedScreen.tsx'));
  check('★차단 화면 문구 "사장님이 이 매장을 닫았어요" · 다른 매장이 있으면 매장 목록으로 가는 길',
    /사장님이 이 매장을 닫았어요/.test(scr) && /router\.replace\('\/stores'\)/.test(scr) && /stores\.length > 1/.test(scr));
  const jl = strip(read('src/app/junior/_layout.tsx'));
  check('★직원 레이아웃이 unitLocked 면 차단 화면을 그린다', /unitLocked\) return <StoreClosedScreen \/>/.test(jl));
  const ol = strip(read('src/app/owner/_layout.tsx'));
  check('★사장 레이아웃에 들어온 매니저도 unitLocked 면 차단 화면을 그린다', /role === 'manager' && unitLocked\) return <StoreClosedScreen \/>/.test(ol));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    // 사장에게 유료 매장이 생기면 무료 매장 store_001 은 이전 매장(잠김)이 된다(0196).
    const PAID = extraUnit('qa_c2_paid', '991101',
      `insert into public.unit_subscriptions (unit_id, status, plan, paid_until) values ('qa_c2_paid', 'active', 'single', now() + interval '30 days')
         on conflict (unit_id) do update set status = 'active', plan = 'single', paid_until = excluded.paid_until;`);
    const q = (who, fixture) => psql(`${IDS}${fixture}${as(who)}select 'R=' || public.my_unit_locked();\nrollback;\n`);
    const j1 = q('j', PAID);
    check('★닫힌 매장(store_001)이 활성인 직원 → my_unit_locked = true', j1.includes('R=true'), tail(j1));
    const m1 = q('m', PAID);
    check('★닫힌 매장이 활성인 매니저 → true', m1.includes('R=true'), tail(m1));
    const o1 = q('o', PAID);
    check('사장 본인은 대상이 아니다 → false', o1.includes('R=false'), tail(o1));
    const j0 = q('j', '');
    check('열린 매장 직원 → false', j0.includes('R=false'), tail(j0));
  }
}

console.log('\n[C6] 모든 초대코드는 만료가 없다(사장이 바꿀 때만 바뀐다)');
{
  const r = lastDef('rotate_invite_code');
  check('★코드 변경(rotate_invite_code)이 만료일을 넣지 않는다', !!r.file && !/interval '7 days'/.test(r.body) && /invite_expires_at = null/.test(r.body), r.file);
  check('rotate_invite_code 권한 유지(authenticated)', fileHas(r.file, 'grant execute on function public.rotate_invite_code() to authenticated;'));
  const o = lastDef('reopen_store');
  check('★다시 열기(reopen_store)가 새 코드에 만료일을 넣지 않는다', !/interval '7 days'/.test(o.body) && /invite_expires_at = null/.test(o.body), o.file);
  check('reopen_store 권한 유지(authenticated)', fileHas(o.file, 'grant execute on function public.reopen_store(text) to authenticated;'));
  let fix = '';
  for (const f of migFiles()) if (/update public\.units set invite_expires_at = null where invite_expires_at is not null;/.test(sqlStrip(read(`supabase/migrations/${f}`)))) fix = f;
  check('★이미 만료일이 찍힌 기존 코드도 만료 없음으로 돌린다', !!fix, fix || '없음');
  const ss = read('src/lib/store/useSessionStore.ts');
  check('합류 실패 문구가 "기한이 지났을 수도"를 말하지 않는다', !/기한이 지났을 수도/.test(ss));
  check('코드 변경 설명에 "7일 만료"가 남아 있지 않다(db·직원 화면)', !/7일 만료/.test(read('src/lib/db.ts')) && !/7일 만료/.test(read('src/app/owner/staff.tsx')));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const r1 = psql(`${IDS}${as('o')}select 'R=' || coalesce(invite_expires_at::text, 'null') from public.rotate_invite_code();\nrollback;\n`);
    check('★사장이 코드를 바꾸면 새 코드의 만료 = 없음(null)', r1.includes('R=null'), tail(r1));
  }
}

console.log('\n[C8] 매장 설정에서 사업자번호를 넣고 바꾼다(RPC 저장 · 중복은 내 매장/다른 매장 구분)');
{
  const f = lastDef('set_store_biz_no');
  check('★저장 RPC set_store_biz_no 가 있다(사장 확인 · 형식 검사 · 내 매장 중복 biz_no_mine · 남의 매장 중복 duplicate_biz_no)',
    !!f.file && /role = 'owner'/.test(f.body) && /invalid_biz_no/.test(f.body) && /biz_no_mine/.test(f.body) && /duplicate_biz_no/.test(f.body), f.file || '없음');
  check('set_store_biz_no 는 authenticated 만 실행',
    fileHas(f.file, 'revoke all on function public.set_store_biz_no(text, text) from public, anon, authenticated;')
      && fileHas(f.file, 'grant execute on function public.set_store_biz_no(text, text) to authenticated;'));
  const db = strip(read('src/lib/db.ts'));
  check('★db: 사업자번호 읽기·저장(set_store_biz_no RPC)', /rpc\('set_store_biz_no'/.test(db) && /export async function fetchUnitBizNo/.test(db));
  check('units 직접 쓰기는 여전히 업종 하나뿐(0268 권한과 맞다)', [...db.matchAll(/from\('units'\)\s*\.update\(\{([^}]*)\}/g)].every((m) => m[1].trim() === 'industry'));
  const sc = strip(read('src/app/owner/store-config.tsx'));
  check('★매장 기본 정보(사장)에 사업자번호 칸 · 형식 검사(isValidBizNo) · 저장',
    /isValidBizNo\(/.test(sc) && /saveUnitBizNo\(/.test(sc) && /사업자등록번호/.test(sc));
  check('★중복 안내를 둘로 가른다(내 다른 매장 / 다른 매장)',
    /biz_no_mine/.test(sc) && /내 다른 매장/.test(sc) && /duplicate_biz_no/.test(sc));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const call = (who, fixture, unit, no) => psql(`${IDS}${fixture}${as(who)}select 'R=' || coalesce(public.set_store_biz_no('${unit}', '${no}'), 'null');\nrollback;\n`);
    const ok = call('o', '', 'store_001', '123-45-67891');
    check('★사장이 올바른 번호를 넣으면 숫자 10자리로 저장된다', ok.includes('R=1234567891'), tail(ok));
    const bad = call('o', '', 'store_001', '1234567890');
    check('★검증 숫자가 틀린 번호 → invalid_biz_no', bad.includes('invalid_biz_no'), tail(bad));
    const staff = call('m', '', 'store_001', '1234567891');
    check('★매니저·직원은 못 바꾼다 → not_owner', staff.includes('not_owner'), tail(staff));
    const mine = call('o', extraUnit('qa_c8_mine', '991102', `update public.units set biz_no = '2208100001' where id = 'qa_c8_mine';`), 'store_001', '2208100001');
    check('★내 다른 매장에서 쓰는 번호 → biz_no_mine', mine.includes('biz_no_mine'), tail(mine));
    const other = call('o', `set local session_replication_role = replica; update public.units set biz_no = '1112223339' where id = 'store_solo_local'; set local session_replication_role = origin;`, 'store_001', '1112223339');
    check('★다른 사장 매장 번호 → duplicate_biz_no', other.includes('duplicate_biz_no') && !other.includes('biz_no_mine'), tail(other));
    const clear = call('o', `update public.units set biz_no = '1234567891' where id = 'store_001';`, 'store_001', '');
    check('빈 값이면 번호를 지운다(null)', clear.includes('R=null'), tail(clear));
  }
}

console.log('\n[C9] 본사 연결이 살아 있는 매장은 삭제를 거부한다');
{
  const f = lastDef('delete_store');
  const g = f.body.match(/from public\.brand_units[\s\S]*?status = 'active'[\s\S]*?brand_linked[\s\S]*?end if;/)?.[0] ?? '';
  check('★delete_store 가 활성 본사 연결을 보고 owner_can_end=false → brand_locked, true → brand_linked',
    /owner_can_end/.test(g) && /brand_locked/.test(g) && f.body.indexOf('brand_linked') < f.body.indexOf('delete from public.units'), f.file);
  check('delete_store 권한 유지(authenticated)', fileHas(f.file, 'grant execute on function public.delete_store(text) to authenticated;'));
  check('delete_store 의 기존 검사·몫 돌려주기는 그대로(last_store · store_has_staff · store_return_slot · 대기 신고 닫기)',
    /last_store/.test(f.body) && /store_has_staff/.test(f.body) && /store_return_slot\(p_unit_id\)/.test(f.body) && /reject_reason = 'store_deleted'/.test(f.body));
  const ss = read('src/lib/store/useSessionStore.ts');
  check('★앱 문구: brand_locked → "본사에 문의해 주세요", brand_linked → "먼저 본사 연결을 끊어 주세요"',
    /brand_locked/.test(ss) && /본사에 문의해 주세요/.test(ss) && /brand_linked/.test(ss) && /먼저 본사 연결을 끊어 주세요/.test(ss));
  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    const fx = (canEnd, status = 'active') => extraUnit('qa_c9', '991103', `
insert into public.brands (id, name) values ('qa_c9_brand', 'QA 본사');
insert into public.brand_units (brand_id, unit_id, status, payer, relation, owner_can_end) values ('qa_c9_brand', 'qa_c9', '${status}', 'store', 'direct', ${canEnd});`);
    const del = (fixture) => psql(`${IDS}${fixture}${as('o')}select 'R=' || public.delete_store('qa_c9')::text;\nrollback;\n`);
    const a = del(fx(false));
    check('★본사가 해제를 막은(owner_can_end=false) 매장 삭제 → brand_locked', a.includes('brand_locked'), tail(a));
    const b = del(fx(true));
    check('★점주가 끊을 수 있는 연결이 살아 있는 매장 삭제 → brand_linked', b.includes('brand_linked'), tail(b));
    const c = del(fx(true, 'ended'));
    check('끝난 연결만 있는 매장은 지금처럼 지워진다', c.includes('R={'), tail(c));
  }
}

console.log('\n[B8] 가입 직후 화면은 유료 AI 한도를 사실대로 말한다');
{
  const ob = strip(read('src/app/owner/onboarding.tsx'));
  check('★"직원·AI 무제한" 문구가 없다', !/직원·AI 무제한/.test(ob));
  check('★"직원 무제한 · AI 월 3,000회"(숫자는 tiers.ts 에서)', /직원 무제한 · AI 월 \$\{[^}]*PLANS\.single\.aiMonthly[^}]*\}회/.test(ob));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
