// qa-race-client.cjs — 클라 레이스 수정(결함 전수 점검 S4 · 2026-11-12)의 순수 검사. 백엔드 없음 · AI 호출 0회.
//
// 왜 있나: 서버 함수(0630~0636)는 qa-race(로컬 DB)가 잰다. 앱이 그 함수를 **한 번만** 부르는지,
//   already 를 실패로 보지 않는지, 읽기 실패가 목록을 비우지 않는지는 스토어 코드에서 정해진다. 그걸 여기서 잰다.
// 방법: 스토어 파일을 typescript 로 바꿔 vm 에서 돈다(qa-audit-work-recovery 와 같은 방식).
//   '@/lib/db' 는 Proxy 다. 부른 함수 이름을 다 적고, 케이스가 준 응답을 돌려준다. 안 준 이름은 기본값(읽기 = 빈 목록 · 쓰기 = 성공)이다.
//   그래서 수정 전 코드도 끝까지 돌고, "옛 함수를 불렀다"로 RED 가 된다.
// 사용: node scripts/qa-race-client.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const jsCache = new Map();

function resolveSrc(p) {
  for (const c of [p + '.ts', p + '.tsx', p + '/index.ts', p]) if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) return c;
  throw new Error('파일 없음: ' + p);
}
function transpile(p) {
  if (!jsCache.has(p)) {
    const text = fs.readFileSync(path.join(root, p), 'utf8');
    jsCache.set(p, ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
  }
  return jsCache.get(p);
}
function load(p, mocks, cache = new Map()) {
  if (cache.has(p)) return cache.get(p).exports;
  const mod = { exports: {} };
  cache.set(p, mod);
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load(resolveSrc('src/' + name.slice(2)), mocks, cache);
    if (name.startsWith('.')) return load(resolveSrc(path.posix.normalize(path.posix.join(path.posix.dirname(p), name))), mocks, cache);
    if (['react', 'zustand'].includes(name)) return req(name);
    throw new Error(`${p}: 모르는 의존 ${name}`);
  };
  vm.runInNewContext(transpile(p), { require: localRequire, module: mod, exports: mod.exports, console, Date, Map, Set, Promise, setTimeout, clearTimeout, setInterval, clearInterval, __DEV__: false, window: undefined }, { filename: p });
  return mod.exports;
}

/** 부른 이름을 적는 모의 모듈. impl[name] 이 있으면 그걸 부른다. */
function recorder(impl, fallback) {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string' || name === '__esModule' || name === 'then') return undefined;
      return (...args) => {
        calls.push({ name, args });
        if (impl[name]) return impl[name](...args);
        return fallback(name, args);
      };
    },
  });
  return { proxy, calls, count: (n) => calls.filter((c) => c.name === n).length, args: (n) => calls.filter((c) => c.name === n).map((c) => c.args) };
}
const dbDefault = (name) => {
  if (/^(fetch|load|subscribe)/.test(name)) return name.startsWith('subscribe') ? () => {} : Promise.resolve({ data: [], error: false });
  return Promise.resolve(true);
};
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** 스토어 하나를 새로 읽는다(모듈 상태가 케이스끼리 섞이지 않게). */
function setup(storeFile, dbImpl = {}, extra = {}) {
  const db = recorder(dbImpl, dbDefault);
  const notify = recorder({}, () => undefined);
  const toasts = [];
  const cache = new Map();
  const sync = load('src/lib/store/useSyncStore.ts', {}, cache);
  const mocks = {
    '@/lib/db': db.proxy,
    '@/lib/push/notify': notify.proxy,
    '@/lib/supabase': { HAS_SUPABASE: true, supabase: {} },
    '@/lib/store/useSyncStore': sync,
    '@/lib/store/useToastStore': { showToast: (m, tone) => toasts.push({ m, tone }), useToastStore: { getState: () => ({ show: (m) => toasts.push({ m }) }) } },
    '@/lib/store/realtimeSync': { coalesce: (fn) => fn, subscribeDebounced: () => () => {}, subscribeDebouncedKeyed: () => () => {}, settleWithin: (p) => p, HYDRATE_TIMEOUT_MS: 8000, pendingNames: () => [], reportHydrate: () => {}, syncStats: {} },
    '@/lib/store/useSessionStore': { useSessionStore: { getState: () => ({ userId: 'me', userName: '나', role: 'owner', unitId: 'u1' }) } },
    '@/lib/store/useRoomStore': { useRoomStore: { getState: () => ({ currentRoomId: 'room1' }) } },
    '@/lib/store/useScheduleStore': storeFile.endsWith('useScheduleStore.ts') ? undefined : { useScheduleStore: { getState: () => ({ config: {} }) } },
    '@/lib/analytics/track': { track: () => {} },
    '@/lib/brand/copy': { isBrandHidden: () => false },
    'expo-router': { router: { push: () => {} } },
    '@/lib/config/store-policy': { showUpgradeHint: () => false },
    '@/lib/config/tiers': { PLANS: { free: { maxStaff: 3 } } },
    '@/data/users.json': { owner: null, staff: [] },
    '@/data/unknown-queries.json': [],
    '@/data/playbook-entries.json': [],
    '@/lib/utils/tenure': { openJoinedAt: () => undefined },
    '@/lib/ai/searchClient': new Proxy({}, { get: (_t, n) => (n === '__esModule' ? undefined : () => undefined) }),
    '@/lib/store/knowhowCategories': new Proxy({}, { get: (_t, n) => (n === '__esModule' ? undefined : (x) => x ?? []) }),
    ...extra,
  };
  for (const k of Object.keys(mocks)) if (mocks[k] === undefined) delete mocks[k];
  const mod = load(storeFile, mocks, cache);
  const errors = () => sync.useSyncStore.getState().error;
  return { mod, db, notify, toasts, errors };
}

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' · ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

async function main() {
  // ── H3 할 일 완료·해제 ──
  console.log('— H3 toggleTask —');
  const D = '2026-11-12', T = 'tpl1';
  const workBase = { templates: [{ id: T, text: '컵 닦기', section: 'open' }], done: {}, feed: [] };
  await test('H3-1 완료는 complete_task 한 번(setDone·upsertFeed 를 부르지 않는다)', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { completeTask: async () => ({ decision: 'ok', by: 'me', byName: '나', code: null }) });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, hydrate: async () => {} });
    w.getState().toggleTask(D, T, 'me', '나', 'owner');
    await flush();
    assert.equal(s.db.count('completeTask'), 1, 'completeTask ' + s.db.count('completeTask'));
    assert.equal(s.db.count('setDone') + s.db.count('upsertFeed'), 0, '옛 쓰기 ' + s.db.calls.map((c) => c.name).join(','));
  });
  await test('H3-2 앱이 완료 글(task_done)을 만들지 않는다', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { completeTask: async () => ({ decision: 'ok', by: 'me', byName: '나', code: null }) });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, hydrate: async () => {} });
    w.getState().toggleTask(D, T, 'me', '나', 'owner');
    assert.equal(w.getState().feed.filter((f) => f.kind === 'task_done').length, 0);
    await flush();
    assert.equal(w.getState().done[D]?.[T]?.byName, '나');
  });
  await test('H3-3 already 면 서버가 준 완료자 이름을 보이고 오류 문구가 없다', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { completeTask: async () => ({ decision: 'already', by: 'other', byName: '김먼저', code: null }) });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, hydrate: async () => {} });
    w.getState().toggleTask(D, T, 'me', '나', 'owner');
    await flush();
    assert.equal(w.getState().done[D]?.[T]?.byName, '김먼저', '이름 ' + w.getState().done[D]?.[T]?.byName);
    assert.equal(s.errors(), null);
  });
  await test('H3-4 해제는 uncomplete_task 한 번(clearDone·deleteFeed 를 부르지 않는다)', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { uncompleteTask: async () => 'ok' });
    const w = s.mod.useWorkStore;
    w.setState({ ...workBase, done: { [D]: { [T]: { by: 'me', byName: '나', at: D } } }, feed: [{ id: `fdone_${D}_${T}`, kind: 'task_done', date: D, refId: T, text: 'x' }], hydrate: async () => {} });
    w.getState().toggleTask(D, T, 'me', '나', 'owner');
    await flush();
    assert.equal(s.db.count('uncompleteTask'), 1, 'uncompleteTask ' + s.db.count('uncompleteTask'));
    assert.equal(s.db.count('clearDone') + s.db.count('deleteFeed'), 0, '옛 쓰기 ' + s.db.calls.map((c) => c.name).join(','));
    assert.equal(w.getState().feed.length, 0);
  });
  await test('H3-5 완료 실패면 그 할 일만 되돌리고 "못 했어요"', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { completeTask: async () => ({ decision: 'failed', code: null }), setDone: async () => 'failed' });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, hydrate: async () => {} });
    w.getState().toggleTask(D, T, 'me', '나', 'owner');
    await flush();
    assert.equal(w.getState().done[D]?.[T], undefined);
    assert.ok(/완료 체크 저장에 실패/.test(s.errors() ?? ''), String(s.errors()));
  });

  // ── H4 제안 승인·반려 ──
  console.log('— H4 review_suggestion —');
  const sug = { id: 'sug1', kind: 'new', proposer_id: 'jr', proposer_name: '직원', text: '본문', status: 'pending', created_at: D };
  await test('H4-1 승인은 review_suggestion 한 번(옛 reviewSuggestion update 를 부르지 않는다)', async () => {
    const s = setup('src/lib/store/useSuggestionStore.ts', { reviewSuggestionRpc: async () => ({ decision: 'ok', current: 'approved', resultingEntryId: null, code: null }) });
    const st = s.mod.useSuggestionStore; st.setState({ suggestions: [sug], hydrate: async () => {} });
    const r = await st.getState().approve('sug1', 'kh1');
    assert.equal(s.db.count('reviewSuggestionRpc'), 1, 'rpc ' + s.db.count('reviewSuggestionRpc'));
    assert.equal(s.db.count('reviewSuggestion'), 0);
    assert.equal(r.decision, 'ok');
    assert.equal(s.notify.count('notifyUserSuggestionResult'), 1);
  });
  await test('H4-2 승인 already 면 결과 알림을 보내지 않고 서버 상태·노하우 id 를 돌려준다', async () => {
    const s = setup('src/lib/store/useSuggestionStore.ts', { reviewSuggestionRpc: async () => ({ decision: 'already', current: 'approved', resultingEntryId: 'kh_win', code: null }) });
    const st = s.mod.useSuggestionStore; st.setState({ suggestions: [sug], hydrate: async () => {} });
    const r = await st.getState().approve('sug1', 'kh_mine');
    await flush();
    assert.equal(s.notify.count('notifyUserSuggestionResult'), 0, '알림 ' + s.notify.count('notifyUserSuggestionResult'));
    assert.equal(r && r.decision, 'already');
    assert.equal(r.resultingEntryId, 'kh_win');
    assert.equal(st.getState().suggestions[0].status, 'approved');
    assert.equal(s.errors(), null);
  });
  await test('H4-3 반려 already 면 결과 알림이 없다', async () => {
    const s = setup('src/lib/store/useSuggestionStore.ts', { reviewSuggestionRpc: async () => ({ decision: 'already', current: 'approved', resultingEntryId: 'kh_win', code: null }) });
    const st = s.mod.useSuggestionStore; st.setState({ suggestions: [sug], hydrate: async () => {} });
    await st.getState().reject('sug1', '사유');
    await flush();
    assert.equal(s.notify.count('notifyUserSuggestionResult'), 0);
    assert.equal(st.getState().suggestions[0].status, 'approved');
  });
  await test('H4-4 코치(새 노하우 승인)가 already·다른 노하우를 받으면 자기 사본을 보관한다', async () => {
    const src = fs.readFileSync(path.join(root, 'src/app/owner/coach.tsx'), 'utf8');
    assert.ok(/archive\w*\(/.test(src) && /already/.test(src.slice(src.indexOf('approveSuggestion(sugId'))), 'coach.tsx 에 already → 보관 갈래가 없다');
  });
  await test('H4-5 매니저는 보관을 부르지 않고(사장만 보관 · 0376) "지웠어요"라고 말하지 않는다', async () => {
    const src = fs.readFileSync(path.join(root, 'src/app/owner/coach.tsx'), 'utf8');
    const br = src.slice(src.indexOf("r.decision === 'already'"), src.indexOf('navAfter();', src.indexOf("r.decision === 'already'")));
    assert.ok(/if \(isOwnerHere\) for \(const id of entryIds\) archiveEntry\(id\)/.test(br), '보관이 사장 조건 없이 불린다');
    assert.ok(/isOwnerHere\s*\?\s*'[^']*지웠어요[^']*'\s*:\s*'[^']*사장님이 정리/.test(br), '매니저 문구가 사장 문구와 같다');
  });

  // ── M1·M2 출퇴근 ──
  console.log('— M1·M2 attendance —');
  const attBase = { records: [], loaded: true, loadError: false, hydrate: async () => {} };
  await test('M1-1 출근은 attendance_check_in(upsertAttendance 를 부르지 않는다)', async () => {
    const s = setup('src/lib/store/useAttendanceStore.ts', { attendanceCheckIn: async (id) => ({ status: 'ok', id }) });
    const a = s.mod.useAttendanceStore; a.setState(attBase);
    a.getState().checkIn('me');
    await flush();
    assert.equal(s.db.count('attendanceCheckIn'), 1);
    assert.equal(s.db.count('upsertAttendance'), 0);
  });
  await test('M1-2 둘째 기기 출근(already)은 낙관 행을 서버 id 로 바꾸고 "이미 출근 중"', async () => {
    const s = setup('src/lib/store/useAttendanceStore.ts', { attendanceCheckIn: async () => ({ status: 'already', id: 'att_srv' }) });
    const a = s.mod.useAttendanceStore; a.setState(attBase);
    a.getState().checkIn('me');
    await flush();
    const ids = a.getState().records.map((r) => r.id);
    assert.equal(ids.join(','), 'att_srv');
    assert.ok(s.toasts.some((t) => /이미 출근 중/.test(t.m)), '안내 없음');
    assert.equal(s.errors(), null);
  });
  await test('M2-1 퇴근은 attendance_check_out · 근무 분은 서버 값', async () => {
    const open = { id: 'att1', staff_id: 'me', date: D, check_in: '2026-11-12T00:00:00.000Z', check_out: null, work_minutes: 0 };
    const s = setup('src/lib/store/useAttendanceStore.ts', { attendanceCheckOut: async () => ({ status: 'ok', id: 'att1', check_out: '2026-11-12T01:17:00.000Z', work_minutes: 77 }) });
    const a = s.mod.useAttendanceStore; a.setState({ ...attBase, records: [open] });
    a.getState().checkOut('me');
    await flush();
    assert.equal(s.db.count('attendanceCheckOut'), 1);
    assert.equal(s.db.count('upsertAttendance'), 0);
    assert.equal(a.getState().records[0].work_minutes, 77);
  });
  await test('M2-2 기존 기록 시간 고치기는 attendance_edit_times · 서버 값으로 바꾼다', async () => {
    const r0 = { id: 'att1', staff_id: 'me', date: D, check_in: '2026-11-12T00:00:00.000Z', check_out: '2026-11-12T02:00:00.000Z', work_minutes: 120 };
    const s = setup('src/lib/store/useAttendanceStore.ts', { attendanceEditTimes: async (id, cin, cout) => ({ id, check_in: cin, check_out: cout, work_minutes: 61, edited_by: 'owner' }) });
    const a = s.mod.useAttendanceStore; a.setState({ ...attBase, records: [r0] });
    a.getState().upsertManual('me', D, '09:00', '10:00', 'owner', 'att1');
    await flush();
    assert.equal(s.db.count('attendanceEditTimes'), 1);
    assert.equal(s.db.count('upsertAttendance'), 0);
    assert.equal(a.getState().records[0].work_minutes, 61);
  });
  await test('M2-3 퇴근 지우기(다시 열기)와 새 기록 추가는 지금처럼 upsert', async () => {
    const r0 = { id: 'att1', staff_id: 'me', date: D, check_in: '2026-11-12T00:00:00.000Z', check_out: '2026-11-12T02:00:00.000Z', work_minutes: 120 };
    const s = setup('src/lib/store/useAttendanceStore.ts', {});
    const a = s.mod.useAttendanceStore; a.setState({ ...attBase, records: [r0] });
    a.getState().upsertManual('me', D, '09:00', null, 'owner', 'att1');
    a.getState().upsertManual('me', D, '12:00', '13:00', 'owner');
    await flush();
    assert.equal(s.db.count('upsertAttendance'), 2);
    assert.equal(s.db.count('attendanceEditTimes'), 0);
  });

  // ── M3 교대 요청 23505 ──
  console.log('— M3 swap —');
  await test('M3-1 같은 근무 요청이 이미 있으면(already) 실패 문구 없이 안내 + 다시 읽기', async () => {
    let hydrated = 0;
    const s = setup('src/lib/store/useScheduleStore.ts', { insertSwap: async () => 'already' });
    const sc = s.mod.useScheduleStore; sc.setState({ swaps: [], hydrate: async () => { hydrated++; } });
    sc.getState().requestSwap({ kind: 'cover', requester_id: 'me', date: D, template_id: 'sh1', note: '' });
    await flush();
    assert.equal(s.errors(), null, String(s.errors()));
    assert.ok(s.toasts.some((t) => /이미 요청한 근무/.test(t.m)), '안내 없음');
    assert.equal(hydrated, 1);
    assert.equal(s.notify.calls.length, 0);
  });

  // ── M13 받은 질문 보내기 ──
  console.log('— M13 submit_unknown_query —');
  const uq = { id: 'uq1', query_text: '포스기 어떻게 켜요', status: 'pending_owner_answer', similar_queries_count: 0, presumed_category: 'Routine', best_match_confidence: 0.1, asked_at: D };
  await test('M13-1 보내기는 submit_unknown_query 한 번 · created 면 사장 알림 한 번', async () => {
    const s = setup('src/lib/store/useUnknownQueueStore.ts', { submitUnknownQuery: async () => ({ decision: 'ok', status: 'created', id: 'uq1', similarCount: 0, code: null }) });
    const q = s.mod.useUnknownQueueStore; q.setState({ queue: [] });
    assert.equal(await q.getState().enqueue(uq), true);
    assert.equal(s.db.count('submitUnknownQuery'), 1);
    assert.equal(s.db.count('insertUnknown') + s.db.count('bumpUnknownSimilar'), 0);
    assert.equal(s.notify.count('notifyStoreQuestion'), 1);
  });
  await test('M13-2 merged 면 사장 알림이 없고 유사 수는 서버 값', async () => {
    const s = setup('src/lib/store/useUnknownQueueStore.ts', { submitUnknownQuery: async () => ({ decision: 'ok', status: 'merged', id: 'uq0', similarCount: 4, code: null }) });
    const q = s.mod.useUnknownQueueStore; q.setState({ queue: [{ ...uq, id: 'uq0', similar_queries_count: 2 }] });
    assert.equal(await q.getState().enqueue({ ...uq, id: 'uq9' }), true);
    assert.equal(s.notify.count('notifyStoreQuestion'), 0);
    assert.equal(s.db.count('bumpUnknownSimilar'), 0);
    assert.equal(q.getState().queue.find((u) => u.id === 'uq0').similar_queries_count, 4);
  });

  // ── M14 공지 ──
  console.log('— M14 notice —');
  const notice = { id: 'n1', date: D, kind: 'notice', text: '마감 청소', authorId: 'other', authorName: '남', authorRole: 'owner', createdAt: '2026-11-12T00:00:00.000Z', roomId: 'room1' };
  await test('M14-1 같은 문구 공지 다시 올리기는 repost_notice(upsertFeed 를 부르지 않는다)', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { repostNotice: async () => ({ createdAt: '2026-11-12T05:00:00.000Z' }) });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, feed: [notice] });
    w.getState().postNotice(D, '마감 청소', 'me', '나', 'owner', true);
    await flush();
    assert.equal(s.db.count('repostNotice'), 1);
    assert.equal(s.db.count('upsertFeed'), 0);
    assert.equal(w.getState().feed[0].createdAt, '2026-11-12T05:00:00.000Z');
  });
  await test('M14-2 글 지우기는 delete_feed_item 한 번(댓글을 따로 지우지 않는다)', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { deleteFeedItemRpc: async () => 'ok' });
    const w = s.mod.useWorkStore;
    w.setState({ ...workBase, feed: [notice, { id: 'c1', kind: 'comment', refId: 'n1', date: D, text: 'ㅇㅋ' }, { id: 'c2', kind: 'comment', refId: 'n1', date: D, text: 'ㅇㅋ' }] });
    w.getState().deleteFeedItem('n1');
    await flush();
    assert.equal(s.db.count('deleteFeedItemRpc'), 1);
    assert.equal(s.db.count('deleteFeed'), 0);
    assert.equal(w.getState().feed.length, 0);
  });
  await test('M14-3 지워진 글에 댓글(feed_parent_gone)은 "글이 지워져 댓글을 달 수 없어요"', async () => {
    const s = setup('src/lib/store/useWorkStore.ts', { insertFeedErr: async () => ({ message: 'feed_parent_gone' }), upsertFeed: async () => false });
    const w = s.mod.useWorkStore; w.setState({ ...workBase, feed: [] });
    w.getState().postComment('n1', D, '댓글', 'me', '나', 'owner');
    await flush();
    assert.ok(/글이 지워져 댓글을 달 수 없어요/.test(s.errors() ?? ''), String(s.errors()));
    assert.equal(w.getState().feed.length, 0);
  });

  // ── M17 반복 근무 묶음 ──
  console.log('— M17 apply_shift_series_ops —');
  await test('M17-1 반복 근무 저장은 apply_shift_series_ops 한 번', async () => {
    const s = setup('src/lib/store/useScheduleStore.ts', { applyShiftSeriesOpsRpc: async () => ({ ok: true, code: null }) });
    const sc = s.mod.useScheduleStore; sc.setState({ templates: [], hydrate: async () => {} });
    const ok = await sc.getState().applySeriesOps('jr', [{ kind: 'add', weekday: 1, from: D }, { kind: 'edit', id: 's1', from: D }], '09:00', '13:00', false);
    assert.equal(ok, true);
    assert.equal(s.db.count('applyShiftSeriesOpsRpc'), 1);
    assert.equal(s.db.count('addShiftSeriesRpc') + s.db.count('editShiftFromRpc') + s.db.count('endShiftFromRpc'), 0);
  });

  // ── S5-1 근무 쓰기 오류 코드 ──
  console.log('— S5-1 shift error codes —');
  await test('S5-1 근무 쓰기 실패 코드(shift_closed)는 문구 표 문구로 말한다', async () => {
    const s = setup('src/lib/store/useScheduleStore.ts', { overrideShiftDayRpc: async () => ({ ok: false, code: 'shift_closed' }) });
    const sc = s.mod.useScheduleStore; sc.setState({ templates: [], hydrate: async () => {} });
    await sc.getState().overrideShiftDay('s1', D, '09:00', '10:00', false);
    const msg = s.errors() ?? '';
    assert.ok(msg && !/근무 수정 저장에 실패/.test(msg), msg);
  });
  await test('S5-1 문구 표에 사용자가 만나는 코드 14개가 있다', async () => {
    const codes = ['staff_not_found', 'shift_closed', 'shift_not_active', 'not_own_shift', 'day_not_scheduled', 'date_out_of_range', 'manager_only', 'no_targets', 'owner_cannot_leave', 'too_many_photos', 'not_member', 'staff_not_member', 'task_not_found', 'feed_parent_gone'];
    const p = 'src/lib/work/errors.ts';
    assert.ok(fs.existsSync(path.join(root, p)), p + ' 없음');
    const m = load(p, {});
    const missing = codes.filter((c) => m.workErrorMessage({ message: c }, '__fallback__') === '__fallback__');
    assert.equal(missing.join(','), '');
  });

  // ── S5-2 · M18 직원 ──
  console.log('— S5-2 · M18 staff —');
  const staff = [{ id: 'jr', name: '직원' }];
  await test('S5-2 이미 나간 직원 내보내기(already)는 실패 문구·되돌리기 없이 다시 읽는다', async () => {
    let hydrated = 0;
    const s = setup('src/lib/store/useStaffStore.ts', { removeStaffMember: async () => 'already' });
    const st = s.mod.useStaffStore; st.setState({ staff, hydrate: async () => { hydrated++; } });
    st.getState().removeStaff('jr');
    await flush();
    assert.equal(s.errors(), null, String(s.errors()));
    assert.equal(st.getState().staff.length, 0);
    assert.equal(hydrated, 1);
  });
  await test('M18 매니저 지정 연타는 한 번만 보낸다', async () => {
    let finish;
    const s = setup('src/lib/store/useStaffStore.ts', { setMemberRoleDb: () => new Promise((r) => { finish = r; }) });
    const st = s.mod.useStaffStore; st.setState({ staff, roles: {} });
    st.getState().setRole('jr', 'manager');
    st.setState({ roles: {} }); // 화면이 아직 옛 값을 그리는 사이 다시 누름
    st.getState().setRole('jr', 'manager');
    finish(true); await flush();
    assert.equal(s.db.count('setMemberRoleDb'), 1);
  });

  // ── M11 읽기 실패가 목록을 비우지 않는다 ──
  console.log('— M11 read failure keeps list —');
  await test('M11-1 받은 질문 다시 읽기 실패 → 이전 목록', async () => {
    const s = setup('src/lib/store/useUnknownQueueStore.ts', { fetchUnknownQueue: async () => ({ data: [], error: true }), fetchPendingQuestionCount: async () => null });
    const q = s.mod.useUnknownQueueStore; q.setState({ queue: [uq] });
    await q.getState().hydrate();
    assert.equal(q.getState().queue.length, 1);
  });
  await test('M11-2 노하우 다시 읽기 실패 → 이전 목록(카테고리 실패·성공 둘 다)', async () => {
    for (const catErr of [true, false]) {
      const s = setup('src/lib/store/usePlaybookStore.ts', { fetchEntries: async () => ({ data: [], error: true }), fetchKnowhowCategories: async () => ({ data: [], error: catErr }) });
      const p = s.mod.usePlaybookStore; p.setState({ entries: [{ id: 'kh1' }] });
      await p.getState().hydrate();
      assert.equal(p.getState().entries.length, 1, 'catErr=' + catErr);
    }
  });
  await test('M11-3 명부 다시 읽기 실패 → 이전 직원·대기 목록', async () => {
    const s = setup('src/lib/store/useStaffStore.ts', {
      fetchStaffProfiles: async () => ({ owner: null, staff: [], roles: {}, error: true }),
      fetchPendingMembers: async () => ({ data: [], error: true }),
    });
    const st = s.mod.useStaffStore; st.setState({ staff, pending: [{ id: 'p1' }], owner: { id: 'me' }, roles: { jr: 'manager' } });
    await st.getState().hydrate();
    assert.equal(st.getState().staff.length, 1);
    assert.equal(st.getState().pending.length, 1);
    assert.equal(st.getState().roles.jr, 'manager');
  });
  await test('M12 명부 재조회가 겹치면 합친다(coalesce)', async () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/store/useStaffStore.ts'), 'utf8');
    assert.ok(/hydrate:\s*coalesce\(/.test(src), 'hydrate 가 coalesce 로 감싸이지 않았다');
  });

  // ── L14 낙관 부분수정은 고친 키만 되돌린다 ──
  console.log('— L14 optimisticPatch —');
  await test('L14 실패 되돌리기는 고친 키만(그 사이 바뀐 다른 키는 남긴다)', async () => {
    const cache = new Map();
    const sync = load('src/lib/store/useSyncStore.ts', {}, cache);
    const h = load('src/lib/store/crudHelpers.ts', { '@/lib/store/useSyncStore': sync }, cache);
    let state = { rows: [{ id: 'a', status: 'pending', note: 'old' }] };
    const set = (fn) => { state = { ...state, ...fn(state) }; };
    const get = () => state;
    let finish;
    const p = h.optimisticPatch(set, get, 'rows', 'a', { status: 'approved' }, () => new Promise((r) => { finish = r; }), 'x');
    state = { rows: [{ ...state.rows[0], note: 'new' }] }; // 그 사이 realtime 이 note 를 바꿈
    finish(false); await p;
    assert.equal(JSON.stringify(state.rows[0]), JSON.stringify({ id: 'a', status: 'pending', note: 'new' }));
  });

  console.log(`\nqa-race-client: pass ${pass} · fail ${fail} · AI 호출 0회`);
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
