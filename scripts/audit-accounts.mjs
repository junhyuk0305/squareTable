// audit-accounts.mjs — 실 Supabase 계정 감사 (읽기 전용, service_role)
// 실행: cd SquareTable && node --env-file=.env.seed scripts/audit-accounts.mjs
// 출력: 콘솔 + ../계정_감사_스냅샷.json (로컬 전용, gitignore 권장)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('✗ env 없음'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(table, query = 'select=*') {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { ...H, Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) { console.warn(`  ! ${table} ${res.status}: ${(await res.text()).slice(0,160)}`); return rows; }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

// auth.users via admin API (email/phone/confirmed/last_sign_in)
async function authUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
    if (!res.ok) { console.warn(`  ! auth admin ${res.status}: ${(await res.text()).slice(0,160)}`); break; }
    const j = await res.json();
    const batch = j.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

const fmt = (iso) => iso ? new Date(new Date(iso).getTime()+9*3600e3).toISOString().slice(0,16).replace('T',' ') : '—';

(async () => {
  console.log('· 연결:', SUPABASE_URL, '\n');
  const [units, profiles, users] = await Promise.all([
    rest('units'), rest('profiles'), authUsers(),
  ]);
  // 부가 테이블 (있으면)
  const [joinAttempts, roomMembers, pushSubs, subscriptions, former] = await Promise.all([
    rest('join_attempts', 'select=*&order=created_at.desc'),
    rest('work_room_members'),
    rest('push_subscriptions'),
    rest('unit_subscriptions'),
    rest('former_staff'),
  ]);

  const unitById = new Map(units.map(u => [u.id, u]));
  const profById = new Map(profiles.map(p => [p.id, p]));
  const userById = new Map(users.map(u => [u.id, u]));

  console.log('════════ 매장(units) ' + units.length + '개 ════════');
  for (const u of units) {
    const staff = profiles.filter(p => p.unit_id === u.id);
    const owner = profById.get(u.owner_id);
    console.log(`\n[${u.id}] "${u.store_name}"  업종=${u.industry||'—'}/${u.subcategory||'—'}`);
    console.log(`   owner_id=${u.owner_id||'∅'} ${owner?`(→${owner.name||'?'} role=${owner.role})`:(u.owner_id?'  ⚠️owner_id가 profiles에 없음':'  ⚠️owner 없음')}`);
    console.log(`   invite_code=${u.invite_code||'∅'}  created=${fmt(u.created_at)}  소속인원=${staff.length}`);
  }

  console.log('\n\n════════ 계정(profiles) ' + profiles.length + '개 ════════');
  console.log('n  role   name            phone        unit(store)                auth-email                       확인 lastSignIn        deleted');
  profiles.forEach((p, i) => {
    const u = userById.get(p.id);
    const unit = p.unit_id ? unitById.get(p.unit_id) : null;
    const email = u?.email || '';
    const confirmed = u ? (u.email_confirmed_at || u.confirmed_at ? '✓' : '✗') : '???';
    const last = u ? fmt(u.last_sign_in_at) : '???';
    const phone = p.phone || (p.phone_last4 ? '****'+p.phone_last4 : '');
    const store = p.unit_id ? (unit ? unit.store_name : `${p.unit_id}⚠️존재X`) : '∅무소속';
    console.log(
      `${String(i+1).padStart(2)} ${(p.role||'?').padEnd(6)} ${(p.name||'∅').padEnd(15)} ${String(phone).padEnd(12)} ${String(store).padEnd(26)} ${email.padEnd(32)} ${confirmed.padEnd(4)} ${last.padEnd(17)} ${p.deleted_at?'🗑'+fmt(p.deleted_at):''}`
    );
  });

  // ── 정합성 이상 탐지 ──
  console.log('\n\n════════ 이상 탐지 ════════');
  const issues = [];
  // 1) orphan: profile.unit_id 가 존재하지 않는 매장
  profiles.filter(p => p.unit_id && !unitById.has(p.unit_id)).forEach(p =>
    issues.push(`ORPHAN profile ${p.id} (${p.name}) → unit_id=${p.unit_id} 없음`));
  // 2) 무소속(unit_id null) 이면서 삭제 안 된 계정
  profiles.filter(p => !p.unit_id && !p.deleted_at).forEach(p =>
    issues.push(`NO_UNIT profile ${p.id} (${p.name}, role=${p.role}) 무소속·미삭제 (합류 미완 고아 가능)`));
  // 3) auth.users 에는 있는데 profile 없음 (트리거 실패 흔적)
  users.filter(u => !profById.has(u.id)).forEach(u =>
    issues.push(`NO_PROFILE auth user ${u.id} (${u.email||u.phone||'?'}) → profiles 행 없음 (handle_new_user 실패?)`));
  // 4) profile 있는데 auth.users 없음 (수동 시드/삭제 잔재)
  profiles.filter(p => !userById.has(p.id)).forEach(p =>
    issues.push(`NO_AUTH profile ${p.id} (${p.name}) → auth.users 없음 (시드/잔재)`));
  // 5) owner 매장 소유 정합: role=owner 인데 그 매장 owner_id 가 본인이 아님
  profiles.filter(p => p.role === 'owner' && p.unit_id).forEach(p => {
    const u = unitById.get(p.unit_id);
    if (u && u.owner_id !== p.id) issues.push(`OWNER_MISMATCH ${p.name}(${p.id}) role=owner unit=${p.unit_id} 인데 units.owner_id=${u.owner_id}`);
  });
  // 6) 매장에 owner role 계정이 0명
  units.forEach(u => {
    const owners = profiles.filter(p => p.unit_id === u.id && p.role === 'owner');
    if (owners.length === 0) issues.push(`NO_OWNER 매장 ${u.id}(${u.store_name}) 에 owner role 계정 0명`);
    if (owners.length > 1) issues.push(`MULTI_OWNER 매장 ${u.id}(${u.store_name}) owner ${owners.length}명: ${owners.map(o=>o.name).join(',')}`);
  });
  // 7) 전화번호 중복 (0022: phone unique 주키)
  const phoneMap = new Map();
  profiles.filter(p=>p.phone).forEach(p => { const k=p.phone; phoneMap.set(k,(phoneMap.get(k)||[]).concat(p)); });
  [...phoneMap].filter(([,v])=>v.length>1).forEach(([k,v]) =>
    issues.push(`DUP_PHONE ${k} → ${v.length}개 계정: ${v.map(p=>`${p.name}/${p.role}`).join(', ')}`));
  // 8) 이메일 중복 (auth)
  const emailMap = new Map();
  users.filter(u=>u.email).forEach(u => { const k=u.email.toLowerCase(); emailMap.set(k,(emailMap.get(k)||[]).concat(u)); });
  [...emailMap].filter(([,v])=>v.length>1).forEach(([k,v]) => issues.push(`DUP_EMAIL ${k} → ${v.length}개`));
  // 9) 미확인 이메일 계정
  users.filter(u => u.email && !(u.email_confirmed_at||u.confirmed_at)).forEach(u =>
    issues.push(`UNCONFIRMED ${u.email} (created ${fmt(u.created_at)}, lastSignIn ${fmt(u.last_sign_in_at)})`));

  if (issues.length === 0) console.log('  ✓ 이상 없음');
  else issues.forEach(s => console.log('  • ' + s));

  // ── 부가 테이블 요약 ──
  console.log('\n════════ 부가 테이블 ════════');
  console.log(`join_attempts: ${joinAttempts.length}  work_room_members: ${roomMembers.length}  push_subscriptions: ${pushSubs.length}  unit_subscriptions: ${subscriptions.length}  former_staff: ${former.length}`);
  if (joinAttempts.length) {
    console.log('\n최근 join_attempts (합류 시도):');
    joinAttempts.slice(0,15).forEach(j => console.log(`  ${fmt(j.created_at)}  ${JSON.stringify(j).slice(0,200)}`));
  }
  // push_subscriptions 소유 정합 (다른 매장 구독 섞임?)
  if (pushSubs.length) {
    pushSubs.forEach(s => {
      const owner = profById.get(s.user_id || s.profile_id);
      const su = s.unit_id;
      if (owner && su && owner.unit_id !== su) issues.push(`PUSH_TENANT_MISMATCH sub user=${s.user_id||s.profile_id} unit=${su} 인데 profile.unit=${owner.unit_id}`);
    });
  }

  const out = resolve(__dirname, '..', '..', '계정_감사_스냅샷.json');
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), counts:{units:units.length,profiles:profiles.length,authUsers:users.length}, units, profiles: profiles.map(p=>({...p, email:userById.get(p.id)?.email, confirmed: !!(userById.get(p.id)?.email_confirmed_at||userById.get(p.id)?.confirmed_at), last_sign_in: userById.get(p.id)?.last_sign_in_at})), authOnly: users.filter(u=>!profById.has(u.id)), issues }, null, 2), 'utf-8');
  console.log(`\n✓ 스냅샷: ${out}`);
  console.log(`  이상 ${issues.length}건 · 매장 ${units.length} · 계정 ${profiles.length} · authUsers ${users.length}`);
})().catch(e => { console.error('✗', e.stack); process.exit(1); });
