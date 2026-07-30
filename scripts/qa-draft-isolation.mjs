// qa-draft-isolation.mjs — draft 노하우 직원 격리(0063+0064) 라이브 실증 + 자가정리
// 실행: npm run qa:draft  (실 백엔드 대상 — 사장·직원 실계정을 만들어 전/후를 증명한다)
//
// 검증 항목:
//  [0063] section/order_index/source_id 컬럼으로 draft insert가 실제로 성공하는가(PGRST204 드리프트 감지)
//  [0064] 직원은 published만 읽고 draft는 0행인가(RLS가 유일한 방어선)
//  [0019] 직원의 draft 변조(update)가 여전히 거부되는가(쓰기 정책 회귀 없음)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';

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
const SRV = env.SUPABASE_SERVICE_ROLE_KEY; // 있으면 phone_otps 시드(게이트 0088 대비)
if (!URL || !ANON) { console.error('env 없음(.env/.env.seed)'); process.exit(2); }

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const rid = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m} ${x}`); c ? pass++ : fail++; };
const phone = () => '010' + String(Math.floor(1e7 + Math.random() * 8e7));

const SQUARE = {
  situation: '여분 시럽 위치: 창고 맨 위 칸',
  quagmire: '', uncover: '',
  action: { steps: [], scripts: [] },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont: '' },
};

(async () => {
  console.log('· draft 격리(0063/0064) 라이브 실증:', URL, '\n');

  // 0088 게이트 라이브 — 사장·직원 번호를 '인증됨'으로 선등록해야 create_store/join 통과.
  const qaPhones = [phone(), phone()];
  await seedVerifiedPhones(URL, SRV, qaPhones);

  // ── 사장 A + 매장 ──
  const A = mk();
  const aEmail = `dq_owner_${rid}@example.com`;
  const { data: su, error: se } = await A.auth.signUp({
    email: aEmail, password: 'Test!2345',
    options: { data: { name: `DQ_사장_${rid}`, role: 'owner', phone: qaPhones[0], phone_last4: '0000', birth_date: '1990-01-15' } },
  });
  if (se || !su.session) { console.error('✗ owner signUp:', se?.message || 'no session'); process.exit(2); }
  const { data: cs, error: ce } = await A.rpc('create_store', { p_store_name: `DQ_${rid}`, p_industry: '카페·디저트', p_biz_no: null });
  if (ce) { console.error('✗ create_store:', ce.message); process.exit(2); }
  const store = Array.isArray(cs) ? cs[0] : cs;
  const unitId = store?.unit_id || store?.id;
  const invite = store?.invite_code;
  console.log(`  · unit=${unitId} invite=${invite}\n`);

  // ── [0063] draft + published 삽입(사장) — 신규 컬럼 포함 ──
  const draftId = `dq_draft_${rid}`;
  const pubId = `dq_pub_${rid}`;
  const base = {
    unit_id: unitId, creator_id: su.user.id, creator_name: '사장',
    category: 'Context', subcategory: '일반', title: '', tags: [],
    square: SQUARE, search_keywords: ['시럽', '창고'], version: 1, quality_score: 0.1,
    source_id: `imp_${rid}`,
  };
  {
    const r = await A.from('playbook_entries').insert({ ...base, id: draftId, title: 'DQ 검토대기(초안)', status: 'draft', section: '오픈', order_index: 1 }).select('id');
    ok(!r.error && r.data?.length === 1, '[0063] draft insert(섹션 컬럼 포함) 성공', r.error ? `err ${r.error.code}: ${r.error.message?.slice(0, 60)}` : '');
  }
  {
    const r = await A.from('playbook_entries').insert({ ...base, id: pubId, title: 'DQ 발행본', status: 'published', section: '오픈', order_index: 2 }).select('id');
    ok(!r.error && r.data?.length === 1, '[0063] published insert 성공', r.error ? `err ${r.error.code}` : '');
  }
  // 사장은 draft+published 둘 다 보인다(검토 대기함 전제).
  {
    const r = await A.from('playbook_entries').select('id,status').like('id', `dq_%_${rid}`);
    const st = new Set((r.data ?? []).map((x) => x.status));
    ok(!r.error && st.has('draft') && st.has('published'), '[0064] 사장 read = draft+published 모두', `rows=${r.data?.length ?? 0}`);
  }

  // ── 직원 S 합류(초대 → 사장 승인) ──
  const S = mk();
  const { data: ss, error: sse } = await S.auth.signUp({
    email: `dq_staff_${rid}@example.com`, password: 'Test!2345',
    options: { data: { name: `DQ_직원_${rid}`, role: 'staff', phone: qaPhones[1], phone_last4: '1111', birth_date: '2000-03-05' } },
  });
  if (sse || !ss.session) { console.error('✗ staff signUp:', sse?.message || 'no session'); process.exit(2); }
  {
    const j = await S.rpc('join_by_invite', { p_code: invite });
    ok(!j.error, '직원 join_by_invite 접수', j.error ? j.error.message?.slice(0, 60) : '');
  }
  {
    const a = await A.rpc('approve_member', { p_uid: ss.user.id });
    ok(!a.error, '사장 approve_member 승인', a.error ? a.error.message?.slice(0, 60) : '');
  }

  // ── [0064] 직원 격리 본검증 ──
  {
    const r = await S.from('playbook_entries').select('id,status').like('id', `dq_%_${rid}`);
    const statuses = (r.data ?? []).map((x) => x.status);
    ok(!r.error && statuses.length === 1 && statuses[0] === 'published',
      '[0064] 직원 read = published 1행만(draft 비노출)', `rows=${statuses.length} [${statuses.join(',')}]`);
  }
  {
    const r = await S.from('playbook_entries').select('id').eq('id', draftId);
    ok(!r.error && (r.data?.length ?? 0) === 0, '[0064] 직원이 draft id 직접 조회 → 0행', `rows=${r.data?.length ?? 0}`);
  }
  {
    const r = await S.from('playbook_entries').update({ title: 'HACKED' }).eq('id', draftId).select('id');
    ok(!!r.error || (r.data?.length ?? 0) === 0, '[0019] 직원의 draft 변조 update 거부/0행', r.error ? `(err ${r.error.code})` : `updated=${r.data?.length}`);
  }

  // ── 자가정리 ──
  try { await S.rpc('delete_my_account'); } catch (e) { console.log('  ! staff cleanup', e.message); }
  try { await A.rpc('delete_my_account'); } catch (e) { console.log('  ! owner cleanup', e.message); }
  await cleanupSeededPhones(URL, SRV, qaPhones);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(2); });
