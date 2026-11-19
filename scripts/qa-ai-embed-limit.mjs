// scripts/qa-ai-embed-limit.mjs — 검색 색인(task=embed)이 코치 대화 한도를 먹지 않는가 (A1 · 2026-11-19)
//
// 무엇을 보나 (첫 사용 측정 2026-11-17 에서 나온 결함):
//   새 사장이 온보딩에서 추천 노하우 10개를 담으면 앱이 색인 요청(embed) 10개를 한꺼번에 보낸다.
//   엣지 레이트리밋이 embed 도 대화 한도(사람당 분당 10)로 세서, 곧바로 보낸 첫 노하우 정리(square)가 429 를 맞았다.
//   ① embed 10개를 동시에 보낸다 → 10개 모두 429 가 아니어야 한다
//   ② 곧바로 square 를 보낸다 → 429 가 아니어야 한다 (수정 전 RED 는 여기서 난다)
//   ③ 색인 행 10개가 DB 에 있다(앱이 찍는 "색인 대기" 행 · 다음 진입 때 embedBacklog 가 다시 만든다)
//   ④ 실제 벡터가 채워졌는지 — 로컬은 AI 를 부르지 않는다(엣지 env 의 HTTPS_PROXY 가 Gemini 를 막는다).
//      엣지에 Gemini 주소를 바꾸는 env 가 없고, 테스트 전용 스위치를 넣지 않기로 했다 → 벡터 검사는 skip (AI) 로 센다.
//      벡터가 채워져 있으면 AI 가 실제로 불렸다는 뜻이라 그 수를 AI 호출 수로 찍는다.
//   ⑤ 색인에도 상한이 있다 — 같은 사람이 embed 를 더 몰아 보내면 언젠가 429 가 난다(무제한이 아니다)
//
// 엣지 코드에 의존하지 않는다. 엣지 URL 만 본다(수정 전 코드로 RED 를 따로 잴 수 있게).
// 실행(로컬 전용 · 엣지를 띄우므로 혼자 돈다):
//   npx -y supabase@2.122.1 functions serve --env-file <VAPID 3 + 가짜 SOLAPI 3 + HTTPS_PROXY=http://127.0.0.1:9 + NO_PROXY=kong,localhost,127.0.0.1>
//   node scripts/qa-ai-embed-limit.mjs --local
import { createClient } from '@supabase/supabase-js';
import { localEnv, makeLocal, cleanupWorld } from './lib/qa-fz-local.mjs';
import { seedVerifiedPhones } from './qa-otp-seed.mjs';

const env = localEnv();
const L = makeLocal(env);
const { admin } = L;
const N = 10;

let pass = 0, fail = 0, skip = 0, aiCalls = 0;
const skipWhy = [];
const check = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const skipped = (name, why) => { skip++; skipWhy.push(why); console.log(`  SKIP ${name} — ${why}`); };

const s = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const w = { unit: null, users: [], phones: [] };
let token = null;

async function edge(task, payload) {
  const res = await fetch(`${env.URL_}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, payload }),
  }).catch(() => null);
  if (!res) return { status: 0, body: null };
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function setup() {
  const phone = `0101${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  w.phones.push(phone);
  await seedVerifiedPhones(env.URL_, env.SRV, [phone]);
  const email = `qa_embedlim_${s}@example.com`;
  const cu = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { name: 'QA색인사장', role: 'owner', phone, birth_date: '1990-01-15' },
  });
  if (cu.error || !cu.data.user) throw new Error(`createUser: ${cu.error?.message ?? 'no user'}`);
  w.users.push(cu.data.user.id);
  // 실세션(매직링크) — 엣지는 auth.getUser 로 세션을 확인한다(AGENTS ⑥).
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`generateLink: ${link.error?.message ?? 'no token'}`);
  const c = createClient(env.URL_, env.ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await c.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
  if (v.error || !v.data.session) throw new Error(`verifyOtp: ${v.error?.message ?? 'no session'}`);
  token = v.data.session.access_token;

  const cs = await c.rpc('create_store', { p_store_name: `QA 색인점 ${s}`, p_industry: '카페·디저트', p_biz_no: null });
  const row = Array.isArray(cs.data) ? cs.data[0] : cs.data;
  if (cs.error || !row?.unit_id) throw new Error(`create_store: ${cs.error?.message ?? 'no row'}`);
  w.unit = row.unit_id;
  const sw = await c.rpc('switch_active_unit', { p_unit_id: w.unit });
  if (sw.error) throw new Error(`switch_active_unit: ${sw.error.message}`);

  // 추천 노하우 10개 담기와 같은 상태 — 발행 노하우 10건 + 앱이 색인 전에 찍는 "색인 대기" 행(searchClient markEmbedPending).
  const entries = Array.from({ length: N }, (_, i) => ({
    id: `pb_qaembed_${i}_${s}`, unit_id: w.unit, category: 'Routine', title: `QA 색인 노하우 ${i + 1}`, status: 'published',
  }));
  const ins = await admin.from('playbook_entries').insert(entries);
  if (ins.error) throw new Error(`playbook_entries: ${ins.error.message}`);
  const now = new Date().toISOString();
  const pend = await c.from('playbook_embeddings').upsert(
    entries.map((e) => ({ entry_id: e.id, unit_id: w.unit, next_attempt_at: now })), { onConflict: 'entry_id' });
  if (pend.error) throw new Error(`색인 대기 행: ${pend.error.message}`);
  return entries;
}

async function main() {
  console.log('qa-ai-embed-limit — 색인(embed)이 대화 한도를 먹지 않는가 (로컬 엣지)\n');
  const probe = await fetch(`${env.URL_}/functions/v1/ai`, { method: 'OPTIONS' }).catch(() => null);
  if (!probe || probe.status === 503) {
    check('셋업: 로컬 엣지가 떠 있다', false, 'functions serve 를 먼저 띄운다');
    return;
  }

  let entries;
  try { entries = await setup(); } catch (e) { check('셋업', false, e.message); return; }

  console.log('① 템플릿 10개 담기와 같은 색인 요청 10개를 동시에');
  const embeds = await Promise.all(entries.map((e, i) =>
    edge('embed', { entryId: e.id, text: `QA 색인 노하우 ${i + 1}. 오픈할 때 조명과 포스기를 켜고 문 잠금을 푼다.` })));
  const codes = embeds.map((r) => r.status);
  const auth = codes.filter((c) => c === 0 || c === 401);
  if (auth.length) check('셋업: 엣지가 실세션을 받는다', false, `상태 ${codes.join(',')}`);
  check('① 색인 10개 모두 429 아님', codes.every((c) => c !== 429), `상태 ${codes.join(',')}`);

  console.log('② 곧바로 첫 노하우 정리(square)');
  const sq = await edge('square', { rawText: '우유는 두 팩 남으면 바로 발주 넣기', category: 'Routine' });
  check('② square 가 429 아님', sq.status !== 429, `상태 ${sq.status}${sq.body?.error ? ' ' + sq.body.error : ''}`);
  if (sq.status === 200 && sq.body?.square) aiCalls++;

  console.log('③·④ 색인 행');
  const rows = await admin.from('playbook_embeddings').select('entry_id, embedding, next_attempt_at').eq('unit_id', w.unit);
  if (rows.error) check('③ 색인 행 읽기', false, rows.error.message);
  else {
    check(`③ 색인 행 ${N}개`, rows.data.length === N, `${rows.data.length}개`);
    const vec = rows.data.filter((r) => r.embedding != null).length;
    aiCalls += vec;
    if (vec === 0) skipped('④ 벡터가 채워졌다', 'AI · 로컬은 Gemini 를 막고 엣지에 목 주소 env 가 없다');
    else check(`④ 벡터 ${N}개`, vec === N, `${vec}개 (AI 가 실제로 불렸다)`);
  }

  console.log('⑤ 색인에도 상한이 있다');
  const more = await Promise.all(Array.from({ length: 60 }, () =>
    edge('embed', { entryId: entries[0].id, text: 'QA 색인 상한 확인용 노하우 문장입니다.' })));
  const n429 = more.filter((r) => r.status === 429).length;
  check('⑤ 한 사람이 색인을 몰아 보내면 429 가 난다', n429 > 0, `추가 60개 중 429 ${n429}개`);
}

try {
  await main();
} catch (e) {
  check('실행', false, e.message ?? String(e));
} finally {
  const cl = await cleanupWorld(L, env, [w]).catch((e) => ({ left: -1, detail: [e.message] }));
  check('정리: 남은 행 0', cl.left === 0, cl.detail?.join(' · ') ?? '');
}
const why = skip ? ` (${[...new Set(skipWhy.map((x) => x.split(' ')[0]))].join(', ')})` : '';
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — pass ${pass} · fail ${fail} · skip ${skip}${why} · AI 호출 ${aiCalls}회`);
process.exit(fail === 0 ? 0 : 1);
