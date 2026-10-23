// Offline audit: execute production store actions/functions with mocked transport.
// No credentials, network, production writes, or source edits.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function load(p, mocks = {}, cache = new Map()) {
  if (cache.has(p)) return cache.get(p).exports;
  const mod = { exports: {} }; cache.set(p, mod);
  const text = read(p);
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', mocks, cache);
    if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(p), name)) + '.ts', mocks, cache);
    if (!['react', 'zustand'].includes(name)) throw new Error('Unexpected dependency: ' + name);
    return req(name);
  };
  vm.runInNewContext(js, { require: localRequire, module: mod, exports: mod.exports, console, Date, setTimeout, clearTimeout, window: undefined }, { filename: p });
  return mod.exports;
}

const assert = require('node:assert/strict');
const draft = { section: 'open', text: 'Current draft', scope: 'shared', recurrence: 'once', date: '2026-10-23', createdBy: 'qa-owner', ownerId: 'qa-staff', knowhowIds: ['qa-kh'] };
let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch(e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
function fixture(options = {}) {
  const cache = new Map();
  const epoch = load('src/lib/store/tenantEpoch.ts', {}, cache);
  const sync = load('src/lib/store/useSyncStore.ts', {}, cache);
  const rows = new Map(options.rows ?? []);
  const counts = { insert: 0, read: 0, update: 0, attach: 0, push: 0, pushTo: [] };
  let store;
  const mocks = {
    '@/lib/supabase': { HAS_SUPABASE: true },
    '@/lib/db': {
      insertTemplate: async t => {
        counts.insert++;
        if (!rows.has(t.id) && options.persist !== false) rows.set(t.id, { ...t, createdAt: 'server-created-at' });
        if (options.throwInsert) throw new Error('response lost');
        return options.insertOk ?? false;
      },
      // listCap = 서버 응답 상한(max_rows) 모의. 목록은 앞 N행만 준다.
      fetchTemplates: async () => { counts.read++; if (options.read) return options.read({store, rows, epoch}); return { data: [...rows.values()].slice(0, options.listCap ?? Infinity), error: options.readError ?? false }; },
      // ID 직접 조회(상한과 무관). read 훅이 있으면 같은 응답에서 그 ID 만 고른다.
      fetchTemplateById: async id => {
        counts.read++;
        const res = options.read ? await options.read({store, rows, epoch}) : { data: [...rows.values()], error: options.readError ?? false };
        return { data: res.error ? null : (res.data.find(r => r.id === id) ?? null), error: res.error };
      },
      updateTemplate: async t => { counts.update++; rows.set(t.id, t); return options.updateOk ?? true; },
      insertTemplateKnowhow: async () => { counts.attach++; return options.attachOk ?? true; },
      deleteTemplateKnowhow: async () => true,
    },
    '@/lib/store/useSyncStore': sync,
    '@/lib/store/realtimeSync': { coalesce: fn => fn },
    '@/lib/store/useRoomStore': { useRoomStore: { getState: () => ({ currentRoomId: 'qa-room' }) } },
    '@/lib/store/useScheduleStore': { useScheduleStore: { getState: () => ({ config: {} }) } },
    '@/lib/store/useSessionStore': { useSessionStore: { getState: () => ({ userId: 'qa-owner', userName: 'QA' }) } },
    '@/lib/push/notify': {},
  };
  store = load('src/lib/store/useWorkStore.ts', mocks, cache).useWorkStore;
  const reset = () => { epoch.bumpTenantEpoch(); store.setState(store.getInitialState(), true); };
  return { store, rows, counts, sync: sync.useSyncStore, reset, options };
}
async function main() {
  // C2: server assignment delivery is covered by qa-c2-assignment.sql. Client sends zero.
  await test('lost ACK confirms own persisted row, completes attachment, no false error, server owns notifications', async () => {
    const f = fixture();
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.insert, 1); assert.equal(f.rows.size, 1); assert.equal(f.counts.attach, 1);
    assert.equal(f.sync.getState().error, null); assert.deepEqual(f.counts.pushTo, []);
    assert.equal(f.rows.get('stable').createdAt, 'server-created-at');
  });
  await test('throwing insert response also recovers', async () => {
    const f = fixture({ throwInsert: true });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.rows.size, 1);
  });
  await test('prior insert plus changed draft updates same owned row and client does not notify', async () => {
    const f = fixture({ rows: [['stable', { ...draft, id: 'stable', text: 'Old draft', ownerId: 'old-staff', createdAt: 'original-time' }]] });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.rows.size, 1); assert.equal(f.rows.get('stable').text, draft.text);
    assert.equal(f.rows.get('stable').createdAt, 'original-time'); assert.equal(f.counts.push, 0);
  });
  await test('recovered row with attachment failure retries without duplicate insert', async () => {
    const f = fixture({ attachOk: false });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    assert.equal(f.store.getState().templates.some(t => t.id === 'stable'), true);
    f.options.attachOk = true;
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.insert, 1); assert.equal(f.rows.size, 1);
  });
  for (const [name, options] of [
    ['read failure', { readError: true }],
    ['actual insert failure', { persist: false }],
    ['different creator', { rows: [['stable', { ...draft, id: 'stable', createdBy: 'other-user' }]] }],
  ]) await test(name + ' remains failure without attachment or update', async () => {
    const f = fixture(options);
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    assert.equal(f.counts.update, 0); assert.equal(f.counts.attach, 0); assert.equal(f.counts.push, 0);
    assert.equal(f.store.getState().templates.some(t => t.id === 'stable'), false);
  });
  await test('tenant change during readback cannot restore or attach old row', async () => {
    let finish, entered;
    const started = new Promise(r => entered = r), pending = new Promise(r => finish = r);
    const f = fixture({ read: () => { entered(); return pending; } });
    const saving = f.store.getState().addTask(draft, 'stable');
    const reachedRead = await Promise.race([started.then(() => true), saving.then(() => false)]);
    assert.equal(reachedRead, true, 'no recovery read was attempted');
    f.reset(); finish({ data: [...f.rows.values()], error: false });
    assert.equal(await saving, false); assert.equal(f.counts.update, 0); assert.equal(f.counts.attach, 0);
    assert.equal(f.store.getState().templates.length, 0);
  });
  await test('failed readback rollback preserves a newer hydrated row', async () => {
    const f = fixture({ read: ({ store }) => {
      store.setState({ templates: [{ ...draft, id: 'stable', text: 'Fresh server row' }] });
      return { data: [], error: true };
    } });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    assert.equal(f.store.getState().templates.find(t => t.id === 'stable')?.text, 'Fresh server row');
  });
  await test('already hydrated retry ID belonging to another creator is not edited', async () => {
    const f = fixture();
    f.store.setState({ templates: [{ ...draft, id: 'stable', createdBy: 'other-user' }] });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    assert.equal(f.counts.insert, 0); assert.equal(f.counts.update, 0); assert.equal(f.counts.attach, 0);
  });
  await test('omitted creator is filled from session so an owned local retry can finish', async () => {
    const f = fixture({ insertOk: true, attachOk: false });
    const withoutCreator = { ...draft }; delete withoutCreator.createdBy;
    assert.equal(await f.store.getState().addTask(withoutCreator, 'stable'), false);
    assert.equal(f.store.getState().templates.find(t => t.id === 'stable').createdBy, 'qa-owner');
    f.options.attachOk = true;
    assert.equal(await f.store.getState().addTask(withoutCreator, 'stable'), true);
    assert.equal(f.counts.insert, 1);
  });
  await test('ordinary successful insert leaves notifications to server and skips readback', async () => {
    const f = fixture({ insertOk: true });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.read, 0); assert.equal(f.counts.push, 0);
  });
  // ── 10-23 KH03_WORK01 추가 ──
  await test('recovery finds own row beyond list page cap (1000)', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => ['f' + i, { ...draft, id: 'f' + i, createdBy: 'other-user' }]);
    const f = fixture({ rows: filler, listCap: 1000 });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.insert, 1); assert.equal(f.counts.attach, 1); assert.deepEqual(f.counts.pushTo, []);
  });
  await test('multi-assignee lost ACK: no client notification', async () => {
    const f = fixture();
    const multi = { ...draft, ownerId: undefined, ownerIds: ['qa-staff', 'qa-owner', 'qa-staff2'] };
    assert.equal(await f.store.getState().addTask(multi, 'stable'), true);
    assert.deepEqual(f.counts.pushTo, []);
  });
  await test('lost ACK then recovered update fails: no push; retry succeeds: no client push', async () => {
    const f = fixture({ updateOk: false });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    assert.equal(f.counts.push, 0);
    // 롤백은 서버 원본 행(담당자 포함)으로 돌아가야 한다 — 화면에 '담당자 없음'이 보이면 안 된다.
    const shown = f.store.getState().templates.find(t => t.id === 'stable');
    assert.equal(JSON.stringify(shown?.ownerIds ?? [shown?.ownerId]), '["qa-staff"]');
    f.options.updateOk = true;
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.insert, 1); assert.deepEqual(f.counts.pushTo, []);
  });
  await test('lost ACK then readback fails, retry recovers: no client push', async () => {
    const f = fixture({ readError: true });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    f.options.readError = false;
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.rows.size, 1); assert.deepEqual(f.counts.pushTo, []);
  });
  await test('lost ACK, readback fails, realtime hydrate brings row before retry: no client push', async () => {
    const f = fixture({ readError: true });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    f.options.readError = false;
    f.store.setState({ templates: [f.rows.get('stable')] }); // 실시간 재조회가 먼저 들여온 서버 행
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.insert, 1); assert.equal(JSON.stringify(f.counts.pushTo), '[]');
  });
  await test('tenant switch never sends client assignment notification', async () => {
    const f = fixture({ updateOk: false });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    f.reset();
    f.options.updateOk = true;
    f.store.setState({ templates: [f.rows.get('stable')] });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.equal(f.counts.push, 0);
  });
  await test('lost ACK with attachment failure, retry: no client push', async () => {
    const f = fixture({ attachOk: false });
    assert.equal(await f.store.getState().addTask(draft, 'stable'), false);
    f.options.attachOk = true;
    assert.equal(await f.store.getState().addTask(draft, 'stable'), true);
    assert.deepEqual(f.counts.pushTo, []);
  });
  console.log(JSON.stringify({passed, failed, network:'disabled'}));
  process.exitCode = failed ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
