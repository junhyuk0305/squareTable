// Offline regression: real Zustand stores, reset subscription and coalesce; transport is mocked.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');
const actualNames = ['useCrossNotifStore', 'useBrandStore', 'useBrandUnitsStore', 'useBrandKnowhowStore', 'useBrandQuizStore', 'useBrandBillingStore', 'useHubStore', 'useMemberPrefsStore'];
const cases = [
  ['useCrossNotifStore', 'hydrate', 'fetchCrossStoreNotifData'],
  ['useBrandStore', 'hydrate', 'fetchMyBrandFull'],
  ['useBrandUnitsStore', 'hydrate', 'fetchBrandOverview'],
  ['useBrandKnowhowStore', 'hydrate', 'fetchEntries'],
  ['useBrandKnowhowStore', 'hydrate', 'enterBrandWorkspace'],
  ['useBrandBillingStore', 'hydrate', 'fetchBrandInvoices'],
  ['useHubStore', 'hydrateOwner', 'fetchOwnerOverview'],
  ['useHubStore', 'hydrateJunior', 'fetchMyCrossSummary'],
  ['useHubStore', 'hydrateGrowth', 'fetchMyGrowth'],
  ['useHubStore', 'hydrateMyEntries', 'fetchMyKnowhowEntries'],
  ['useHubStore', 'hydrateKnowhowStats', 'fetchOwnerKnowhowStats'],
  ['useMemberPrefsStore', 'hydrate', 'fetchMemberPrefs'],
];
function environment(delayedName, failure) {
  const session = create(() => ({ userId: 'A', unitId: 'A-unit' }));
  const cache = new Map();
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const marker = 'PRIVATE_A';
  function response(name, account) {
    const id = account === 'A' ? marker : 'PUBLIC_B';
    if (name === 'enterBrandWorkspace') return { data: `${id}_workspace`, error: null };
    if (name === 'fetchMyBrandFull') return { data: { brand_id: id }, error: null };
    if (name === 'fetchOwnerLaborInputs') return { data: [], error: null };
    if (name === 'fetchCourseEntries') return [];
    return { data: [{ id, unitId: id, unit_id: id, store_name: id, nickname: id, active: true, title: id, body: id, feed: [] }], error: null };
  }
  const transport = new Proxy({}, { get: (_, name) => async () => {
    const account = session.getState().userId;
    if (name === delayedName && account === 'A') {
      await pending;
      if (failure) return { data: null, error: { message: marker } };
    }
    return response(name, account);
  } });
  const dummy = create(() => ({ reset() {}, loaded: false }));
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    function localRequire(name) {
      if (name === 'zustand') return { create };
      if (name === '@/lib/store/useSessionStore') return { useSessionStore: session };
      if (name === '@/lib/supabase') return { HAS_SUPABASE: true };
      if (['@/lib/db', '@/lib/brand/brandDb'].includes(name)) return transport;
      if (name === '@/lib/analytics/track') return { reportError() {} };
      if (name === '@/lib/brand/errors') return { brandErrorMessage: e => e?.message ?? 'failed' };
      if (name === '@/lib/store/knowhowCategories') return { setCustomCategoryRegistry() {} };
      if (name === '@/lib/store/useSyncStore') return { guardWrite: async (p, rollback) => { const r = await p; if (!r) rollback(); return r; } };
      if (name === '@/lib/utils/attendance') return { todayStr: () => '2026-10-23' };
      if (name === '@/lib/utils/payroll') return { payWindow: () => ({ inputDates: [] }) };
      if (name === '@/lib/utils/tenure') return { departedPayRows: () => [] };
      if (name === '@/lib/utils/payPeriod') return { payLabelOf: () => '2026-10' };
      const base = name.split('/').at(-1);
      if (actualNames.includes(base) || ['tenantEpoch', 'tenantReset', 'realtimeSync'].includes(base)) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('@/lib/store/')) return { [base]: dummy, DEFAULT_SETTINGS: {}, resetHubHydrateTtl() {}, resetMemberPrefsHydrateTtl() {} };
      throw new Error('Unexpected dependency: ' + name);
    }
    vm.runInNewContext(js, { module: mod, exports: mod.exports, require: localRequire, Date, console, setTimeout, clearTimeout }, { filename: file });
    return mod.exports;
  }
  load('src/lib/store/tenantReset.ts').installTenantReset();
  return { session, deliver, load, marker };
}
(async () => {
  let passed = 0, failed = 0;
  for (const [name, method, call] of cases) {
    for (const failure of [false, true]) {
      try {
        const e = environment(call, failure);
        const store = e.load(`src/lib/store/${name}.ts`)[name];
        const observations = [];
        const requestA = store.getState()[method]();
        await Promise.resolve(); await Promise.resolve();
        e.session.setState({ userId: 'B', unitId: 'B-unit' });
        store.subscribe(s => observations.push(JSON.stringify(s)));
        const requestB = store.getState()[method]();
        e.deliver();
        await Promise.all([requestA, requestB]);
        assert.ok(!observations.some(s => s.includes(e.marker)), 'A response/error must never reach B store');
        assert.ok(JSON.stringify(store.getState()).includes('PUBLIC_B'), 'B hydration must still succeed');
        console.log(`PASS ${name}.${method} delayed ${call} ${failure ? 'error' : 'success'}`); passed++;
      } catch (error) {
        console.log(`FAIL ${name}.${method} delayed ${call} ${failure ? 'error' : 'success'}: ${error.message}`); failed++;
      }
    }
  }
  // Account-wide requests survive an ordinary unit change within the same account.
  const e = environment('fetchCrossStoreNotifData', false);
  const store = e.load('src/lib/store/useCrossNotifStore.ts').useCrossNotifStore;
  const request = store.getState().hydrate();
  e.session.setState({ unitId: 'A-other-unit' });
  e.deliver(); await request;
  assert.ok(JSON.stringify(store.getState()).includes(e.marker)); passed++;
  console.log('BLOCKED useBrandQuizStore (2 delayed-call scenarios): concurrent external quiz work; source unchanged');
  console.log(`RESULT ${passed} PASS ${failed} FAIL 2 BLOCKED; offline mocks, no auth/network/UI execution`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
