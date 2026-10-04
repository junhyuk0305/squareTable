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
  ['/owner/inbox', '/junior/chat'],
  ['/owner/suggestions', '/junior/home'],
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
// 앱이 실제로 싣는 푸시 url 전부(notify.ts) — 매니저 결과는 허용 목록이거나 /junior/* 다.
const notifySrc = read('src/lib/push/notify.ts');
const urls = [...new Set([...notifySrc.matchAll(/'(\/(?:owner|junior)\/[a-z-]+)'/g)].map((m) => m[1]))];
check('notify.ts 에서 url 을 읽었다', urls.length >= 8, show(urls));
const bad = urls.filter((u) => {
  const to = route(u, M);
  return !(to.startsWith('/junior/') || managerMayOpen(to));
});
check('매니저: 모든 푸시 url 이 열 수 있는 곳으로 간다', typeof routeForRole === 'function' && bad.length === 0, show(bad.map((u) => `${u}→${route(u, M)}`)));

console.log('\n■ (1-b) 복제본 두 개를 지웠다');
for (const f of ['src/lib/push/nativepush.ts', 'src/lib/push/usePushBootstrap.ts']) {
  // 주석 걷기는 '/junior/*' 같은 경로 글자를 블록 주석으로 오인한다. 정의·import 는 원문에서 본다.
  const code = read(f);
  check(`${f}: 자체 routeForRole 정의가 없다`, !/function\s+routeForRole\s*\(/.test(code));
  check(`${f}: roles.ts 의 routeForRole 을 쓴다`, /import\s*\{[^}]*\brouteForRole\b[^}]*\}\s*from\s*'@\/lib\/utils\/roles'/.test(code)
    && /routeForRole\([^)]*,\s*useSessionStore\.getState\(\)\.role\)/.test(code));
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
const opens = (r) => String(r.route).startsWith('/junior/') || managerMayOpen(String(r.route));
check('매니저 목록에 /owner/staff 행이 없다', !mgr.some((r) => r.route === '/owner/staff'), show(routes));
check('합류 신청 없음', !mgr.some((r) => r.kind === 'join_request'));
check('제안 검토 없음', !mgr.some((r) => r.kind === 'suggestion'));
check('사장 알림 없음', !ids.some((i) => i.startsWith('alert_')));
check('입금 결과 없음', !mgr.some((r) => r.kind === 'payment_approved' || r.kind === 'payment_rejected'));
check('모든 행이 열 수 있는 곳으로 간다', mgr.length > 0 && mgr.every(opens), show(routes));
const q = mgr.find((r) => r.id === 'q_uq_other');
check('동료 질문 → /junior/chat', q?.route === '/junior/chat', show(q?.route));
check('내가 물은 질문은 안 뜬다(물어보기 탭에서 답할 수 없다)', !ids.includes('q_uq_mine'));
const res = mgr.find((r) => r.id === 'sugres_sg_mine_done');
check('내 제안 결과 → /junior/chat', res?.route === '/junior/chat', show(res?.route));
check('남기는 행: 공지·멘션·배정·교대 승인', ['notice_f_notice', 'mention_f_mention', 'assign_t1', 'swap_sw_acc'].every((i) => ids.includes(i)), show(ids));
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
check('사장: 합류 신청 → /owner/staff', own.find((r) => r.id === 'join_p1')?.route === '/owner/staff');
check('사장: 질문 2건 → /owner/inbox', own.filter((r) => r.kind === 'question').every((r) => r.route === '/owner/inbox') && ownIds.includes('q_uq_mine'));
check('사장: 제안 검토·입금·사장 알림 있음', ['s_sg_other', 'pay_c1', 'alert_7'].every((i) => ownIds.includes(i)), show(ownIds));
check('사장 배지 계산 그대로', N.ownerUnreadCount(queue, suggestions, swaps, pending, feed, OWNER, null, claims, alerts) === own.filter((r) => r.unread).length);

console.log('\n■ (3) 노하우 빈 결과 · 매니저 지정 푸시');
const browse = read('src/components/owner/OwnerKnowhowBrowse.tsx'); // 원문 — 주석에 남은 이름도 없어야 한다
check('OwnerKnowhowBrowse: goAsk 없음', !/\bgoAsk\b/.test(browse));
check('OwnerKnowhowBrowse: onAsk 없음', !/\bonAsk\b/.test(browse));
check('OwnerKnowhowBrowse: /owner/ask 로 보내지 않는다', !browse.includes('/owner/ask'));
const roleChange = /export const notifyUserRoleChange[\s\S]*?\n\s*\}\);/.exec(notifySrc)?.[0] ?? '';
check('notifyUserRoleChange url = /junior/home(두 경우 모두)', /url:\s*'\/junior\/home'/.test(roleChange) && !roleChange.includes('/owner/'), show(/url:[^\n]*/.exec(roleChange)?.[0]));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
