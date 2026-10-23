// PAY-01 (2026-10-23): 급여 설정 조회 실패 ≠ 설정 없음.
// 실제 db.ts(급여 함수) + 실제 usePayrollStore 를 돌리고 supabase 통신만 모의한다.
//   인증 실패 · 네트워크 실패 → 실패 상태, 저장 막힘, 캐시 유지
//   정상 미설정 · 정상 조회 → 저장 가능
//   재시도 성공 → 실패 해제, 저장 가능
// 화면이 실패를 LoadErrorState(재시도)로 보여 주는지는 원문으로 본다.
// 실행: node scripts/qa-audit-payroll-settings-read.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };

function environment(queue) {
  // queue: units 조회 응답을 차례로 준다. 마지막 응답은 계속 쓴다.
  const rpcCalls = [];
  const storage = new Map();
  let unitsCalls = 0;
  const builder = (table) => {
    const b = new Proxy({}, {
      get: (_, k) => {
        if (k === 'then') {
          let res = { data: [], error: null };
          if (table === 'units') res = queue[Math.min(unitsCalls++, queue.length - 1)];
          return (ok, ko) => Promise.resolve(res).then(ok, ko);
        }
        return () => b;
      },
    });
    return b;
  };
  const supabase = {
    from: (t) => builder(t),
    rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: null, error: null }; },
  };
  const sync = create(() => ({ noteReadFail() {}, noteError() {} }));
  const syncMod = {
    useSyncStore: sync,
    guardWrite: async (p, rollback) => { let ok = false; try { ok = await p; } catch { ok = false; } if (!ok) rollback(); return ok; },
  };
  const cache = new Map();
  const stub = new Proxy({}, { get: (_, k) => (k === '__esModule' ? false : () => undefined) });
  function load(rel) {
    const file = path.join(root, rel);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const req = (name) => {
      if (name === 'zustand') return { create };
      if (name === './supabase' || name === '@/lib/supabase') return { supabase, HAS_SUPABASE: true };
      if (name === '@/lib/db') return load('src/lib/db.ts');
      if (name === '@/lib/store/useSyncStore') return syncMod;
      if (name === '@/lib/store/useAttendanceStore') return { HOURLY_WAGE: {} };
      if (name === '@/lib/store/tenantEpoch') return { currentTenantEpoch: () => 0, isStaleEpoch: () => false };
      if (name === '@/lib/utils/attendance') return { todayStr: () => '2026-10-23' };
      if (name === '@/lib/utils/payroll') return load('src/lib/utils/payroll.ts');
      if (name === './attendance' || name === './schedule') return stub;
      return stub; // db.ts 의 다른 의존(분석·퀴즈 오류 등)은 급여 함수와 무관
    };
    vm.runInNewContext(js, {
      module: mod, exports: mod.exports, require: req, console: { warn() {}, log() {}, error() {} }, Date, setTimeout, clearTimeout,
      window: { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } },
    }, { filename: file });
    return mod.exports;
  }
  // 이 기기에 지난번 값(정산 시작일 25일)이 캐시돼 있다.
  storage.set('sqt.payroll_settings.v1', JSON.stringify({ periodStartDay: 25, nightAllowance: false }));
  const db = load('src/lib/db.ts');
  db.setUnitId('U1');
  const { usePayrollStore } = load('src/lib/store/usePayrollStore.ts');
  return { db, store: usePayrollStore, rpcCalls, storage, unitsCallCount: () => unitsCalls };
}

const AUTH = { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
const NET = { data: null, error: { message: 'TypeError: Failed to fetch' } };
const UNSET = { data: { payroll_settings: null }, error: null };
const SAVED = { data: { payroll_settings: { periodStartDay: 15, payday: 5 } }, error: null };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function failCase(label, res) {
  console.log(`[${label}]`);
  const e = environment([res]);
  await e.store.getState().hydrate();
  const s = e.store.getState();
  check('★실패 상태가 보인다(settingsLoadError)', s.settingsLoadError === true, String(s.settingsLoadError));
  check('캐시 값을 기본값으로 덮지 않는다(정산 시작일 25 유지)', s.settings.periodStartDay === 25 && JSON.parse(e.storage.get('sqt.payroll_settings.v1')).periodStartDay === 25);
  s.setSetting('payday', 20);
  await tick();
  check('★실패 상태에서 저장 RPC 를 보내지 않는다', e.rpcCalls.length === 0, `rpc ${e.rpcCalls.length}회`);
  check('실패 상태에서 화면 값도 바뀌지 않는다', e.store.getState().settings.payday !== 20);
  const r = typeof e.db.fetchPayrollSettingsResult === 'function' ? await e.db.fetchPayrollSettingsResult() : null;
  check('db: fetchPayrollSettingsResult 가 error:true 를 준다', !!r && r.error === true && r.data === null);
}

(async () => {
  await failCase('인증 실패', AUTH);
  await failCase('네트워크 실패', NET);

  console.log('[정상 미설정]');
  {
    const e = environment([UNSET]);
    await e.store.getState().hydrate();
    const s = e.store.getState();
    check('실패 아님 · 확인 끝', s.settingsLoaded === true && !s.settingsLoadError);
    check('설정이 없으면 이 기기 캐시를 쓴다(예전과 같음)', s.settings.periodStartDay === 25);
    s.setSetting('payday', 20);
    await tick();
    check('저장 RPC 를 보낸다', e.rpcCalls.length === 1 && e.rpcCalls[0].fn === 'save_payroll_settings');
    const r = typeof e.db.fetchPayrollSettingsResult === 'function' ? await e.db.fetchPayrollSettingsResult() : null;
    check('db: 없음 = { data:null, error:false }', !!r && r.error === false && r.data === null);
  }

  console.log('[정상 조회]');
  {
    const e = environment([SAVED]);
    await e.store.getState().hydrate();
    const s = e.store.getState();
    check('DB 값이 기본값 위에 병합된다', s.settings.periodStartDay === 15 && s.settings.payday === 5 && s.settings.breakDeduction === true && !s.settingsLoadError);
    s.setSetting('payday', 20);
    await tick();
    check('저장 RPC 가 DB 값 기준으로 나간다', e.rpcCalls.length === 1 && e.rpcCalls[0].args.p_settings.periodStartDay === 15 && e.rpcCalls[0].args.p_settings.payday === 20);
    check('옛 함수 fetchPayrollSettings 는 그대로 객체를 준다(호환)', JSON.stringify(await e.db.fetchPayrollSettings()) === JSON.stringify({ periodStartDay: 15, payday: 5 }));
  }

  console.log('[재시도 성공]');
  {
    const e = environment([NET, SAVED]);
    await e.store.getState().hydrate();
    check('첫 조회 실패', e.store.getState().settingsLoadError === true);
    await e.store.getState().hydrate();
    const s = e.store.getState();
    check('★다시 불러오면 실패가 풀리고 DB 값이 들어온다', s.settingsLoadError === false && s.settings.periodStartDay === 15);
    s.setSetting('payday', 20);
    await tick();
    check('복구 뒤 저장 가능', e.rpcCalls.length === 1);
  }

  console.log('[매장 전환]');
  {
    const e = environment([NET]);
    await e.store.getState().hydrate();
    // tenantReset.resetUnitData 와 같은 경로: getInitialState 로 되돌린다.
    e.store.setState(e.store.getInitialState(), true);
    const s = e.store.getState();
    check('★매장 전환(초기 상태) 뒤 settingsLoadError=false · settingsLoaded=false', s.settingsLoadError === false && s.settingsLoaded === false);
    const tr = fs.readFileSync(path.join(root, 'src/lib/store/tenantReset.ts'), 'utf8');
    check('tenantReset 이 usePayrollStore 를 getInitialState 로 비운다', /UNIT_STORES[\s\S]*?usePayrollStore[\s\S]*?\];/.test(tr) && /getInitialState\(\)/.test(tr));
  }

  // 화면 원문 검사. --head 를 주면 HEAD 판을 본다(수정 전 RED 확인용).
  const src = (p) => (process.argv.includes('--head')
    ? require('node:child_process').execFileSync('git', ['show', `HEAD:${p}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, p), 'utf8'));
  console.log('[화면]');
  {
    const scr = src('src/app/owner/payroll.tsx');
    check('★급여 설정 화면이 실패면 LoadErrorState(다시 시도 → hydrate)를 보인다', /settingsLoadError/.test(scr) && /<LoadErrorState[\s\S]*?onRetry=\{[^}]*hydrate\(\)/.test(scr));
    const staff = src('src/app/owner/staff.tsx');
    check('★직원 관리 히어로: 설정 실패면 금액 대신 "불러오지 못했어요" + 다시 시도', /settingsLoadError/.test(staff) && /settingsFail \?[\s\S]*?불러오지 못했어요[\s\S]*?hydrate\(\)/.test(staff) && /settingsFail \? '금액 확인 불가'/.test(staff));
    const tv = src('src/components/TimesheetView.tsx');
    check('★출퇴근 기록 화면: 설정 실패면 예상급여를 만들지 않는다', /settingsLoadError/.test(tv) && /pastSettingsMissing \|\| settingsFail \? null/.test(tv));
    const ja = src('src/app/junior/attendance.tsx');
    check('★직원 출퇴근: 설정 실패면 예상 급여·오늘 금액을 숨긴다', /settingsLoadError/.test(ja) && /payShown = wageSet && !settingsFail/.test(ja) && !/wageSet \? won\(monthPay\)/.test(ja));
  }

  console.log('[출퇴근 기록 화면 = 한 기간]');
  {
    const tv = src('src/components/TimesheetView.tsx');
    check('★근무시간·기록 목록이 정산 기간으로 거른다(startsWith(ym) 아님)', /monthRecs = useMemo\(\s*\(\) => records\.filter\(\(r\) => r\.staff_id === staffId && r\.date >= payWin\.from && r\.date <= payWin\.to\)/.test(tv));
    check('★근무표 대조가 정산 기간 날짜를 쓴다(monthDates(ym) 아님)', /monthShifts = useMemo\(\s*\(\) => scheduledShiftsFor\([^)]*payWin\.inputDates\.filter/.test(tv) && !/monthDates\(ym\)/.test(tv));
    check('★승인 대기 건수도 같은 기간', /pendingTimeRequests\(timeRequests, staffId\)\.filter\(\(r\) => r\.date >= payWin\.from && r\.date <= payWin\.to\)/.test(tv));
    check('★기간이 걸친 지난달마다 그 달 기록을 읽는다(loadMonth)', /pastMonths = \[\.\.\.new Set\(\[payWin\.from\.slice\(0, 7\), payWin\.to\.slice\(0, 7\)\]\)\]/.test(tv) && /void loadMonth\(staffId, m\)/.test(tv));
  }

  console.log(`\n${pass} PASS · ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
