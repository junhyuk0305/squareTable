// qa:old-client-compat — 옛 클라(라이브 웹·출시 앱·라이브 엣지)가 새 DB 에서도 그대로 도는가 (2026-10-06 사용자 규칙)
//
//   규칙: DB 는 앱 출시 시점과 맞추지 않는다. 모든 마이그레이션은 옛 클라가 그대로 도는 상태로 짠다(.claude/rules/db-rls.md).
//   이 하니스는 그중 기계로 잡히는 부분을 본다.
//     ① 옛 클라 코드(OLD_REF, 기본 main)의 .rpc('이름', { 인자 }) 호출마다, 로컬 DB(마이그레이션 전체 재생본)에
//        같은 이름 함수가 있고 · 보낸 인자 이름을 모두 받고 · 기본값 없는 필수 인자를 다 보냈는가.
//     ② 화면 코드(src/) 호출이면 authenticated 에 실행 권한이 있는가(엣지는 service_role 이라 제외).
//     ③ .from('이름') 의 테이블·뷰가 있는가.
//     ④ 결과 모양(2026-11-12 S5): 옛 클라의 .from('표').select('열…') 열이 다 있는가 · 할 일·결제 호출을 옛 인자 그대로
//        사장 세션(role authenticated + JWT claims)으로 실제 불러, 옛 코드가 `data as <타입>` 으로 읽는 필수 필드가 오는가.
//        한 트랜잭션에서 부르고 롤백한다(남는 행 0). 고정 계정 owner@pilot 이 로컬에 없으면 FAIL 로 센다.
//   못 잡는 것: 뜻이 바뀐 경우(같은 필드에 다른 의미), RLS 로 행이 줄어든 경우. 그건 마이그레이션 머리말 '옛 앱 호환:' 근거와 도메인 하니스가 본다.
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

// ── [④] 결과 모양 ───────────────────────────────────────────────────────────
const oldSrc = (f) => { try { return git('show', `${OLD_REF}:${f}`); } catch { return ''; } };
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/** 옛 소스의 `type 이름 = { … }` 에서 필수 필드(물음표 없는 것)만 꺼낸다. */
const typeFields = (src, name) => {
  const m = src.match(new RegExp(`type ${name} = \\{`));
  if (!m) return null;
  const body = noComments(objAt(src, m.index + m[0].length - 1) ?? '');
  const out = []; let depth = 0, cur = '';
  for (const ch of body + '\n') {
    if ('{[(<'.includes(ch)) depth++;
    if ('}])>'.includes(ch)) depth--;
    if ((ch === ';' || ch === '\n' || ch === ',') && depth === 0) {
      const k = cur.match(/^\s*['"]?(\w+)['"]?(\?)?\s*:/);
      if (k && !k[2]) out.push(k[1]);
      cur = '';
    } else cur += ch;
  }
  return out;
};
const DB_TS = oldSrc('src/lib/db.ts');
const TYPES_TS = oldSrc('src/types/index.ts');

// ④-a 옛 클라의 select 열이 새 DB 에 다 있는가 (열을 지우거나 이름을 바꾸면 옛 앱의 그 읽기가 통째로 실패한다)
const cols = new Map();
for (const l of psql(`select table_name, column_name from information_schema.columns where table_schema = 'public';`).trim().split('\n')) {
  const [t, c] = l.split('\t');
  if (!cols.has(t)) cols.set(t, new Set());
  cols.get(t).add(c);
}
const selects = new Map(); // 표 → Map(열 → 파일)
for (const f of files.filter((x) => x.startsWith('src/'))) {
  const s = git('show', `${OLD_REF}:${f}`);
  for (const m of s.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)\s*\.select\(\s*['"`]([^'"`]*)['"`]/g)) {
    if (storageBuckets.has(m[1])) continue;
    // 맨 바깥 쉼표로 자른다. 끼워 읽기(profiles(name))·* ·count 는 뺀다. 별칭 a:b → b, json 경로 data->>x → data.
    let depth = 0, cur = ''; const parts = [];
    for (const ch of m[2] + ',') {
      if (ch === '(') depth++; if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    for (let p of parts) {
      if (!p || p.includes('(') || p.includes('*')) continue;
      p = p.replace(/^\w+:/, '').replace(/->.*$/, '').replace(/::\w+$/, '').trim();
      if (!/^\w+$/.test(p)) continue;
      if (!selects.has(m[1])) selects.set(m[1], new Map());
      if (!selects.get(m[1]).has(p)) selects.get(m[1]).set(p, f);
    }
  }
}
console.log(`[④-a] 옛 클라의 select 열 ${[...selects.values()].reduce((n, m) => n + m.size, 0)}개(표 ${selects.size}개)가 있는가`);
for (const [t, m] of [...selects].sort()) {
  const have = cols.get(t);
  const miss = [...m].filter(([c]) => !have?.has(c)).map(([c, f]) => `${c}(${f})`);
  check(`${t} 열`, have && miss.length === 0, have ? `없는 열 ${miss.join(', ')}` : '표 없음');
}

// ④-b 할 일·결제 호출을 옛 인자로 실제 부른다(사장 세션 · 롤백)
console.log('[④-b] 옛 클라의 할 일·결제 호출이 옛 코드가 읽는 모양으로 돌아오는가(사장 owner@pilot · 롤백)');
const OWNER_EMAIL = 'owner@pilot.squaretable.app';
const ownerId = psql(`select id from auth.users where email = '${OWNER_EMAIL}';`).trim();
/** 사장 세션으로 한 트랜잭션을 돌리고 롤백한다. 줄마다 `STEP\t이름\tjsonb`. 오류면 { err }. */
const asOwner = (body) => {
  const sql = `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub: ownerId, role: 'authenticated', email: OWNER_EMAIL })}', true) \\g /dev/null\n${body}\nrollback;\n`;
  try {
    const out = psql(sql);
    const steps = new Map();
    for (const l of out.split('\n')) {
      const [tag, name, json] = l.split('\t');
      if (tag !== 'STEP') continue;
      if (!steps.has(name)) steps.set(name, []);
      steps.get(name).push(json === '' || json === undefined ? null : JSON.parse(json));
    }
    return { steps };
  } catch (e) {
    return { err: String(e.stderr || e.message).split('\n').find((l) => /ERROR/.test(l)) ?? String(e.message).slice(0, 200) };
  }
};
const step = (name, expr) => `select 'STEP', '${name}', ${expr};`;
const declared = new Map(psql(`
  select p.proname,
         coalesce((select string_agg(u.n, ',') from unnest(p.proargnames, p.proargmodes::text[]) as u(n, m) where u.m in ('o', 't', 'b')),
                  (select string_agg(a.attname, ',') from pg_attribute a join pg_type t on t.typrelid = a.attrelid
                    where t.oid = p.prorettype and a.attnum > 0 and not a.attisdropped), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';`)
  .trim().split('\n').map((l) => { const [n, c] = l.split('\t'); return [n, new Set((c || '').split(',').filter(Boolean))]; }));
const hasKeys = (obj, keys) => keys.filter((k) => !(obj && typeof obj === 'object' && k in obj));

if (!ownerId) {
  check('고정 계정 owner@pilot 이 로컬에 있다', false, '없음 — node scripts/qa-local-accounts.mjs 를 먼저 돌린다(④-b 전부 못 돎)');
} else {
  const unit = psql(`select active_unit_id from public.profiles where id = '${ownerId}';`).trim();
  const room = psql(`select id from public.work_rooms where unit_id = '${unit}' and is_default limit 1;`).trim();
  const tag = `s5old_${Date.now()}`;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  // 결제 읽기: 옛 db.ts 가 `data as 타입` 으로 읽는 것
  const shape = [
    ['unit_seat_status', `(select to_jsonb(x) from public.unit_seat_status() x limit 1)`, { type: 'SeatStatus' }],
    ['needs_downgrade_choice', `(select to_jsonb(x) from public.needs_downgrade_choice() x limit 1)`, { type: 'DowngradeNeed' }],
    ['iap_enabled', `to_jsonb(public.iap_enabled())`, { bool: true }],
    ['my_can_add_store', `to_jsonb(public.my_can_add_store())`, { bool: true }],
    ['my_seat_locked', `to_jsonb(public.my_seat_locked())`, { bool: true }],
    ['my_unit_locked', `to_jsonb(public.my_unit_locked())`, { bool: true }],
    ['billing_free_mode', `to_jsonb(public.billing_free_mode())`, { bool: true }],
    ['owner_prepaid_until', `to_jsonb(public.owner_prepaid_until())`, { strOrNull: true }],
    ['my_multi_until', `to_jsonb(public.my_multi_until())`, { strOrNull: true }],
  ];
  const r1 = asOwner(shape.map(([n, e]) => step(n, e)).join('\n'));
  for (const [n, , exp] of shape) {
    if (r1.err) { check(`${n} 결과 모양`, false, r1.err); continue; }
    const v = r1.steps.get(n)?.[0];
    if (exp.type) {
      const keys = typeFields(DB_TS, exp.type);
      check(`${n} → ${exp.type}{${keys?.join(',')}}`, keys && hasKeys(v, keys).length === 0, keys ? `없는 필드 ${hasKeys(v, keys).join(',')} · 받은 값 ${JSON.stringify(v)}` : '옛 타입을 못 찾음');
    } else if (exp.bool) check(`${n} → boolean`, typeof v === 'boolean', `받은 값 ${JSON.stringify(v)}`);
    else check(`${n} → 문자열|null`, v === null || v === undefined || typeof v === 'string', `받은 값 ${JSON.stringify(v)}`);
  }
  // 행을 돌려주는 함수는 비어 있어도 잴 수 있게 선언된 결과 열을 본다
  for (const [fn, keys] of [
    ['my_card_release_candidates', ['unit_id', 'store_name']],
    ['redeem_promo_code', typeFields(DB_TS, 'PromoRedeemRow')],
    ['broadcast_notice', ['broadcast_id', 'sent']],
  ]) {
    const d = declared.get(fn);
    const miss = (keys ?? []).filter((k) => !d?.has(k));
    check(`${fn} 결과 열 ⊇ {${keys?.join(',')}}`, d && keys && miss.length === 0, d ? `없는 열 ${miss.join(',')} · 선언 ${[...d].join(',')}` : '함수 없음');
  }
  // 옛 화면이 아는 오류 코드: 옛 billing.tsx 의 코드 → 문구 표
  const oldBillingCodes = new Set([...noComments(oldSrc('src/app/billing.tsx')).matchAll(/^\s+([a-z_]+): '/gm)].map((m) => m[1]));
  const codeOf = (err) => (err?.match(/ERROR:\s+([a-z_]+)/) || [])[1] ?? '(코드 없음)';
  // 없는 코드 = 빈 결과(0323 결정 · 옛 앱은 !data 로 읽어 일반 실패 문구를 띄운다). 오류면 옛 표에 있는 코드여야 한다.
  const promo = asOwner(`select 'STEP', 'promo', to_jsonb(x) from public.redeem_promo_code(p_code => 'S5-NO-SUCH-CODE') x;\nselect 'STEP', 'promo_n', 0;`);
  check('redeem_promo_code(없는 코드) → 빈 결과(0323) 또는 옛 화면이 아는 코드',
    promo.err ? oldBillingCodes.has(codeOf(promo.err)) : !promo.steps.has('promo'),
    promo.err ? `받은 코드 ${codeOf(promo.err)} · 옛 표 ${[...oldBillingCodes].join(',')}` : `행이 왔다 ${JSON.stringify(promo.steps.get('promo'))}`);  // 입금 신고: 옛 앱이 보내는 인자 그대로(옛 TERMS_VERSION 포함)
  const oldTerms = (oldSrc('src/lib/config/business.ts').match(/TERMS_VERSION = '([^']+)'/) || [])[1];
  const claim = asOwner(step('claim', `(select to_jsonb(x) from public.submit_payment_claim(p_plan => 'single', p_amount => 0, p_depositor => 'S5옛앱', p_months => 1, p_memo => null, p_terms_version => '${oldTerms}', p_biz_no => null, p_biz_email => null, p_store_count => 1) x limit 1)`));
  const claimKeys = typeFields(TYPES_TS, 'PaymentClaim');
  if (claim.err) check(`submit_payment_claim(옛 인자 · 약관 ${oldTerms}) → 옛 화면이 아는 코드`, oldBillingCodes.has(codeOf(claim.err)), `받은 코드 ${codeOf(claim.err)}`);
  else {
    const v = claim.steps.get('claim')?.[0];
    check(`submit_payment_claim(옛 인자 · 약관 ${oldTerms}) → PaymentClaim{${claimKeys?.join(',')}}`, claimKeys && hasKeys(v, claimKeys).length === 0, `없는 필드 ${hasKeys(v, claimKeys ?? []).join(',')}`);
  }

  // 할 일: 옛 db.ts 의 쓰기 모양 그대로 한 바퀴(만들기 → 고치기 → 완료 → 피드 → 표시 RPC → 지우기)
  const mapFields = [...new Set([...(noComments(DB_TS).match(/function mapTemplateRow[\s\S]*?\n}\n/) || [''])[0].matchAll(/\br\.(\w+)/g)].map((m) => m[1]))];
  const feed = { id: `${tag}_f`, date: today, kind: 'message', text: 'S5 옛 앱 모양', authorId: ownerId, authorName: 'S5', authorRole: 'owner', createdAt: new Date().toISOString(), roomId: room };
  const mark = { by: ownerId, byName: 'S5', at: new Date().toISOString() };
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const tpl = `${tag}_t`;
  // 쓰기는 CTE 로 감싸 영향 행 수(또는 행)를 찍는다. PostgREST 가 옛 앱 요청을 바꾸는 SQL 과 같은 모양이다.
  const dml = (name, sql, expr = 'count(*)') => `with x as (${sql}) select 'STEP', '${name}', ${expr} from x;`;
  const task = asOwner([
    dml('tpl_insert', `insert into public.work_templates (id, section, text, description, replaces_routine_id, room_id, section_note, scope, owner_ids, owner_id, recurrence, date, remind_at, unit_id)
       values (${q(tpl)}, 'open', 'S5 옛 앱 할 일', null, null, ${q(room)}, null, 'shared', array[${q(ownerId)}]::uuid[], ${q(ownerId)}, null, ${q(today)}, null, ${q(unit)}) returning *`, 'to_jsonb(x)'),
    dml('tpl_update', `update public.work_templates set section = 'open', text = 'S5 고침', description = null, section_note = null, scope = 'shared', owner_ids = array[${q(ownerId)}]::uuid[], owner_id = ${q(ownerId)}, recurrence = null, date = ${q(today)}, remind_at = null where id = ${q(tpl)} returning id`),
    dml('done_insert', `insert into public.work_done (unit_id, work_date, template_id, room_id, data) values (${q(unit)}, ${q(today)}, ${q(tpl)}, ${q(room)}, ${q(JSON.stringify(mark))}::jsonb) on conflict do nothing returning template_id`),
    step('done_read', `(select to_jsonb(d) from (select work_date, template_id, data from public.work_done where work_date >= ${q(today)} and template_id = ${q(tpl)}) d limit 1)`),
    dml('feed_upsert', `insert into public.work_feed (id, unit_id, feed_date, room_id, data) values (${q(feed.id)}, ${q(unit)}, ${q(today)}, ${q(room)}, ${q(JSON.stringify(feed))}::jsonb)
       on conflict (id) do update set unit_id = excluded.unit_id, feed_date = excluded.feed_date, room_id = excluded.room_id, data = excluded.data returning id`),
    step('feed_read', `(select to_jsonb(f) from (select data from public.work_feed where feed_date >= ${q(today)} and id = ${q(feed.id)}) f limit 1)`),
    // 전체 읽음을 먼저 — 이미 읽은 글은 서버가 세지 않는다(0176 · 그 경우는 찾은결함 S5 항목)
    step('mark_all_feed_read', `to_jsonb(public.mark_all_feed_read(p_feed_ids => array[${q(feed.id)}]))`),
    step('mark_feed_read', `to_jsonb(public.mark_feed_read(p_feed_id => ${q(feed.id)}))`),
    step('toggle_feed_reaction', `to_jsonb(public.toggle_feed_reaction(p_feed_id => ${q(feed.id)}, p_emoji => '✅'))`),
    step('edit_feed_text', `to_jsonb(public.edit_feed_text(p_feed_id => ${q(feed.id)}, p_text => 'S5 고친 글'))`),
    dml('tpl_hidden', `update public.work_templates set hidden = true where id in (${q(tpl)}) returning id`),
    dml('feed_delete', `delete from public.work_feed where id = ${q(feed.id)} returning id`),
    dml('done_delete', `delete from public.work_done where unit_id = ${q(unit)} and work_date = ${q(today)} and template_id = ${q(tpl)} returning template_id`),
    dml('tpl_delete', `delete from public.work_templates where id = ${q(tpl)} returning id`),
  ].join('\n'));
  if (task.err) check('할 일 한 바퀴(옛 쓰기 모양)', false, task.err);
  else {
    const s = (n) => task.steps.get(n)?.[0];
    const row = s('tpl_insert');
    check(`work_templates insert → 옛 mapTemplateRow 가 읽는 열 ${mapFields.length}개`, mapFields.length > 0 && hasKeys(row, mapFields).length === 0, `없는 열 ${hasKeys(row, mapFields).join(',')}`);
    for (const n of ['tpl_update', 'done_insert', 'feed_upsert', 'tpl_hidden', 'feed_delete', 'done_delete', 'tpl_delete']) check(`${n} → 1행`, Number(s(n)) === 1, `받은 값 ${JSON.stringify(s(n))}`);
    check('work_done 읽기 → {work_date,template_id,data}', hasKeys(s('done_read'), ['work_date', 'template_id', 'data']).length === 0, JSON.stringify(s('done_read')));
    check('work_feed 읽기 → data 가 옛 FeedItem', s('feed_read')?.data?.id === feed.id, JSON.stringify(s('feed_read')));
    // 옛 rpcBool 은 data === true 만 성공으로 본다
    for (const n of ['mark_feed_read', 'toggle_feed_reaction', 'edit_feed_text']) check(`${n} → true`, s(n) === true, `받은 값 ${JSON.stringify(s(n))}`);
    // 옛 markAllFeedRead 는 숫자 = 요청 건수여야 성공
    check('mark_all_feed_read → 1', s('mark_all_feed_read') === 1, `받은 값 ${JSON.stringify(s('mark_all_feed_read'))}`);
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL${wait ? ` / ${wait} WAIT` : ''}`);
process.exit(fail ? 1 : 0);
