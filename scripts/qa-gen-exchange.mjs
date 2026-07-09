// qa-gen-exchange.mjs — 생년월일 필수 수집 + 세대 간 노하우 교류(0065) 실 백엔드 QA
//
// 검증(완료 조건):
//   ① 생년월일 없이/범위 밖 값으로 신규 가입 경로(create_store·join_by_invite) → 서버가 named 에러로 거부
//   ② 50대 사장 노하우 → 20대 직원 SERVE(chat_queries mode='served') → knowhow_transfers 1건, 뷰 cross_gen=true
//   ③ 같은 나이대 → cross_gen=false
//   ④ 사장 인박스 답변(unknown_queries → resolved_with_entry 전이) → 트리거 자동 기록(source='owner_answer')
//   ⑤ 생년월일 null 계정 → 교류는 기록되되 cross_gen 판정 제외(both_known=false) + 커버리지 <100%
//   ⑥ 노출 통제: 타인 birth_date SELECT 거부·본인 birth_date UPDATE 거부·knowhow_transfers/뷰 클라 접근 거부
//   ⑦ realtime(0047 회귀): profiles 변경 이벤트가 여전히 오고, payload 에 birth_date 가 없다(컬럼 권한 필터)
//
// 실행: node scripts/qa-gen-exchange.mjs  (.env + .env.seed 필요 — 계정 생성/검증/정리에 service_role 사용)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) { console.error('FAIL: URL/ANON/SERVICE_ROLE env 필요(.env + .env.seed)'); process.exit(2); }

const rid = String(Date.now()).slice(-9);
const pw = 'Test!2345';
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const SH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const svc = async (path) => (await fetch(`${URL_}/rest/v1/${path}`, { headers: SH })).json();

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  PASS', n, x)) : (fail++, console.log('  FAIL', n, x)); };
let seq = 0;
const phone = () => `0107${String((Number(rid) + ++seq * 131) % 100000000).padStart(8, '0').slice(0, 8)}`;

const uids = [];
async function signUp(name, role, birth) {
  const c = mk();
  const meta = { name, role, phone: phone(), ...(birth ? { birth_date: birth } : {}) };
  const { data, error } = await c.auth.signUp({ email: `gx_${name}_${rid}@example.com`, password: pw, options: { data: meta } });
  if (error || !data.session) throw new Error(`signUp(${name}) 실패: ${error?.message}`);
  await c.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  uids.push(data.user.id);
  return { c, uid: data.user.id };
}
const birthOf = async (uid) => (await svc(`profiles?id=eq.${uid}&select=birth_date`))[0]?.birth_date ?? null;

async function main() {
  let unitId = null;
  try {
    // ── ① 생년월일 강제 (서버 거부) ─────────────────────────────────────────
    console.log('[1] 생년월일 서버 강제');
    const O = await signUp('owner', 'owner'); // birth 메타데이터 없이 가입
    const noBirth = await O.c.rpc('create_store', { p_store_name: `GX매장_${rid}`, p_industry: '카페·디저트', p_biz_no: null });
    check('① 생년월일 누락 → create_store 거부', /birth_date_required/.test(noBirth.error?.message ?? ''), noBirth.error?.message ?? 'no error');
    const badBirth = await O.c.rpc('create_store', { p_store_name: `GX매장_${rid}`, p_industry: '카페·디저트', p_biz_no: null, p_birth_date: '2030-01-01' });
    check('① 범위 밖(미래) → birth_date_invalid', /birth_date_invalid/.test(badBirth.error?.message ?? ''), badBirth.error?.message ?? 'no error');
    const oldBirth = await O.c.rpc('create_store', { p_store_name: `GX매장_${rid}`, p_industry: '카페·디저트', p_biz_no: null, p_birth_date: '1919-12-31' });
    check('① 범위 밖(1920 이전) → birth_date_invalid', /birth_date_invalid/.test(oldBirth.error?.message ?? ''), oldBirth.error?.message ?? 'no error');

    // 유효한 생년월일(1970 → 50대)로 매장 생성 성공 + SSOT 기록 확인
    const cs = await O.c.rpc('create_store', { p_store_name: `GX매장_${rid}`, p_industry: '카페·디저트', p_biz_no: null, p_birth_date: '1970-05-01' });
    const row = Array.isArray(cs.data) ? cs.data[0] : cs.data;
    check('① p_birth_date 유효 → 매장 생성', !cs.error && !!row?.unit_id, cs.error?.message ?? row?.unit_id);
    unitId = row.unit_id;
    check('① 파라미터 경로 → profiles.birth_date 기록(SSOT)', (await birthOf(O.uid)) === '1970-05-01');

    // 직원: birth 없는 계정은 join 도 거부
    const JX = await signUp('joinx', 'junior');
    const jx = await JX.c.rpc('join_by_invite', { p_code: row.invite_code });
    check('① 생년월일 누락 → join_by_invite 거부', /birth_date_required/.test(jx.error?.message ?? ''), jx.error?.message ?? 'no error');

    // ── 직원 3명 합류: J1=2000(20대) · J2=1972(50대=사장과 동일 밴드) · J3=2001(뒤에 null 처리) ──
    console.log('[2] 직원 합류(메타데이터 → 트리거 기록 경로)');
    const joinAndApprove = async (name, birth) => {
      const J = await signUp(name, 'junior', birth);
      const j = await J.c.rpc('join_by_invite', { p_code: row.invite_code });
      if (j.error) throw new Error(`join(${name}): ${j.error.message}`);
      const ap = await O.c.rpc('approve_member', { p_uid: J.uid });
      if (ap.error) throw new Error(`approve(${name}): ${ap.error.message}`);
      return J;
    };
    const J1 = await joinAndApprove('j20', '2000-03-05');
    const J2 = await joinAndApprove('j50', '1972-06-01');
    const J3 = await joinAndApprove('jnull', '2001-08-09');
    check('② 메타데이터 경로 → profiles.birth_date 기록(트리거)', (await birthOf(J1.uid)) === '2000-03-05');
    // ⑤ 준비: J3 을 "생년월일 없는 기존 계정"으로 시뮬레이션(service_role 로 null 처리)
    await fetch(`${URL_}/rest/v1/profiles?id=eq.${J3.uid}`, { method: 'PATCH', headers: { ...SH, Prefer: 'return=minimal' }, body: JSON.stringify({ birth_date: null }) });
    check('⑤ 준비: J3 birth_date null 처리', (await birthOf(J3.uid)) === null);

    // ── 사장 노하우 등록 ─────────────────────────────────────────────────────
    const entryId = `pb_gx_${rid}`;
    const ins = await O.c.from('playbook_entries').insert({
      id: entryId, unit_id: unitId, creator_id: O.uid, creator_name: 'GX사장',
      category: 'Know-how', title: 'GX 마감 청소 순서', status: 'published',
    });
    check('사장 노하우 등록', !ins.error, ins.error?.message ?? '');

    // ── ② AI SERVE → 트리거 기록 + cross_gen=true ──────────────────────────
    console.log('[3] AI SERVE 경로(chat_queries 트리거)');
    const serve = async (J, cqId) => J.c.from('chat_queries').insert({
      id: cqId, unit_id: unitId, junior_name: 'GX직원', query_text: '마감 청소 순서 알려줘',
      matched_entry_ids: [entryId], match_confidence: 0.91, was_deflected: true,
      response_block: { mode: 'served', summary: 'GX 마감 청소 순서' }, resolved_at: new Date().toISOString(),
    });
    const s1 = await serve(J1, `cq_gx1_${rid}`);
    check('② SERVE 기록 insert(20대 직원)', !s1.error, s1.error?.message ?? '');
    let t1 = (await svc(`knowhow_transfers?receiver_id=eq.${J1.uid}&select=*`));
    check('② knowhow_transfers 1건(source=ai_serve, giver=사장)', t1.length === 1 && t1[0].source === 'ai_serve' && t1[0].giver_id === O.uid, JSON.stringify(t1[0] ?? null));
    let d1 = (await svc(`gen_exchange_detail?receiver_id=eq.${J1.uid}&select=*`))[0];
    check('② 뷰: 50대→20대 cross_gen=true', d1?.cross_gen === true && d1?.giver_band === '50대' && d1?.receiver_band === '20대', JSON.stringify(d1 ?? null));

    // ── ③ 같은 나이대 → cross_gen=false ─────────────────────────────────────
    const s2 = await serve(J2, `cq_gx2_${rid}`);
    check('③ SERVE 기록 insert(50대 직원)', !s2.error, s2.error?.message ?? '');
    const d2 = (await svc(`gen_exchange_detail?receiver_id=eq.${J2.uid}&select=*`))[0];
    check('③ 뷰: 50대→50대 cross_gen=false', d2?.cross_gen === false && d2?.both_known === true, JSON.stringify(d2 ?? null));

    // 'served' 외 모드는 카운트 제외(generated/후보)
    await J1.c.from('chat_queries').insert({
      id: `cq_gx4_${rid}`, unit_id: unitId, junior_name: 'GX직원', query_text: '종합 답변 질문',
      matched_entry_ids: [entryId], match_confidence: 0.6, was_deflected: true,
      response_block: { mode: 'generated', summary: '종합' }, resolved_at: new Date().toISOString(),
    });
    t1 = (await svc(`knowhow_transfers?receiver_id=eq.${J1.uid}&select=id`));
    check('② generated 모드 제외(여전히 1건)', t1.length === 1, `count=${t1.length}`);

    // ── ④ 사장 인박스 답변 경로(트리거) ─────────────────────────────────────
    console.log('[4] 사장 인박스 답변 경로(unknown_queries 트리거)');
    const uqId = `uq_gx_${rid}`;
    const uq = await J1.c.from('unknown_queries').insert({ id: uqId, unit_id: unitId, junior_name: 'GX직원', query_text: '환불 규정이 뭐예요?' });
    check('④ 에스컬레이션 insert', !uq.error, uq.error?.message ?? '');
    const entry2 = `pb_gx2_${rid}`;
    await O.c.from('playbook_entries').insert({ id: entry2, unit_id: unitId, creator_id: O.uid, creator_name: 'GX사장', category: 'Know-how', title: 'GX 환불 규정', status: 'published' });
    const rs = await O.c.from('unknown_queries').update({ status: 'resolved_with_entry', resolved_with_entry_id: entry2 }).eq('id', uqId).select('id');
    check('④ 사장 답변(resolved 전이)', !rs.error && (rs.data?.length ?? 0) > 0, rs.error?.message ?? '');
    const t4 = (await svc(`knowhow_transfers?source=eq.owner_answer&receiver_id=eq.${J1.uid}&select=*`));
    check('④ 트리거 자동 기록(source=owner_answer, giver=사장)', t4.length === 1 && t4[0].giver_id === O.uid && t4[0].knowhow_id === entry2, JSON.stringify(t4[0] ?? null));
    // 같은 행 재저장(상태 불변 update) → 중복 발화 없음
    await O.c.from('unknown_queries').update({ similar_queries_count: 1 }).eq('id', uqId);
    const t4b = (await svc(`knowhow_transfers?source=eq.owner_answer&receiver_id=eq.${J1.uid}&select=id`));
    check('④ 상태 불변 update → 중복 기록 없음', t4b.length === 1, `count=${t4b.length}`);

    // ── ⑤ 생년월일 null 계정 → 기록은 되되 판정 제외 ────────────────────────
    console.log('[5] 생년월일 null 계정(커버리지)');
    const s3 = await serve(J3, `cq_gx3_${rid}`);
    check('⑤ SERVE 기록 insert(null 직원)', !s3.error, s3.error?.message ?? '');
    const d3 = (await svc(`gen_exchange_detail?receiver_id=eq.${J3.uid}&select=*`))[0];
    check('⑤ 교류는 기록 + cross_gen 판정 제외', !!d3 && d3.both_known === false && d3.cross_gen === false && d3.receiver_band === null, JSON.stringify(d3 ?? null));
    const stats = (await svc('gen_exchange_stats?select=*'))[0];
    check('⑤ 집계 뷰(총/판정가능/세대간/커버리지<100%)',
      !!stats && Number(stats.total_transfers) >= 4 && Number(stats.cross_gen_transfers) >= 2 && Number(stats.birth_coverage_pct) < 100,
      JSON.stringify(stats ?? null));

    // ── ⑥ 노출 통제 ─────────────────────────────────────────────────────────
    console.log('[6] birth_date 노출 통제(컬럼 권한)');
    const leak = await J1.c.from('profiles').select('id, birth_date').eq('id', O.uid);
    check('⑥ 타인 birth_date SELECT 거부', !!leak.error, leak.error?.message ?? `rows=${JSON.stringify(leak.data)}`);
    const okCols = await J1.c.from('profiles').select('id, name, role, phone_last4, avatar, bio, meta, created_at').eq('unit_id', unitId);
    check('⑥ 동료 목록(기존 컬럼) SELECT 정상', !okCols.error && (okCols.data?.length ?? 0) >= 3, okCols.error?.message ?? `rows=${okCols.data?.length}`);
    const tamper = await J1.c.from('profiles').update({ birth_date: '1999-01-01' }).eq('id', J1.uid).select('id');
    check('⑥ 본인 birth_date UPDATE 거부(사후 변조 차단)', !!tamper.error, tamper.error?.message ?? '');
    const selfUpd = await J1.c.from('profiles').update({ bio: 'gx' }).eq('id', J1.uid);
    check('⑥ 본인 bio UPDATE 는 정상(기존 경로 무회귀)', !selfUpd.error, selfUpd.error?.message ?? '');
    const ktCli = await J1.c.from('knowhow_transfers').select('*');
    check('⑥ knowhow_transfers 클라 접근 거부', !!ktCli.error, ktCli.error?.message ?? `rows=${ktCli.data?.length}`);
    const vwCli = await J1.c.from('gen_exchange_stats').select('*');
    check('⑥ 집계 뷰 클라 접근 거부', !!vwCli.error, vwCli.error?.message ?? `rows=${vwCli.data?.length}`);

    // ── ⑦ realtime 회귀(0047) + 컬럼 필터 ───────────────────────────────────
    console.log('[7] realtime(profiles) — 이벤트 수신 + birth_date 미포함');
    // 노드(persistSession:false)에선 realtime 소켓이 anon 토큰으로 남아 RLS상 이벤트 0건 → 명시 setAuth 필수
    // (setAuth 없이는 SUBSCRIBED 후 timeout — 브라우저에선 onAuthStateChange 가 자동 전파해 문제 없음).
    const { data: oSess } = await O.c.auth.getSession();
    if (oSess?.session?.access_token) await O.c.realtime.setAuth(oSess.session.access_token);
    const rt = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: 'timeout' }), 12000);
      const ch = O.c.channel(`gx_${rid}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        clearTimeout(timer);
        resolve({ status: 'event', payload });
      }).subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await fetch(`${URL_}/rest/v1/profiles?id=eq.${J1.uid}`, { method: 'PATCH', headers: { ...SH, Prefer: 'return=minimal' }, body: JSON.stringify({ bio: 'gx_rt' }) });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          resolve({ status: 'channel_error' });
        }
      });
    });
    await O.c.removeAllChannels();
    if (rt.status === 'event') {
      check('⑦ realtime 이벤트 수신(0047 무회귀)', true);
      check('⑦ payload 에 birth_date 없음', !('birth_date' in (rt.payload?.new ?? {})), JSON.stringify(Object.keys(rt.payload?.new ?? {})));
    } else {
      check('⑦ realtime 이벤트 수신(0047 무회귀)', false, `status=${rt.status} — 노드 환경 이슈면 브라우저에서 수동 확인 필요`);
    }

    // 증거 출력(라이브 실증 보고용)
    console.log('\n── 라이브 증거(정리 전 스냅샷) ──');
    console.log('knowhow_transfers:', JSON.stringify(await svc(`knowhow_transfers?unit_id=eq.${unitId}&select=giver_id,receiver_id,knowhow_id,source,created_at`), null, 1));
    console.log('gen_exchange_detail:', JSON.stringify(await svc(`gen_exchange_detail?unit_id=eq.${unitId}&select=source,giver_band,receiver_band,both_known,cross_gen`), null, 1));
    console.log('gen_exchange_stats:', JSON.stringify(await svc('gen_exchange_stats?select=*'), null, 1));
  } finally {
    // ── 자가 정리: 매장 삭제(cascade) + 계정 삭제 ──
    try {
      if (unitId) await fetch(`${URL_}/rest/v1/units?id=eq.${unitId}`, { method: 'DELETE', headers: SH });
      for (const uid of uids) await admin.auth.admin.deleteUser(uid).catch(() => {});
      console.log(`\n정리 완료(매장 1·계정 ${uids.length})`);
    } catch (e) { console.log('정리 중 오류(수동 확인):', e?.message); }
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('스크립트 실패:', e); process.exit(2); });
