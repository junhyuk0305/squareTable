// Production session store + real pure session policies. Transport/auth are offline fakes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function scenario(mode) {
  let serverUnit = 'A', readFails = mode === 'read-failure', localUnit = 'A', renamed = 0;
  const user = { id: 'owner', email: 'qa@example.invalid', user_metadata: {} };
  let release;
  const delayed = new Promise(r => { release = r; });
  const db = {
    setUnitId: id => { localUnit = id; },
    switchActiveUnit: async id => {
      if (mode === 'rejected') return { error: { message: 'unit_locked' } };
      serverUnit = id;
      if (mode === 'delayed' || mode === 'delayed-commit') await delayed;
      if (mode === 'lost-response') throw new Error('fetch failed');
      return { error: null };
    },
    fetchSessionProfile: async () => ({ data: readFails ? null : { role: 'owner', name: 'QA', active_unit_id: 'A' }, error: readFails ? { message: 'fetch failed' } : null }),
    fetchSessionUnit: async () => ({ data: mode === 'mismatch' ? 'A' : serverUnit, error: null }),
    fetchUnitInfo: async id => ({ data: { store_name: `Store ${id}` }, error: null }),
    fetchUnitSubscription: async () => ({ data: null, error: null }),
    fetchBillingFreeMode: async () => ({ data: true, error: null }),
    fetchDowngradeNeed: async () => ({ data: null, error: null }),
    fetchMyUnits: async () => ({ data: [{ unit_id: 'A', role: 'owner' }, { unit_id: 'B', role: 'owner' }], error: null }),
    fetchMyBrand: async () => ({ data: null, error: null }),
    rpcRenameStore: async () => { renamed++; return { data: 1, error: null }; },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const js = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name === 'zustand') return require('zustand');
      if (name.startsWith('./')) return load('src/lib/store/' + name.slice(2) + '.ts');
      if (name === '@/lib/db') return db;
      if (name === '@/lib/supabase') return { HAS_SUPABASE: true, supabase: { auth: { getSession: async () => ({ data: { session: { user } }, error: null }), onAuthStateChange() {} } } };
      if (name === '@/lib/analytics/track') return { track() {}, reportError() {}, setAnalyticsContext() {} };
      if (name === '@/lib/utils/userError') return { isMissingRpc: () => false, friendlyError: (_e,f) => f };
      if (name === '@/lib/utils/subscription') return { effectivePlanOf: () => 'free' };
      if (name === '@/lib/config/tiers') return { normalizePlan: () => 'free' };
      if (name === '@/lib/config/store-policy') return { SHOW_IAP: false };
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      return new Proxy({}, { get: (_,key) => () => { throw new Error(`Unexpected: ${name}.${String(key)}`); } });
    };
    vm.runInNewContext(js, { module:mod,exports:mod.exports,require:localRequire,console,Date,Error,window:undefined,setTimeout,clearTimeout }, {filename:file});
    return mod.exports;
  }
  const store = load('src/lib/store/useSessionStore.ts').useSessionStore;
  store.setState({ status:'signed_in', userId:user.id, email:user.email, unitId:'A',storeName:'Store A',role:'owner',stores:[{unit_id:'A',role:'owner'},{unit_id:'B',role:'owner'}] });
  return { store, release, recover:()=>{readFails=false;}, stats:()=>({serverUnit,localUnit,renamed}) };
}
(async()=>{
  let passed=0,failed=0;
  async function test(name,run) { try { await run(); passed++; console.log('PASS '+name); } catch(e) { failed++; console.log('FAIL '+name+': '+e.message); } }
  await test('profile failure cannot report success or write from stale A; init recovers B',async()=>{
    const e=scenario('read-failure'); const r=await e.store.getState().switchUnit('B');
    assert.ok(r.error); assert.equal(e.store.getState().unitId,''); assert.equal(e.stats().localUnit,null);
    assert.equal(e.store.getState().sessionCheck,'offline');
    const rename=await e.store.getState().renameStore('Wrong destination');
    assert.ok(rename.error); assert.equal(e.stats().renamed,0);
    e.recover(); await e.store.getState().init();
    assert.equal(e.store.getState().status,'signed_in'); assert.equal(e.store.getState().unitId,'B');
    assert.equal(e.store.getState().role,'owner'); assert.equal(e.stats().localUnit,'B');
  });
  await test('successful B switch still succeeds',async()=>{const e=scenario('ok'); const r=await e.store.getState().switchUnit('B');assert.equal(r.error,null);assert.equal(e.store.getState().unitId,'B');});
  await test('definite unit_locked rejection preserves A',async()=>{const e=scenario('rejected');const r=await e.store.getState().switchUnit('B');assert.ok(r.error);assert.equal(e.store.getState().unitId,'A');assert.equal(e.stats().serverUnit,'A');});
  await test('server/client mismatch fails closed',async()=>{const e=scenario('mismatch');const r=await e.store.getState().switchUnit('B');assert.ok(r.error);assert.equal(e.store.getState().unitId,'');});
  await test('lost switch response fails closed, retry init recovers server B',async()=>{const e=scenario('lost-response');const r=await e.store.getState().switchUnit('B');assert.ok(r.error);assert.equal(e.store.getState().unitId,'');await e.store.getState().init();assert.equal(e.store.getState().unitId,'B');});
  await test('new login while old switch waits is never overwritten',async()=>{const e=scenario('delayed');const p=e.store.getState().switchUnit('B');e.store.setState({userId:'new-user',unitId:'C',storeName:'Store C'});e.release();const r=await p;assert.ok(r.error);assert.equal(e.store.getState().userId,'new-user');assert.equal(e.store.getState().unitId,'C');});
  await test('server committed B with response pending blocks stale A writes immediately',async()=>{
    const e=scenario('delayed-commit');const p=e.store.getState().switchUnit('B');
    assert.equal(e.stats().serverUnit,'B');
    const rename=await e.store.getState().renameStore('Must not send');
    e.release();await p;
    assert.ok(rename.error);assert.equal(e.stats().renamed,0);assert.equal(e.store.getState().unitId,'B');
  });
  console.log(`RESULT ${passed} PASS ${failed} FAIL 0 SKIP; offline, no server or rendered UI`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
