// Offline regression for useBrandQuizStore account switch (SESSION-01 residual).
// Real Zustand store, real tenantReset subscription, real coalesce/tenantEpoch; DB transport is mocked (no network/auth/UI).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');
const real = ['useBrandQuizStore', 'tenantEpoch', 'tenantReset', 'realtimeSync'];

function environment(delayedName, failure) {
  const session = create(() => ({ userId: 'A', unitId: 'A-unit' }));
  const cache = new Map();
  let gen = 0; // bumps on every account change; each response carries the gen it was issued in
  session.subscribe((s, p) => { if (s.userId !== p.userId) gen += 1; });
  let deliver;
  const pending = new Promise(r => { deliver = r; });
  let delayedUsed = false;
  const tag = (account, g) => `${account}_G${g}`;
  function response(name, id) {
    if (name === 'enterBrandWorkspace') return { data: `${id}_ws`, error: null };
    if (name === 'fetchTrainingCourses') return { data: [{ id, title: id, active: true }], error: null };
    if (name === 'fetchCourseEntriesResult') return { data: [{ id, course_id: id }], error: null };
    return { data: [{ id, unit_id: id, title: id }], error: null };
  }
  const transport = new Proxy({}, { get: (_, name) => async () => {
    const id = tag(session.getState().userId, gen);
    if (name === delayedName && !delayedUsed) {
      delayedUsed = true;
      await pending;
      if (failure) return { data: null, error: { message: `ERR_${id}` } };
    }
    return response(name, id);
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
      const base = name.split('/').at(-1);
      if (real.includes(base)) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('@/lib/store/')) return { [base]: dummy, DEFAULT_SETTINGS: {}, resetHubHydrateTtl() {}, resetMemberPrefsHydrateTtl() {}, resetCrossNotifHydrateTtl() {} };
      throw new Error('Unexpected dependency: ' + name);
    }
    vm.runInNewContext(js, { module: mod, exports: mod.exports, require: localRequire, Date, console, setTimeout, clearTimeout }, { filename: file });
    return mod.exports;
  }
  load('src/lib/store/tenantReset.ts').installTenantReset();
  const store = load('src/lib/store/useBrandQuizStore.ts').useBrandQuizStore;
  const observations = [];
  store.subscribe(s => observations.push(JSON.stringify(s)));
  const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { session, deliver, store, observations, tick };
}

const pick = s => JSON.stringify({ wsUnitId: s.wsUnitId, courses: s.courses, courseEntries: s.courseEntries, list: s.list, matrix: s.matrix, entryMatrix: s.entryMatrix, loaded: s.loaded, error: s.error });
const EMPTY = pick({ wsUnitId: null, courses: [], courseEntries: [], list: [], matrix: [], entryMatrix: [], loaded: false, error: null });

const scenarios = {
  // A in flight, B logs in and hydrates. Stale A (G0) data/error must never appear; B (G1) must load.
  'A-pending-B-login': async e => {
    const a = e.store.getState().hydrate(); await e.tick();
    e.session.setState({ userId: 'B', unitId: 'B-unit' });
    const b = e.store.getState().hydrate();
    e.deliver(); await Promise.all([a, b]);
    assert.ok(!e.observations.some(s => s.includes('A_G0')), 'stale A data/error reached store');
    const s = e.store.getState();
    assert.ok(pick(s).includes('B_G1') && s.loaded && s.error === null, 'B hydrate must succeed: ' + pick(s));
  },
  // A -> B -> A. The first A request (G0) arriving late must not overwrite the current A (G2) state.
  'A-B-A': async e => {
    const a = e.store.getState().hydrate(); await e.tick();
    e.session.setState({ userId: 'B', unitId: 'B-unit' });
    e.session.setState({ userId: 'A', unitId: 'A-unit' });
    const a2 = e.store.getState().hydrate();
    e.deliver(); await Promise.all([a, a2]);
    assert.ok(!e.observations.some(s => s.includes('A_G0')), 'stale A(G0) data/error reached store');
    const s = e.store.getState();
    assert.ok(pick(s).includes('A_G2') && s.loaded && s.error === null, 'current A hydrate must succeed: ' + pick(s));
  },
  // Reset (account switch) then only the late response arrives: state stays initial (loaded=false, error=null).
  'reset-then-late': async e => {
    const a = e.store.getState().hydrate(); await e.tick();
    e.session.setState({ userId: 'B', unitId: 'B-unit' });
    e.deliver(); await a;
    assert.equal(pick(e.store.getState()), EMPTY, 'late response changed reset state');
  },
  // Control: normal hydrate without switching.
  'control': async e => {
    const a = e.store.getState().hydrate(); await e.tick();
    e.deliver(); await a;
    const s = e.store.getState();
    assert.ok(s.loaded && s.error === null && pick(s).includes('A_G0') && s.courses.length === 1 && s.courseEntries.length === 1, 'control must load: ' + pick(s));
  },
};

(async () => {
  let pass = 0, fail = 0;
  for (const delayed of ['enterBrandWorkspace', 'fetchCourseEntriesResult']) {
    for (const [sname, fn] of Object.entries(scenarios)) {
      for (const failure of sname === 'control' ? [false] : [false, true]) {
        const label = `${sname} delayed=${delayed} late=${failure ? 'error' : 'success'}`;
        try { await fn(environment(delayed, failure)); console.log('PASS ' + label); pass++; }
        catch (err) { console.log(`FAIL ${label}: ${err.message}`); fail++; }
      }
    }
  }
  // deploy: A deploy in flight, account switches to B. Late result must not be returned as success/raw error, and no stale set.
  for (const failure of [false, true]) {
    const label = `deploy-A-pending-B-login late=${failure ? 'error' : 'success'}`;
    try {
      const e = environment('deployBrandCourse', failure);
      const d = e.store.getState().deploy('c1', ['u1']); await e.tick();
      e.session.setState({ userId: 'B', unitId: 'B-unit' });
      e.deliver(); const r = await d;
      assert.equal(r.data, null, 'stale deploy returned data');
      assert.ok(typeof r.error === 'string' && r.error.includes('계정이 바뀌었어요'), 'stale deploy must say account changed: ' + r.error);
      assert.ok(!e.observations.some(s => s.includes('A_G0')), 'stale A reached store');
      assert.equal(pick(e.store.getState()), EMPTY, 'stale deploy changed reset state');
      console.log('PASS ' + label); pass++;
    } catch (err) { console.log(`FAIL ${label}: ${err.message}`); fail++; }
  }
  try {
    const e = environment('deployBrandCourse', false);
    const d = e.store.getState().deploy('c1', ['u1']); await e.tick(); e.deliver(); const r = await d;
    assert.ok(r.error === null && Array.isArray(r.data) && e.store.getState().loaded, 'control deploy must succeed and refresh');
    console.log('PASS deploy-control'); pass++;
  } catch (err) { console.log('FAIL deploy-control: ' + err.message); fail++; }
  // Control: a failure without switching must surface as error (not swallowed).
  try {
    const e = environment('fetchCourseEntriesResult', true);
    const a = e.store.getState().hydrate(); await e.tick(); e.deliver(); await a;
    const s = e.store.getState();
    assert.ok(s.loaded && typeof s.error === 'string' && s.error.length > 0, 'control failure must show error: ' + pick(s));
    console.log('PASS control-failure delayed=fetchCourseEntriesResult'); pass++;
  } catch (err) { console.log('FAIL control-failure: ' + err.message); fail++; }
  console.log(`RESULT ${pass} PASS ${fail} FAIL; offline mocked transport, no auth/network/UI execution`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
