// qa-fresh-accounts.mjs — "회원가입부터" 테스트용 고정 계정 2개를 새것으로 되돌린다 (service_role).
//
// 왜 있나: QA 고정 계정은 두 축으로 나눠 쓴다(2026-08-25 사용자 결정).
//   · 데이터 있는 축 = 파일럿 3계정(김영자/박지원/이수민 · store_001) → `npm run qa:seed`
//   · 회원가입부터 축 = 아래 2계정(test1234)                          → 이 스크립트
// 이 스크립트는 아래 2계정과 그 소유 매장을 지워서, 앱 가입 화면부터 다시 밟을 수 있게 만든다.
// 계정을 매번 새로 만들지 않는 이유는 Supabase 가입 레이트리밋(하니스 무더기 거짓실패) 때문이다.
//
// 실행:
//   node --env-file=.env.seed scripts/qa-fresh-accounts.mjs            # 계획만(DRY-RUN)
//   node --env-file=.env.seed scripts/qa-fresh-accounts.mjs --execute  # 실제 삭제
//
// ★ 삭제는 되돌릴 수 없다. 그래서 기본이 DRY-RUN 이고, 아래 TARGETS 밖의 이메일은 코드로 차단한다.
// ★ 앱에서 가입할 땐 SMS 인증(signup.tsx:109)을 통과해야 하므로 **실제로 문자를 받는 번호**가 필요하다.
//   0157 이후 번호 unique 스코프가 (번호, 가입역할)이라 같은 실번호로 사장 1개 + 직원 1개를 만들 수 있다.

const TARGETS = ['test.owner.0812@example.com', 'test.staff.0812@example.com'];
const GUARD = /^test\.(owner|staff)\.0812@example\.com$/; // TARGETS 오타/확장으로 실계정을 건드리는 사고 차단

const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) { console.error('env 없음 (--env-file=.env.seed)'); process.exit(2); }
if (!TARGETS.every((e) => GUARD.test(e))) { console.error('✗ TARGETS 에 허용되지 않은 이메일이 있다'); process.exit(2); }

const EXECUTE = process.argv.includes('--execute');
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const rest = async (path, init) => fetch(`${U}/rest/v1/${path}`, { headers: H, ...init });

async function listAuthUsers() {
  const out = []; let p = 1;
  for (;;) {
    const j = await (await fetch(`${U}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: H })).json();
    const b = j.users || []; out.push(...b); if (b.length < 200) break; p++;
  }
  return out;
}

(async () => {
  const users = (await listAuthUsers()).filter((u) => TARGETS.includes((u.email || '').toLowerCase()));
  const ids = new Set(users.map((u) => u.id));

  const profs = (await (await rest(`profiles?select=id,name,phone,role,unit_id&id=in.(${[...ids].join(',')})`)).json()) || [];
  const units = ids.size
    ? ((await (await rest(`units?select=id,store_name,owner_id&owner_id=in.(${[...ids].join(',')})`)).json()) || [])
    : [];
  const phones = profs.map((p) => p.phone).filter(Boolean);

  console.log(`\n${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY-RUN (미실행)'} — 회원가입 축 계정 초기화\n`);
  console.log('■ 대상 계정');
  for (const e of TARGETS) {
    const u = users.find((x) => (x.email || '').toLowerCase() === e);
    if (!u) { console.log(`   - ${e.padEnd(30)} (이미 없음 — 그대로 가입하면 됨)`); continue; }
    const pr = profs.find((x) => x.id === u.id);
    console.log(`   - ${e.padEnd(30)} name=${pr?.name ?? '-'} phone=${pr?.phone ?? '-'} unit=${pr?.unit_id ?? '-'}`);
  }
  console.log(`\n■ 같이 지울 소유 매장 ${units.length}개 (자식 데이터 cascade)`);
  units.forEach((u) => console.log(`   - ${String(u.id).padEnd(22)} "${u.store_name}"`));
  console.log(`\n■ 같이 지울 phone_otps 인증행: ${phones.length ? phones.join(', ') : '(없음)'}`);
  console.log('\n■ 안 건드리는 것: 파일럿 3계정(owner/staff/staff2@pilot.squaretable.app) · store_001 · 그 외 전부');

  if (!EXECUTE) { console.log('\n실제로 지우려면 `--execute` 를 붙여 다시 실행하세요.'); return; }
  if (!users.length) { console.log('\n지울 계정이 없다 — 이미 새것 상태.'); return; }

  console.log('\n삭제 실행 중…');
  for (const u of units) {
    const r = await rest(`units?id=eq.${u.id}`, { method: 'DELETE' });
    console.log(r.ok ? `  ✓ 매장 ${u.id}` : `  ! 매장 ${u.id}: ${r.status} ${await r.text()}`);
  }
  for (const u of users) {
    const r = await fetch(`${U}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H });
    console.log(r.ok ? `  ✓ 계정 ${u.email}` : `  ! 계정 ${u.email}: ${r.status}`);
  }
  for (const ph of phones) {
    const r = await rest(`phone_otps?phone=eq.${encodeURIComponent(ph)}`, { method: 'DELETE' });
    if (!r.ok) console.log(`  ! phone_otps ${ph}: ${r.status}`);
  }

  console.log(`
✓ 초기화 완료. 이제 앱에서 가입 화면부터 밟으면 된다.

   사장 축  test.owner.0812@example.com / test1234  → 가입 시 역할 '사장' 선택
   직원 축  test.staff.0812@example.com / test1234  → 가입 시 역할 '직원' 선택

★ 전화번호는 **문자를 실제로 받는 번호**를 써야 한다(가입 폼이 SMS 인증을 요구한다).
   같은 번호로 사장 1개 + 직원 1개까지 만들 수 있다(0157 — 번호 unique 스코프가 역할별).`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
