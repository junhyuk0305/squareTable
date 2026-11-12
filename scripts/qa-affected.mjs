// qa-affected.mjs — 바뀐 파일로 돌릴 하니스를 골라서 돌린다(2026-11-12).
//
//   npm run qa:affected                  main 과 달라진 파일(커밋 + 작업 중 + 새 파일) 기준 · 로컬 대상
//   npm run qa:affected -- --list        고르기만 하고 돌리지 않는다
//   npm run qa:affected -- --base <ref>  비교 기준을 바꾼다(기본 main)
//   npm run qa:affected -- --files a,b   git 대신 이 파일 목록으로 고른다
//   npm run qa:affected -- --heavy       여정·크롤 하니스도 돌린다(개발 서버 8081 필요 · 수십 분)
//   npm run qa:affected -- --allow-remote [--allow-ai]   라이브 대상(main 체크아웃에서만) · AI 호출 하니스는 --allow-ai 가 있어야 돈다
//
// 고르는 법(하니스 본문을 읽어 자동으로 잇는다):
//   마이그레이션  → 그 파일이 만든·바꾼 함수 이름이 나오는 하니스 + 표를 .from()/rest 로 읽는 하니스 + qa-map.json 의 migrations 표
//   엣지 함수     → functions/v1/<이름> 을 부르는 하니스
//   src 파일      → 그 경로를 본문에 적은 하니스(정적 검사) + qa-map.json 의 src 표
//   하니스·lib    → 그 하니스 자신 · 그 lib 을 import 하는 하니스
// 함수·표 하나에 하니스가 WIDE 개 넘게 걸리면 그것으로는 고르지 않고 알려만 준다(셋업에 쓰는 join_by_invite · units 같은 것).
//
// 돌리는 법: 고정 계정·브라우저를 쓰는 하니스는 한 번에 하나, 나머지는 JOBS 개씩 같이. 하니스당 15분 넘으면 죽인다.
//   전화번호 접두(0107… 처럼 시각을 붙이는 앞 4자리)가 겹치는 하니스는 같이 돌리지 않는다.
//   로컬 대상에서는 로컬 도커의 주소·키를 env 로 넘긴다. --local 을 지원하거나 셸 env 를 먼저 읽는 하니스,
//   백엔드를 안 쓰는 하니스가 돈다. 나머지(.env 파일만 읽는 것)는 skip 으로 센다.
// 같이 돌 때 실패한 하니스는 끝에 혼자 한 번 다시 돌린다. 그때 통과하면 PASS 로 세고 FLAKY 에도 센다(숨기지 않는다).
// 마지막 줄: GREEN|RED — PASS n · FAIL n · SKIP n · KNOWN n · FLAKY n · UNMAPPED n. FAIL 이 있으면 종료 코드 1.
//   KNOWN = qa-known-red.json 에 적힌 하니스의 실패. UNMAPPED = src·supabase 파일인데 걸리는 하니스가 없는 것.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { localEnv } from './qa-local-target.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const REMOTE = flag('--allow-remote');
const ALLOW_AI = flag('--allow-ai');
const HEAVY = flag('--heavy');
const LIST = flag('--list');
const JOBS = Number(opt('--jobs', 3));
const TIMEOUT_MS = 15 * 60 * 1000;
const WIDE = 25;

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ── 1. 바뀐 파일 ─────────────────────────────────────────────
let changed;
if (opt('--files')) changed = opt('--files').split(',');
else {
  const base = git('merge-base', opt('--base', 'main'), 'HEAD')[0];
  changed = [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])];
}

// ── 2. 하니스 색인(package.json 에 등록된 것만) ────────────────
const pkg = JSON.parse(read(join(ROOT, 'package.json'))).scripts;
const npmName = {};
// :local 로만 등록된 하니스도 있다(qa:space-isolation:local). 이름은 :local 아닌 것을 먼저 쓴다.
for (const [k, v] of Object.entries(pkg).sort(([x], [y]) => x.endsWith(':local') - y.endsWith(':local'))) {
  if (!k.startsWith('qa:')) continue;
  for (const m of v.matchAll(/scripts\/(qa-[\w.-]+\.(?:mjs|cjs))/g)) npmName[m[1]] ??= k;
}
delete npmName['qa-affected.mjs'];
const map = JSON.parse(read(join(SCRIPTS, 'qa-map.json')));
const known = new Set(JSON.parse(read(join(SCRIPTS, 'qa-known-red.json'))));
const harness = Object.keys(npmName).map((file) => {
  const t = read(join(SCRIPTS, file));
  const id = file.replace(/\.(mjs|cjs)$/, '');
  return {
    file, id, t,
    tables: new Set([...t.matchAll(/\.from\(\s*['"`](\w+)['"`]|rest\/v1\/(\w+)/g)].map((m) => m[1] ?? m[2])),
    edges: new Set([...t.matchAll(/functions\/v1\/([\w-]+)|invoke\(\s*['"`]([\w-]+)/g)].map((m) => m[1] ?? m[2])),
    srcRefs: [...new Set(t.match(/src\/[\w/.\-[\]()]+/g) ?? [])],
    imports: new Set([...t.matchAll(/['"]\.\/(lib\/[\w-]+\.mjs|qa-[\w-]+\.mjs)['"]/g)].map((m) => `scripts/${m[1]}`)),
    local: /--local|qa-local-target/.test(t),
    shellEnv: /{ ...process.env }/.test(t), // 셸 env 를 .env 파일보다 먼저 읽는다 → 로컬 주소·키를 env 로 넘기면 로컬로 간다
    pure: !/SUPABASE|lib\/cdp|QA_ORIGIN|localhost:8081/.test(t),
    // 전역 스위치(app_config.billing_free_mode)를 바꾸는 하니스도 혼자 돈다. 같이 돌던 하니스의 전제가 흔들린다.
    serial: /lib\/(cdp|qa-fixed-accounts)|owner@|staff2?@|hq@pilot|\.0812/.test(t)
      // 쓰는 방식이 파일마다 달라서(update·upsert·svcPatch·svcWrite·setConfig·setFreeMode·psql update) 스위치 이름 + 쓰기 동작이 한 파일에 있으면 혼자 돌린다.
      || (/billing_free_mode/.test(t) && /\.update\(|\.upsert\(|svcPatch|svcWrite|setConfig|setFreeMode|update public\.app_config/.test(t)),
    // 전화번호 = 접두 4자리 + 시각 앞 7자리(100ms 단위). 같은 때 시작한 두 하니스가 접두를 같이 쓰면 번호가 같아져
    // 한쪽 가입의 번호가 비고 합류가 막힌다(qa-room-matrix·qa-room-isolation 의 approve_member not_pending). 그래서 접두를 모은다.
    phones: new Set([
      ...[...t.matchAll(/`(01\d{2})\$\{s\.slice\(0, ?7\)\}`/g)].map((m) => m[1]),
      ...[...t.matchAll(/\[([^\]]*)\]\.map\(\(p\) => `\$\{p\}\$\{s\.slice\(0, ?7\)\}`\)/g)].flatMap((m) => [...m[1].matchAll(/'(\d{4})'/g)].map((y) => y[1])),
      ...[...t.matchAll(/['"`](010\d{8})['"`]/g)].map((m) => m[1]),
    ]),
    ai: /functions\/v1\/ai\b|invoke\(\s*['"`]ai['"`]/.test(t),
    heavy: map.heavy.includes(id),
  };
});

// ── 3. 고르기 ────────────────────────────────────────────────
const picked = new Map(); // id → 이유들
let hit = false; // 지금 보는 파일이 하니스에 하나라도 걸렸나
const pick = (h, why) => { hit = true; picked.set(h.id, (picked.get(h.id) ?? new Set()).add(why)); };
const notes = [];
const unmapped = [];
for (const f of changed) {
  hit = false;
  if (/^supabase\/migrations\/.+\.sql$/.test(f)) {
    const sql = read(join(ROOT, f));
    const tag = f.match(/(\d{4})/)?.[1] ?? f;
    const fns = new Set([...sql.matchAll(/\bfunction\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)/gi)].map((m) => m[1]));
    const tables = new Set([...sql.matchAll(/\b(?:table|policy[\s\S]{0,200}?\bon|trigger[\s\S]{0,200}?\bon)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)/gi)].map((m) => m[1]));
    const pickOrNote = (kind, name, hits) => {
      if (hits.length > WIDE) { hit = true; notes.push(`${tag} ${kind} ${name}: 하니스 ${hits.length}개에 나온다. 넓어서 이것으로는 고르지 않았다.`); }
      else for (const h of hits) pick(h, `${tag} ${kind} ${name}`);
    };
    for (const fn of fns) pickOrNote('함수', fn, harness.filter((h) => new RegExp(`\\b${fn}\\b`).test(h.t)));
    for (const tb of tables) pickOrNote('표', tb, harness.filter((h) => h.tables.has(tb)));
    // 마이그레이션이면 늘 도는 것(옛 앱 호환 · 정의자 함수 필터) = qa-map.json 의 migrations 표.
    for (const [re, ids] of map.migrations ?? []) if (new RegExp(re).test(f)) for (const h of harness) if (ids.includes(h.id)) pick(h, `표 ${re.slice(0, 30)}`);
  } else if (/^supabase\/functions\/([\w-]+)\//.test(f)) {
    const name = f.split('/')[2];
    for (const h of harness) if (h.edges.has(name)) pick(h, `엣지 ${name}`);
  } else if (f.startsWith('scripts/')) {
    for (const h of harness) if (f === `scripts/${h.file}` || h.imports.has(f)) pick(h, f);
  } else if (f.startsWith('src/')) {
    for (const h of harness) if (h.srcRefs.some((r) => f === r || (r.endsWith('/') && f.startsWith(r)))) pick(h, `${f} 를 읽는다`);
    for (const [re, ids] of map.src) if (new RegExp(re).test(f)) for (const h of harness) if (ids.includes(h.id)) pick(h, `표 ${re.slice(0, 30)}`);
  } else continue;
  if (!hit && /^(src|supabase)\//.test(f)) unmapped.push(f);
}

// ── 4. 돌릴지 정하기 ─────────────────────────────────────────
const plan = [...picked.keys()].sort().map((id) => {
  const h = harness.find((x) => x.id === id);
  let skip = null;
  let args = [];
  if (h.heavy && !HEAVY) skip = '무거움(--heavy)';
  else if (REMOTE) { if (h.ai && !ALLOW_AI) skip = 'AI 호출(--allow-ai)'; else args = ['--allow-remote']; }
  else if (h.local) args = ['--local'];
  else if (!h.pure && !h.shellEnv) skip = '로컬 미지원';
  return { h, skip, args, why: [...picked.get(id)] };
});

console.log(`바뀐 파일 ${changed.length}개 → 하니스 ${plan.length}개 (대상: ${REMOTE ? '라이브' : '로컬'})`);
for (const p of plan) console.log(`  ${p.skip ? '○' : p.h.serial ? '1' : '∥'} ${p.h.id}${p.skip ? ` — skip: ${p.skip}` : ''}  ← ${p.why.slice(0, 3).join(' · ')}${p.why.length > 3 ? ` 외 ${p.why.length - 3}` : ''}`);
for (const n of notes) console.log(`  ※ ${n}`);
if (unmapped.length) console.log(`  걸리는 하니스 없음(${unmapped.length}): ${unmapped.slice(0, 10).join(', ')}${unmapped.length > 10 ? ' …' : ''}`);

// ── 5. 돌리기 ────────────────────────────────────────────────
const count = { pass: 0, fail: 0, skip: plan.filter((p) => p.skip).length, known: 0, flaky: 0 };
const retry = []; // 같이 돌 때 실패한 것. 끝에 혼자 다시 돌린다.
const logDir = join(tmpdir(), `qa-affected-${Date.now().toString(36)}`);
let childEnv = process.env;
const runOne = (p, alone) => new Promise((done) => {
  const log = join(logDir, `${p.h.id}.log`);
  const out = createWriteStream(log);
  const child = spawn(process.execPath, [join(SCRIPTS, p.h.file), ...p.args], { cwd: ROOT, env: childEnv });
  let last = '';
  const onData = (d) => { out.write(d); const l = String(d).trim().split('\n').filter((s) => s.trim()).pop(); if (l) last = l.trim(); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)]); else child.kill('SIGKILL');
  }, TIMEOUT_MS);
  child.on('close', (code) => {
    clearTimeout(timer);
    out.end();
    const ok = code === 0 && !timedOut;
    const isKnown = !ok && known.has(p.h.id);
    if (!ok && !alone && !isKnown && !timedOut) { console.log(`다시 ${p.h.id} — 같이 돌 때 실패. 끝에 혼자 다시 돌린다.`); retry.push(p); return done(); }
    if (ok && retry.includes(p)) count.flaky++;
    if (ok) count.pass++; else if (isKnown) count.known++; else count.fail++;
    const label = ok ? (retry.includes(p) ? 'PASS(혼자서는 통과)' : 'PASS') : timedOut ? 'FAIL(15분 초과)' : isKnown ? 'KNOWN' : code === 2 ? 'FAIL(환경)' : 'FAIL';
    console.log(`${label} ${p.h.id} — ${last.slice(0, 120)}${ok ? '' : `\n     로그: ${log}`}`);
    done();
  });
});
const todo = plan.filter((p) => !p.skip);
if (!LIST && todo.length) {
  mkdirSync(logDir, { recursive: true });
  if (REMOTE && !existsSync(join(ROOT, '.env'))) { console.error('중단: --allow-remote 는 키가 있는 main 체크아웃에서만 쓴다.'); process.exit(2); }
  if (!REMOTE && todo.some((p) => !p.h.pure)) childEnv = { ...process.env, ...localEnv() }; // 로컬 도커의 주소·키(supabase status)
  // supabase start 는 엣지 함수를 띄우지 않는다. 꺼져 있으면 하니스가 503 으로 죽어 원인이 안 보이니 먼저 알린다.
  if (!REMOTE && todo.some((p) => p.h.edges.size)) {
    const r = await fetch(`${childEnv.SUPABASE_URL}/functions/v1/push`, { method: 'OPTIONS' }).catch(() => null);
    if (!r || r.status === 503) console.log('  ※ 로컬 엣지 함수가 꺼져 있다. 엣지를 부르는 하니스는 503 으로 실패한다. 띄우는 법: npx -y supabase@2.122.1 functions serve --env-file <VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY 를 적은 파일>');
  }
  const queue = todo.filter((p) => !p.h.serial);
  // 전화번호 접두가 겹치는 하니스는 같이 돌리지 않는다(위 phones).
  const running = new Set();
  const clash = (p) => [...running].some((r) => [...p.h.phones].some((x) => r.h.phones.has(x)));
  await new Promise((all) => {
    const next = () => {
      if (!queue.length && !running.size) return all();
      while (running.size < JOBS) {
        const i = queue.findIndex((p) => !clash(p));
        if (i < 0) break;
        const p = queue.splice(i, 1)[0];
        running.add(p);
        runOne(p, false).then(() => { running.delete(p); next(); });
      }
    };
    next();
  });
  for (const p of [...todo.filter((x) => x.h.serial), ...retry]) await runOne(p, true);
}
const head = LIST ? 'LIST' : count.fail ? 'RED' : 'GREEN';
console.log(`\n${head} — PASS ${count.pass} · FAIL ${count.fail} · SKIP ${count.skip} · KNOWN ${count.known} · FLAKY ${count.flaky} · UNMAPPED ${unmapped.length}`);
process.exit(count.fail ? 1 : 0);
