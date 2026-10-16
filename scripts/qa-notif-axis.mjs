#!/usr/bin/env node
// qa-notif-axis.mjs — 알림 축(역할별 스트림) 진리표. 순수 함수 검증이라 백엔드 불필요.
//
// 무엇을 고정하나(2026-08-08 역할 분리 감사에서 나온 것들):
//  ① 매니저가 사장이 올린 **공지**를 받는다(예전엔 화면 세트로 축이 갈려 통째로 빠져 있었다)
//  ② 자기가 올린 제안은 **자기 검토함에 안 뜬다**(직원→매니저 승격 이월)
//  ③ 자기가 쓴 공지는 자기 알림에 **안 뜬다**(메아리)
//  ④ 멘션이 **한 번만** 뜬다(사장 축과 개인 축 양쪽에 넣으면 중복)
//  ⑤ 매니저가 행동할 수 없는 것(교대 수락·내 교대 결과)은 **안 온다**
//  ⑥ 사장 스트림은 이번 변경으로 **바뀌지 않는다**(자기 제안 제외분 말고는 회귀 0)
//  ⑦ 배지 수 == 목록의 안읽음 수 (드리프트 방지 · F-2 부터 배지는 목록과 같은 배열에서 센다)
//  ⑧ 매니저 행은 열 수 있는 곳(허용 목록·/junior/*)으로만 간다(F-2 · 2026-10-04). 제안 검토는 사장 전용
// 실행: node scripts/qa-notif-axis.mjs
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 별칭 해석 + 스토어 두 곳의 순수 함수만 잘라 읽는 훅(하니스 전용). 앱 코드를 그대로 import 한다.
// ★예전 qa-alias-loader 로는 스토어가 react-native 를 끌고 와서 import 단계에서 죽었다.
const { installNotifHooks } = await import(pathToFileURL(join(ROOT, 'scripts/lib/qa-notif-hooks.mjs')).href);
installNotifHooks();
const { managerMayOpen } = await import(pathToFileURL(join(ROOT, 'src/lib/utils/roles.ts')).href);

const {
  buildOwnerNotifications, buildManagerNotifications, managerUnreadCount,
} = await import(pathToFileURL(join(ROOT, 'src/lib/utils/notifications.ts')).href);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

const ME = 'u_manager', OWNER = 'u_owner', TODAY = '2026-08-08';
const iso = (d) => `2026-08-0${d}T09:00:00.000Z`;

const feed = [
  { id: 'f_notice_owner', kind: 'notice', text: '내일 재고조사', authorId: OWNER, authorName: '김영자', createdAt: iso(7), read_by: [] },
  { id: 'f_notice_mine', kind: 'notice', text: '내가 쓴 공지', authorId: ME, authorName: '박지원', createdAt: iso(6), read_by: [] },
  { id: 'f_mention', kind: 'message', text: '@박지원 확인 부탁', authorId: OWNER, authorName: '김영자', createdAt: iso(5), read_by: [], mentions: [ME] },
];
const suggestions = [
  { id: 'sg_mine', unit_id: 'u1', kind: 'improve', proposer_id: ME, proposer_name: '박지원', text: '내가 올린 제안', status: 'pending', created_at: iso(4) },
  { id: 'sg_other', unit_id: 'u1', kind: 'new', proposer_id: 'u_junior', proposer_name: '이수민', text: '동료가 올린 제안', status: 'pending', created_at: iso(3) },
  { id: 'sg_mine_done', unit_id: 'u1', kind: 'new', proposer_id: ME, proposer_name: '박지원', text: '승격 전 제안', status: 'approved', created_at: iso(2), reviewed_at: iso(3) },
];
const taskTemplates = [
  { id: 't_mine', text: '오픈 청소', ownerId: ME, createdBy: OWNER, createdAt: iso(4), repeat: 'daily' },
];
const swaps = [
  { id: 'sw_open', unit_id: 'u1', kind: 'cover', requester_id: 'u_junior', status: 'open', date: '2026-08-20', created_at: iso(4), updated_at: iso(4) },
  { id: 'sw_acc', unit_id: 'u1', kind: 'cover', requester_id: 'u_junior', status: 'accepted', date: '2026-08-21', created_at: iso(4), updated_at: iso(5) },
];
const nameOf = (id) => ({ [OWNER]: '김영자', u_junior: '이수민' })[id] ?? '직원';
const ownerArgs = { queue: [], suggestions, swaps, pending: [], nameOf, feed, userId: ME, ackAt: null, claims: [] };
const received = { feed, taskTemplates, done: {}, today: TODAY, suggestions, userId: ME, nameOf, ackAt: null };

// ── 매니저 스트림 ────────────────────────────────────────────────────────
const mgr = buildManagerNotifications(ownerArgs, received);
const kinds = mgr.map((r) => r.kind);
const ids = mgr.map((r) => r.id);

// 2026-10-16 #9: 공지는 벨·푸시가 없다(채팅 맨 위 고정 1줄로 보인다). 전엔 매니저가 사장 공지를 벨로 받았다.
check('① 공지는 매니저 벨에 없다(10-16 · 채팅 맨 위 고정 1줄)', !ids.some((id) => String(id).startsWith('notice_')), `kinds=${kinds.join(',')}`);
check('② 내가 올린 pending 제안은 검토함에 없다', !ids.includes('s_sg_mine'));
check('② 동료 제안 검토는 매니저에게 안 온다(사장 전용 · F-2)', !ids.includes('s_sg_other'));
check('③ 내가 쓴 공지는 내 알림에 없다', !ids.includes('notice_f_notice_mine'));
check('④ 멘션은 정확히 1건', kinds.filter((k) => k === 'mention').length === 1);
check('⑤ 교대 수락 요청(open)은 안 온다', !ids.includes('swap_sw_open'));
check('⑤ 교대 승인 대기(accepted)는 온다(사장 축)', ids.includes('swap_sw_acc'));
check('배정된 할일이 온다', ids.includes('assign_t_mine'));
check('내 제안 결과가 온다', ids.includes('sugres_sg_mine_done'));
// managerMayOpen 은 pathname 만 받는다(owner/_layout 이 usePathname 으로 부른다) — 경로에 ?feed=·?view=·?task= 가 붙으므로 떼고 본다.
check('⑧ 매니저 경로는 허용 목록 또는 /junior/*', mgr.every((r) => String(r.route).startsWith('/junior/') || managerMayOpen(String(r.route).split('?')[0])),
  mgr.map((r) => r.route).join(','));
check('시간 역순 정렬', mgr.every((r, i) => i === 0 || mgr[i - 1].at >= r.at));

// ⑦ 배지 == 목록 안읽음
const badge = managerUnreadCount(ownerArgs, received);
check('⑦ 배지 수 == 목록 안읽음 수', badge === mgr.filter((r) => r.unread).length, `badge=${badge} list=${mgr.filter((r) => r.unread).length}`);

// ── 사장 스트림 회귀 ─────────────────────────────────────────────────────
const own = buildOwnerNotifications({ ...ownerArgs, userId: OWNER, feed, suggestions });
const ownIds = own.map((r) => r.id);
check('⑥ 사장: 공지·배정은 여전히 안 온다(회귀)', !ownIds.some((i) => i.startsWith('notice_') || i.startsWith('assign_')), ownIds.join(','));
check('⑥ 사장: 직원 제안 2건 모두 검토함에(자기 것 아님)', ownIds.includes('s_sg_mine') && ownIds.includes('s_sg_other'));

// ── 논리 점검 D11 (2026-10-06) ───────────────────────────────────────────
{
  const { buildJuniorNotifications, juniorUnreadCount, ownerUnreadCount, unreadMentionIds } =
    await import(pathToFileURL(join(ROOT, 'src/lib/utils/notifications.ts')).href);
  // ① 오래된 할일에 오늘 담당자로 추가됨 — 배정 시각·배정한 사람은 assignedMeta 가 정한다.
  const ACK = iso(6);
  const late = [{ id: 't_late', text: '냉장고 정리', ownerIds: [ME], ownerId: ME, createdBy: OWNER, createdAt: iso(2), repeat: 'daily',
    assignedMeta: { [ME]: { at: iso(8), by: 'u_junior' } } }];
  const jr = buildJuniorNotifications({ feed: [], swaps: [], templates: [], nameOf, userId: ME, today: TODAY, taskTemplates: late, done: {}, ackAt: ACK });
  const row = jr.find((r) => r.id === 'assign_t_late');
  check('★D11-1 새로 담당자가 되면 "모두 읽기" 뒤에도 새 알림이다(배정 시각 기준)', row?.unread === true && row?.at === iso(8), JSON.stringify(row));
  check('★D11-1 제목 이름은 마지막으로 배정한 사람', row?.title === '이수민님이 할 일을 배정했어요', row?.title);
  check('D11-1 배지도 같은 시각으로 센다', juniorUnreadCount([], [], ME, TODAY, late, {}, ACK) === 1);
  const mrow = buildManagerNotifications(ownerArgs, { ...received, taskTemplates: late, ackAt: ACK }).find((r) => r.id === 'assign_t_late');
  check('D11-1 매니저 배정 행도 같은 규칙', mrow?.unread === true && mrow?.title === '이수민님이 할 일을 배정했어요', JSON.stringify(mrow));

  // ② 사장 알림함에 공지·배정(내 글 제외) — 사장 폰에 푸시가 오는 것과 같은 축.
  const ownArgs = { ...ownerArgs, userId: OWNER };
  const ownRecv = { ...received, userId: OWNER, taskTemplates: [{ id: 't_own', text: '발주', ownerIds: [OWNER], ownerId: OWNER, createdBy: ME, createdAt: iso(7), repeat: 'daily' }] };
  const own2 = buildOwnerNotifications(ownArgs, ownRecv);
  const own2Ids = own2.map((r) => r.id);
  check('★D11-2 사장 알림함에 공지는 없다(10-16 #9 · 매니저가 쓴 것도)', !own2Ids.some((id) => String(id).startsWith('notice_')), own2Ids.join(','));
  check('D11-2 사장이 쓴 공지는 사장 알림함에 없다(메아리)', !own2Ids.includes('notice_f_notice_owner'));
  check('★D11-2 사장 알림함에 나에게 배정된 할일이 뜬다', own2Ids.includes('assign_t_own'));
  // 배정 경로는 그 할일을 연다(P1 · /owner/work?view=todo&task=<id>).
  check('D11-2 사장 배정 경로는 /owner/work?view=todo&task=<id>', own2.filter((r) => r.kind === 'assign').every((r) => /^\/owner\/work\?view=todo&task=.+/.test(String(r.route))));
  const ownBadge = typeof ownerUnreadCount === 'function'
    ? ownerUnreadCount([], suggestions, swaps, [], feed, OWNER, null, [], [], ownRecv) : -1;
  check('★D11-2 사장 배지 수 == 목록 안읽음 수', ownBadge === own2.filter((r) => r.unread).length, `badge=${ownBadge} list=${own2.filter((r) => r.unread).length}`);

  // ③ 채팅에서 본 멘션은 읽음 처리 대상이다.
  const ids3 = typeof unreadMentionIds === 'function'
    ? unreadMentionIds([...feed, { id: 'f_read', kind: 'message', text: '@', authorId: OWNER, authorName: '김영자', createdAt: iso(5), read_by: [ME], mentions: [ME] }], ME) : null;
  check('★D11-3 채팅에 보이는 안 읽은 나의 멘션 id', JSON.stringify(ids3) === JSON.stringify(['f_mention']), JSON.stringify(ids3));
}

// ── 허브(전 매장 · 0313) — 매장 벨의 모든 종류가 허브 행에도 나오고(결정 1) 합류 결과는 계정 단위 ack(결정 3) ──
{
  const { buildStoreNotifs, storeUnreadCount, buildJoinCrossNotifs } =
    await import(pathToFileURL(join(ROOT, 'src/lib/utils/crossStoreNotifs.ts')).href);
  const { accountAckAt, buildJuniorNotifications, juniorUnreadCount } =
    await import(pathToFileURL(join(ROOT, 'src/lib/utils/notifications.ts')).href);
  const JR = 'u_junior';
  const uqAnswered = { id: 'uq1', unit_id: 'u1', junior_id: JR, junior_name: '이수민', query_text: '얼음 어디?', status: 'resolved_with_entry', answered_by: OWNER, asked_at: iso(2) };
  const uqPending = { id: 'uq2', unit_id: 'u1', junior_id: 'u_other', junior_name: '최민수', query_text: '마감 순서?', status: 'pending_owner_answer', asked_at: iso(3) };
  // 허브 원시 묶음 한 매장(UnitNotifData) — 0313 이 보태는 축을 벨과 같은 타입으로 채운다.
  const d = {
    unitId: 'u1', feed: [], swaps: [], taskTemplates: [], done: {}, names: { [JR]: '이수민', [OWNER]: '김영자' },
    queue: [uqAnswered, uqPending], suggestions: [], pending: [],
    assignments: [{ id: 'qa1', courseId: 'c1', userId: JR, scheduledOn: '2026-08-01', sentAt: iso(3), dueOn: null, openedAt: iso(3), completedAt: iso(4), origin: 'manual' }],
    courses: [{ id: 'c1', name: '오픈 퀴즈' }],
    timeRequests: [{ id: 'tr1', staff_id: JR, template_id: 't1', date: '2026-08-20', old_start: '09:00', old_end: '12:00', new_start: '10:00', new_end: '13:00', note: null, created_at: iso(5) }],
    claims: [], alerts: [], scheduleNotices: [{ id: 9, kind: 'shift_changed', title: '근무가 바뀌었어요', body: '20일', created_at: iso(6) }],
  };
  const own = buildStoreNotifs(d, 'owner', OWNER, TODAY, null);
  const qd = own.find((r) => r.id === 'quiz_done_qa1');
  check('⑩ 허브 사장 행에 quiz_done(제목 = 푼 직원 · 본문 = 퀴즈 이름 · unitId 칩)', qd?.kind === 'quiz_done' && qd?.title === '이수민님이 퀴즈를 다 풀었어요' && qd?.body === '오픈 퀴즈' && qd?.unitId === 'u1', JSON.stringify(qd));
  check('⑩ 허브 사장 행에 shift_time', own.some((r) => r.id === 'shift_time_tr1' && r.kind === 'shift_time' && r.unitId === 'u1'), own.map((r) => r.id).join(','));
  check('⑩ 허브 사장 배지 == 목록 안읽음', storeUnreadCount(d, 'owner', OWNER, TODAY, null) === own.filter((r) => r.unread).length, `badge=${storeUnreadCount(d, 'owner', OWNER, TODAY, null)} list=${own.filter((r) => r.unread).length}`);
  const jr = buildStoreNotifs(d, 'junior', JR, TODAY, null);
  check('⑩ 허브 직원 행에 q_answered(내 질문에 답)', jr.some((r) => r.id === 'qa_uq1' && r.kind === 'q_answered' && r.unitId === 'u1'), jr.map((r) => r.id).join(','));
  check('⑩ 허브 직원 행에 question(D4 · 동료 질문) · schedule(근무 알림)', jr.some((r) => r.id === 'q_uq2' && r.kind === 'question') && jr.some((r) => r.id === 'sched_9' && r.kind === 'schedule'));
  check('⑩ 허브 직원 배지 == 목록 안읽음', storeUnreadCount(d, 'junior', JR, TODAY, null) === jr.filter((r) => r.unread).length);

  // 합류 결과 — 반려된 매장(u3)엔 prefs 행이 없다. 읽음 기준 = 내 매장 ack 중 최댓값(iso(5)).
  const ackByUnit = { u1: iso(5), u2: iso(3) };
  const joinNotices = [
    { id: 1, unit_id: 'u3', kind: 'rejected', store_name: '셋째 매장', body: '셋째 매장', created_at: iso(4) },
    { id: 2, unit_id: 'u2', kind: 'approved', store_name: '둘째 매장', body: '둘째 매장 직원이 됐어요', created_at: iso(6) },
  ];
  check('⑩ accountAckAt = 내 매장 ack 중 가장 늦은 시각', accountAckAt(ackByUnit) === iso(5) && accountAckAt({}) === null);
  const hub = buildJoinCrossNotifs(joinNotices, accountAckAt(ackByUnit));
  const rej = hub.find((r) => r.id === 'join_rejected_1'), app = hub.find((r) => r.id === 'join_approved_2');
  check('⑩ 허브 합류 결과: 반려(최대 ack 이전 · 그 매장 ack 행 없음)=읽음 · 승인(이후)=안 읽음 · unitId=그 알림 매장 · storeName 칩 폴백',
    rej?.unread === false && rej?.unitId === 'u3' && rej?.storeName === '셋째 매장' && app?.unread === true && app?.unitId === 'u2', JSON.stringify(hub));
  const bell = buildJuniorNotifications({ feed: [], swaps: [], templates: [], nameOf, userId: JR, today: TODAY, ackAt: null, joinNotices, joinAckAt: accountAckAt(ackByUnit) });
  check('⑩ 매장 벨 합류 결과도 같은 판정(unread 동일) · 배지 == 목록', bell.find((r) => r.id === 'join_rejected_1')?.unread === false && bell.find((r) => r.id === 'join_approved_2')?.unread === true
    && juniorUnreadCount([], [], JR, TODAY, [], {}, null, [], [], [], [], joinNotices, accountAckAt(ackByUnit)) === 1);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
