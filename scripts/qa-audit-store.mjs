#!/usr/bin/env node
// qa-audit-store.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 매장·직원 묶음 재현 검사.
//   [C1] 무료 매장 좌석 잠금은 한 판정을 쓴다. 직원이 3명 이하면 아무도 잠그지 않는다.
//        매장이 유료가 되면 옛 "계속 함께할 직원" 명단을 비운다. 사장 화면 잠김 수도 같은 판정으로 센다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 실행: node --no-warnings scripts/qa-audit-store.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';

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

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
