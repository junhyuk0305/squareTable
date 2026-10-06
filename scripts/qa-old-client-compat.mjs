// qa:old-client-compat — 옛 클라(라이브 웹·출시 앱·라이브 엣지)가 새 DB 에서도 그대로 도는가 (2026-10-06 사용자 규칙)
//
//   규칙: DB 는 앱 출시 시점과 맞추지 않는다. 모든 마이그레이션은 옛 클라가 그대로 도는 상태로 짠다(.claude/rules/db-rls.md).
//   이 하니스는 그중 기계로 잡히는 부분을 본다.
//     ① 옛 클라 코드(OLD_REF, 기본 main)의 .rpc('이름', { 인자 }) 호출마다, 로컬 DB(마이그레이션 전체 재생본)에
//        같은 이름 함수가 있고 · 보낸 인자 이름을 모두 받고 · 기본값 없는 필수 인자를 다 보냈는가.
//     ② 화면 코드(src/) 호출이면 authenticated 에 실행 권한이 있는가(엣지는 service_role 이라 제외).
//     ③ .from('이름') 의 테이블·뷰가 있는가.
//   못 잡는 것: 결과 모양·뜻이 바뀐 경우, RLS 로 행이 줄어든 경우. 그건 마이그레이션 머리말 '옛 앱 호환:' 근거와 도메인 하니스가 본다.
//
// 실행: 로컬 Supabase(도커) 를 새 마이그레이션까지 재생한 뒤
//   node --no-warnings scripts/qa-old-client-compat.mjs            (옛 클라 = main)
//   OLD_REF=<출시 빌드 커밋> node --no-warnings scripts/qa-old-client-compat.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const OLD_REF = process.env.OLD_REF || 'main';
const DB = process.env.QA_DB_CONTAINER || 'supabase_db_SquareTable';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};
// 축소 단계 파일('올리기 조건:' 머리말)이 닫는 함수는 FAIL 이 아니라 WAIT 로 센다 — 조건(새 엣지·새 앱 퍼짐)이 맞을 때만 올린다.
const contract = new Map(); // 함수 이름 → 파일
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql'))) {
  const t = readFileSync(`supabase/migrations/${f}`, 'utf8');
  if (!/^-- 올리기 조건:/m.test(t)) continue;
  for (const m of t.matchAll(/revoke[^;]*function public\.(\w+)\(/g)) contract.set(m[1], f);
}
let wait = 0;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 64 << 20 });

try { psql('select 1;'); } catch { console.log('SKIP — 로컬 DB 컨테이너가 없다(도커·supabase start 먼저)'); process.exit(1); }

// ── 옛 클라 호출 모으기 ─────────────────────────────────────────────────────
const files = git('ls-tree', '-r', '--name-only', OLD_REF, '--', 'src', 'supabase/functions')
  .split('\n').filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/(__tests__|\.test\.)/.test(f));

// 객체 리터럴의 맨 바깥 키만 꺼낸다({ a: 1, b, c: { d } } → a, b, c).
const topKeys = (body) => {
  const keys = []; let depth = 0, cur = '';
  for (const ch of body) {
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { keys.push(cur); cur = ''; } else cur += ch;
  }
  keys.push(cur);
  return keys.map((k) => (k.trim().match(/^\.\.\./) ? '*' : (k.trim().match(/^['"]?(\w+)['"]?\s*(?::|$)/) || [])[1]))
    .filter(Boolean);
};
// 'name', { ... } 에서 짝 맞는 중괄호까지 자른다.
const objAt = (s, i) => {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return s.slice(i + 1, j);
  }
  return null;
};

const rpcCalls = new Map(); // name → [{ file, keys|null, client }]
const tables = new Map();   // name → file
const storageBuckets = new Set(); // storage.from('버킷') 은 테이블이 아니다
for (const f of files) {
  const s = git('show', `${OLD_REF}:${f}`);
  for (const m of s.matchAll(/\.rpc\(\s*['"`](\w+)['"`]\s*(,\s*)?/g)) {
    let keys = [];
    if (m[2]) {
      const at = m.index + m[0].length;
      keys = s[at] === '{' ? topKeys(objAt(s, at) ?? '') : null; // 변수로 넘기면 인자 이름을 모른다
    }
    // 화면 코드는 사용자 권한. 엣지는 userClient(authz) 처럼 사용자 토큰 클라로 부를 때만 권한을 본다(0276: 엣지가 userClient 로 부르던 함수의 권한을 빼면 조용히 실패).
    const client = f.startsWith('src/') || /user\w*\([^()]*\)\s*$/.test(s.slice(Math.max(0, m.index - 40), m.index));
    if (!rpcCalls.has(m[1])) rpcCalls.set(m[1], []);
    rpcCalls.get(m[1]).push({ file: f, keys, client });
  }
  for (const m of s.matchAll(/storage\s*\.from\(\s*['"`](\w[\w-]*)['"`]/g)) storageBuckets.add(m[1]);
  for (const m of s.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)) if (!tables.has(m[1])) tables.set(m[1], f);
}
// ── 새 DB 함수 시그니처 ─────────────────────────────────────────────────────
const names = [...rpcCalls.keys()];
const rows = psql(`
  select p.proname, p.oid,
         coalesce(array_to_string(p.proargnames, ','), ''),
         coalesce(array_to_string(p.proargmodes::text[], ','), ''),
         p.pronargs, p.pronargdefaults,
         has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(array[${names.map((n) => `'${n}'`).join(',') || "''"}]);`)
  .trim().split('\n').filter(Boolean).map((l) => {
    const [name, , argnames, modes, nargs, ndef, exec] = l.split('\t');
    const all = argnames ? argnames.split(',') : [];
    const md = modes ? modes.split(',') : all.map(() => 'i');
    const inputs = all.filter((_, i) => md[i] === 'i' || md[i] === 'b' || md[i] === 'v');
    return { name, inputs, required: inputs.slice(0, Number(nargs) - Number(ndef)), exec: exec === 't' };
  });
const byName = new Map();
for (const r of rows) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }

console.log(`[①②] 옛 클라(${OLD_REF}) 의 rpc ${names.length}개가 새 DB 에서 같은 인자로 불리는가`);
for (const [name, calls] of [...rpcCalls].sort()) {
  const overloads = byName.get(name) || [];
  if (!overloads.length) { check(`${name} 이 있다`, false, `없음 · 호출 ${calls[0].file}`); continue; }
  const bad = [];
  for (const c of calls) {
    if (c.keys === null || c.keys.includes('*')) continue; // 인자 이름을 정적으로 모름
    const ok = overloads.some((o) => c.keys.every((k) => o.inputs.includes(k)) && o.required.every((k) => c.keys.includes(k)));
    if (!ok) bad.push(`${c.file} {${c.keys.join(',')}} ↔ ${overloads.map((o) => `(${o.inputs.join(',')}; 필수 ${o.required.join(',') || '없음'})`).join(' | ')}`);
    if (c.client && !overloads.some((o) => o.exec)) bad.push(`${c.file} authenticated 실행 권한 없음(사용자 권한으로 부름)`);
  }
  if (bad.length && contract.has(name) && bad.every((b) => b.includes('실행 권한 없음'))) {
    wait++; console.log(`  WAIT ${name} — 축소 단계 ${contract.get(name)} 가 닫는다. 그 파일의 '올리기 조건'이 맞을 때만 올린다`);
    continue;
  }
  check(`${name}`, bad.length === 0, [...new Set(bad)].join(' / '));
}

console.log(`[③] 옛 클라의 .from() 테이블·뷰 ${tables.size}개가 있는가`);
const rels = new Set(psql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','v','m','p');`).trim().split('\n'));
for (const [t, f] of [...tables].sort()) {
  if (storageBuckets.has(t)) continue; // storage.from('버킷')
  check(`${t}`, rels.has(t), `없음 · ${f}`);
}

console.log(`\n${pass} PASS / ${fail} FAIL${wait ? ` / ${wait} WAIT` : ''}`);
process.exit(fail ? 1 : 0);
