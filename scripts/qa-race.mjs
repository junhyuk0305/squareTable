// qa-race.mjs — 레이스(동시 요청) 하니스 (2026-11-12 · 결함 전수 점검 S0)
//
// 사용: npm run qa:race:local [-- --case=H1,M4]   (로컬 도커 전용 · --local 필수)
// 판정: 케이스마다 "고친 뒤의 기대"를 단언한다. 지금 결함이 남아 있으면 ❌(RED)로 센다.
//   방식 A(psql 두 세션 · 앞 세션 1.5초 쥠) = 서버 함수 · 방식 B(실세션 둘 · Promise.all n회) = 클라 직접 쓰기.
//   단언 다섯: 이긴 쪽 수 · 진 쪽 코드 · 남은 행 수 · 나간 알림 수 · 정리 뒤 남은 행 0.
// 계정·매장: makeWorld 로 케이스마다 격리 매장을 만든다(고정 계정 없음). 정리는 케이스가 끝날 때마다 한다.
// 셋업이 못 서면 fail 로 센다. 최종 줄 = `pass n · fail n · skip n`.
// 기록: 산출물/결함전수점검_2026-11-12/레이스지도_확정_2026-11-12.md
import './lib/require-local-target.mjs';
import { localEnv, makeLocal, makeWorld, cleanupWorld, kstDay } from './lib/qa-fz-local.mjs';
import { makeRace, show, makeCounter, q } from './lib/qa-race.mjs';

const env = localEnv();
const L = makeLocal(env);
const R = makeRace(env.DB_CONTAINER);
const { t, check } = makeCounter();
const only = (process.argv.find((a) => a.startsWith('--case=')) ?? '').slice(7).split(',').filter(Boolean);
const ROUNDS = 10;
console.log(`대상: ${env.URL_} · db ${env.DB_CONTAINER} · 케이스 ${only.length ? only.join(',') : '전부'}`);

const n = (sql) => Number(R.val(sql));
const S = (w, who, body, hold) => R.session(who, body, hold);
const today = kstDay();

// 정리: world 가 만든 매장 + 그 사장이 가진 매장 전부 + 사장 단위 표(카드·앱 구독·슬롯·비번 실패).
async function cleanup(worlds) {
  const users = worlds.flatMap((w) => w.users);
  if (!users.length) return { left: 0, detail: [] };
  const lit = `'{${users.join(',')}}'::uuid[]`;
  const extra = R.val(`select coalesce(string_agg(id, ','), '') from public.units where owner_id = any(${lit})`).split(',').filter(Boolean);
  const known = new Set(worlds.map((w) => w.unit));
  const fake = extra.filter((u) => !known.has(u)).map((u) => ({ unit: u, users: [], phones: [] }));
  R.val(`delete from public.card_payments where owner_id = any(${lit});
delete from public.card_billing_keys where owner_id = any(${lit});
delete from public.iap_subscriptions where owner_id = any(${lit});
delete from public.store_slots where owner_id = any(${lit});
delete from public.password_change_failures where user_id = any(${lit});
delete from public.payment_claims where claimed_by = any(${lit});
delete from public.space_entry_allowlist where user_id = any(${lit});
delete from public.attendance_edits where unit_id = any('{${[...worlds.map((w) => w.unit), ...extra].filter(Boolean).join(',')}}'::text[]);
select 1;`);
  const r = await cleanupWorld(L, env, [...worlds, ...fake]);
  const left2 = n(`select (select count(*) from public.card_payments where owner_id = any(${lit}))
    + (select count(*) from public.iap_subscriptions where owner_id = any(${lit}))
    + (select count(*) from public.store_slots where owner_id = any(${lit}))
    + (select count(*) from public.payment_claims where claimed_by = any(${lit}))`);
  return { left: r.left + left2, detail: left2 ? [...r.detail, `사장표=${left2}`] : r.detail };
}

const CASES = [];
const def = (id, name, run) => CASES.push({ id, name, run });

// ─────────────────────────────── 이미 고친 길(틀 검증 · GREEN 기대) ───────────────────────────────
def('AQ', 'ai_quota_reserve 마지막 1칸을 두 요청이 동시에(0554 advisory)', async (W) => {
  const w = await W({ staffN: 0 });
  const cap = n(`select cap from public.unit_ai_cap(${q(w.unit)})`);
  R.val(`insert into public.ai_usage_monthly(unit_id, month, used) values (${q(w.unit)}, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'), ${cap - 1})
    on conflict (unit_id, month) do update set used = excluded.used; select 1;`);
  const body = `(select allowed::text from public.ai_quota_reserve(${q(w.unit)}, 1, null, true))`;
  const [a, b] = R.twoAtOnce(S(w, 'service', body, true), S(w, 'service', body, false));
  const used = n(`select used from public.ai_usage_monthly where unit_id = ${q(w.unit)}`);
  check('AQ', '이긴 쪽 1 · 진 쪽 allowed=false', a.ok && a.v === 'true' && b.ok && b.v === 'false', `${show(a)} · ${show(b)}`);
  check('AQ', `사용량 = 상한(${cap})`, used === cap, `used=${used}`);
});

def('AS', 'accept_swap 두 직원이 동시에 수락(0179 for update)', async (W) => {
  const w = await W({ staffN: 3 });
  const [A, B, C] = w.staff;
  const tpl = `st_rc_${w.s}`, sw = `sw_rc_${w.s}`;
  R.val(`insert into public.shift_templates(id, unit_id, staff_id, weekday, start_time, end_time) values (${q(tpl)}, ${q(w.unit)}, ${q(A.id)}, 1, '09:00', '13:00');
insert into public.swap_requests(id, unit_id, kind, requester_id, date, template_id, status) values (${q(sw)}, ${q(w.unit)}, 'cover', ${q(A.id)}, current_date + 3, ${q(tpl)}, 'open'); select 1;`);
  const body = `public.accept_swap(${q(sw)})::text`;
  const [a, b] = R.twoAtOnce(S(w, B.id, body, true), S(w, C.id, body, false));
  check('AS', '이긴 쪽 1 · 진 쪽 false', a.ok && a.v === 'true' && b.ok && b.v === 'false', `${show(a)} · ${show(b)}`);
  check('AS', '수락자 = 앞 세션', R.val(`select accepted_by from public.swap_requests where id = ${q(sw)}`) === B.id);
});

// ─────────────────────────────── 높음 · 서버 함수(방식 A) ───────────────────────────────
def('H1', 'create_store 15개 상한 직전에 동시 두 번(소유 수 세고 쓰기)', async (W) => {
  const w = await W({ staffN: 0 });
  // 14개로 채운다(무료 모드라 슬롯 갈래는 로컬에서 안 탄다 · 같은 v_owned 읽기라 상한 갈래로 잰다).
  const rows = Array.from({ length: 13 }, (_, i) => `(${q(`store_rc${i}_${w.s}`)}, 'RC${i}', ${q(w.owner.id)}, '카페·디저트', '{}'::jsonb)`).join(',');
  R.val(`insert into public.units(id, store_name, owner_id, industry, context) values ${rows};
insert into public.unit_members(user_id, unit_id, role) select ${q(w.owner.id)}, id, 'owner' from public.units where id like 'store_rc%_${w.s}'; select 1;`);
  const before = n(`select count(*) from public.unit_members where user_id = ${q(w.owner.id)} and role = 'owner'`);
  const body = `(select unit_id from public.create_store('RC 동시', '카페·디저트', null, null))`;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, body, true), S(w, w.owner.id, body, false));
  const after = n(`select count(*) from public.unit_members where user_id = ${q(w.owner.id)} and role = 'owner'`);
  check('H1', `셋업: 소유 14`, before === 14, `소유 ${before}`);
  check('H1', '이긴 쪽 1 · 진 쪽 store_limit_reached', a.ok && !b.ok && b.code === 'store_limit_reached', `${show(a)} · ${show(b)}`);
  check('H1', '소유 매장 = 15(상한)', after === 15, `소유 ${after}`);
});

def('H2', 'card_begin_subscribe 같은 사장 동시 두 번(pending 주문 exists)', async (W) => {
  const w = await W({ staffN: 0 });
  const ck = `ck_rc_${w.s}`;
  R.val(`insert into public.card_billing_keys(owner_id, customer_key) values (${q(w.owner.id)}, ${q(ck)}); select 1;`);
  const body = `(select order_id from public.card_begin_subscribe(${q(w.owner.id)}::uuid, ${q(ck)}, 'multi', 1, 'v1', false))`;
  const [a, b] = R.twoAtOnce(S(w, 'service', body, true), S(w, 'service', body, false));
  const pend = n(`select count(*) from public.card_payments where owner_id = ${q(w.owner.id)} and status = 'pending' and kind = 'first'`);
  check('H2', '이긴 쪽 1 · 진 쪽 payment_in_progress', a.ok && !b.ok && b.code === 'payment_in_progress', `${show(a)} · ${show(b)}`);
  check('H2', 'pending 첫 결제 주문 = 1', pend === 1, `주문 ${pend}`);
});

// ─────────────────────────────── 중간 · 서버 함수(방식 A) ───────────────────────────────
def('M4', 'apply_iap_event 새 EXPIRATION 과 옛 RENEWAL 이 겹침', async (W) => {
  const w = await W({ staffN: 0 });
  const txn = `rc_txn_${w.s}`;
  R.val(`insert into public.iap_subscriptions(owner_id, platform, product_id, store_count, original_transaction_id, status, current_period_end, last_event_at)
values (${q(w.owner.id)}, 'play', 'st_multi', 1, ${q(txn)}, 'active', now() + interval '20 days', now() - interval '1 hour'); select 1;`);
  const ts = (iv) => `jsonb_build_object('event', jsonb_build_object('event_timestamp_ms', (extract(epoch from now() ${iv}) * 1000)::bigint::text))`;
  const exp = `(public.apply_iap_event(${q(w.owner.id)}::uuid, 'play', ${q(txn)}, 'EXPIRATION', 'st_multi', 'multi', 1, now(), null, null, ${ts('')}) ->> 'type')`;
  const ren = `(public.apply_iap_event(${q(w.owner.id)}::uuid, 'play', ${q(txn)}, 'RENEWAL', 'st_multi', 'multi', 1, now() + interval '30 days', null, null, ${ts("- interval '30 minutes'")}) ->> 'type')`;
  const [a, b] = R.twoAtOnce(S(w, 'service', exp, true), S(w, 'service', ren, false));
  const st = R.val(`select status from public.iap_subscriptions where original_transaction_id = ${q(txn)}`);
  check('M4', '두 이벤트 처리', a.ok && b.ok, `${show(a)} · ${show(b)}`);
  check('M4', '최종 상태 = expired(늦게 커밋한 옛 RENEWAL 이 덮지 않는다)', st === 'expired', `status=${st}`);
});

async function secondStore(w) {
  const r = R.psqlRun(`${R.as(w.owner.id)}\nselect unit_id || '|' || invite_code from public.create_store('RC 2호', '카페·디저트', null, null);`);
  const line = (r.stdout ?? '').trim().split('\n').pop();
  if (r.status !== 0 || !line?.includes('|')) throw new Error(`2호점 생성 실패: ${r.stderr}`);
  const [unit, code] = line.split('|');
  return { unit, code };
}

def('M5a', 'delete_store 두 매장을 동시에 지움(마지막 매장 검사)', async (W) => {
  const w = await W({ staffN: 0 });
  const u2 = await secondStore(w);
  const del = (u) => `public.delete_store(${q(u)})::text`;
  const live = () => n(`select count(*) from public.units where owner_id = ${q(w.owner.id)} and deleted_at is null`);
  // ① 프로필이 앞 세션 매장(1호점)을 가리킬 때: 앞 세션이 프로필을 2호점으로 옮기며 외래키 검사가 2호점 행을 잠근다
  //   → 뒤 세션의 2호점 for update 가 기다린다(우연한 방어). ② 프로필이 이미 2호점이면 그 잠금이 없다.
  R.val(`update public.profiles set unit_id = ${q(u2.unit)}, active_unit_id = ${q(u2.unit)} where id = ${q(w.owner.id)}; select 1;`);
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, del(w.unit), true), S(w, w.owner.id, del(u2.unit), false));
  const left = live();
  check('M5a', '프로필 = 2호점 · 1호점·2호점 동시 지움: 진 쪽 last_store', a.ok && !b.ok && b.code === 'last_store', `${show(a)} · ${show(b)}`);
  check('M5a', '남은 매장 = 1', left === 1, `남은 ${left}`);
});

def('M5b', '안전 확인: delete_store 와 합류가 겹침(멤버 트리거가 units for update 로 다시 봄)', async (W) => {
  const w = await W({ staffN: 1, joinN: 0 });
  const u2 = await secondStore(w);
  const [st] = w.staff;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, `public.delete_store(${q(u2.unit)})::text`, true),
    S(w, st.id, `(select unit_id from public.join_by_invite(${q(u2.code)}, null))`, false));
  const ghost = n(`select count(*) from public.unit_members m join public.units u on u.id = m.unit_id where m.unit_id = ${q(u2.unit)} and u.deleted_at is not null`);
  check('M5b', '둘 중 하나만 성공', !(a.ok && b.ok), `${show(a)} · ${show(b)}`);
  check('M5b', '지운 매장의 멤버 행 = 0', ghost === 0, `멤버 ${ghost}`);
});

const claimBody = `(select c.id::text from public.submit_payment_claim('multi', null, 'RC입금', 1, null, 'v1', null, null, 1) c)`;

def('M6', '계좌이체 신고 ↔ 카드 구독 시작이 겹침', async (W) => {
  const w = await W({ staffN: 0 });
  const ck = `ck_rc_${w.s}`;
  R.val(`insert into public.card_billing_keys(owner_id, customer_key) values (${q(w.owner.id)}, ${q(ck)}); select 1;`);
  const begin = `(select order_id from public.card_begin_subscribe(${q(w.owner.id)}::uuid, ${q(ck)}, 'multi', 1, 'v1', false))`;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, claimBody, true), S(w, 'service', begin, false));
  check('M6', '신고가 먼저면 카드 시작 = payment_claim_pending', a.ok && !b.ok && b.code === 'payment_claim_pending', `${show(a)} · ${show(b)}`);
  const both = n(`select (select count(*) from public.payment_claims where claimed_by = ${q(w.owner.id)} and status = 'pending') + (select count(*) from public.card_payments where owner_id = ${q(w.owner.id)} and status = 'pending')`);
  check('M6', '열린 채널 = 1', both === 1, `신고+주문 ${both}`);
  // 역방향(순차 · 레이스 아님): 카드 주문이 진행 중일 때 신고를 받는가.
  R.val(`update public.payment_claims set status = 'rejected', reviewed_at = now(), reviewed_by = 'system' where claimed_by = ${q(w.owner.id)} and status = 'pending';
delete from public.card_payments where owner_id = ${q(w.owner.id)}; select 1;`);
  const o = R.psqlRun(`${R.as('service')}\nselect ${begin};`);
  const c = R.psqlRun(`\\set VERBOSITY verbose\n${R.as(w.owner.id)}\nselect ${claimBody};`);
  check('M6', '역방향(순차): 카드 주문 진행 중이면 신고 거절', o.status === 0 && c.status !== 0, c.status === 0 ? '신고가 들어갔다' : (c.stderr || '').match(/ERROR:\s+\S+:\s+(\S+)/)?.[1]);
});

def('L9a', 'submit_payment_claim 동시 두 번(23505 원문)', async (W) => {
  const w = await W({ staffN: 0 });
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, claimBody, true), S(w, w.owner.id, claimBody, false));
  check('L9a', '진 쪽이 DB 원문(23505)이 아닌 결과', a.ok && (b.ok || b.code !== '23505'), `${show(a)} · ${show(b)}`);
  check('L9a', '대기 신고 = 1', n(`select count(*) from public.payment_claims where claimed_by = ${q(w.owner.id)} and status = 'pending'`) === 1);
});

def('M7', 'change_my_password 실패 4회 뒤 동시 두 번', async (W) => {
  const w = await W({ staffN: 0 });
  R.val(`insert into public.password_change_failures(user_id) select ${q(w.owner.id)} from generate_series(1, 4); select 1;`);
  const body = `public.change_my_password('wrong-password', 'NewPass1234!')`;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, body, true), S(w, w.owner.id, body, false));
  const f = n(`select count(*) from public.password_change_failures where user_id = ${q(w.owner.id)}`);
  check('M7', '앞 = current_password_wrong · 뒤 = too_many_attempts', a.ok && a.v === 'current_password_wrong' && b.ok && b.v === 'too_many_attempts', `${show(a)} · ${show(b)}`);
  check('M7', '실패 기록 ≤ 5', f <= 5, `실패 ${f}`);
});

function seedLink(w) {
  const link = `el_rc_${w.s}`;
  R.val(`insert into public.space_entry_allowlist(user_id, note) values (${q(w.owner.id)}, 'qa_race') on conflict do nothing;
insert into public.edu_links(id, unit_id, token, title, created_by, expires_at) values (${q(link)}, ${q(w.unit)}, ${q(`tok_rc_${w.s}_xxxxxxxxxxxxxxxx`)}, 'RC 링크', ${q(w.owner.id)}, now() + interval '7 days'); select 1;`);
  const code = (k) => {
    const c = `RC${k}${w.s}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
    R.val(`insert into public.edu_link_handoffs(link_id, code_hash, expires_at) values (${q(link)}, encode(extensions.digest(${q(c)}, 'sha256'), 'hex'), now() + interval '10 minutes'); select 1;`);
    return c;
  };
  return { link, code };
}
const claim = (c) => `(select status from public.edu_link_claim_code(${q(c)}))`;

def('L6', '_edu_guest_for_me 한 계정이 이어받기 코드 2개를 동시에', async (W) => {
  const w = await W({ staffN: 1 });
  const { link, code } = seedLink(w);
  const c1 = code('A'), c2 = code('B');
  const [st] = w.staff;
  const [a, b] = R.twoAtOnce(S(w, st.id, claim(c1), true), S(w, st.id, claim(c2), false));
  const g = n(`select count(*) from public.edu_link_guests where link_id = ${q(link)} and claimed_by = ${q(st.id)}`);
  check('L6', '둘 다 claimed', a.ok && a.v === 'claimed' && b.ok && b.v === 'claimed', `${show(a)} · ${show(b)}`);
  check('L6', '내 손님 행 = 1', g === 1, `행 ${g}`);
});

def('EC', '안전 확인: 이어받기 코드 하나를 두 계정이 동시에(0583 for update)', async (W) => {
  const w = await W({ staffN: 2 });
  const { link, code } = seedLink(w);
  const c = code('C');
  const [s1, s2] = w.staff;
  const [a, b] = R.twoAtOnce(S(w, s1.id, claim(c), true), S(w, s2.id, claim(c), false));
  check('EC', '앞 = claimed · 뒤 = invalid_code', a.ok && a.v === 'claimed' && b.ok && b.v === 'invalid_code', `${show(a)} · ${show(b)}`);
  check('EC', '코드 사용자 = 앞 계정 · 손님 행 = 1', R.val(`select used_by from public.edu_link_handoffs where link_id = ${q(link)}`) === s1.id
    && n(`select count(*) from public.edu_link_guests where link_id = ${q(link)}`) === 1);
});

def('AM', '안전 확인: _admit_member 같은 직원이 두 기기에서 동시에 합류(0346 advisory)', async (W) => {
  const w = await W({ staffN: 1, joinN: 0 });
  const [st] = w.staff;
  const body = `(select unit_id from public.join_by_invite(${q(w.code)}, null))`;
  const [a, b] = R.twoAtOnce(S(w, st.id, body, true), S(w, st.id, body, false));
  check('AM', '앞 = 합류 · 뒤 = already_member', a.ok && !b.ok && b.code === 'already_member', `${show(a)} · ${show(b)}`);
  check('AM', '멤버 행 1 · 합류 알림 1', n(`select count(*) from public.unit_members where unit_id = ${q(w.unit)} and user_id = ${q(st.id)}`) === 1
    && n(`select count(*) from public.member_notices where unit_id = ${q(w.unit)} and kind = 'member_joined'`) === 1);
});
def('AMs', '안전 확인: 무료 좌석 마지막 한 자리에 두 직원이 동시에 합류', async (W) => {
  // _staff_seat_full 은 billing_free_mode() 면 바로 false 다. 잴 동안만 끄고 되돌린다
  //   (qa-scheduler-recheck ①·qa-quiz-resend (m)·qa-store-slots 와 같은 방식 · 로컬 전용).
  const cap = n('select public.free_staff_cap()');
  const w = await W({ staffN: cap + 1, joinN: cap - 1 });
  R.val(`update public.unit_subscriptions set status = 'active', plan = 'free', trial_ends_at = null, paid_until = null where unit_id = ${q(w.unit)}; select 1;`);
  const [x, y] = w.staff.slice(cap - 1);
  const body = `(select unit_id from public.join_by_invite(${q(w.code)}, null))`;
  const was = R.val(`select value from public.app_config where key = 'billing_free_mode'`);
  let a, b;
  try {
    if (was === 'true') R.val(`update public.app_config set value = 'false' where key = 'billing_free_mode'; select 1;`);
    check('AMs', `셋업: 무료 · 직원 ${cap - 1}/${cap} · 아직 안 참`, R.val(`select public.effective_plan(${q(w.unit)}) || '/' || public._staff_seat_full(${q(w.unit)})`) === 'free/false');
    [a, b] = R.twoAtOnce(S(w, x.id, body, true), S(w, y.id, body, false));
  } finally {
    if (was === 'true') R.val(`update public.app_config set value = 'true' where key = 'billing_free_mode'; select 1;`);
  }
  const staff = n(`select count(*) from public.unit_members where unit_id = ${q(w.unit)} and role in ('junior', 'manager')`);
  check('AMs', '앞 = 합류 · 뒤 = staff_limit', a.ok && !b.ok && b.code === 'staff_limit', `${show(a)} · ${show(b)}`);
  check('AMs', `직원 = ${cap}(무료 상한)`, staff === cap, `직원 ${staff}`);
});

def('L7', 'cap_pending_escalations 대기 9개에서 동시 두 개', async (W) => {
  const w = await W({ staffN: 1 });
  const [st] = w.staff;
  // junior_id 는 stamp_author 트리거가 auth.uid() 로 찍는다 → 직원 세션으로 심는다.
  const sd = R.psqlRun(`${R.as(st.id)}\ninsert into public.unknown_queries(id, unit_id, junior_id, query_text, status) select 'uq_rc' || g || '_${w.s}', ${q(w.unit)}, ${q(st.id)}, 'RC 질문 ' || g, 'pending_owner_answer' from generate_series(1, 9) g;`);
  if (sd.status !== 0) throw new Error(`대기 9개 심기 실패: ${sd.stderr}`);
  check('L7', '셋업: 대기 9', n(`select count(*) from public.unknown_queries where unit_id = ${q(w.unit)} and junior_id = ${q(st.id)} and status = 'pending_owner_answer'`) === 9);
  const ins = (k) => `insert into public.unknown_queries(id, unit_id, junior_id, query_text, status) values ('uq_rc${k}_${w.s}', ${q(w.unit)}, ${q(st.id)}, 'RC 동시 ${k}', 'pending_owner_answer') returning id`;
  const [a, b] = R.twoAtOnce(S(w, st.id, ins('A'), true), S(w, st.id, ins('B'), false));
  const c = n(`select count(*) from public.unknown_queries where unit_id = ${q(w.unit)} and junior_id = ${q(st.id)} and status = 'pending_owner_answer'`);
  check('L7', '이긴 쪽 1 · 진 쪽 too_many_pending', a.ok && !b.ok && b.code === 'too_many_pending', `${show(a)} · ${show(b)}`);
  check('L7', '대기 질문 ≤ 10', c <= 10, `대기 ${c}`);
});

def('L8', 'put_schedule_notice 같은 알림 동시 두 번', async (W) => {
  const w = await W({ staffN: 1 });
  const [st] = w.staff;
  const body = `public.put_schedule_notice(${q(w.unit)}, ${q(st.id)}, 'swap_confirmed', 'RC 확정', 'RC 같은 본문')::text`;
  const [a, b] = R.twoAtOnce(S(w, 'postgres', body, true), S(w, 'postgres', body, false));
  const c = n(`select count(*) from public.member_notices where unit_id = ${q(w.unit)} and user_id = ${q(st.id)} and kind = 'swap_confirmed'`);
  check('L8', '둘 다 true', a.ok && b.ok, `${show(a)} · ${show(b)}`);
  check('L8', '알림 = 1', c === 1, `알림 ${c}`);
});

// ─────────────────────────────── 직접 쓰기(방식 B · 실세션 · RLS) ───────────────────────────────
const ok = (r) => !r.error;
const rows = (r) => (r.error ? -1 : (r.data ?? []).length);

def('H3', '할 일 완료를 두 직원이 동시에 · 그 뒤 완료자가 해제(K5-b1)', async (W) => {
  const w = await W({ staffN: 2 });
  const [A, B] = w.staff;
  let mismatch = 0, orphan = 0, errs = 0;
  const done = (who, tpl) => Promise.all([
    who.c.from('work_done').upsert({ unit_id: w.unit, work_date: today, template_id: tpl, room_id: null, data: { by: who.id, byName: who.key, at: new Date().toISOString() } }, { ignoreDuplicates: true }).select('template_id'),
    who.c.from('work_feed').upsert({ id: `fdone_${today}_${tpl}`, unit_id: w.unit, feed_date: today, room_id: null,
      data: { id: `fdone_${today}_${tpl}`, date: today, kind: 'task_done', text: `${who.key} 완료`, authorId: who.id, authorName: who.key, authorRole: 'junior', createdAt: new Date().toISOString(), refId: tpl } }, { ignoreDuplicates: true }),
  ]);
  for (let i = 0; i < ROUNDS; i++) {
    const tpl = `wt_rc${i}_${w.s}`;
    R.val(`insert into public.work_templates(id, unit_id, section, text) values (${q(tpl)}, ${q(w.unit)}, 'open', 'RC 할 일 ${i}'); select 1;`);
    const rs = await Promise.all([done(A, tpl), done(B, tpl)]);
    if (rs.flat().some((r) => r.error)) errs++;
    const by = R.val(`select data->>'by' from public.work_done where unit_id = ${q(w.unit)} and template_id = ${q(tpl)}`);
    const au = R.val(`select data->>'authorId' from public.work_feed where id = ${q(`fdone_${today}_${tpl}`)}`);
    if (by !== au) mismatch++;
    // 완료자가 해제한다(클라 = 두 요청 Promise.all).
    const me = by === A.id ? A : B;
    await Promise.all([
      me.c.from('work_done').delete().eq('unit_id', w.unit).eq('work_date', today).eq('template_id', tpl).select('template_id'),
      me.c.from('work_feed').delete().eq('id', `fdone_${today}_${tpl}`).select('id'),
    ]);
    if (n(`select count(*) from public.work_feed where id = ${q(`fdone_${today}_${tpl}`)}`) > 0) orphan++;
  }
  check('H3', `요청 오류 0`, errs === 0, `오류 라운드 ${errs}`);
  check('H3', `완료 기록 ↔ 완료 글 이름 일치(${ROUNDS}회)`, mismatch === 0, `어긋남 ${mismatch}/${ROUNDS}`);
  check('H3', `해제 뒤 남은 완료 글 = 0(${ROUNDS}회)`, orphan === 0, `고아 ${orphan}/${ROUNDS}`);
});

async function managerWorld(W, staffN) {
  const w = await W({ staffN });
  const M = w.staff[staffN - 1];
  R.val(`update public.unit_members set role = 'manager' where unit_id = ${q(w.unit)} and user_id = ${q(M.id)}; insert into public.unit_kept_seats(unit_id, user_id) values (${q(w.unit)}, ${q(M.id)}) on conflict do nothing; select 1;`);
  return { w, M };
}

def('H4', '제안 승인 두 관리자 동시 · 승인과 반려 동시', async (W) => {
  const { w, M } = await managerWorld(W, 2);
  const [P] = w.staff;
  const seed = (id) => R.val(`insert into public.playbook_suggestions(id, unit_id, kind, proposer_id, proposer_name, text, status) values (${q(id)}, ${q(w.unit)}, 'new', ${q(P.id)}, 'RC', 'RC 제안', 'pending'); select 1;`);
  const approve = (who, sug, tag) => (async () => {
    const e = await who.c.from('playbook_entries').insert({ id: `pb_rc_${tag}_${w.s}`, unit_id: w.unit, category: 'Routine', title: `RC 승인 ${tag}`, status: 'published' });
    const u = await who.c.from('playbook_suggestions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: who.id }).eq('id', sug).select('id');
    return { e, u };
  })();
  const reject = (who, sug) => who.c.from('playbook_suggestions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: who.id }).eq('id', sug).select('id');
  let dupEntry = 0, bothWin = 0, bothWinAR = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const sug = `sug_rc${i}_${w.s}`; seed(sug);
    const [x, y] = await Promise.all([approve(w.owner, sug, `o${i}`), approve(M, sug, `m${i}`)]);
    if ([x.e, x.u, y.e, y.u].some((r) => r.error)) errs++;
    if (rows(x.u) === 1 && rows(y.u) === 1) bothWin++;
    if (n(`select count(*) from public.playbook_entries where unit_id = ${q(w.unit)} and title in ('RC 승인 o${i}', 'RC 승인 m${i}')`) > 1) dupEntry++;
    const sug2 = `sug_rcr${i}_${w.s}`; seed(sug2);
    const [ra, rr] = await Promise.all([approve(w.owner, sug2, `a${i}`), reject(M, sug2)]);
    if (rows(ra.u) === 1 && rows(rr) === 1) bothWinAR++;
  }
  check('H4', '요청 오류 0', errs === 0, `오류 라운드 ${errs}`);
  check('H4', `동시 승인: 이긴 쪽 1(${ROUNDS}회)`, bothWin === 0, `둘 다 이김 ${bothWin}/${ROUNDS}`);
  check('H4', `동시 승인: 노하우 1건(${ROUNDS}회)`, dupEntry === 0, `2건 ${dupEntry}/${ROUNDS}`);
  check('H4', `승인·반려 동시: 이긴 쪽 1(${ROUNDS}회 · 알림 둘 다 나감)`, bothWinAR === 0, `둘 다 이김 ${bothWinAR}/${ROUNDS}`);
});

def('M1', '출근 두 기기에서 동시에(열린 기록)', async (W) => {
  const w = await W({ staffN: 1 });
  const [A] = w.staff;
  const A2 = L.clientFor(A.id, A.email);
  let dup = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    R.val(`update public.attendance set check_out = now() where unit_id = ${q(w.unit)} and check_out is null; select 1;`);
    const ins = (c, k) => c.from('attendance').upsert({ id: `att_${A.id}_${Date.now()}_${i}${k}`, staff_id: A.id, date: today, check_in: new Date().toISOString(), check_out: null, work_minutes: 0, unit_id: w.unit }).select('id');
    const rs = await Promise.all([ins(A.c, 'a'), ins(A2, 'b')]);
    if (rs.some((r) => r.error)) errs++;
    if (n(`select count(*) from public.attendance where unit_id = ${q(w.unit)} and staff_id = ${q(A.id)} and check_out is null`) > 1) dup++;
  }
  check('M1', '요청 오류 0', errs === 0, `오류 ${errs}`);
  check('M1', `열린 기록 ≤ 1(${ROUNDS}회)`, dup === 0, `2건 ${dup}/${ROUNDS}`);
});

def('M2', '퇴근과 관리자 출근시각 수정이 동시에(행 전체 upsert)', async (W) => {
  const w = await W({ staffN: 1 });
  const [A] = w.staff;
  let lost = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const id = `att_rc${i}_${w.s}`;
    const open = { id, staff_id: A.id, date: today, check_in: new Date(Date.now() - 4 * 3600e3).toISOString(), check_out: null, work_minutes: 0, unit_id: w.unit };
    R.val(`insert into public.attendance(id, staff_id, date, check_in, unit_id) values (${q(id)}, ${q(A.id)}, ${q(today)}, ${q(open.check_in)}, ${q(w.unit)}); select 1;`);
    const rs = await Promise.all([
      A.c.from('attendance').upsert({ ...open, check_out: new Date().toISOString(), work_minutes: 240 }).select('id'),
      w.owner.c.from('attendance').upsert({ ...open, check_in: new Date(Date.now() - 5 * 3600e3).toISOString(), edited_by: w.owner.id }).select('id'),
    ]);
    if (rs.some((r) => r.error)) errs++;
    const row = R.val(`select (check_out is not null)::text || '/' || (edited_by is not null)::text from public.attendance where id = ${q(id)}`);
    if (row !== 'true/true') lost++;
  }
  check('M2', '요청 오류 0', errs === 0, `오류 ${errs}`);
  check('M2', `두 변경이 다 남는다(${ROUNDS}회)`, lost === 0, `한쪽 사라짐 ${lost}/${ROUNDS}`);
});

def('M3', '교대 요청 두 기기에서 같은 근무에 동시에', async (W) => {
  const w = await W({ staffN: 1 });
  const [A] = w.staff;
  const A2 = L.clientFor(A.id, A.email);
  let dup = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const tpl = `st_rc${i}_${w.s}`;
    R.val(`insert into public.shift_templates(id, unit_id, staff_id, weekday, start_time, end_time) values (${q(tpl)}, ${q(w.unit)}, ${q(A.id)}, 1, '09:00', '13:00'); select 1;`);
    const ins = (c, k) => c.from('swap_requests').insert({ id: `swap_rc${i}${k}_${w.s}`, unit_id: w.unit, kind: 'cover', requester_id: A.id, date: kstDay(3), template_id: tpl, note: '', status: 'open', accepted_by: null });
    const rs = await Promise.all([ins(A.c, 'a'), ins(A2, 'b')]);
    if (rs.some((r) => r.error)) errs++;
    if (n(`select count(*) from public.swap_requests where template_id = ${q(tpl)} and status = 'open'`) > 1) dup++;
  }
  check('M3', '요청 오류 0', errs === 0, `오류 ${errs}`);
  check('M3', `같은 근무의 열린 요청 ≤ 1(${ROUNDS}회)`, dup === 0, `2건 ${dup}/${ROUNDS}`);
});

def('M13', '받은 질문 보내기 두 직원 동시(유사 수 +1 · 첫 질문 2행)', async (W) => {
  const w = await W({ staffN: 2 });
  const [A, B] = w.staff;
  let lostBump = 0, dupRow = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const id = `uq_rcb${i}_${w.s}`;
    R.val(`insert into public.unknown_queries(id, unit_id, junior_id, query_text, status, similar_queries_count) values (${q(id)}, ${q(w.unit)}, ${q(A.id)}, 'RC 같은 질문 ${i}', 'pending_owner_answer', 0); select 1;`);
    const bump = (c) => c.from('unknown_queries').update({ similar_queries_count: 1 }).eq('id', id).select('id');   // 클라 = 로컬 값(0) + 1
    const rs = await Promise.all([bump(A.c), bump(B.c)]);
    if (rs.some((r) => r.error)) errs++;
    if (n(`select similar_queries_count from public.unknown_queries where id = ${q(id)}`) !== 2) lostBump++;
    const ins = (who, k) => who.c.from('unknown_queries').insert({ id: `uq_rcn${i}${k}_${w.s}`, unit_id: w.unit, junior_id: who.id, junior_name: who.key, query_text: `RC 새 질문 ${i}`, status: 'pending_owner_answer' });
    const r2 = await Promise.all([ins(A, 'a'), ins(B, 'b')]);
    if (r2.some((r) => r.error)) errs++;
    if (n(`select count(*) from public.unknown_queries where unit_id = ${q(w.unit)} and query_text = 'RC 새 질문 ${i}' and status = 'pending_owner_answer'`) > 1) dupRow++;
  }
  check('M13', '요청 오류 0', errs === 0, `오류 ${errs}`);
  check('M13', `유사 수가 2 늘어난다(${ROUNDS}회)`, lostBump === 0, `1만 늘어남 ${lostBump}/${ROUNDS}`);
  check('M13', `같은 첫 질문 = 1행(${ROUNDS}회)`, dupRow === 0, `2행 ${dupRow}/${ROUNDS}`);
});

def('M14', '공지 다시 올리기(남의 공지) · 공지 지우기와 댓글이 겹침', async (W) => {
  const w = await W({ staffN: 1 });
  const [A] = w.staff;
  const note = (id, author, role) => ({ id, unit_id: w.unit, feed_date: today, room_id: null,
    data: { id, date: today, kind: 'notice', text: 'RC 같은 공지', authorId: author.id, authorName: author.key, authorRole: role, createdAt: new Date().toISOString() } });
  const nid = `f_rcn_${w.s}`;
  const r0 = await w.owner.c.from('work_feed').insert(note(nid, w.owner, 'owner'));
  // 직원이 같은 문구로 올린다 → 클라는 문구가 같은 공지(사장 것)에 upsert 한다.
  const r1 = await A.c.from('work_feed').upsert({ ...note(nid, A, 'junior'), data: { ...note(nid, A, 'junior').data, authorId: w.owner.id } });
  check('M14', '셋업: 사장 공지', ok(r0), r0.error?.message);
  check('M14', '남의 같은 문구 공지에 다시 올리기가 실패하지 않는다', ok(r1), r1.error ? `${r1.error.code}` : '');
  let orphan = 0, errs = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const id = `f_rcd${i}_${w.s}`;
    await w.owner.c.from('work_feed').insert(note(id, w.owner, 'owner'));
    const cm = { id: `f_rcc${i}_${w.s}`, unit_id: w.unit, feed_date: today, room_id: null,
      data: { id: `f_rcc${i}_${w.s}`, date: today, kind: 'comment', text: 'RC 댓글', authorId: A.id, authorName: A.key, authorRole: 'junior', createdAt: new Date().toISOString(), refId: id } };
    const rs = await Promise.all([w.owner.c.from('work_feed').delete().eq('id', id).select('id'), A.c.from('work_feed').insert(cm)]);
    if (rs.some((r) => r.error)) errs++;
    if (n(`select count(*) from public.work_feed where unit_id = ${q(w.unit)} and data->>'refId' = ${q(id)}`) > 0) orphan++;
  }
  check('M14', '요청 오류 0', errs === 0, `오류 ${errs}`);
  check('M14', `공지를 지운 뒤 남은 댓글 = 0(${ROUNDS}회)`, orphan === 0, `고아 ${orphan}/${ROUNDS}`);
});

// ─────────────────────────────── S1 이 더한 케이스(2026-11-12 · 0600~0604) ───────────────────────────────
def('H2b', 'card_begin_subscribe 결과를 모르는 20분 전 주문이 있을 때(나이 무관 · 사용자 결정 11-12)', async (W) => {
  const w = await W({ staffN: 0 });
  const ck = `ck_rc_${w.s}`;
  R.val(`insert into public.card_billing_keys(owner_id, customer_key) values (${q(w.owner.id)}, ${q(ck)});
insert into public.card_payments(order_id, owner_id, kind, plan, store_count, amount_krw, livemode, order_name, created_at)
values (${q(`FPrcold${w.s}`)}, ${q(w.owner.id)}, 'first', 'multi', 1, 31900, false, 'RC 옛 주문', now() - interval '20 minutes'); select 1;`);
  const r = R.psqlRun(`\\set VERBOSITY verbose\n${R.as('service')}\nselect order_id from public.card_begin_subscribe(${q(w.owner.id)}::uuid, ${q(ck)}, 'multi', 1, 'v1', false);`);
  const code = (r.stderr || '').match(/ERROR:\s+\S+:\s+(\S+)/)?.[1];
  check('H2b', '새 주문 거절 = payment_in_progress', r.status !== 0 && code === 'payment_in_progress', r.status === 0 ? '새 주문이 생겼다' : code);
  check('H2b', 'pending 첫 결제 주문 = 1', n(`select count(*) from public.card_payments where owner_id = ${q(w.owner.id)} and status = 'pending' and kind = 'first'`) === 1);
});

def('L24', 'rename_store 14일 2회 한도 직전에 동시 두 번', async (W) => {
  const w = await W({ staffN: 0 });
  R.val(`update public.units set rename_events = array[now() - interval '1 day'] where id = ${q(w.unit)}; select 1;`);
  const body = `public.rename_store('RC 새 이름')::text`;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, body, true), S(w, w.owner.id, body, false));
  const ev = n(`select coalesce(array_length(rename_events, 1), 0) from public.units where id = ${q(w.unit)}`);
  check('L24', '앞 = 남은 0 · 뒤 = rename_limit', a.ok && a.v === '0' && !b.ok && b.code === 'rename_limit', `${show(a)} · ${show(b)}`);
  check('L24', '14일 기록 = 2(한도)', ev === 2, `기록 ${ev}`);
});

def('L9b', 'request_shift_time 같은 근무·같은 날 동시 두 번(23505 원문)', async (W) => {
  const w = await W({ staffN: 1 });
  const [A] = w.staff;
  const tpl = `st_rq_${w.s}`;
  R.val(`insert into public.shift_templates(id, unit_id, staff_id, weekday, shift_date, start_time, end_time)
values (${q(tpl)}, ${q(w.unit)}, ${q(A.id)}, null, public.kst_today() + 3, '09:00', '13:00'); select 1;`);
  const body = `public.request_shift_time(${q(tpl)}, public.kst_today() + 3, '10:00', '14:00', null)`;
  const [a, b] = R.twoAtOnce(S(w, A.id, body, true), S(w, A.id, body, false));
  const pend = n(`select count(*) from public.shift_change_requests where template_id = ${q(tpl)} and status = 'pending'`);
  check('L9b', '둘 다 성공(뒤 요청이 앞 요청을 닫고 새로 낸다)', a.ok && b.ok, `${show(a)} · ${show(b)}`);
  check('L9b', '대기 요청 = 1', pend === 1, `대기 ${pend}`);
  R.val(`delete from public.shift_change_requests where template_id = ${q(tpl)}; delete from public.shift_templates where id = ${q(tpl)}; select 1;`);
});

def('L9c', 'set_my_marketing_consent 켜기 동시 두 번(23505 원문)', async (W) => {
  const w = await W({ staffN: 0 });
  R.val(`update public.user_consents set withdrawn_at = now() where user_id = ${q(w.owner.id)} and item = 'marketing' and withdrawn_at is null; select 1;`);
  const body = `(public.set_my_marketing_consent(true, '2026-11-12')->>'on')`;
  const [a, b] = R.twoAtOnce(S(w, w.owner.id, body, true), S(w, w.owner.id, body, false));
  const act = n(`select count(*) from public.user_consents where user_id = ${q(w.owner.id)} and item = 'marketing' and withdrawn_at is null`);
  check('L9c', '둘 다 성공', a.ok && b.ok, `${show(a)} · ${show(b)}`);
  check('L9c', '유효 동의 = 1', act === 1, `행 ${act}`);
  R.val(`delete from public.user_consents where user_id = ${q(w.owner.id)} and item = 'marketing'; select 1;`);
});

// ─────────────────────────────── 엣지 · OTP 문자(H5) ───────────────────────────────
// 로컬 엣지가 떠 있어야 한다: `npx -y supabase@2.122.1 functions serve otp --no-verify-jwt --env-file <파일>`.
//   env 파일 = 가짜 SOLAPI_API_KEY·SECRET·FROM + HTTPS_PROXY=http://127.0.0.1:9 (밖으로 나가는 요청이 연결 거부로 끝난다 · 문자 0통).
//   그러면 문자 단계까지 간 요청은 502 send_failed 로 돌아온다. 그 수 = 실제였다면 나갔을 문자 수.
def('H5', 'OTP 문자 발송 같은 번호로 동시 5번', async () => {
  const url = process.env.QA_OTP_FN_URL ?? `${env.URL_}/functions/v1/otp`;
  const phone = `0104${String(Date.now()).slice(-7)}`;
  try {
    const ping = await fetch(url, { method: 'OPTIONS' }).catch(() => null);
    if (!ping) { check('H5', '셋업: 로컬 엣지 otp', false, `${url} 응답 없음`); return; }
    const send = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ANON}`, apikey: env.ANON },
      body: JSON.stringify({ action: 'send', phone }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
    const rs = await Promise.all(Array.from({ length: 5 }, send));
    const reasons = rs.map((r) => r.j.reason ?? (r.j.ok ? 'ok' : r.s));
    const reached = reasons.filter((x) => x === 'send_failed' || x === 'ok').length;
    check('H5', '셋업: 문자 단계 응답이 연결 거부(send_failed)로 온다', !reasons.includes('not_configured') && reached >= 1, reasons.join(','));
    check('H5', '문자 단계까지 간 요청 = 1(나머지 cooldown)', reached === 1, `문자 단계 ${reached}/5 · ${reasons.join(',')}`);
  } finally {
    R.val(`delete from public.phone_otps where phone = ${q(phone)}; select 1;`);
    check('H5', '정리 뒤 남은 행 = 0', n(`select count(*) from public.phone_otps where phone = ${q(phone)}`) === 0);
  }
});

// H5c(S1): IP 분당 3건 제한을 이 IP 에서만 잠깐 풀고 잰다 → 번호 단위 차지(0603 otp_claim_send)만으로 1통인지 본다.
//   IP 행은 먼저 한 번 보내 만든다(다른 번호). 그 IP 의 창을 지금으로 두고 n 을 크게 낮춘다. 1분 뒤 창이 새로 열리면 원래대로다.
def('H5c', 'OTP 문자 발송 같은 번호로 동시 5번 · IP 제한 없이', async () => {
  const url = process.env.QA_OTP_FN_URL ?? `${env.URL_}/functions/v1/otp`;
  const phone = `0105${String(Date.now()).slice(-7)}`, warm = `0106${String(Date.now()).slice(-7)}`;
  const send = (p) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ANON}`, apikey: env.ANON },
    body: JSON.stringify({ action: 'send', phone: p }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
  try {
    const w0 = await send(warm).catch(() => null);
    if (!w0) { check('H5c', '셋업: 로컬 엣지 otp', false, `${url} 응답 없음`); return; }
    R.val(`update public.otp_ip_hits set n = -100, window_start = now() where ip = (select ip from public.otp_ip_hits order by window_start desc limit 1); select 1;`);
    const rs = await Promise.all(Array.from({ length: 5 }, () => send(phone)));
    const reasons = rs.map((r) => r.j.reason ?? (r.j.ok ? 'ok' : r.s));
    const reached = reasons.filter((x) => x === 'send_failed' || x === 'ok').length;
    check('H5c', '셋업: IP 제한에 걸린 요청 0 · 문자 단계 응답 1개 이상', !reasons.includes('rate_limited') && !reasons.includes('not_configured') && reached >= 1, reasons.join(','));
    check('H5c', '문자 단계까지 간 요청 = 1(나머지 cooldown)', reached === 1, `문자 단계 ${reached}/5 · ${reasons.join(',')}`);
  } finally {
    R.val(`delete from public.phone_otps where phone in (${q(phone)}, ${q(warm)}); select 1;`);
    check('H5c', '정리 뒤 남은 행 = 0', n(`select count(*) from public.phone_otps where phone in (${q(phone)}, ${q(warm)})`) === 0);
  }
});

// ─────────────────────────────── 실행 ───────────────────────────────

for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  console.log(`\n[${c.id}] ${c.name}`);
  const worlds = [];
  const W = async (opts) => { const w = await makeWorld(L, env, { tag: 'rc', courses: [], ...opts }); worlds.push(w); return w; };
  try { await c.run(W); } catch (e) { check(c.id, '셋업·실행', false, e.message.slice(0, 200)); }
  try {
    const cl = await cleanup(worlds);

    if (worlds.length) check(c.id, '정리 뒤 남은 행 = 0', cl.left === 0, cl.detail.join(' '));
  } catch (e) { check(c.id, '정리', false, e.message.slice(0, 200)); }
}

console.log('\n── 케이스별 ❌ ──');
const red = {};
for (const r of t.rows) if (r.ok === false) red[r.id] = (red[r.id] ?? 0) + 1;
console.log(Object.keys(red).length ? Object.entries(red).map(([k, v]) => `${k}:${v}`).join(' · ') : '없음');
console.log(`\n${t.fail ? 'RED' : 'GREEN'} — pass ${t.pass} · fail ${t.fail} · skip ${t.skip} (AI 호출 0회)`);
process.exitCode = t.fail ? 1 : 0;
