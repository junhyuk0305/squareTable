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
//  ⑦ 배지 수 == 목록의 안읽음 수 (드리프트 방지)
// 실행: node scripts/qa-notif-axis.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// '@/...' 별칭·확장자·json 을 해석하는 최소 로더(하니스 전용). 앱 코드를 그대로 import 한다.
register(pathToFileURL(join(ROOT, 'scripts/qa-alias-loader.mjs')));

const {
  buildOwnerNotifications, buildManagerNotifications, ownerUnreadCount, managerUnreadCount,
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

check('① 매니저가 사장 공지를 받는다', ids.includes('notice_f_notice_owner'), `kinds=${kinds.join(',')}`);
check('② 내가 올린 pending 제안은 검토함에 없다', !ids.includes('s_sg_mine'));
check('② 동료 제안은 검토함에 있다', ids.includes('s_sg_other'));
check('③ 내가 쓴 공지는 내 알림에 없다', !ids.includes('notice_f_notice_mine'));
check('④ 멘션은 정확히 1건', kinds.filter((k) => k === 'mention').length === 1);
check('⑤ 교대 수락 요청(open)은 안 온다', !ids.includes('swap_sw_open'));
check('⑤ 교대 승인 대기(accepted)는 온다(사장 축)', ids.includes('swap_sw_acc'));
check('배정된 할일이 온다', ids.includes('assign_t_mine'));
check('내 제안 결과가 온다', ids.includes('sugres_sg_mine_done'));
check('매니저 경로는 전부 /owner/*', mgr.every((r) => String(r.route).startsWith('/owner/') || r.route === '/billing'),
  mgr.map((r) => r.route).join(','));
check('시간 역순 정렬', mgr.every((r, i) => i === 0 || mgr[i - 1].at >= r.at));

// ⑦ 배지 == 목록 안읽음
const base = ownerUnreadCount([], suggestions, swaps, [], feed, ME, null, []);
const badge = managerUnreadCount(base, received);
check('⑦ 배지 수 == 목록 안읽음 수', badge === mgr.filter((r) => r.unread).length, `badge=${badge} list=${mgr.filter((r) => r.unread).length}`);

// ── 사장 스트림 회귀 ─────────────────────────────────────────────────────
const own = buildOwnerNotifications({ ...ownerArgs, userId: OWNER, feed, suggestions });
const ownIds = own.map((r) => r.id);
check('⑥ 사장: 공지·배정은 여전히 안 온다(회귀)', !ownIds.some((i) => i.startsWith('notice_') || i.startsWith('assign_')), ownIds.join(','));
check('⑥ 사장: 직원 제안 2건 모두 검토함에(자기 것 아님)', ownIds.includes('s_sg_mine') && ownIds.includes('s_sg_other'));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
