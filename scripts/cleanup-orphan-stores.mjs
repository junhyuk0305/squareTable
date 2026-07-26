// cleanup-orphan-stores.mjs — 고아/QA 매장·계정 정리 (service_role)
// 기본은 DRY-RUN(계획만 출력). 실제 삭제는 `--execute` 플래그.
//   node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs            # 계획만
//   node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs --execute  # 실행
//
// 삭제 대상(테스트/고아만): (a) dangling = owner 프로필이 이미 삭제된 매장,
//   (b) soft = deleted_at 세팅된 매장, (c) owner 이메일이 QA 전용 도메인(@example.com·@test.com 등)인 매장(live 포함),
//   (d) QA 전용 도메인 계정(auth.users 하드삭제, live/soft 무관).
// 보호(절대 삭제 안 함): PROTECT_UNITS(eval 픽스처 등) + 실사용자 이메일(naver/gmail/daum/kakao 등).
//   실사용자 소유 매장은 REAL_EMAIL 로 항상 보호(멤버 0이어도 유지) → QA_EMAIL 확장이 실매장을 건드릴 수 없다.
import { createClient } from '@supabase/supabase-js';

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) { console.error('env 없음 (--env-file=.env.seed)'); process.exit(2); }
const EXECUTE = process.argv.includes('--execute');
const admin = createClient(U, K, { auth: { persistSession: false } });
const H = { apikey: K, Authorization: `Bearer ${K}` };

// 절대 건드리지 않을 매장. store_eval=eval 하네스 픽스처. store_001=데모 '스퀘어 카페 신촌점'(삭제금지).
//   store_appreview=앱스토어/플레이스토어 심사용 데모 매장(scripts/seed-appreview.mjs, 고정 id).
//   ★데모 owner 이메일이 QA 도메인(@example.com 류)이라 QA_EMAIL 규칙만으론 잡히므로 반드시 명시 보호.
//   ★store_appreview 를 지우면 심사 중 Guideline 2.1(a) 반려 — 재생성해도 id 가 고정이라 이 보호가 유지된다.
const PROTECT_UNITS = new Set(['store_eval', 'store_001', 'store_appreview']);
// 실사용자 이메일 도메인/패턴 (이 계정은 QA로 오인해 지우지 않는다)
const REAL_EMAIL = /@(naver|gmail|daum|kakao|hanmail|nate|outlook|hotmail|icloud)\.com|@team-roundtable|cristianojun/i;
// QA/자동 계정 이메일 (하드삭제 허용)
const QA_EMAIL = /@example\.com|@squaretable\.test|@test\.com|@pilot\.squaretable/i;
// ★스토어 심사용 데모 계정 — QA 도메인(@pilot.squaretable.app)을 쓰지만 절대 하드삭제 금지.
//   PROTECT_UNITS 이중화: 매장이 아직 없거나 프로필 unit_id 가 잠시 비어 있는 순간에도 계정이 살아남는다.
const PROTECT_EMAIL = /appreview\.(owner|staff)@/i;

async function listAuthUsers() {
  const users = []; let p = 1;
  for (;;) { const r = await fetch(`${U}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: H }); const j = await r.json(); const b = j.users || []; users.push(...b); if (b.length < 200) break; p++; }
  return users;
}

(async () => {
  const { data: units } = await admin.from('units').select('id,store_name,owner_id,deleted_at');
  const { data: profs } = await admin.from('profiles').select('id,unit_id,role,deleted_at');
  const users = await listAuthUsers();
  const emailById = new Map(users.map(u => [u.id, (u.email || '').toLowerCase()]));
  const allProfIds = new Set(profs.map(p => p.id));
  const liveProfIds = new Set(profs.filter(p => !p.deleted_at).map(p => p.id));
  const liveMembers = {}; profs.filter(p => !p.deleted_at && p.unit_id).forEach(p => liveMembers[p.unit_id] = (liveMembers[p.unit_id] || 0) + 1);

  // 보호 매장(PROTECT_UNITS)의 owner·소속 계정은 QA 도메인이어도 하드삭제 금지 (데모 계정 보존).
  const protectAccts = new Set();
  units.forEach(u => { if (PROTECT_UNITS.has(u.id) && u.owner_id) protectAccts.add(u.owner_id); });
  profs.forEach(p => { if (p.unit_id && PROTECT_UNITS.has(p.unit_id)) protectAccts.add(p.id); });

  // ── 삭제 대상 매장 선정 ──
  const delUnits = [];
  for (const u of units) {
    if (PROTECT_UNITS.has(u.id)) continue;
    // 활성 owner가 있고, 그 owner가 실사용자면 보호(멤버 0이어도)
    const ownerEmail = emailById.get(u.owner_id) || '';
    const ownerLive = liveProfIds.has(u.owner_id);
    if (PROTECT_EMAIL.test(ownerEmail)) continue;                     // 스토어 심사용 데모 → 보호(id 무관)
    if (ownerLive && REAL_EMAIL.test(ownerEmail)) continue;           // 실사용자 소유 → 보호
    if (u.deleted_at) { delUnits.push([u, 'soft-deleted']); continue; } // 소프트삭제
    if (!allProfIds.has(u.owner_id)) { delUnits.push([u, 'dangling(owner삭제됨)']); continue; } // 하드고아
    // owner 이메일이 QA 전용 도메인이면 삭제 — live/soft 무관. 실사용자는 위 REAL_EMAIL 보호에서 이미 제외됨.
    //   (qa:billing-tiers 등 일부 하니스가 owner를 살아있는 채 남겨 매장이 누적되던 사각지대를 닫는다.)
    if (QA_EMAIL.test(ownerEmail)) { delUnits.push([u, ownerLive ? 'owner활성(QA도메인)' : 'owner소프트삭제(QA)']); continue; }
  }

  // ── 삭제 대상 계정(auth.users 하드삭제): QA 전용 도메인 계정 (live/soft 무관, 실사용자 제외) ──
  //   위 매장 삭제와 짝 — 살아있던 QA owner/직원 계정까지 하드삭제해 잔여 계정이 남지 않게 한다.
  const delUsers = profs.filter(p => QA_EMAIL.test(emailById.get(p.id) || '') && !REAL_EMAIL.test(emailById.get(p.id) || '')
    && !PROTECT_EMAIL.test(emailById.get(p.id) || '') && !protectAccts.has(p.id))
    .map(p => ({ id: p.id, email: emailById.get(p.id) }));

  console.log(`\n${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY-RUN (미실행)'} — 정리 계획\n`);
  console.log(`■ 삭제할 매장 ${delUnits.length}개 (자식 데이터 cascade):`);
  delUnits.forEach(([u, why]) => console.log(`   - ${u.id.padEnd(20)} "${u.store_name}"  [${why}]`));
  console.log(`\n■ 하드삭제할 QA 계정 ${delUsers.length}개 (auth.users → profiles cascade):`);
  console.log('   ' + (delUsers.length ? delUsers.slice(0, 8).map(u => u.email).join(', ') + (delUsers.length > 8 ? ` … 외 ${delUsers.length - 8}개` : '') : '(없음)'));
  console.log(`\n■ 보호(유지): eval 픽스처(store_eval), 스토어 심사용 데모(store_appreview + appreview.* 계정), 실사용자 소유 매장(코홀트커피 등)`);

  if (!EXECUTE) { console.log('\n실제 삭제하려면 `--execute` 를 붙여 다시 실행하세요.'); return; }

  console.log('\n삭제 실행 중…');
  let un = 0, usr = 0;
  for (const [u] of delUnits) { const { error } = await admin.from('units').delete().eq('id', u.id); if (error) console.warn(`  ! unit ${u.id}: ${error.message}`); else un++; }
  for (const u of delUsers) { const r = await fetch(`${U}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H }); if (r.ok) usr++; else console.warn(`  ! user ${u.email}: ${r.status}`); }
  console.log(`✓ 매장 ${un}개, 계정 ${usr}개 삭제 완료`);

  // 사후 카운트
  const { data: u2 } = await admin.from('units').select('id');
  const { data: p2 } = await admin.from('profiles').select('id,deleted_at');
  console.log(`남은 매장 ${u2.length} · 계정 ${p2.length}(활성 ${p2.filter(p => !p.deleted_at).length})`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
