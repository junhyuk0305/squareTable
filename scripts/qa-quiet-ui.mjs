// qa-quiet-ui.mjs — 화면의 조용한 오류 실측(2026-11-12 S5 · 로컬 전용 · 브라우저 460px)
//
// 무엇을 재나(세션 S5 범위 2·3·5·9):
//   [2] 교육 링크 손님 화면(/l/[token]) — 닫힌 링크 · 보내기 실패(서버 전 끊김) · 응답 유실(서버는 저장) · 연 뒤 닫힘
//   [3] 공간 저장 왕복 — 질문에 답하기(/space/answer) · 링크 기간 저장(/space/link) → 새로고침 뒤 값이 남는가
//   [5] 카드 결제 응답 유실(/billing-card) — 서버까지 간 요청의 응답만 끊으면 "결제하지 못했어요"가 뜨는가
//   [9] AI 엣지 402·429·5xx — 손님 링크 답(edu_link_answer)과 직원 물어보기(answer). 화면 문구가 사람 말인가 · 재시도 횟수
// AI 는 부르지 않는다. 엣지 응답은 cdp.mockEdge 로 대신 준다. 카드 결제는 가짜 authKey 라 토스에서 실패한다(결제 없음).
//
// 준비: ① 로컬 DB 를 보는 개발 서버(BROWSER=none npx expo start --web --port 8081 · env = localEnv 값 + EXPO_PUBLIC_TOSS_CLIENT_KEY 더미 · CI=1 금지)
//       ② node scripts/qa-local-accounts.mjs(공간 주인 qa.space@example.com · 사장 qa.owner@example.com)
// 실행: node scripts/qa-quiet-ui.mjs --local   · 마지막 줄 = GREEN|RED — pass · fail · skip · 결함(DEFECT) n
// DEFECT = 제품 결함으로 판정한 줄(찾은결함 목록에 적는다). FAIL = 검사가 못 선 것(하니스 문제). 둘 다 RED 다.
import { localEnv, makeLocal } from './lib/qa-fz-local.mjs';
import { launch, storageKeyFor, sleep } from './lib/cdp.mjs';
import { firstRunSeedJs, SETTLED } from './lib/qa-oracles.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const SHOT_DIR = process.env.QA_SHOT_DIR ?? tmpdir();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = localEnv();
const { psql } = makeLocal(env);
const ORIGIN = process.env.QA_ORIGIN ?? 'http://localhost:8081';
const PW_LOCAL = 'QaTest1234!';
const SPACE_EMAIL = 'qa.space@example.com', OWNER_EMAIL = 'qa.owner@example.com';
const JUNIOR_EMAIL = 'staff2@pilot.squaretable.app', JUNIOR_PW = 'pilot1234';
const RUN = `s5${Date.now().toString(36)}`;
// 상한에 걸려도 정리는 한다(process.exit 는 finally 를 건너뛴다 · 11-12 개발 서버가 꺼진 채 돌아 링크 7개가 남았다).
const WATCHDOG = setTimeout(async () => {
  console.log('FAIL: 12분 상한 — 멈춤');
  try { for (const w of opened) await w.close(); await cleanup(); } catch { /* 정리 실패는 다음 실행 시작 정리가 걷는다 */ }
  process.exit(1);
}, 12 * 60 * 1000);

let pass = 0, fail = 0, skip = 0, defect = 0;
const out = (tag, name, extra = '') => console.log(`  ${tag} ${name}${extra ? ` — ${extra}` : ''}`);
const ok = (c, name, extra) => { if (c) { pass++; out('PASS', name, extra); } else { fail++; out('FAIL', name, extra); } return c; };
/** 제품 결함 판정: good = 기대한 올바른 동작이 나왔나. 아니면 DEFECT 로 센다. */
const expectGood = (good, name, extra) => { if (good) { pass++; out('PASS', name, extra); } else { defect++; out('DEFECT', name, extra); } };
const skipped = (name, why) => { skip++; out('SKIP', name, why); };
/** 화면에 개발 값이 보이는가(코드·상태 번호·SQLSTATE). */
const RAW = /(ai_[a-z_]+|\b[a-z]+_[a-z]+(?:_[a-z]+)*\b|PGRST\w*|SQLSTATE|exception|undefined|\bnull\b|\berror\b)/;
/** 걸린 낱말과 앞뒤 40자(어디에 보였나). 없으면 null. */
const rawIn = (t) => {
  const m = t.match(RAW);
  if (!m) return null;
  return `${m[0]} ← "${t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ')}"`;
};

try { await fetch(ORIGIN); } catch { console.log(`FAIL: 개발 서버(${ORIGIN})가 없다`); process.exit(2); }

async function passwordSession(email, pw) {
  const r = await fetch(`${env.URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.ANON }, body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${email} 로그인 실패 — qa-local-accounts 를 먼저 돌린다`);
  return j;
}
const userClient = async (email, pw) => {
  const { createClient } = await import('@supabase/supabase-js');
  const c = createClient(env.URL_, env.ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  c.uid = data.user.id;
  return c;
};

const STORAGE_KEY = storageKeyFor(env.URL_);
const INJECT = `(()=>{try{${firstRunSeedJs(ROOT)}}catch(e){}})()`;
let port = 9420;
async function browser(session) {
  const w = await launch({ origin: ORIGIN, storageKey: STORAGE_KEY, width: 460, height: 900, port: port++ });
  if (session) await w.page.seedSession(session);
  else await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear()}catch(e){}' });
  await w.page.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  return w;
}
const hasText = (page, s, ms = 15000) => page.waitFor(`document.body && document.body.innerText.includes(${JSON.stringify(s)})`, ms);
const byLabel = (l) => `[aria-label="${l}"]`;
/** 누른 뒤 새로 뜬 실패 문구 한 줄(못했어요·다시·닫혔어요). 없으면 null. */
async function newWarn(page, before, ms = 8000) {
  const had = new Set(before.split('\n').map((x) => x.trim()));
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const lines = (await page.text().catch(() => '')).split('\n').map((x) => x.trim()).filter((x) => x && !had.has(x));
    const hit = lines.find((x) => /못했어요|다시|닫혔어요|잠시/.test(x));
    if (hit) return hit.slice(0, 80);
    await sleep(150);
  }
  return null;
}
async function settle(page, path) {
  const t0 = Date.now();
  await page.goto(path);
  if (!(await page.waitFor(SETTLED, 180000))) throw new Error(`${path} 가 안 떴다`);
  console.log(`  · ${path.split('?')[0].slice(0, 40)} 뜸 ${Math.round((Date.now() - t0) / 1000)}초`);
  await sleep(800);
}

// ── 셋업: 공간 · 링크 ────────────────────────────────────────────────────────
const space = await userClient(SPACE_EMAIL, PW_LOCAL);
const SPACE_ID = psql(`select m.unit_id from unit_members m join units u on u.id = m.unit_id where m.user_id = '${space.uid}' and m.role = 'space_owner' and u.kind = 'space' limit 1`);
if (!SPACE_ID) { console.log('FAIL: 공간이 없다 — qa-local-accounts 를 먼저 돌린다'); process.exit(2); }
// 링크 만들기·닫기는 이 세션이 공간에 들어가 있어야 된다(auth_space_id = 세션별).
{ const { error } = await space.rpc('enter_space', { p_space: SPACE_ID }); if (error) { console.log(`FAIL: enter_space ${error.message}`); process.exit(2); } }
const links = [];
// 지난 실행이 죽어 남긴 링크(제목 앞 s5…)를 먼저 걷는다.
{ const old = psql(`select coalesce(string_agg(quote_literal(id), ','), '') from public.edu_links where unit_id = '${SPACE_ID}' and title ~ '^s5[a-z0-9]+ '`); if (old) { psql(`delete from public.question_replies where uq_id in (select id from public.unknown_queries where link_id in (${old}))`); psql(`delete from public.unknown_queries where link_id in (${old})`); psql(`delete from public.edu_links where id in (${old})`); console.log('  · 지난 실행 잔재 링크 정리'); } }
async function newLink(title) {
  const { data, error } = await space.rpc('edu_link_create', { p_unit: SPACE_ID, p_title: `${RUN} ${title}`, p_entry_ids: [], p_days: 7 });
  if (error) throw new Error(`edu_link_create: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  links.push(row.id);
  return row;
}
const cqCount = (linkId) => Number(psql(`select count(*) from public.edu_guest_questions where link_id = '${linkId}'`) || 0);

async function cleanup() {
  if (!links.length) return;
  const ids = links.map((x) => `'${x}'`).join(',');
  try {
    psql(`delete from public.question_replies where uq_id in (select id from public.unknown_queries where link_id in (${ids}))`);
    psql(`delete from public.edu_guest_questions where link_id in (${ids})`);
    psql(`delete from public.unknown_queries where link_id in (${ids})`);
    psql(`delete from public.chat_queries where link_id in (${ids})`);
    psql(`delete from public.edu_link_guests where link_id in (${ids})`);
    psql(`delete from public.edu_links where id in (${ids})`);
  } catch (e) { console.log(`  · 정리 오류: ${String(e.message).slice(0, 120)}`); }
  const left = psql(`select count(*) from public.edu_links where id in (${ids})`);
  console.log(`  · 정리: 남은 링크 ${left}`);
}

const opened = [];
// --only=2,9g,3,5,9j 로 묶음만 돈다(없으면 전부).
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
try {
  // ════ [2] 손님 링크 ════
  console.log('[2] 교육 링크 손님 화면');
  if (want('2')) {
    const closedL = await newLink('닫힌 링크');
    await space.rpc('edu_link_close', { p_link: closedL.id });
    const w = await browser(null); opened.push(w);
    await settle(w.page, `/l/${closedL.token}`);
    ok(await hasText(w.page, '이 링크는 닫혔어요'), '닫힌 링크 → 닫힘 문구');

    const L = await newLink('보내기');
    await settle(w.page, `/l/${L.token}`);
    const formUp = await w.page.waitFor(`!!document.querySelector('${byLabel('질문 보내기')}')`, 20000);
    if (!ok(formUp, '열린 링크 → 질문 칸이 뜬다')) throw new Error('질문 칸 없음');
    await w.page.mockEdge({ ai: { status: 500, body: { error: 'ai_failed' } } }); // 실제 AI 를 부르지 않는다
    await w.page.type(byLabel('내 이름'), 'QA손님');
    await w.page.type(byLabel('궁금한 걸 물어보세요'), '첫 질문 보내기 실패 확인');

    // a. 서버 전에 끊김 → 실패 토스트 · 서버 행 0
    await w.page.failRpc(['edu_link_ask']);
    let before = await w.page.text();
    await w.page.click(byLabel('질문 보내기'));
    const warnA = await newWarn(w.page, before);
    ok(!!warnA, '보내기 실패(서버 전) → 실패 문구가 뜬다', warnA ?? '안 뜸');
    ok(cqCount(L.id) === 0, '보내기 실패(서버 전) → 서버 행 0');
    await w.page.failRpc([]);

    // b. 응답 유실(서버는 저장) → 화면은 실패라고 한다. 다시 보내면 중복이 생기나
    await w.page.dropResponse(['edu_link_ask']);
    await sleep(4500); // 앞 토스트가 걷히게
    before = await w.page.text();
    await w.page.click(byLabel('질문 보내기'));
    const warnB = await newWarn(w.page, before);
    const afterDrop = cqCount(L.id);
    const saidFail = !!warnB;
    out('  ·', `응답 유실 때 화면 문구: ${warnB ?? '없음'}`);
    ok(afterDrop === 1, '응답 유실 → 서버는 질문 1건을 저장했다', `행 ${afterDrop}`);
    await w.page.dropResponse([]);
    await sleep(3500);
    // 입력칸에 글이 남아 있으면 사람은 다시 누른다
    const textLeft = await w.page.eval(`(document.querySelector('${byLabel('궁금한 걸 물어보세요')}')||{}).value||''`);
    if (textLeft) await w.page.click(byLabel('질문 보내기'));
    await sleep(3000);
    const afterRetry = cqCount(L.id);
    expectGood(!(saidFail && afterRetry > 1), '응답 유실 뒤 다시 보내기 → 같은 질문이 두 번 쌓이지 않는다',
      `실패 문구 ${saidFail ? '뜸' : '안 뜸'} · 글 ${textLeft ? '남음' : '비움'} · 서버 행 ${afterDrop}→${afterRetry}`);

    // c. 연 뒤 링크가 닫힘 → 닫힘 문구(개발 값 없음)
    await space.rpc('edu_link_close', { p_link: L.id });
    await w.page.type(byLabel('궁금한 걸 물어보세요'), '닫힌 뒤 질문');
    await w.page.click(byLabel('질문 보내기'));
    ok(await hasText(w.page, '이 링크는 닫혔어요', 8000), '연 뒤 닫힘 → 보내기에서 닫힘 문구');
    const t = await w.page.text();
    ok(!rawIn(t.replace(/QA손님|s5[a-z0-9]+/g, '')), '손님 화면에 개발 값 없음', rawIn(t) ?? '');
    await w.close(); opened.pop();
  }

  // ════ [9] AI 엣지 상태(손님 링크) ════
  console.log('[9] AI 엣지 402·429·5xx — 손님 링크');
  const CASES = [
    { key: '402', resp: { status: 402, body: { error: 'ai_quota_exceeded', cap: 10, used: 10, scope: 'space' } }, hits: 1, text: '이번 달 AI 답은 다 썼어요', sent: true },
    { key: '429', resp: { status: 429, body: { error: 'rate_limited' } }, hits: 1, text: '노하우에 아직 없어요', sent: false },
    { key: '500', resp: { status: 500, body: { error: 'internal' } }, hits: 2, text: '노하우에 아직 없어요', sent: false },
    { key: '500 ai_failed', resp: { status: 500, body: { error: 'ai_failed' } }, hits: 1, text: '노하우에 아직 없어요', sent: false },
  ];
  let answerQid = null;
  for (const c of want('9g') ? CASES : []) {
    const L = await newLink(`AI 상태 ${CASES.indexOf(c) + 1}`);
    const w = await browser(null); opened.push(w);
    await settle(w.page, `/l/${L.token}`);
    await w.page.waitFor(`!!document.querySelector('${byLabel('질문 보내기')}')`, 20000);
    await w.page.mockEdge({ ai: c.resp });
    await w.page.type(byLabel('내 이름'), 'QA손님');
    await w.page.type(byLabel('궁금한 걸 물어보세요'), `엣지 상태 확인 질문 ${CASES.indexOf(c) + 1}번`);
    await w.page.click(byLabel('질문 보내기'));
    const shown = await hasText(w.page, c.text, 15000);
    await sleep(1200);
    const t = await w.page.text();
    ok(shown, `${c.key} → "${c.text}"`);
    ok(w.page.edgeHits('ai') === c.hits, `${c.key} → 엣지 호출 ${c.hits}번`, `실제 ${w.page.edgeHits('ai')}`);
    ok(w.page.requests.includes('edu_link_send') === c.sent, `${c.key} → 바로 보내기 ${c.sent ? '함' : '안 함'}`);
    ok(!rawIn(t.replace(/엣지 상태 확인 질문 [0-9]+번|QA손님|s5[a-z0-9]+/g, '')), `${c.key} → 개발 값 없음`, rawIn(t) ?? '');
    if (c.key === '429') {
      // [3] 재료: 사람에게 보내 공간 주인이 답할 질문을 만든다
      const btn = '[aria-label$="께 보내기"]';
      if (await w.page.waitFor(`!!document.querySelector('${btn}')`, 5000)) {
        await w.page.click(btn);
        await hasText(w.page, '질문을 보냈어요', 8000);
        answerQid = psql(`select id from public.unknown_queries where link_id = '${L.id}' and status = 'pending_owner_answer' limit 1`) || null;
      }
    }
    await w.close(); opened.pop();
  }

  // ════ [3] 공간 저장 왕복 ════
  console.log('[3] 공간 저장 왕복');
  // 손님 묶음을 안 돌렸으면 고정 질문(qa-local-accounts)을 쓴다.
  if (!answerQid) answerQid = psql(`select id from public.unknown_queries where unit_id = '${SPACE_ID}' and status = 'pending_owner_answer' order by asked_at desc limit 1`) || null;
  if (want('3')) {
    const w = await browser(await passwordSession(SPACE_EMAIL, PW_LOCAL)); opened.push(w);
    if (!answerQid) skipped('질문에 답하기 → 새로고침 뒤 남음', '답할 질문을 못 만들었다([9] 429 보내기)');
    else {
      await settle(w.page, `/space/answer/${answerQid}?space=${SPACE_ID}`);
      const up = await w.page.waitFor(`!!document.querySelector('${byLabel('답을 적어 주세요')}')`, 30000);
      if (ok(up, '답하기 화면이 뜬다')) {
        await w.page.type(byLabel('답을 적어 주세요'), 'QA 답: 왕복 확인');
        await w.page.click(byLabel('보내기'));
        ok(await hasText(w.page, '답을 보냈어요', 10000), '답 보내기 → "답을 보냈어요"');
        const n = Number(psql(`select count(*) from public.question_replies where uq_id = '${answerQid}' and body = 'QA 답: 왕복 확인'`));
        ok(n === 1, '답이 서버에 1건', `${n}`);
        await settle(w.page, `/space/answer/${answerQid}?space=${SPACE_ID}`);
        ok(await hasText(w.page, '이미 답한 질문이에요', 20000), '새로고침 뒤 → "이미 답한 질문이에요"');
      }
    }
    // 링크 기간 늘리기(공간 설정 중 저장 가능한 값)
    const L = await newLink('기간');
    const before = psql(`select expires_at from public.edu_links where id = '${L.id}'`);
    await settle(w.page, `/space/link/${L.id}?unit=${SPACE_ID}&space=${SPACE_ID}`);
    const up = await w.page.waitFor(`!!document.querySelector('${byLabel('14일')}')`, 30000);
    if (!ok(up, '링크 상세가 뜬다')) {
      const shot = join(SHOT_DIR, 'qa-quiet-ui-link.png');
      await w.page.shot(shot).catch(() => {});
      out('  ·', `화면: ${(await w.page.text()).replace(/\s+/g, ' ').slice(0, 200)} · ${await w.page.path()} · ${shot}`);
    } else {
      await w.page.click(byLabel('14일'));
      await w.page.click(byLabel('저장'));
      ok(await hasText(w.page, '저장했어요', 10000), '기간 저장 → "저장했어요"');
      const after = psql(`select round(extract(epoch from expires_at - created_at) / 86400) from public.edu_links where id = '${L.id}'`);
      ok(after === '14', '서버 기간 = 만든 날 + 14일', `${before} → +${after}일`);
      await settle(w.page, `/space/link/${L.id}?unit=${SPACE_ID}&space=${SPACE_ID}`);
      const shownEnd = await w.page.waitFor(`document.body.innerText.includes('남음') || document.body.innerText.includes('까지')`, 15000);
      ok(shownEnd, '새로고침 뒤 상세가 다시 뜬다');
    }
    skipped('공간 노하우 쓰기 왕복', '코치 대화(엣지 ai)로만 저장한다 · 엣지 응답 모양을 꾸며야 해서 이번 범위 밖');
    await w.close(); opened.pop();
  }

  // ════ [5] 카드 결제 응답 유실 ════
  console.log('[5] 카드 결제 응답 유실');
  if (want('5')) {
    const w = await browser(await passwordSession(OWNER_EMAIL, PW_LOCAL)); opened.push(w);
    await w.page.dropResponse(['card-billing']);
    const t0 = Date.now();
    await settle(w.page, `/billing-card?mode=subscribe&plan=single&stores=1&authKey=${RUN}&customerKey=${RUN}`);
    const done = await w.page.waitFor(`/결제하지 못했어요|결제 결과를 확인하고 있어요|결제가 승인되지 않았어요|결제가 완료됐어요/.test(document.body.innerText)`, 30000);
    const t = await w.page.text();
    if (!done) { fail++; out('FAIL', '카드 결제 화면이 결과를 그리지 않았다', (await w.page.path())); }
    else {
      const title = t.match(/결제하지 못했어요|결제 결과를 확인하고 있어요|결제가 승인되지 않았어요|결제가 완료됐어요/)[0];
      expectGood(title === '결제 결과를 확인하고 있어요', '응답 유실(서버까지 감) → "확인하고 있어요"로 보인다', `실제 "${title}" · ${Math.round((Date.now() - t0) / 1000)}초`);
    }
    await w.page.dropResponse([]);
    await w.close(); opened.pop();
  }

  // ════ [9] AI 엣지 상태(직원 물어보기) ════
  console.log('[9] AI 엣지 402·429·5xx — 직원 물어보기');
  if (want('9j')) {
    const title = psql(`select title from public.playbook_entries where unit_id = 'store_001' and status = 'published' and archived_at is null and brand_entry_id is null order by created_at limit 1`);
    if (!title) skipped('직원 물어보기 3건', 'store_001 에 발행된 노하우가 없다');
    else {
      // 직원 물어보기는 분류(triage)·검색(search)을 먼저 엣지로 부른다. 엣지가 402·429·5xx 면 글자 검색으로 떨어져
      // 저장된 노하우를 그대로 보여 줘야 한다(개발 값·가짜 성공 문구 없이). 답 만들기(answer) 갈래는 검색 응답 모양을
      // 꾸며야 닿아서 여기서 재지 않는다(분류 = client.ts callEdge · 402 → AiQuotaError · 429 = 4xx 즉시 실패 → 기본 안내).
      const JCASES = [
        { key: '402', resp: { status: 402, body: { error: 'ai_quota_exceeded', cap: 10, used: 10, scope: 'store' } } },
        { key: '429', resp: { status: 429, body: { error: 'rate_limited' } } },
        { key: '503', resp: { status: 503, body: { error: 'internal' } } },
      ];
      const w = await browser(await passwordSession(JUNIOR_EMAIL, JUNIOR_PW)); opened.push(w);
      await settle(w.page, '/junior/chat');
      for (const c of JCASES) {
        const input = '[placeholder="궁금한 걸 물어보세요"]';
        if (!(await w.page.waitFor(`!!document.querySelector('${input}')`, 30000))) { fail++; out('FAIL', `${c.key} 입력칸 없음`, await w.page.path()); break; }
        await w.page.mockEdge({ ai: c.resp });
        await w.page.type(input, title);
        const before = await w.page.text();
        await w.page.click(byLabel('질문 보내기'));
        const warn = await newWarn(w.page, before, 8000);
        await sleep(1500);
        const tasks = w.page.edgeTasks('ai');
        const t = `${await w.page.text()} ${warn ?? ''}`;
        const tail = t.split(title).pop().replace(/\s+/g, ' ').trim().slice(0, 100);
        out('  ·', `${c.key}: 엣지 일 [${tasks.join(',')}] · 새 문구 ${warn ?? '없음'} · 질문 뒤: ${tail}`);
        ok(tasks.includes('triage') && tasks.includes('search'), `${c.key} → 분류·검색을 엣지로 불렀다`);
        ok(t.includes('원문 보기'), `${c.key} → 엣지가 실패해도 저장된 노하우를 보여 준다`);
        ok(!rawIn(t.replace(title, '')), `${c.key} → 개발 값 없음`, rawIn(t) ?? '');
      }
      skipped('직원 답 만들기(answer) 402·429·5xx 화면', '검색 응답 모양을 꾸며야 닿는다 · 코드로만 확인');
      await w.page.mockEdge({});
      await w.close(); opened.pop();
    }
  }
} catch (e) {
  fail++; out('FAIL', '하니스 중단', String(e.message ?? e).slice(0, 200));
} finally {
  for (const w of opened) await w.close();
  await cleanup();
}
clearTimeout(WATCHDOG);
const red = fail + defect > 0;
console.log(`\n${red ? 'RED' : 'GREEN'} — pass ${pass} · fail ${fail} · skip ${skip} · 결함 ${defect} · AI 호출 0회`);
process.exit(red ? 1 : 0);
