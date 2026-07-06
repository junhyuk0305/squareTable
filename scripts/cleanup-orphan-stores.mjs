// cleanup-orphan-stores.mjs — 고아/QA 매장·계정 정리 (service_role)
// 기본은 DRY-RUN(계획만 출력). 실제 삭제는 `--execute` 플래그.
//   node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs            # 계획만
//   node --env-file=.env.seed scripts/cleanup-orphan-stores.mjs --execute  # 실행
//
// 삭제 대상(테스트/고아만): (a) dangling = owner 프로필이 이미 삭제된 매장,
//   (b) soft = deleted_at 세팅된 매장, (c) 소프트삭제된 QA/자동 계정(auth.users 하드삭제).
// 보호(절대 삭제 안 함): PROTECT_UNITS(eval 픽스처 등) + 실사용자 이메일(naver/gmail/daum/kakao 등) +
//   활성 owner가 있는 매장(멤버 0이어도 실사용자 소유면 유지).
import { createClient } from '@supabase/supabase-js';

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) { console.error('env 없음 (--env-file=.env.seed)'); process.exit(2); }
const EXECUTE = process.argv.includes('--execute');
const admin = createClient(U, K, { auth: { persistSession: false } });
const H = { apikey: K, Authorization: `Bearer ${K}` };

// 절대 건드리지 않을 매장 (eval 하네스 픽스처 — 활성 멤버·시드데이터 보유)
const PROTECT_UNITS = new Set(['store_eval']);
// 실사용자 이메일 도메인/패턴 (이 계정은 QA로 오인해 지우지 않는다)
const REAL_EMAIL = /@(naver|gmail|daum|kakao|hanmail|nate|outlook|hotmail|icloud)\.com|@team-roundtable|cristianojun/i;
// QA/자동 계정 이메일 (하드삭제 허용)
const QA_EMAIL = /@example\.com|@squaretable\.test|@test\.com|@pilot\.squaretable/i;

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

  // ── 삭제 대상 매장 선정 ──
  const delUnits = [];
  for (const u of units) {
    if (PROTECT_UNITS.has(u.id)) continue;
    // 활성 owner가 있고, 그 owner가 실사용자면 보호(멤버 0이어도)
    const ownerEmail = emailById.get(u.owner_id) || '';
    const ownerLive = liveProfIds.has(u.owner_id);
    if (ownerLive && REAL_EMAIL.test(ownerEmail)) continue;           // 실사용자 소유 → 보호
    if (u.deleted_at) { delUnits.push([u, 'soft-deleted']); continue; } // 소프트삭제
    if (!allProfIds.has(u.owner_id)) { delUnits.push([u, 'dangling(owner삭제됨)']); continue; } // 하드고아
    // owner가 소프트삭제됐고 QA면 삭제, 실사용자면 보호
    if (!ownerLive && QA_EMAIL.test(ownerEmail)) { delUnits.push([u, 'owner소프트삭제(QA)']); continue; }
  }

  // ── 삭제 대상 계정(auth.users 하드삭제): 소프트삭제 + QA이메일 (실사용자·미삭제 제외) ──
  const delUsers = profs.filter(p => p.deleted_at && QA_EMAIL.test(emailById.get(p.id) || '') && !REAL_EMAIL.test(emailById.get(p.id) || ''))
    .map(p => ({ id: p.id, email: emailById.get(p.id) }));

  console.log(`\n${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY-RUN (미실행)'} — 정리 계획\n`);
  console.log(`■ 삭제할 매장 ${delUnits.length}개 (자식 데이터 cascade):`);
  delUnits.forEach(([u, why]) => console.log(`   - ${u.id.padEnd(20)} "${u.store_name}"  [${why}]`));
  console.log(`\n■ 하드삭제할 QA 계정 ${delUsers.length}개 (auth.users → profiles cascade):`);
  console.log('   ' + (delUsers.length ? delUsers.slice(0, 8).map(u => u.email).join(', ') + (delUsers.length > 8 ? ` … 외 ${delUsers.length - 8}개` : '') : '(없음)'));
  console.log(`\n■ 보호(유지): eval 픽스처(store_eval), 실사용자 소유 매장(코홀트커피 등)`);

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
