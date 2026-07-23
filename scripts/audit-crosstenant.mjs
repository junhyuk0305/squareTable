// audit-crosstenant.mjs — 두 매장 실계정으로 크로스테넌트 격리 실증 + 자가정리(service_role sweep)
// 실행: node --env-file=.env.seed scripts/audit-crosstenant.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON) { console.error('env 없음'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const rid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
let pass = 0, fail = 0;
const ok = (c, m, x='') => { console.log(`  ${c?'PASS':'FAIL'} ${m} ${x}`); c ? pass++ : fail++; };

async function makeOwner(tag, phone) {
  const c = mk();
  const email = `xt_${tag}_${rid}@example.com`;
  const { data: su, error: se } = await c.auth.signUp({
    email, password: 'Test!2345',
    options: { data: { name: `XT_${tag}`, role: 'owner', phone, phone_last4: phone.slice(-4), birth_date: '1990-01-15' } },
  });
  if (se) throw new Error(`${tag} signUp: ${se.message}`);
  if (!su.session) throw new Error(`${tag} no session (email confirm ON?)`);
  const { data: cs, error: ce } = await c.rpc('create_store', { p_store_name: `XT_${tag}_${rid}`, p_industry: '카페·디저트', p_biz_no: null });
  if (ce) throw new Error(`${tag} create_store: ${ce.message}`);
  const row = Array.isArray(cs) ? cs[0] : cs;
  return { c, email, uid: su.user.id, unit: row?.unit_id || row?.id, invite: row?.invite_code };
}

// unit_id 컬럼을 가진 모든 테넌트 테이블
const TENANT_TABLES = ['playbook_entries','chat_queries','unknown_queries','work_rooms','work_room_members',
  'work_templates','work_done','work_feed','attendance','wages','schedule_config','shift_templates',
  'swap_requests','playbook_suggestions','playbook_embeddings','former_staff','push_subscriptions',
  'unit_subscriptions','app_events','client_errors','work_template_knowhow','task_understanding'];

(async () => {
  console.log('· 크로스테넌트 격리 실증:', URL, '\n');
  const A = await makeOwner('A', '010' + String(Math.floor(1e7 + Math.random()*8e7)));
  const B = await makeOwner('B', '010' + String(Math.floor(1e7 + Math.random()*8e7)));
  console.log(`  · A unit=${A.unit}  B unit=${B.unit}\n`);

  // units / profiles 크로스테넌트
  const rd = async (client, table, col, val) => { const { data, error } = await client.from(table).select('*').eq(col, val); return { n: error?-1:(data?.length||0), error: error?.message, code: error?.code }; };
  { const r = await rd(A.c,'units','id',B.unit); ok(r.n===0, `A→B.units 읽기 0행`, `rows=${r.n}${r.error?' err:'+r.error.slice(0,40):''}`); }
  // profiles 는 0065 컬럼 GRANT로 select('*') 자체가 42501(본인 행 포함) — 0행보다 강한 차단이라 42501도 PASS.
  { const r = await rd(A.c,'profiles','id',B.uid); ok(r.n===0 || r.code==='42501', `A→B 사장 프로필(id) 차단(0행 또는 42501)`, `rows=${r.n} code=${r.code??''}`); }
  { const r = await rd(A.c,'profiles','unit_id',B.unit); ok(r.n===0 || r.code==='42501', `A→B.profiles(unit_id) 차단(0행 또는 42501)`, `rows=${r.n} code=${r.code??''}`); }

  for (const t of TENANT_TABLES) {
    const r = await rd(A.c, t, 'unit_id', B.unit);
    if (r.n === -1 && /does not exist|find the table|column .* does not exist/.test(r.error||'')) { console.log(`  skip ${t} (${r.error?.slice(0,45)})`); continue; }
    ok(r.n === 0, `A→B.${t} 0행 격리`, r.n===-1?`(err ${r.code})`:`rows=${r.n}`);
  }

  // units 전체 나열 → 본인만
  { const { data } = await A.c.from('units').select('id'); const leaked=(data||[]).filter(u=>u.id!==A.unit); ok(leaked.length===0, `A units 전체나열 → 본인만`, `본인외 ${leaked.length}`); }

  // 쓰기 위조
  { const f = await A.c.from('playbook_entries').insert({ id:`xtf_${rid}`, unit_id:B.unit, category:'Context', title:'FORGE', creator_id:A.uid }).select();
    ok(!!f.error || (f.data?.length||0)===0, `A→B.unit_id 노하우 위조삽입 거부`, f.error?`(err ${f.error.code})`:`inserted=${f.data?.length}`); }
  { const u = await A.c.from('units').update({ store_name:'HACKED' }).eq('id',B.unit).select();
    ok(!!u.error || (u.data?.length||0)===0, `A→B 매장명 변조 0행/거부`, u.error?`(err ${u.error.code})`:`updated=${u.data?.length}`); }
  { const d = await A.c.from('playbook_entries').delete().eq('unit_id',B.unit).select();
    ok(!!d.error || (d.data?.length||0)===0, `A→B 노하우 삭제 0행/거부`, d.error?`(err ${d.error.code})`:`deleted=${d.data?.length}`); }
  { const p = await A.c.from('profiles').update({ role:'owner', unit_id:B.unit }).eq('id',B.uid).select();
    ok(!!p.error || (p.data?.length||0)===0, `A→B 프로필 변조(강제소속) 0행/거부`, p.error?`(err ${p.error.code})`:`updated=${p.data?.length}`); }

  // RPC 남용
  if (B.invite) { const j = await A.c.rpc('join_by_invite',{ p_code:B.invite }); ok(!!j.error, `A(사장)→B초대코드 join 거부`, j.error?`(${j.error.message.slice(0,40)})`:`RESP ${JSON.stringify(j.data).slice(0,50)}`); }
  { const a = await A.c.rpc('approve_member',{ p_uid:B.uid }); ok(!!a.error, `A→approve_member(B) 권한상승 거부`, a.error?`(${a.error.code||a.error.message.slice(0,30)})`:'RESP'); }
  { const r = await A.c.rpc('remove_staff',{ p_staff_id:B.uid }); ok(!!r.error, `A→remove_staff(B) 거부`, r.error?`(${r.error.code||r.error.message.slice(0,30)})`:'RESP'); }

  // ── unit_member_prefs (직원×매장 개인 설정, 0076) — 본인 행(user_id) 격리 + 멤버십 가드 ──
  { const s = await A.c.rpc('save_unit_member_prefs', { p_unit_id:A.unit, p_nickname:'A별칭', p_color:'#3E92D9', p_muted:false, p_quiet_enabled:true, p_quiet_start:'22:00', p_quiet_end:'08:00' });
    ok(!s.error, `A 자기매장 prefs 저장 성공`, s.error?`(err ${s.error.message.slice(0,40)})`:''); }
  { const { data, error } = await A.c.from('unit_member_prefs').select('user_id, unit_id');
    const leaked=(data||[]).filter(r=>r.user_id!==A.uid);
    ok(!error && leaked.length===0, `A prefs 전체나열 → 본인만`, error?`(err ${error.code})`:`본인외 ${leaked.length}`); }
  { const { data, error } = await B.c.from('unit_member_prefs').select('*').eq('unit_id', A.unit);
    ok(!error && (data?.length||0)===0, `B→A.unit prefs 0행(본인 아님)`, error?`(err ${error.code})`:`rows=${data?.length}`); }
  { const s = await A.c.rpc('save_unit_member_prefs', { p_unit_id:B.unit, p_nickname:'X', p_color:null, p_muted:true, p_quiet_enabled:false, p_quiet_start:'22:00', p_quiet_end:'08:00' });
    ok(!!s.error && /not_a_member/.test(s.error.message||''), `A→B.unit prefs 저장 거부(not_a_member)`, s.error?`(${s.error.message.slice(0,40)})`:'RESP(누출)'); }
  { const f = await A.c.from('unit_member_prefs').insert({ user_id:B.uid, unit_id:A.unit, muted:true }).select();
    ok(!!f.error || (f.data?.length||0)===0, `A→B.user_id prefs 위조삽입 거부`, f.error?`(err ${f.error.code})`:`inserted=${f.data?.length}`); }

  // ── my_units_notif_data (통합 알림, 0077) — definer RLS 우회 경로의 멤버십 스코프 격리 ──
  { const today = new Date().toISOString().slice(0,10);
    const notice = { id:`xtn_${rid}`, kind:'notice', text:'B 내부 공지', authorId:B.uid, authorName:'XT_B', date:today, createdAt:new Date().toISOString(), read_by:[] };
    const ins = await B.c.from('work_feed').insert({ id:notice.id, unit_id:B.unit, feed_date:today, data:notice }).select();
    ok(!ins.error && (ins.data?.length||0)===1, `B 자기매장 공지 시드(0077 대조용)`, ins.error?`(err ${ins.error.code})`:''); }
  { const { data, error } = await B.c.rpc('my_units_notif_data');
    const mine=(data||[]).filter(r=>r.unit_id===B.unit && r.source==='feed');
    ok(!error && mine.length>=1, `B→my_units_notif_data 자기매장 공지 반환(양성 대조)`, error?`(err ${error.message.slice(0,40)})`:`feed=${mine.length}`); }
  { const { data, error } = await A.c.rpc('my_units_notif_data');
    const leaked=(data||[]).filter(r=>r.unit_id===B.unit);
    ok(!error && leaked.length===0, `A→my_units_notif_data B매장 행 0(비소속 격리)`, error?`(err ${error.message.slice(0,40)})`:`B행 ${leaked.length}`); }
  { const { data, error } = await mk().rpc('my_units_notif_data');
    ok(!error && (data?.length||0)===0, `anon→my_units_notif_data 0행`, error?`(err ${error.message.slice(0,40)})`:`rows=${data?.length}`); }

  // ── 정리: 본인 세션으로 삭제 (await, no .catch) ──
  try { await A.c.rpc('delete_my_account'); } catch(e){ console.log('  ! A cleanup', e.message); }
  try { await B.c.rpc('delete_my_account'); } catch(e){ console.log('  ! B cleanup', e.message); }

  // service_role sweep: 남은 xt_ 계정/매장 + 이전 실행 잔재 정리
  if (SRV) {
    const admin = createClient(URL, SRV, { auth:{persistSession:false} });
    // 남은 units (owner XT) 삭제
    const { data: units } = await admin.from('units').select('id,store_name').like('id','store_%');
    // auth users 중 xt_ 이메일 삭제
    let uPage=1, killed=0;
    for(;;){ const res=await fetch(`${URL}/auth/v1/admin/users?page=${uPage}&per_page=200`,{headers:{apikey:SRV,Authorization:`Bearer ${SRV}`}}); const j=await res.json(); const us=j.users||[]; for(const u of us){ if((u.email||'').startsWith('xt_')){ await fetch(`${URL}/auth/v1/admin/users/${u.id}`,{method:'DELETE',headers:{apikey:SRV,Authorization:`Bearer ${SRV}`}}); killed++; } } if(us.length<200) break; uPage++; }
    // XT_ 매장 삭제
    const { data: xu } = await admin.from('units').select('id').like('store_name','XT_%');
    for(const u of (xu||[])) await admin.from('units').delete().eq('id',u.id);
    console.log(`  · sweep: xt_ authUser ${killed} 삭제, XT_ 매장 ${(xu||[]).length} 삭제`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗', e.message); process.exit(2); });
