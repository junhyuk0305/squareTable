#!/usr/bin/env node
// qa-open-record.mjs — 열린(미퇴근) 출퇴근 기록 판정(src/lib/utils/attendance.ts) 순수 함수 검증. DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 결함 Q4: 야간 근무자가 자정을 넘기면 퇴근 버튼이 사라졌다.
//   홈(useJuniorHomeData)·출퇴근 화면(junior/attendance)·사장 직원 목록(owner/staff)은 **오늘 날짜** 기록만 봤고,
//   스토어(checkIn·checkOut)는 날짜와 상관없이 열린 기록을 찾았다. 그래서 버튼은 '출근하기'인데
//   누르면 "이미 출근 중이에요. 먼저 퇴근을 눌러 주세요."가 떴고, 퇴근 버튼은 어디에도 없었다.
//   → 판정을 findOpenRecord(records, staffId) 하나로 모은다. 16시간이 넘게 열린 기록은 퇴근 깜빡으로 본다.
// 실행: node scripts/qa-open-record.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

let mod = {};
try {
  mod = await import('../src/lib/utils/attendance.ts');
} catch (e) {
  console.log('  FAIL 모듈을 읽지 못했다', String(e && e.code ? e.code : e));
}
const { findOpenRecord, openSinceText, isForgotCheckout, FORGOT_CHECKOUT_MIN } = mod;
const fn = (f) => typeof f === 'function';
const call = (f, ...a) => (fn(f) ? f(...a) : undefined);

// KST 벽시계 → ISO. 기기 타임존과 무관하게 같은 시각을 만든다.
const K = (date, time) => new Date(`${date}T${time}:00+09:00`).toISOString();
const rec = (id, staff, date, cin, cout = null, coutDate = date) => ({
  id, staff_id: staff, date,
  check_in: K(date, cin),
  check_out: cout ? K(coutDate, cout) : null,
  work_minutes: 0,
});

// 상황: 10/4(토) 22:00 출근, 지금은 10/5(일) 00:30 KST — 자정을 넘긴 야간 근무.
const NOW = new Date(K('2026-10-05', '00:30'));
const TODAY = '2026-10-05';
const records = [
  rec('a1', 'u1', '2026-10-04', '22:00'),                    // u1 어제 출근, 아직 퇴근 전
  rec('a0', 'u1', '2026-10-03', '10:00', '18:00'),           // u1 지난 기록(닫힘)
  rec('b1', 'u2', '2026-10-05', '00:10'),                    // 다른 직원의 열린 기록
  rec('c1', 'u3', '2026-10-04', '09:00', '18:00'),           // u3 닫힌 기록만
];

console.log('\n■ findOpenRecord — 날짜와 상관없이 그 직원의 열린 기록 하나');
// 옛 화면 로직(오늘 날짜만)은 이 기록을 못 찾는다 — 그래서 퇴근 버튼이 사라졌다.
const oldScreen = records.filter((r) => r.staff_id === 'u1' && r.date === TODAY).find((r) => r.check_in && !r.check_out);
check('(참고) 옛 화면 로직은 어제 열린 기록을 못 찾는다', oldScreen === undefined);
check('★어제 22:00에 연 기록을 찾는다', call(findOpenRecord, records, 'u1')?.id === 'a1', `→ ${call(findOpenRecord, records, 'u1')?.id}`);
check('다른 직원의 열린 기록은 가져오지 않는다', call(findOpenRecord, records, 'u2')?.id === 'b1' && call(findOpenRecord, records, 'u9') === undefined);
check('닫힌 기록만 있으면 없다', fn(findOpenRecord) && call(findOpenRecord, records, 'u3') === undefined);
const two = [rec('x1', 'u1', '2026-10-03', '22:00'), rec('x2', 'u1', '2026-10-04', '22:00')];
check('열린 기록이 둘이면 가장 최근 출근을 고른다', call(findOpenRecord, two, 'u1')?.id === 'x2', `→ ${call(findOpenRecord, two, 'u1')?.id}`);
check('출근 시각이 없는 행은 열린 기록이 아니다', fn(findOpenRecord) && call(findOpenRecord, [{ id: 'n', staff_id: 'u1', date: TODAY, check_in: null, check_out: null, work_minutes: 0 }], 'u1') === undefined);

console.log('\n■ openSinceText — "어제 22:00 출근"');
const since = (iso) => call(openSinceText, iso, NOW);
check('★어제 출근 → "어제 22:00 출근"', since(K('2026-10-04', '22:00')) === '어제 22:00 출근', `→ ${since(K('2026-10-04', '22:00'))}`);
check('★화면 표시 "어제 22:00 출근 · 근무 중"', `${since(K('2026-10-04', '22:00'))} · 근무 중` === '어제 22:00 출근 · 근무 중');
check('오늘 출근 → "00:10 출근"(지금 문구 그대로)', since(K('2026-10-05', '00:10')) === '00:10 출근', `→ ${since(K('2026-10-05', '00:10'))}`);
check('그제 이전 → "10/3 22:00 출근"', since(K('2026-10-03', '22:00')) === '10/3 22:00 출근', `→ ${since(K('2026-10-03', '22:00'))}`);

console.log('\n■ isForgotCheckout — 16시간이 넘게 열려 있으면 퇴근 깜빡');
check('기준은 16시간(960분)', FORGOT_CHECKOUT_MIN === 960, `→ ${FORGOT_CHECKOUT_MIN}`);
const at = (iso) => new Date(iso);
const open = rec('f', 'u1', '2026-10-04', '08:00');
check('15시간 59분 → 아직 아니다', fn(isForgotCheckout) && call(isForgotCheckout, open, at(K('2026-10-04', '23:59'))) === false);
check('16시간 정각 → 아직 아니다', fn(isForgotCheckout) && call(isForgotCheckout, open, at(K('2026-10-05', '00:00'))) === false);
check('★16시간 1분 → 퇴근 깜빡', call(isForgotCheckout, open, at(K('2026-10-05', '00:01'))) === true);
check('야간 근무 2시간 30분 → 아니다(퇴근 버튼 그대로)', fn(isForgotCheckout) && call(isForgotCheckout, records[0], NOW) === false);
check('닫힌 기록은 아니다', fn(isForgotCheckout) && call(isForgotCheckout, rec('d', 'u1', '2026-10-03', '08:00', '09:00'), NOW) === false);

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 || !fn(findOpenRecord) ? 1 : 0);
