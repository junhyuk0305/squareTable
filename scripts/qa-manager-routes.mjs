#!/usr/bin/env node
// qa-manager-routes.mjs — 매니저 막다른 길(F-2 · 마스터 계획 P3-7) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// 규칙: 매니저에게는 허용 목록(roles.ts MANAGER_OWNER_ROUTES)이나 /junior/* 로 가는 것만 보이거나 온다.
//   허용 목록과 0201 은 그대로다. 매니저 쪽 표면을 좁힌다.
//   (1) routeForRole(url, role) 하나 — 푸시 탭 보정. 예전엔 nativepush.ts·usePushBootstrap.ts 에 복제본이
//       있었고, 매니저의 /junior/chat 을 없는 /owner/chat 으로 바꿨다.
//   (2) 매니저 알림 목록 — 합류 신청·제안 검토·사장 알림·입금 결과는 사장 전용 화면이라 뺀다.
//       질문과 내 제안 결과는 물어보기 탭(/junior/chat)으로. 배지는 목록과 같은 배열에서 센다.
//   (3) 노하우 빈 결과의 매니저 전용 "물어보기"(goAsk·onAsk) 삭제 · 매니저 지정 푸시 url = /junior/home.
// 실행: node scripts/qa-manager-routes.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync } from 'node:fs';
import { installNotifHooks } from './lib/qa-notif-hooks.mjs';

installNotifHooks();

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const roles = await import('../src/lib/utils/roles.ts');
const { routeForRole, managerMayOpen } = roles;
const route = (u, r) => (typeof routeForRole === 'function' ? routeForRole(u, r) : '(함수 없음)');

console.log('\n■ (1) routeForRole(url, role) — roles.ts 하나');
check('roles.ts 가 routeForRole 을 낸다', typeof routeForRole === 'function');
const M = 'manager';
for (const [u, want] of [
  ['/junior/chat', '/junior/chat'],
  ['/junior/home', '/junior/home'],
  ['/junior/work', '/owner/work'],
  ['/junior/schedule', '/owner/schedule'],
  ['/junior/notifications', '/owner/notifications'],
  // 0315: 서버가 허용하던 받은 질문·제안 승인·노하우·퀴즈를 매니저에게 연다.
  ['/owner/inbox', '/owner/inbox'],
  ['/owner/suggestions', '/owner/suggestions'],
  ['/owner/categories', '/owner/categories'],
  ['/owner/training', '/owner/training'],
  ['/owner/quiz/abc', '/owner/quiz/abc'],
  ['/owner/payroll', '/junior/home'],
  ['/owner/import-knowhow', '/junior/home'],
  ['/owner/store-config', '/junior/home'],
  ['/owner/staff', '/junior/home'],
  ['/owner/dashboard', '/junior/home'],
  ['/owner/work', '/owner/work'],
  ['/owner/schedule', '/owner/schedule'],
  ['/owner/timesheet/abc', '/owner/timesheet/abc'],
]) {
  check(`매니저 ${u} → ${want}`, route(u, M) === want, `got=${route(u, M)}`);
}
// 사장·직원은 예전 규칙 그대로(회귀 0).
for (const [u, r, want] of [
  ['/junior/work', 'owner', '/owner/work'],
  ['/owner/staff', 'owner', '/owner/staff'],
  ['/billing', 'owner', '/billing'],
  ['/owner/schedule', 'junior', '/junior/schedule'],
  ['/junior/chat', 'junior', '/junior/chat'],
]) {
  check(`${r} ${u} → ${want}`, route(u, r) === want, `got=${route(u, r)}`);
}
// 알림 주소 전부 — 10-16 P1 부터 notify.ts 는 주소를 레지스트리(NOTIF[kind].route)에서 받는다. 레지스트리를 직접 돈다.
//   매니저 결과는 허용 목록이거나 /junior/* 다. 판정은 경로만(?id 는 routeForRole 이 그대로 싣는다).
const notifySrc = read('src/lib/push/notify.ts');
const { NOTIF } = await import('../src/lib/notif/registry.ts');
const urls = [...new Set(Object.values(NOTIF).flatMap((spec) => ['owner', 'junior'].flatMap((sf) => [spec.route(sf), spec.route(sf, 'x1')])))]
  .filter((u) => /^\/(owner|junior)\//.test(u));
check('레지스트리에서 알림 주소를 읽었다', urls.length >= 8, show(urls));
const pathOf = (u) => String(u).split(/[?#]/)[0];
const bad = urls.filter((u) => {
  const to = route(u, M);
  return !(to.startsWith('/junior/') || managerMayOpen(pathOf(to)));
});
check('매니저: 모든 푸시 url 이 열 수 있는 곳으로 간다', typeof routeForRole === 'function' && bad.length === 0, show(bad.map((u) => `${u}→${route(u, M)}`)));

console.log('\n■ (1-b) 복제본 두 개를 지웠다');
// P5-4 뒤 앱 푸시 탭은 nativepush.ts → pushTapPlan(pushTap.ts) → routeForRole(dest, session.role) 이다.
//   다른 매장 알림은 useStoreEntryStore.enter 가 전환 뒤 역할로 routeForRole 을 거친다.
const importsRoles = (code) => /import\s*\{[^}]*\brouteForRole\b[^}]*\}\s*from\s*'@\/lib\/utils\/roles'/.test(code);
for (const f of ['src/lib/push/nativepush.ts', 'src/lib/push/pushTap.ts', 'src/lib/push/usePushBootstrap.ts', 'src/lib/store/useStoreEntryStore.ts']) {
  // 주석 걷기는 '/junior/*' 같은 경로 글자를 블록 주석으로 오인한다. 정의·import 는 원문에서 본다.
  check(`${f}: 자체 routeForRole 정의가 없다`, !/function\s+routeForRole\s*\(/.test(read(f)));
}
{
  const nat = read('src/lib/push/nativepush.ts');
  check('nativepush.ts: pushTap.ts 의 pushTapPlan 에 세션 역할을 넘긴다',
    /import\s*\{[^}]*\bpushTapPlan\b[^}]*\}\s*from\s*'@\/lib\/push\/pushTap'/.test(nat)
    && /useSessionStore\.getState\(\)/.test(nat) && /pushTapPlan\([^)]*role:\s*s\.role/.test(nat));
  const tap = read('src/lib/push/pushTap.ts');
  check('pushTap.ts: roles.ts 의 routeForRole 을 쓴다', importsRoles(tap) && /routeForRole\(dest,\s*session\.role\)/.test(tap));
  for (const f of ['src/lib/push/usePushBootstrap.ts', 'src/lib/store/useStoreEntryStore.ts']) {
    const code = read(f);
    check(`${f}: roles.ts 의 routeForRole 을 쓴다`, importsRoles(code)
      && /routeForRole\([^)]*,\s*useSessionStore\.getState\(\)\.role\)/.test(code));
  }
}

console.log('\n■ (2) 매니저 알림 목록 — 열 수 있는 곳만');
const N = await import('../src/lib/utils/notifications.ts');
const ME = 'u_manager', OWNER = 'u_owner', TODAY = '2026-10-05';
const iso = (d) => `2026-10-0${d}T09:00:00.000Z`;
const feed = [
  { id: 'f_notice', kind: 'notice', text: '내일 재고조사', authorId: OWNER, authorName: '김영자', createdAt: iso(4), read_by: [] },
  { id: 'f_mention', kind: 'message', text: '@박지원 확인', authorId: OWNER, authorName: '김영자', createdAt: iso(3), read_by: [], mentions: [ME] },
];
const suggestions = [
  { id: 'sg_other', unit_id: 'u1', kind: 'new', proposer_id: 'u_junior', proposer_name: '이수민', text: '동료 제안', status: 'pending', created_at: iso(3) },
  { id: 'sg_mine_done', unit_id: 'u1', kind: 'new', proposer_id: ME, proposer_name: '박지원', text: '승격 전 제안', status: 'approved', created_at: iso(1), reviewed_at: iso(2) },
];
const queue = [
  { id: 'uq_other', junior_id: 'u_junior', junior_name: '이수민', query_text: '포스 마감은?', status: 'pending_owner_answer', asked_at: iso(2) },
  { id: 'uq_mine', junior_id: ME, junior_name: '박지원', query_text: '내가 물은 것', status: 'pending_owner_answer', asked_at: iso(2) },
];
const swaps = [{ id: 'sw_acc', unit_id: 'u1', kind: 'cover', requester_id: 'u_junior', status: 'accepted', date: '2026-10-20', created_at: iso(1), updated_at: iso(2) }];
const pending = [{ id: 'p1', name: '최하늘', created_at: iso(4) }];
const claims = [{ id: 'c1', status: 'approved', plan: 'single', months: 1, reviewed_at: iso(4) }];
const alerts = [{ id: 7, unit_id: 'u1', kind: 'seat_lock', title: '자리가 잠겼어요', body: '', created_at: iso(4) }];
const taskTemplates = [{ id: 't1', text: '오픈 청소', ownerId: ME, createdBy: OWNER, createdAt: iso(1) }];
const nameOf = (id) => ({ [OWNER]: '김영자', u_junior: '이수민' })[id] ?? '직원';
const ownerArgs = { queue, suggestions, swaps, pending, nameOf, feed, userId: ME, ackAt: null, claims, alerts };
const received = { feed, taskTemplates, done: {}, today: TODAY, suggestions, userId: ME, nameOf, ackAt: null };

const mgr = N.buildManagerNotifications(ownerArgs, received);
const ids = mgr.map((r) => r.id);
const routes = mgr.map((r) => `${r.id}→${r.route}`);
const opens = (r) => String(r.route).startsWith('/junior/') || managerMayOpen(pathOf(r.route));
check('매니저 목록에 /owner/staff 행이 없다', !mgr.some((r) => r.route === '/owner/staff'), show(routes));
check('합류 신청 없음', !mgr.some((r) => r.kind === 'join_request'));
check('제안 검토 없음', !mgr.some((r) => r.kind === 'suggestion'));
check('사장 알림 없음', !ids.some((i) => i.startsWith('alert_')));
check('입금 결과 없음', !mgr.some((r) => r.kind === 'payment_approved' || r.kind === 'payment_rejected'));
check('모든 행이 열 수 있는 곳으로 간다', mgr.length > 0 && mgr.every(opens), show(routes));
const q = mgr.find((r) => r.id === 'q_uq_other');
check('동료 질문 → /junior/chat(그 질문)', q?.route === '/junior/chat?uqId=uq_other', show(q?.route));
check('내가 물은 질문은 안 뜬다(물어보기 탭에서 답할 수 없다)', !ids.includes('q_uq_mine'));
const res = mgr.find((r) => r.id === 'sugres_sg_mine_done');
check('내 제안 결과 → /junior/chat', res?.route === '/junior/chat', show(res?.route));
// 공지는 벨·푸시에서 뺐다(2026-10-16 사용자 결정 · 채팅 맨 위 고정 공지).
check('남기는 행: 멘션·배정·교대 승인', ['mention_f_mention', 'assign_t1', 'swap_sw_acc'].every((i) => ids.includes(i)), show(ids));
check('공지 행 없음(10-16)', !ids.includes('notice_f_notice'));
check('멘션은 1건', mgr.filter((r) => r.kind === 'mention').length === 1);

console.log('\n■ (2-b) 배지 = 같은 배열의 안 읽음 수');
const listUnread = mgr.filter((r) => r.unread).length;
const badge = N.managerUnreadCount(ownerArgs, received);
check('배지 == 목록 안 읽음', badge === listUnread, `badge=${show(badge)} list=${listUnread}`);
const acked = N.managerUnreadCount({ ...ownerArgs, ackAt: iso(9) }, { ...received, ackAt: iso(9) });
check('모두 읽기 뒤 배지 0', acked === 0, `got=${show(acked)}`);

console.log('\n■ (2-c) 사장 목록은 그대로(회귀 0)');
const own = N.buildOwnerNotifications({ ...ownerArgs, userId: OWNER });
const ownIds = own.map((r) => r.id);
// 주소는 레지스트리 그대로(합류 = 명부의 그 신청 · 질문 = 노하우 코치의 그 질문).
check('사장: 합류 신청 → /owner/staff', pathOf(own.find((r) => r.id === 'join_p1')?.route) === '/owner/staff', show(own.find((r) => r.id === 'join_p1')?.route));
check('사장: 질문 2건 → 그 질문', own.filter((r) => r.kind === 'question').every((r) => r.route === NOTIF.question.route('owner', r.id.slice('q_'.length))) && ownIds.includes('q_uq_mine'));
check('사장: 제안 검토·입금·사장 알림 있음', ['s_sg_other', 'pay_c1', 'alert_7'].every((i) => ownIds.includes(i)), show(ownIds));
check('사장 배지 계산 그대로', N.ownerUnreadCount(queue, suggestions, swaps, pending, feed, OWNER, null, claims, alerts) === own.filter((r) => r.unread).length);

console.log('\n■ (3) 노하우 빈 결과 · 매니저 지정 푸시');
const browse = read('src/components/owner/OwnerKnowhowBrowse.tsx'); // 원문 — 주석에 남은 이름도 없어야 한다
check('OwnerKnowhowBrowse: goAsk 없음', !/\bgoAsk\b/.test(browse));
check('OwnerKnowhowBrowse: onAsk 없음', !/\bonAsk\b/.test(browse));
check('OwnerKnowhowBrowse: /owner/ask 로 보내지 않는다', !browse.includes('/owner/ask'));
// 0315: 역할 변경 알림은 서버(set_member_role → member_notices)가 보낸다. 앱은 쏘지 않는다.
check('notify.ts: notifyUserRoleChange 없음', !/export const notifyUserRoleChange/.test(notifySrc));
check('useStaffStore: 역할 변경 푸시를 쏘지 않는다', !/notifyUserRoleChange/.test(read('src/lib/store/useStaffStore.ts')));
const mig = read('supabase/migrations/0315_manager_permissions.sql');
check('0315: set_member_role 이 role_changed 알림을 넣는다', /function public\.set_member_role[\s\S]*'role_changed'[\s\S]*'\/junior\/home'/.test(mig));
check('0315: 잠긴 매니저는 auth_can_manage 거부', /function public\.auth_can_manage[\s\S]*m\.role = 'manager' and not public\.seat_locked_for/.test(mig));
check('0315: unit_members realtime', /add table public\.unit_members/.test(mig));
const edge = read('supabase/functions/push/index.ts');
check("엣지: 'role' 사용자 푸시는 보내지 않는다", /audience === 'user' && tag === 'role'\) return json\(200/.test(edge));
check('엣지: 결과 알림 태그는 관리자만', /MANAGER_USER_PUSH_TAGS\.has\(tag\)[\s\S]{0,120}auth_can_manage/.test(edge));

console.log('\n■ (4) 매니저 진입·사장 전용 버튼');
const jset = read('src/app/junior/settings.tsx');
check("직원 설정: 매니저에게 '노하우'·'퀴즈' 행", /label="노하우"[^\n]*\/owner\/categories/.test(jset) && /label="퀴즈"[^\n]*\/owner\/training/.test(jset));
check('노하우 수정: 휴지통은 사장만', /isBrandCopy\(entry\) \|\| !isOwner/.test(read('src/app/owner/edit/[id].tsx')));
check('코치: 다른 매장 넣기 넛지는 사장만', /isOwnerHere && st\.role === 'owner'/.test(read('src/app/owner/coach.tsx')));
check('owner/_layout: 잠긴 매니저 → /billing', /role === 'manager' && seatLocked\) return <Redirect href="\/billing"/.test(read('src/app/owner/_layout.tsx')));
{
  // 0315/0316: 역할 변경 행 — 매니저 목록에 직원 홈으로, 배지에도 센다.
  const rn = { id: 9, kind: 'role_changed', title: '매니저가 됐어요', body: 'QA', created_at: '2099-01-01T00:00:00Z' };
  const mRows = N.buildManagerNotifications(ownerArgs, { ...received, scheduleNotices: [rn] });
  const r = mRows.find((x) => x.id === 'role_9');
  check('매니저: 역할 변경 행 → /junior/home', r?.kind === 'role' && r?.route === '/junior/home', show(r));
  check('매니저: 역할 변경 행을 배지가 센다', N.managerUnreadCount(ownerArgs, { ...received, scheduleNotices: [rn] }) === N.managerUnreadCount(ownerArgs, received) + 1);
  // 근무 알림(D9) 전부 + 시간 수정 요청(남의 것만) — 매니저 목록·배지가 같은 배열.
  const sn = [
    { id: 11, kind: 'swap_confirmed', title: '대타 확정', body: 'a', created_at: '2099-01-02T00:00:00Z' },
    { id: 12, kind: 'shift_time_result', title: '시간 수정 승인', body: 'b', created_at: '2099-01-02T00:00:00Z' },
    { id: 13, kind: 'shift_changed', title: '근무 변경', body: 'c', created_at: '2099-01-02T00:00:00Z' },
  ];
  const tr = [
    { id: 'tr_other', staff_id: 'u_junior', date: '2026-10-21', new_start: '09:00', new_end: '13:00', created_at: iso(5) },
    { id: 'tr_mine', staff_id: ME, date: '2026-10-21', new_start: '09:00', new_end: '13:00', created_at: iso(5) },
  ];
  const oa = { ...ownerArgs, timeRequests: tr }, rc = { ...received, scheduleNotices: [rn, ...sn] };
  const rows2 = N.buildManagerNotifications(oa, rc);
  const ids2 = rows2.map((x) => x.id);
  check('매니저: 근무 알림 3종 → /owner/schedule', sn.every((n) => rows2.find((x) => x.id === `sched_${n.id}`)?.route === '/owner/schedule'), show(ids2));
  check('매니저: 남의 시간 수정 요청만(내 요청은 결정 불가)', ids2.includes('shift_time_tr_other') && !ids2.includes('shift_time_tr_mine'), show(ids2));
  check('매니저: 같은 행 두 번 없음', new Set(ids2).size === ids2.length);
  check('매니저 배지(manageUnreadCount) == 목록 안 읽음', N.manageUnreadCount('manager', oa, rc) === rows2.filter((x) => x.unread).length);
  check('사장 배지(manageUnreadCount) == 예전 ownerUnreadCount',
    N.manageUnreadCount('owner', { ...oa, userId: OWNER }, rc) === N.ownerUnreadCount(queue, suggestions, swaps, pending, feed, OWNER, null, claims, alerts, rc, undefined, tr));
  for (const f of ['src/components/NotificationBell.tsx', 'src/lib/push/appBadge.ts', 'src/lib/utils/crossStoreNotifs.ts']) {
    check(`${f}: 관리 배지는 manageUnreadCount 하나`, /manageUnreadCount\(/.test(read(f)) && !/\b(ownerUnreadCount|managerUnreadCount)\(/.test(read(f)));
  }
  const sch = read('src/app/owner/schedule.tsx');
  check('근무표: 시간 수정 요청을 매니저에게도(자기 요청 제외)', /pendingTimeRequests\(timeRequests\)\.filter\(\(r\) => isOwner \|\| r\.staff_id !== myId\)/.test(sch));
  check('0316: decide_shift_time = auth_can_manage + cannot_decide_self', /not public\.auth_can_manage\(\) then raise exception 'owner_only'[\s\S]*cannot_decide_self/.test(read('supabase/migrations/0316_manager_shift_time_and_role_notice.sql')));
}
for (const f of ['src/app/owner/_layout.tsx', 'src/app/junior/_layout.tsx']) check(`${f}: 내 멤버십 실시간 구독`, /subscribeMyMembership\(userId/.test(read(f)));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
