// qa-draft-isolation.mjs — draft 노하우 직원 격리(0063+0064) + 숨긴 본사 사본(0231) 라이브 실증 + 자가정리
// 실행: npm run qa:draft                    (0231 적용 전 — 숨김 단정은 SKIP 으로 찍고 관찰값만 보여 준다)
//       npm run qa:draft -- --expect-0231   (0231 적용 후 — 숨김 단정도 센다)
//
// ★고정 계정만 쓴다(2026-10-03 사용자 결정 "하니스를 수정해. 고정계정만 쓰도록" · scripts/lib/qa-fixed-accounts.mjs).
//   사장 owner@pilot · 매니저 staff@pilot · 직원 staff2@pilot, 매장 store_001. 계정·매장을 만들지 않는다.
//   만드는 것은 `pb_qadraft_` 접두사 노하우 3행뿐이고, 사장 권한으로 지운다(시작 전 잔재도 같이).
//   service_role 이 필요 없다(.env 만).
//
// 검증 항목:
//  [0063] section/order_index/source_id 컬럼으로 draft insert가 실제로 성공하는가(PGRST204 드리프트 감지)
//  [0064] 직원은 published만 읽고 draft는 0행인가(RLS가 유일한 방어선)
//  [0064] 매니저는 draft 도 읽는가(검토 대기함 — auth_can_manage)
//  [0019] 직원의 draft 변조(update)가 여전히 거부되는가(쓰기 정책 회귀 없음)
//  [0231] 숨긴 본사 사본(brand_hidden_at)은 직원·매니저 0행 · 사장 1행
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIXED, UNIT, login, stateLine, rolePrecondition, ensureActive, restoreActive } from './lib/qa-fixed-accounts.mjs';

function loadEnv() {
  const env = { ...process.env };
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const f of ['.env', '.env.seed']) {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    }
  } catch {}
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('env 없음(.env)'); process.exit(2); }

const EXPECT_0231 = process.argv.includes('--expect-0231');
const rid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
let pass = 0, fail = 0, skip = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m} ${x}`); c ? pass++ : fail++; };
// 0231 이 있어야 성립하는 단정. 플래그 없이는 세지 않고 SKIP 으로 찍는다(통과로 세지 않는다 — AGENTS '게이트가 거짓말하는 3가지').
const ok0231 = (c, m, x = '') => {
  if (EXPECT_0231) return ok(c, m, x);
  skip++; console.log(`  SKIP ${m} — 0231 적용 후 --expect-0231 로 켠다(지금 관찰: ${c ? '충족' : '미충족'}) ${x}`);
};

const PREFIX = 'pb_qadraft_';
const SQUARE = {
  situation: '여분 시럽 위치: 창고 맨 위 칸',
  quagmire: '', uncover: '',
  action: { steps: [] },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont: '' },
};

// 하니스가 만든 행만 지운다(사장 RLS — playbook_entries_write). 남은 행 수를 돌려준다.
async function cleanup(O) {
  await O.from('playbook_entries').delete().eq('unit_id', UNIT).like('id', `${PREFIX}%`);
  const { data } = await O.from('playbook_entries').select('id').eq('unit_id', UNIT).like('id', `${PREFIX}%`);
  return (data ?? []).length;
}

let O, M, J, before = null, prevActive = {}, setupFailed = false;
try {
  console.log('· draft 격리(0063/0064) + 숨긴 사본(0231) 라이브 실증:', URL, EXPECT_0231 ? '(--expect-0231)' : '', '\n');
  O = await login(URL, ANON, FIXED.owner);
  M = await login(URL, ANON, FIXED.manager);
  J = await login(URL, ANON, FIXED.junior);
  const why = await rolePrecondition({ owner: O, manager: M, junior: J });
  if (why) { setupFailed = true; throw new Error(`고정 계정 상태가 시드와 다르다 — ${why}`); }
  before = await stateLine({ owner: O, manager: M, junior: J });
  for (const [k, c] of Object.entries({ owner: O, manager: M, junior: J })) prevActive[k] = await ensureActive(c);
  await cleanup(O); // 지난 실행이 남긴 잔재

  const draftId = `${PREFIX}draft_${rid}`;
  const pubId = `${PREFIX}pub_${rid}`;
  const hiddenId = `${PREFIX}hidden_${rid}`;
  const base = {
    unit_id: UNIT, creator_id: O.uid, creator_name: '사장',
    category: 'Context', subcategory: '일반', title: '', tags: [],
    square: SQUARE, search_keywords: ['시럽', '창고'], version: 1, quality_score: 0.1,
    source_id: `imp_${rid}`,
  };

  // ── [0063] draft + published 삽입(사장) — 신규 컬럼 포함 ──
  {
    const r = await O.from('playbook_entries').insert({ ...base, id: draftId, title: 'QA 검토대기(초안)', status: 'draft', section: '오픈', order_index: 1 }).select('id');
    ok(!r.error && r.data?.length === 1, '[0063] draft insert(섹션 컬럼 포함) 성공', r.error ? `err ${r.error.code}: ${r.error.message?.slice(0, 60)}` : '');
  }
  {
    const r = await O.from('playbook_entries').insert({ ...base, id: pubId, title: 'QA 발행본', status: 'published', section: '오픈', order_index: 2 }).select('id');
    ok(!r.error && r.data?.length === 1, '[0063] published insert 성공', r.error ? `err ${r.error.code}` : '');
  }
  // 숨긴 본사 사본 — hide_brand_copy(0224) 가 남기는 모양 그대로(brand_entry_id + brand_hidden_at).
  // RPC 대신 사장 insert 로 만든다: RPC 는 brand_events 에 로그를 남기는데 그 행은 사장 권한으로 못 지운다.
  // brand_entry_id 는 FK 가 없다(0216) — 원본이 없는 id 를 넣어도 된다.
  {
    const r = await O.from('playbook_entries').insert({
      ...base, id: hiddenId, title: 'QA 숨긴 본사 사본', status: 'published', section: '오픈', order_index: 3,
      brand_entry_id: `${PREFIX}src_${rid}`, brand_hidden_at: new Date().toISOString(),
    }).select('id');
    ok(!r.error && r.data?.length === 1, '[0231 전제] 숨긴 본사 사본 insert 성공', r.error ? `err ${r.error.code}: ${r.error.message?.slice(0, 60)}` : '');
  }

  // ── 사장: draft+published 둘 다(검토 대기함 전제) · 숨긴 사본도 보인다(되살리기 목록) ──
  {
    const r = await O.from('playbook_entries').select('id,status').in('id', [draftId, pubId]);
    const st = new Set((r.data ?? []).map((x) => x.status));
    ok(!r.error && st.has('draft') && st.has('published'), '[0064] 사장 read = draft+published 모두', `rows=${r.data?.length ?? 0}`);
  }
  {
    const r = await O.from('playbook_entries').select('id').eq('id', hiddenId);
    ok(!r.error && (r.data?.length ?? 0) === 1, '[0231] 사장은 숨긴 사본 1행(되살리기 목록)', `rows=${r.data?.length ?? 0}`);
  }

  // ── [0064] 직원 격리 본검증 ──
  {
    const r = await J.from('playbook_entries').select('id,status').in('id', [draftId, pubId]);
    const statuses = (r.data ?? []).map((x) => x.status);
    ok(!r.error && statuses.length === 1 && statuses[0] === 'published',
      '[0064] 직원 read = published 1행만(draft 비노출)', `rows=${statuses.length} [${statuses.join(',')}]`);
  }
  {
    const r = await J.from('playbook_entries').select('id').eq('id', draftId);
    ok(!r.error && (r.data?.length ?? 0) === 0, '[0064] 직원이 draft id 직접 조회 → 0행', `rows=${r.data?.length ?? 0}`);
  }
  {
    const r = await J.from('playbook_entries').update({ title: 'HACKED' }).eq('id', draftId).select('id');
    ok(!!r.error || (r.data?.length ?? 0) === 0, '[0019] 직원의 draft 변조 update 거부/0행', r.error ? `(err ${r.error.code})` : `updated=${r.data?.length}`);
  }

  // ── [0064] 매니저는 초안을 계속 본다 ──
  {
    const r = await M.from('playbook_entries').select('id,status').in('id', [draftId, pubId]);
    const st = new Set((r.data ?? []).map((x) => x.status));
    ok(!r.error && st.has('draft') && st.has('published'), '[0064] 매니저 read = draft+published 모두(초안 열람 유지)', `rows=${r.data?.length ?? 0}`);
  }

  // ── [0231] 숨긴 본사 사본은 직원·매니저 0행 ──
  {
    const r = await J.from('playbook_entries').select('id').eq('id', hiddenId);
    ok0231(!r.error && (r.data?.length ?? 0) === 0, '[0231] 직원은 숨긴 사본 0행', `rows=${r.data?.length ?? 0}`);
  }
  {
    const r = await M.from('playbook_entries').select('id').eq('id', hiddenId);
    ok0231(!r.error && (r.data?.length ?? 0) === 0, '[0231] 매니저도 숨긴 사본 0행', `rows=${r.data?.length ?? 0}`);
  }
} catch (e) {
  fail++; console.log('  FAIL exception:', e.message);
} finally {
  // ── 자가정리 + 고정 계정 원복 확인 ──
  if (O && !setupFailed) {
    try {
      const left = await cleanup(O);
      ok(left === 0, `정리: ${PREFIX} 행 0`, `left=${left}`);
    } catch (e) { fail++; console.log('  FAIL 정리 예외:', e.message); }
    for (const [k, c] of Object.entries({ owner: O, manager: M, junior: J })) { if (c) await restoreActive(c, prevActive[k]); }
    if (before) {
      try {
        const after = await stateLine({ owner: O, manager: M, junior: J });
        ok(after === before, '정리: 고정 계정 역할·활성 매장 전후 동일', after === before ? '' : `\n    전 ${before}\n    후 ${after}`);
      } catch (e) { fail++; console.log('  FAIL 상태 비교 예외:', e.message); }
    }
  }
  for (const c of [O, M, J]) { try { await c?.auth.signOut(); } catch { /* best-effort */ } }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(setupFailed ? 2 : fail ? 1 : 0);
