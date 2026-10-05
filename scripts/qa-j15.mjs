#!/usr/bin/env node
// qa-j15.mjs — J15 ①~④ (2026-10-05 사용자 결정 · 계획 P5-10 · 설계 05 §14). ⑤ 웹 결제 내역은 토스 동결이라 뺀다.
//   ① 채팅 전송이 실패하면 글을 남기고 [다시 보내기]를 준다.
//   ② 내 메시지는 24시간 안에 고친다. 지우기 전에 묻는다. 서버도 24시간을 강제한다(0252 · 직접 UPDATE 포함).
//   ③ 앱이 다시 앞으로 오면(30초 넘게 뒤에 있었으면) 공지·근무표 등을 다시 읽는다.
//   ④ 본사 화면을 좁은 폰 브라우저로 열면 "컴퓨터에서 열어 주세요" 안내 한 장.
// DB 검사는 로컬 도커 트랜잭션(되돌림 · 고정 계정 · 계정 신설 없음). 실행: node scripts/qa-j15.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const fn = (f) => typeof f === 'function';
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8') : '');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const load = async (p) => { try { return await import(p); } catch (e) { check(`모듈 ${p}`, false, String(e?.code ?? e)); return {}; } };

const H = 3600000;
const NOW = Date.parse('2026-10-05T12:00:00+09:00');
const iso = (ms) => new Date(ms).toISOString();

console.log('[1] 채팅 규칙(src/lib/work/chatRules.ts)');
{
  const { canEditMessage, deleteConfirmText, markSendFailed, FEED_EDIT_WINDOW_MS } = await load('../src/lib/work/chatRules.ts');
  const msg = (o) => ({ id: 'f1', date: '2026-10-05', kind: 'message', text: '안녕', authorId: 'me', authorName: '나', authorRole: 'junior', createdAt: iso(NOW - H), ...o });
  check('수정 기간 = 24시간', FEED_EDIT_WINDOW_MS === 24 * H);
  const ce = (it) => (fn(canEditMessage) ? canEditMessage(it, 'me', NOW) : undefined);
  check('★내 메시지 · 1시간 전 → 고칠 수 있다', ce(msg()) === true);
  check('★내 메시지 · 25시간 전 → 못 고친다', ce(msg({ createdAt: iso(NOW - 25 * H) })) === false);
  check('남의 메시지 → 못 고친다', ce(msg({ authorId: 'you' })) === false);
  check('사진만 있는 메시지 → 못 고친다', ce(msg({ text: '', photoUrl: 'p' })) === false);
  check('전송 실패한 메시지 → 못 고친다', ce(msg({ sendState: 'failed' })) === false);
  check('메시지가 아닌 것(완료 알림) → 못 고친다', ce(msg({ kind: 'task_done' })) === false);
  const dc = (it) => (fn(deleteConfirmText) ? deleteConfirmText(it, 'me') : null);
  check('★내 메시지 삭제 확인 문구', dc(msg())?.message === '이 메시지를 지울까요?', JSON.stringify(dc(msg())));
  check('★남의 메시지 삭제 확인 문구(사장·매니저)', dc(msg({ authorId: 'you' }))?.message === '다른 사람의 메시지예요. 모두에게서 사라져요.', JSON.stringify(dc(msg({ authorId: 'you' }))));
  const feed = [msg({ id: 'a' }), msg({ id: 'b' })];
  const after = fn(markSendFailed) ? markSendFailed(feed, 'b') : feed.filter((f) => f.id !== 'b');
  check('★① 전송 실패 → 글을 지우지 않고 실패로 표시한다', after.length === 2 && after[1].sendState === 'failed' && after[0].sendState === undefined, JSON.stringify(after.map((f) => f.sendState ?? '-')));

  // 논리 점검 D4 — 새로고침(hydrate)이 실패·전송 중 메시지를 지우지 않는다. 다시 보내면 지금 시각으로 들어간다.
  const { carryUnsent, restampForResend } = await load('../src/lib/work/chatRules.ts');
  const server = [msg({ id: 'a' })];
  const local = [msg({ id: 'a' }), msg({ id: 'b', sendState: 'failed' }), msg({ id: 'c' }), msg({ id: 'gone' })];
  const merged = fn(carryUnsent) ? carryUnsent(server, local, new Set(['c'])) : server;
  check('★D4 새로고침 뒤에도 실패한 내 메시지가 남는다(실패 표시 그대로)', merged.some((f) => f.id === 'b' && f.sendState === 'failed'), JSON.stringify(merged.map((f) => f.id)));
  check('★D4 아직 저장 중인 내 메시지도 남는다', merged.some((f) => f.id === 'c'), JSON.stringify(merged.map((f) => f.id)));
  check('D4 서버에서 지워진 다른 글은 남기지 않는다 · 서버에 있는 글은 한 번만', !merged.some((f) => f.id === 'gone') && merged.filter((f) => f.id === 'a').length === 1, JSON.stringify(merged.map((f) => f.id)));
  const again = fn(carryUnsent) ? carryUnsent([msg({ id: 'b' })], local, new Set()) : [];
  check('D4 서버에 이미 들어간 글은 서버 것을 쓴다(중복 없음)', again.length === 1 && again[0].sendState === undefined, JSON.stringify(again));
  const re = fn(restampForResend) ? restampForResend(msg({ id: 'b', sendState: 'failed', date: '2026-10-04', createdAt: iso(NOW - 26 * H) }), iso(NOW), '2026-10-05') : null;
  check('★D4 다시 보내면 지금 시각·오늘 날짜로 들어간다(id 는 그대로)', re?.id === 'b' && re?.createdAt === iso(NOW) && re?.date === '2026-10-05' && re?.sendState === undefined, JSON.stringify(re));
}

console.log('\n[2] 앞으로 돌아오면 다시 읽기(src/lib/app/foreground.ts)');
{
  const { shouldRefreshOnForeground } = await load('../src/lib/app/foreground.ts');
  const r = (prev, next, away) => (fn(shouldRefreshOnForeground) ? shouldRefreshOnForeground(prev, next, NOW - away, NOW) : undefined);
  check('★뒤에 31초 → 다시 읽는다', r('background', 'active', 31000) === true);
  check('뒤에 10초 → 다시 읽지 않는다', r('background', 'active', 10000) === false);
  check('inactive → active(31초)도 다시 읽는다', r('inactive', 'active', 31000) === true);
  check('active → background 는 아니다', r('active', 'background', 31000) === false);
}

console.log('\n[3] 본사 화면 폭(src/lib/brand/hqNarrow.ts)');
{
  const { hqNarrow, HQ_MIN_WIDTH } = await load('../src/lib/brand/hqNarrow.ts');
  check('기준 폭 900', HQ_MIN_WIDTH === 900);
  check('★폰 폭 390 → 안내', fn(hqNarrow) && hqNarrow(390) === true);
  check('넓은 화면 1280 → 그대로', fn(hqNarrow) && hqNarrow(1280) === false);
}

console.log('\n[4] 배선(주석 제외 코드)');
{
  const store = strip(read('src/lib/store/useWorkStore.ts'));
  const pm = (store.match(/postMessage: \(date, text[\s\S]*?\n  \},/) || [''])[0];
  check('★① postMessage 실패가 글을 지우지 않고 markSendFailed 로 표시한다', /markSendFailed\(/.test(pm) && !/feed: s\.feed\.filter\(\(f\) => f\.id !== item\.id\)/.test(pm));
  check('① retryMessage · discardFailedMessage 가 있다', /retryMessage: /.test(store) && /discardFailedMessage: /.test(store));
  check('★D4 hydrate 가 서버 피드에 실패·저장 중 메시지를 다시 얹는다(carryUnsent)', /feed: carryUnsent\(live\.feed, get\(\)\.feed, sendingIds\)/.test(store));
  const rm = (store.match(/retryMessage: \(id\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★D4 다시 보내기가 지금 시각으로 새로 찍는다(restampForResend)', /restampForResend\(failed, new Date\(\)\.toISOString\(\), todayStr\(\)\)/.test(rm));
  const db = strip(read('src/lib/db.ts'));
  check('① 저장할 때 sendState 를 서버에 싣지 않는다', /export async function upsertFeed[\s\S]{0,400}sendState/.test(db));
  const chat = strip(read('src/components/work/WorkChat.tsx'));
  check('① 실패한 말풍선에 [다시 보내기]', chat.includes('다시 보내기') && chat.includes('전송 실패'));
  check('② 시트에 [수정] (canEditMessage) · "(수정됨)" 표시', /canEditMessage\(/.test(chat) && chat.includes('(수정됨)'));
  check('★② 삭제 전에 확인창(deleteConfirmText · confirmAction)', /deleteConfirmText\(/.test(chat) && /confirmAction\(/.test(chat));
  for (const p of ['src/app/owner/_layout.tsx', 'src/app/junior/_layout.tsx']) {
    check(`③ ${p} 가 useForegroundRefresh 를 쓴다`, /useForegroundRefresh\(/.test(strip(read(p))));
  }
  // G2(QA 2026-10-05): 앱 착지 화면(/hub)·매장 목록·통합 알림은 두 _layout 밖이라 다시 열어도 어제 숫자가 남았다.
  for (const [p, needs] of [
    ['src/components/hub/OwnerStatusView.tsx', ['hydrateOwner()', 'hydrateCross()', 'hydratePrefs()', 'hydrateKnowhowStats()']],
    ['src/components/hub/JuniorTodayView.tsx', ['hydrateJunior()', 'hydrateCross()', 'hydratePrefs()']],
    ['src/app/notifications.tsx', ['hydrateCross()']],
    ['src/app/stores.tsx', ['setFgTick(']],
  ]) {
    const s = strip(read(p));
    const call = (s.match(/useForegroundRefresh\([\s\S]*?\n  \}\);/) || [''])[0];
    check(`★G2 ${p} 가 앞으로 돌아오면 소속과 화면 데이터를 다시 읽는다`,
      /refreshMembership\(\)/.test(call) && needs.every((n) => call.includes(n)), call.slice(0, 120));
  }
  {
    const s = strip(read('src/app/stores.tsx'));
    check('G2 매장 목록의 지표·잠김 읽기가 다시 돈다(fgTick 의존)', (s.match(/\}, \[[^\]]*\bfgTick\b[^\]]*\]\);/g) || []).length >= 2);
  }
  // G4(QA 2026-10-05): 물어보기 대화 — 복귀 새로고침이 실패하면 대화가 통째로 비고, 저장 실패한 답도 다음 새로고침에 사라졌다.
  {
    const fcq = (db.match(/export async function fetchChatQueries[\s\S]*?\n\}/) || [''])[0];
    check('★G4 fetchChatQueries 가 실패를 빈 목록과 가른다(ReadResult)',
      /Promise<ReadResult<ChatQuery\[\]>>/.test(fcq) && /return \{ data: \[\], error: true \}/.test(fcq), fcq.slice(0, 100));
    const cs = strip(read('src/lib/store/useChatStore.ts'));
    const hy = (cs.match(/hydrate: async \(juniorId\) => \{[\s\S]*?\n  \},/) || [''])[0];
    check('★G4 hydrate 가 읽기 실패면 화면의 대화를 지우지 않는다', /if \(error\) \{ set\(\{ loaded: true \}\); return; \}/.test(hy), hy.slice(0, 200));
    check('★G4 hydrate 가 서버에 아직 없는 내 답(저장 중·저장 실패)을 다시 얹는다', /_unsynced\.has\(/.test(hy));
    check('G4 대화 저장은 서버에 들어갈 때까지 표시해 둔다(직접 insertChatQuery 안 부름)',
      (cs.match(/insertChatQuery\(/g) || []).length === 1 && /_unsynced\.add\(/.test(cs) && /_unsynced\.delete\(/.test(cs));
  }
  const fg = strip(read('src/lib/app/useForegroundRefresh.ts'));
  check('③ AppState 로 듣고 shouldRefreshOnForeground 로 고른다 · 자동 토큰 갱신을 묶는다', /AppState\.addEventListener/.test(fg) && /shouldRefreshOnForeground\(/.test(fg) && /startAutoRefresh/.test(fg) && /stopAutoRefresh/.test(fg));
  const shell = strip(read('src/components/shell/AppShell.web.tsx'));
  check('④ 본사 셸이 좁으면 안내 한 장(hqNarrow · HqNarrowNotice)', /hqNarrow\(/.test(shell) && /HqNarrowNotice/.test(shell));
  check('④ 안내 문구', read('src/components/shell/HqNarrowNotice.tsx').includes('컴퓨터에서 열어 주세요'));
}

console.log('\n[5] 서버 24시간 규칙(0252 · 로컬 도커 트랜잭션)');
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300);
  }
};
let dbUp = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { dbUp = false; }
if (!dbUp) {
  console.log('  SKIP 로컬 도커 DB 없음');
} else {
  const SETUP = `
begin;
select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
insert into public.work_feed (id, unit_id, feed_date, room_id, data) values
  ('qa_j15_old', 'store_001', current_date, null, jsonb_build_object('id','qa_j15_old','kind','message','text','옛 글','authorId',current_setting('qa.j'),'createdAt', to_char((now() - interval '25 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  ('qa_j15_new', 'store_001', current_date, null, jsonb_build_object('id','qa_j15_new','kind','message','text','새 글','authorId',current_setting('qa.j'),'createdAt', to_char((now() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  ('qa_j15_ntc', 'store_001', current_date, null, jsonb_build_object('id','qa_j15_ntc','kind','notice','text','공지','authorId',current_setting('qa.j'),'createdAt', to_char((now() - interval '30 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.j'), 'role', 'authenticated')::text, true);
`;
  const run = (body) => psql(`${SETUP}${body}\nrollback;\n`);
  const a = run(`select 'R=' || public.edit_feed_text('qa_j15_old', '고침');`);
  check('★② 25시간 지난 내 메시지를 edit_feed_text 로 못 고친다(edit_window_passed)', a.includes('edit_window_passed'), a.slice(0, 200));
  const b = run(`select 'R=' || public.edit_feed_text('qa_j15_new', '고침');
select 'E=' || coalesce((select data->>'editedAt' from public.work_feed where id = 'qa_j15_new'), 'null');`);
  check('★② 1시간 전 내 메시지는 고친다 · editedAt 을 남긴다', b.includes('R=true') && /E=\d{4}-/.test(b), b.slice(0, 200));
  const c = run(`update public.work_feed set data = jsonb_set(data, '{text}', '"직접"') where id = 'qa_j15_old';`);
  check('★② 옛 앱 직접 UPDATE 로도 25시간 지난 메시지 본문을 못 고친다', c.includes('edit_window_passed'), c.slice(0, 200));
  const d = run(`select 'R=' || public.edit_feed_text('qa_j15_ntc', '공지 고침');`);
  check('② 공지는 지금처럼 기간 제한 없이 고친다', d.includes('R=true'), d.slice(0, 200));
  const e = run(`update public.work_feed set data = data || '{"x":1}'::jsonb where id = 'qa_j15_old';`);
  check('② 본문이 아닌 칸 갱신은 막지 않는다', !e.includes('ERR='), e.slice(0, 200));
  const f = psql(`select has_function_privilege('anon', 'public.edit_feed_text(text, text)', 'execute')::text || ',' || has_function_privilege('authenticated', 'public.edit_feed_text(text, text)', 'execute')::text;`);
  check('edit_feed_text: anon 실행 불가 · authenticated 실행 가능', f.trim() === 'false,true', f);
}

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
