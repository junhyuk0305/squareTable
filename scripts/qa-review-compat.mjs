#!/usr/bin/env node
// qa-review-compat.mjs — 2026-10-05 리뷰(영역 compat)에서 확인된 결함의 회귀 하네스.
//
// 무엇을 보나
//   [1] push 엣지 — Expo 요청에 EXPO_ACCESS_TOKEN 을 Authorization: Bearer 로 싣는가(P2-7① 순서의 전제).
//       시크릿이 비어 있으면 헤더를 빼서 지금처럼 보낸다(Enhanced security 를 켜기 전 동작 그대로).
//   [2] 허브 이번달 인건비 — db.ts 가 부르는 RPC 의 반복 근무 행이 적용 기간을 실어 직원·급여 화면과 같은 시간을 내는가.
//       로컬 DB 트랜잭션 안에서 store_solo_local 에 같은 요일 반복을 둘로 나눈 행을 넣고(이번 달 1~10일 4시간 · 11일부터 9시간),
//       그 매장 사장 권한으로 앱이 부르는 RPC 를 불러 shiftAppliesOn 으로 이번 달 분을 센다. 끝나면 되돌린다(계정 신설 없음).
// 실행: node scripts/qa-review-compat.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.qa-out', 'review-compat');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => readFileSync(join(root, p), 'utf8');

// ── [1] push 엣지 Expo 인증 헤더 ─────────────────────────────────────────────
console.log('[1] push 엣지 Expo 인증 헤더');
const push = read('supabase/functions/push/index.ts');
check('EXPO_ACCESS_TOKEN 시크릿을 읽는다', /Deno\.env\.get\(\s*['"]EXPO_ACCESS_TOKEN['"]\s*\)/.test(push));
const fetchAt = push.indexOf('fetch(EXPO_PUSH_URL');
const fetchBlock = fetchAt >= 0 ? push.slice(fetchAt, fetchAt + 600) : '';
check('Expo 요청 헤더가 토큰을 싣는다', /Authorization/.test(fetchBlock) || /EXPO_HEADERS|expoHeaders/.test(fetchBlock));
check('토큰이 비면 Authorization 을 빼는 분기가 있다', /EXPO_ACCESS_TOKEN\s*\?/.test(push));

// ── [2] 허브 인건비 RPC 의 기간 ───────────────────────────────────────────────
console.log('[2] 허브 이번달 인건비 = 기간을 본 근무 시간');
const dbSrc = read('src/lib/db.ts');
const fnAt = dbSrc.indexOf('export async function fetchOwnerLaborInputs');
const rpcName = (dbSrc.slice(fnAt, fnAt + 400).match(/supabase\.rpc\('([a-z0-9_]+)'/) ?? [])[1];
check('fetchOwnerLaborInputs 가 RPC 를 부른다', !!rpcName, rpcName ?? '');

try {
  execFileSync('npx', ['tsc',
    'src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts',
    '--outDir', OUT, '--module', 'es2022', '--target', 'es2022',
    '--moduleResolution', 'node', '--skipLibCheck', '--ignoreConfig', '--ignoreDeprecations', '6.0',
  ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch { /* 산출물 존재로 판정 */ }
const fp = join(OUT, 'schedule.js');
writeFileSync(fp, readFileSync(fp, 'utf8').split("'@/lib/utils/attendance'").join("'./attendance.js'"), 'utf8');
writeFileSync(join(OUT, 'package.json'), '{"type":"module"}');
const S = await import(pathToFileURL(fp));

const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' });

if (rpcName) {
  const STAFF = 'qa-review-compat-staff';
  let out = '';
  try {
    out = psql(`
begin;
select set_config('qa.today', public.kst_today()::text, true);
select set_config('qa.owner', (select owner_id::text from public.units where id = 'store_solo_local'), true);
select set_config('qa.ms', to_char(date_trunc('month', public.kst_today()), 'YYYY-MM-DD'), true);
insert into public.shift_templates (id, unit_id, staff_id, weekday, start_time, end_time, valid_from, valid_to) values
  ('qa-rc-a', 'store_solo_local', '${STAFF}', 1, '09:00', '13:00', '2000-01-01', current_setting('qa.ms')::date + 9),
  ('qa-rc-b', 'store_solo_local', '${STAFF}', 1, '09:00', '18:00', current_setting('qa.ms')::date + 10, null);
select 'TODAY=' || current_setting('qa.today');
select 'ALL=' || coalesce(jsonb_agg(jsonb_build_object('weekday', weekday, 'start', start_time, 'end', end_time,
  'valid_from', to_char(valid_from, 'YYYY-MM-DD'), 'valid_to', to_char(valid_to, 'YYYY-MM-DD'))), '[]'::jsonb)::text
  from public.shift_templates where staff_id = '${STAFF}';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.owner'), 'role', 'authenticated')::text, true);
select 'RPC=' || coalesce((select r.shifts::text from public.${rpcName}() r where r.unit_id = 'store_solo_local'), '[]');
rollback;
`);
  } catch (e) {
    check('로컬 DB 왕복', false, String(e.stderr ?? e.message).slice(0, 300));
  }
  const pick = (k) => (out.split('\n').find((l) => l.startsWith(k + '=')) ?? '').slice(k.length + 1);
  if (out) {
    const today = pick('TODAY');
    const dates = S.monthDates(today.slice(0, 7));
    const mins = (rows) => {
      let m = 0;
      for (const d of dates) for (const t of rows) if (S.shiftAppliesOn(t, d)) m += S.toMinutes(t.end) - S.toMinutes(t.start);
      return m;
    };
    const expected = mins(JSON.parse(pick('ALL')));
    const rpcRows = JSON.parse(pick('RPC')).filter((r) => r.staff_id === STAFF);
    const got = mins(rpcRows);
    check('허브 RPC 가 나눈 두 구간을 모두 준다', rpcRows.length === 2, `행 ${rpcRows.length}`);
    check('허브 RPC 행에 적용 기간이 있다', rpcRows.length > 0 && rpcRows.every((r) => 'valid_from' in r), '');
    check('이번 달 근무분이 직원·급여 화면 기준과 같다', got === expected, `허브 ${got}분 · 기준 ${expected}분`);
  }
}

console.log(`\nqa-review-compat: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
