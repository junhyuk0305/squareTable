// qa-hydrate-telemetry.mjs — 불러오기 실패 계측(64497e8) 회귀 검사 (2026-11-05 · 오류 탐지 11-03 검사 결함 3 · 백엔드 없음 · AI 호출 0회)
//
// 왜 있나: 64497e8 을 되돌려도 백엔드 없는 검사 32개가 모두 통과했다. 계측이 사라져도 아무도 몰랐다.
// 방법: track.ts·realtimeSync.ts 를 typescript 로 바꿔 vm 에서 돌린다. supabase 는 가짜이고 client_errors insert 를 받아 적는다.
//   T1~T4 = 동작(행이 실제로 나가는가) · T5 = 세 스토어가 계측을 켰는가(소스 모양).
// 사용: node scripts/qa-hydrate-telemetry.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ` · ${extra}` : ''}`); };

// ── 가짜 supabase: insert 결과를 테스트가 정한다 ──
const rows = [];
let insertFails = false;
const supabase = {
  from: (t) => ({ insert: (row) => { rows.push({ t, row, failed: insertFails }); return Promise.resolve(insertFails ? { error: { message: 'offline' } } : { error: null }); } }),
  auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} },
};
const stubs = {
  'react-native': { Platform: { OS: 'web' } },
  'expo-constants': { default: {}, __esModule: true },
  '@/lib/supabase': { supabase, HAS_SUPABASE: true },
  '@/lib/analytics/posthog': { initPostHog() {}, phSetContext() {}, phCapture() {} },
};
function load(path, extra = {}) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const require = (id) => { const m = extra[id] ?? stubs[id]; if (!m) throw new Error(`stub 없음: ${id}`); return m; };
  vm.runInNewContext(js, { module, exports: module.exports, require, console: { ...console, warn() {} }, setTimeout, clearTimeout, Date, Promise, navigator: { onLine: true }, process: { env: {} } });
  return module.exports;
}
const track = load('src/lib/analytics/track.ts');
const RS = load('src/lib/store/realtimeSync.ts', { '@/lib/analytics/track': track });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const errRows = () => rows.filter((r) => r.t === 'client_errors');

console.log('— 불러오기 실패 계측(64497e8) —');
// T1 시간 초과 → hydrate.timeout:<store> · 매달린 축 · 걸린 ms
{
  const v = await RS.settleWithin(10, new Promise(() => {}), () => 'fallback', { store: 'work', pending: () => ['feed'] });
  await tick(5);
  const r = errRows().find((x) => x.row.context === 'hydrate.timeout:work');
  check('T1 시간 초과면 정지 방지 값을 돌려주고 hydrate.timeout:work 를 남긴다', v === 'fallback' && !!r && JSON.stringify(r.row.meta?.pending) === '["feed"]' && typeof r.row.meta?.ms === 'number',
    r ? `meta ${JSON.stringify(r.row.meta)}` : `행 없음(${errRows().map((x) => x.row.context).join(',') || '0건'})`);
}
// T2 reject → hydrate.reject:room
{
  const v = await RS.settleWithin(1000, Promise.reject(new Error('boom-t2')), () => 'fallback', { store: 'room' });
  await tick(5);
  check('T2 실패하면 hydrate.reject:room 을 남긴다', v === 'fallback' && errRows().some((x) => x.row.context === 'hydrate.reject:room'));
}
// T3 diag 없는 호출(로컬 저장소 읽기)은 기록하지 않는다
{
  const n = errRows().length;
  await RS.settleWithin(10, new Promise(() => {}), () => null);
  await tick(5);
  check('T3 diag 없는 시간 초과는 원격에 안 남긴다', errRows().length === n);
}
// T4 insert 가 실패한 기록은 다음 기록이 성공할 때 queued_at 을 달고 한 번 다시 간다
{
  insertFails = true;
  track.reportError('qa.t4.first', new Error('t4-first'));
  await tick(5);
  insertFails = false;
  track.reportError('qa.t4.second', new Error('t4-second'));
  await tick(5);
  const resent = errRows().filter((x) => x.row.context === 'qa.t4.first' && !x.failed);
  check('T4 못 보낸 기록을 다음 성공 때 queued_at 과 함께 다시 보낸다', resent.length === 1 && typeof resent[0].row.meta?.queued_at === 'string', `다시 보낸 행 ${resent.length}`);
}
// T5 세 스토어가 원격 hydrate 에 diag 를 넘기고, 업무·방은 catch 에서 hydrate.threw 를 남긴다
{
  // 주석을 지운 뒤 본다. 주석에 같은 글자가 남아 통과하지 않게 한다.
  const src = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\s+/g, ' ');
  const work = src('src/lib/store/useWorkStore.ts'), room = src('src/lib/store/useRoomStore.ts'), sched = src('src/lib/store/useScheduleStore.ts');
  check('T5a 업무 hydrate 가 diag(work)·threw 기록을 켠다', /store: 'work'/.test(work) && /reportHydrate\('threw', 'work'/.test(work));
  check('T5b 방 hydrate 가 diag(room)·threw 기록을 켠다', /store: 'room'/.test(room) && /reportHydrate\('threw', 'room'/.test(room));
  check('T5c 근무표 hydrate 가 diag(schedule)를 켠다', /\{ store: 'schedule' \}/.test(sched));
}

console.log(`\n── PASS ${pass} · FAIL ${fail} · skip 0 · AI 호출 0회`);
process.exit(fail ? 1 : 0);
