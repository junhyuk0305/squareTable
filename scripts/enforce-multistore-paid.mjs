#!/usr/bin/env node
// enforce-multistore-paid.mjs — "2매장부터는 유료" 집행 (2026-07-30 정책 결정)
//
// 왜 있나: 0062 게이트는 '신규' 2호점 생성만 막는다. 파일럿 기간(billing_free_mode=true)이나
//   시드/관리자 우회로 이미 생긴 "무료 다매장"은 소급되지 않아 정책과 어긋난 채 남는다.
//   이 스크립트가 그 잔여분을 찾아 페이월로 전환한다.
//
// 규칙: 사장별로 소유 무료 매장 중 **가장 활발한 1곳(직원수+노하우수)만 무료 유지**, 나머지 무료
//   매장은 plan='multi' + status='expired' 로 전환 → 클라 deriveSubscription 이 만료로 판정해
//   /billing 페이월로 보낸다(무료 plan 은 영구 무료로 단락되므로 plan 전환이 필수).
//   유료 매장(single/multi active)은 건드리지 않는다.
//
// 제외: PROTECT_UNITS(데모·심사) 포함 사장, QA 이메일 사장(purge cron 이 정리).
// 실행: node scripts/enforce-multistore-paid.mjs          ← dry-run (변경 없음)
//       node scripts/enforce-multistore-paid.mjs --apply  ← 실제 적용
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* 없으면 skip */ }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !K) { console.error('FAIL: URL/SERVICE_ROLE 필요(.env + .env.seed)'); process.exit(2); }
const APPLY = process.argv.includes('--apply');
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

// cleanup-orphan-stores.mjs 와 동일 목록 — 데모·심사 매장은 절대 건드리지 않는다.
const PROTECT_UNITS = new Set(['store_eval', 'store_001', 'store_appreview', 'store_002_demo', 'store_starter_demo']);
const QA_EMAIL = /@example\.com|@squaretable\.test|@pilot\.squaretable/i;

const get = async (path) => {
  const r = await fetch(`${URL}${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};
const countOf = async (table, unitId) => {
  const r = await fetch(`${URL}/rest/v1/${table}?select=unit_id&unit_id=eq.${unitId}&limit=1`, {
    method: 'HEAD', headers: { ...H, Prefer: 'count=exact' },
  });
  return Number((r.headers.get('content-range') ?? '/0').split('/')[1]) || 0;
};

const units = await get('/rest/v1/units?select=id,owner_id,store_name,created_at&order=created_at');
const subs = await get('/rest/v1/unit_subscriptions?select=unit_id,plan,status');
const subOf = new Map(subs.map((s) => [s.unit_id, s]));

const emails = new Map();
for (let p = 1; p <= 10; p++) {
  const r = await fetch(`${URL}/auth/v1/admin/users?page=${p}&per_page=100`, { headers: H });
  const list = (await r.json()).users ?? [];
  for (const u of list) emails.set(u.id, u.email);
  if (list.length < 100) break;
}

const byOwner = new Map();
for (const u of units) {
  if (!u.owner_id) continue;
  (byOwner.get(u.owner_id) ?? byOwner.set(u.owner_id, []).get(u.owner_id)).push(u);
}

let changed = 0;
for (const [owner, list] of byOwner) {
  if (list.length < 2) continue;
  const email = emails.get(owner) ?? '';
  if (list.some((u) => PROTECT_UNITS.has(u.id))) { console.log(`skip(보호): ${email}`); continue; }
  if (QA_EMAIL.test(email)) { console.log(`skip(QA): ${email}`); continue; }

  const free = list.filter((u) => (subOf.get(u.id)?.plan ?? 'free') === 'free');
  if (free.length < 2 && free.length === list.length) continue; // 무료 1곳뿐이면 정책 위반 아님
  // 활발도 = 직원수 + 노하우수. 가장 활발한 무료 매장 1곳만 무료 유지.
  const scored = [];
  for (const u of free) {
    const score = (await countOf('unit_members', u.id)) + (await countOf('playbook_entries', u.id));
    scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score || a.u.created_at.localeCompare(b.u.created_at));
  const lock = scored.slice(1); // [0]=유지, 나머지=페이월
  console.log(`\n사장 ${email} — 매장 ${list.length}곳 / 무료 ${free.length}곳`);
  if (scored[0]) console.log(`  유지: ${scored[0].u.id} "${scored[0].u.store_name}" (활발도 ${scored[0].score})`);
  for (const { u, score } of lock) {
    console.log(`  ${APPLY ? '전환' : '전환예정'}: ${u.id} "${u.store_name}" (활발도 ${score}) → plan=multi status=expired`);
    if (APPLY) {
      const r = await fetch(`${URL}/rest/v1/unit_subscriptions?unit_id=eq.${u.id}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({ plan: 'multi', status: 'expired', updated_at: new Date().toISOString() }),
      });
      const rows = r.ok ? await r.json() : [];
      if (!r.ok || rows.length !== 1) { console.error(`  !! 실패: ${u.id} → ${r.status}`); process.exitCode = 1; }
      else changed++;
    }
  }
}
console.log(`\n${APPLY ? '적용 완료' : 'dry-run 종료'} — 전환 ${APPLY ? changed : '0(dry)'}건`);
