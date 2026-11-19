// qa-shift-now.cjs — "근무 중" 판정 순수 검사(2026-11-19 세션 C · C5). 백엔드 없음 · AI 호출 0회.
//
// 재는 것:
//   ① 출근 기록 상태(recordStatus · staffWorkStatus): 16시간 이하 = 근무 중 · 16시간 넘음 = 퇴근 안 찍음 · 퇴근 찍음 = 닫힘.
//   ② 직원 근무표 "내 다음 근무 · 지금 근무 중"(nextShiftFor): 22:00~02:00 밤 근무를 저녁 9시 · 밤 11시 · 새벽 1시 · 새벽 3시에 본다.
//   ③ 밤 근무 겹침(shiftTimesOverlap): 22:00~02:00 과 23:00~03:00 은 겹친다.
// 시각은 전부 KST 순간(+09:00)으로 준다. 기기 시간대와 무관해야 한다.
// 사용: node scripts/qa-shift-now.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');

function resolveSrc(p) {
  for (const c of [p + '.ts', p + '.tsx', p]) if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) return c;
  throw new Error('파일 없음: ' + p);
}
function load(p, cache = new Map()) {
  if (cache.has(p)) return cache.get(p).exports;
  const mod = { exports: {} };
  cache.set(p, mod);
  const text = fs.readFileSync(path.join(root, p), 'utf8');
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const localRequire = (name) => {
    if (name.startsWith('@/')) return load(resolveSrc('src/' + name.slice(2)), cache);
    throw new Error(`${p}: 모르는 의존 ${name}`);
  };
  vm.runInThisContext(`(function (exports, require, module) {${js}\n})`, { filename: p })(mod.exports, localRequire, mod);
  return mod.exports;
}

const att = load('src/lib/utils/attendance.ts');
const sch = load('src/lib/utils/schedule.ts');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, '→', r); }
  } catch (e) {
    fail++;
    console.log('FAIL', name, '→', e.message);
  }
}
const kst = (date, hm) => new Date(`${date}T${hm}:00+09:00`);
const hoursAfter = (d, h) => new Date(d.getTime() + h * 3600 * 1000);

// ── ① 출근 기록 상태 ──
const checkIn = kst('2026-11-18', '22:00');
const open = { staff_id: 'me', date: '2026-11-18', check_in: checkIn.toISOString(), check_out: null };
const cases1 = [
  [1, 'working'],
  [15.9, 'working'],
  [16, 'working'], // 16시간 정각은 아직 근무 중(넘어야 퇴근 안 찍음)
  [16.1, 'forgot'],
  [23.9, 'forgot'],
];
for (const [h, want] of cases1) {
  check(`① 출근 ${h}시간 뒤 recordStatus = ${want}`, () => {
    if (typeof att.recordStatus !== 'function') return 'recordStatus 함수가 없다(판정이 화면마다 흩어져 있다)';
    const got = att.recordStatus(open, hoursAfter(checkIn, h));
    return got === want || `got ${got}`;
  });
  check(`① 출근 ${h}시간 뒤 직원 목록(staffWorkStatus)도 같은 상태`, () => {
    const got = att.staffWorkStatus([open], 'me', '2026-11-19', hoursAfter(checkIn, h));
    return got === want || `got ${got}`;
  });
}
check('① 퇴근 찍은 기록 = closed', () => {
  if (typeof att.recordStatus !== 'function') return 'recordStatus 함수가 없다';
  const got = att.recordStatus({ ...open, check_out: hoursAfter(checkIn, 4).toISOString() }, hoursAfter(checkIn, 5));
  return got === 'closed' || `got ${got}`;
});
check('① 열린 기록 이름: 16시간 넘음 = "퇴근 안 찍음"', () => {
  const label = att.OPEN_RECORD_LABEL && att.OPEN_RECORD_LABEL.forgot;
  return label === '퇴근 안 찍음' || `got ${label}`;
});

// ── ② 직원 근무표: 22:00~02:00 매주 수요일(2026-11-18) ──
const night = { id: 'n1', staff_id: 'me', weekday: 3, date: null, start: '22:00', end: '02:00', valid_from: '2026-01-01', valid_to: null };
const next = (today, nowDate) => {
  if (typeof sch.nextShiftFor !== 'function') throw new Error('nextShiftFor 함수가 없다(판정이 화면 안 기기 현지 "HH:MM" 비교에 있다)');
  return sch.nextShiftFor([night], [], [], 'me', today, nowDate.getTime());
};
check('② 수 저녁 9시 → 다음 근무 = 오늘 22:00, 근무 중 아님', () => {
  const r = next('2026-11-18', kst('2026-11-18', '21:00'));
  return (r && r.date === '2026-11-18' && r.ongoing === false) || JSON.stringify(r && { date: r.date, ongoing: r.ongoing });
});
check('② 수 밤 11시 → 지금 근무 중', () => {
  const r = next('2026-11-18', kst('2026-11-18', '23:00'));
  return (r && r.date === '2026-11-18' && r.ongoing === true) || JSON.stringify(r && { date: r.date, ongoing: r.ongoing });
});
check('② 목 새벽 1시(오늘 = 목) → 어제 시작한 근무가 지금 근무 중', () => {
  const r = next('2026-11-19', kst('2026-11-19', '01:00'));
  return (r && r.date === '2026-11-18' && r.dayOffset === -1 && r.ongoing === true) || JSON.stringify(r && { date: r.date, off: r.dayOffset, ongoing: r.ongoing });
});
check('② 목 새벽 3시 → 끝난 근무는 빠지고 다음 주 수요일', () => {
  const r = next('2026-11-19', kst('2026-11-19', '03:00'));
  return (r && r.date === '2026-11-25' && r.ongoing === false) || JSON.stringify(r && { date: r.date, ongoing: r.ongoing });
});
check('② 낮 근무 09:00~18:00 오후 6시 정각 → 끝난 근무', () => {
  const day = { ...night, id: 'd1', start: '09:00', end: '18:00' };
  const r = sch.nextShiftFor([day], [], [], 'me', '2026-11-18', kst('2026-11-18', '18:00').getTime());
  return (r && r.date === '2026-11-25') || JSON.stringify(r && { date: r.date });
});

// ── ③ 밤 근무 겹침 ──
check('③ 22:00~02:00 과 23:00~03:00 은 겹친다', () => {
  if (typeof sch.shiftTimesOverlap !== 'function') return 'shiftTimesOverlap 함수가 없다';
  return sch.shiftTimesOverlap({ start: '22:00', end: '02:00' }, { start: '23:00', end: '03:00' }) === true || 'false';
});
check('③ 22:00~02:00 과 18:00~22:00 은 안 겹친다', () => {
  if (typeof sch.shiftTimesOverlap !== 'function') return 'shiftTimesOverlap 함수가 없다';
  return sch.shiftTimesOverlap({ start: '22:00', end: '02:00' }, { start: '18:00', end: '22:00' }) === false || 'true';
});
check('③ 교대 겹침 경고(overlapsStaffShift): 내 밤 근무와 넘겨받을 23:00~03:00', () => {
  return sch.overlapsStaffShift([night], [], [], 'me', '2026-11-18', '23:00', '03:00') === true || 'false';
});

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail} · SKIP 0`);
process.exit(fail === 0 ? 0 : 1);
