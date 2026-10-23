// Offline audit: execute production store actions/functions with mocked transport.
// No credentials, network, production writes, or source edits.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
const results = [];
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = {};
function load(p, mocks = {}, cache = new Map()) {
  if (cache.has(p)) return cache.get(p).exports;
  const mod = { exports: {} }; cache.set(p, mod);
  const text = read(p); source[p] = require('node:crypto').createHash('sha256').update(text).digest('hex');
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
function extractedFunction(p, name, globals) {
  const text = read(p);
  source[p] = require('node:crypto').createHash('sha256').update(text).digest('hex');
  const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, p.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found;
  function visit(n) { if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.text === name) found = n; ts.forEachChild(n, visit); }
  visit(sf); if (!found) throw new Error('Function not found: '+name);
  const decl = ts.isVariableDeclaration(found) ? 'const ' + name + ' = ' + found.initializer.getText(sf) + ';' : found.getText(sf).replace(/^export /, '');
  const js = ts.transpileModule(decl + '\nmodule.exports = ' + name + ';', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = {exports:{}};
  vm.runInNewContext(js, { ...globals, module: mod, exports: mod.exports });
  return mod.exports;
}

const assert = require('node:assert/strict');
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
async function main() {
  const sync = load('src/lib/store/useSyncStore.ts');
  let inserted = 0, linksOk = false, writeOk = true;
  const mocks = {
    '@/lib/supabase': { HAS_SUPABASE: true },
    '@/lib/db': {
      insertTemplate: async () => { inserted++; return writeOk; },
      updateTemplate: async () => writeOk,
      insertTemplateKnowhow: async () => linksOk,
      deleteTemplateKnowhow: async () => linksOk,
    },
    '@/lib/store/useSyncStore': sync,
    '@/lib/store/realtimeSync': { coalesce: fn => fn },
    '@/lib/store/useRoomStore': { useRoomStore: { getState: () => ({ currentRoomId: 'qa-room' }) } },
    '@/lib/store/useScheduleStore': { useScheduleStore: { getState: () => ({ config: {} }) } },
    '@/lib/store/useSessionStore': { useSessionStore: { getState: () => ({ userId: 'qa-owner', userName: 'QA' }) } },
    '@/lib/push/notify': {},
  };
  const work = load('src/lib/store/useWorkStore.ts', mocks).useWorkStore;
  const input = { section: 'open', text: 'QA only', scope: 'shared', recurrence: 'once', date: '2026-10-23', createdBy: 'qa-owner', knowhowIds: ['qa-kh'] };
  await test('WORK-01 attachment failure is not full success', async () => {
    assert.equal(await work.getState().addTask(input, 'qa-retry'), false);
    assert.equal(work.getState().knowhowLinks.length, 0);
  });
  await test('WORK-01 retry completes same task without another insert', async () => {
    linksOk = true;
    assert.equal(await work.getState().addTask({ ...input, text: 'QA edited draft' }, 'qa-retry'), true);
    assert.equal(inserted, 1);
    assert.equal(work.getState().templates.filter(t => t.id === 'qa-retry').length, 1);
    assert.equal(work.getState().knowhowLinks.length, 1);
  });
  await test('WORK-01 failed detach reports failure and restores attachment', async () => {
    const id = work.getState().templates.find(t => t.text === 'QA edited draft').id;
    linksOk = false;
    assert.equal(await work.getState().editTask(id, { ...input, knowhowIds: [] }), false);
    assert.equal(work.getState().knowhowLinks.length, 1);
    linksOk = true;
    assert.equal(await work.getState().editTask(id, { ...input, knowhowIds: [] }), true);
    assert.equal(work.getState().knowhowLinks.length, 0);
  });
  await test('WORK-01 primary failure leaves no optimistic template', async () => {
    writeOk = false;
    assert.equal(await work.getState().addTask(input, 'qa-primary-fail'), false);
    assert.equal(work.getState().templates.some(t => t.id === 'qa-primary-fail'), false);
    writeOk = true;
  });

  function tenantCase(db) {
    const cache = new Map();
    const epoch = load('src/lib/store/tenantEpoch.ts', {}, cache);
    let notifications = 0;
    const local = load('src/lib/store/useWorkStore.ts', {
      ...mocks,
      '@/lib/db': { insertTemplate: async () => true, updateTemplate: async () => true, insertTemplateKnowhow: async () => true, deleteTemplateKnowhow: async () => true, ...db },
      '@/lib/push/notify': { notifyUserAssign: () => { notifications++; } },
    }, cache).useWorkStore;
    const reset = extractedFunction('src/lib/store/tenantReset.ts', 'resetUnitData', {
      bumpTenantEpoch: epoch.bumpTenantEpoch, UNIT_STORES: [local],
      toInitial: extractedFunction('src/lib/store/tenantReset.ts', 'toInitial', {}),
      setCustomCategoryRegistry: () => {}, usePayrollStore: { setState: () => {} }, DEFAULT_SETTINGS: {},
    });
    return { store: local, reset, notifications: () => notifications };
  }
  for (const mode of ['add', 'edit']) {
    await test('WORK tenant ' + mode + ': late primary response starts no attachment or notification', async () => {
      let finish, attachments = 0;
      const pending = new Promise(r => finish = r);
      const c = tenantCase({
        insertTemplate: () => pending, updateTemplate: () => pending,
        insertTemplateKnowhow: async () => { attachments++; return true; },
      });
      const patch = { ...input, ownerId: 'qa-staff' };
      if (mode === 'edit') c.store.setState({ templates: [{ ...input, id: 'qa-stable' }] });
      const saving = mode === 'add' ? c.store.getState().addTask(patch, 'qa-stable') : c.store.getState().editTask('qa-stable', patch);
      c.reset(); finish(true);
      const result = await saving;
      assert.equal(attachments, 0); assert.equal(c.notifications(), 0); assert.equal(result, false);
      assert.equal(c.store.getState().knowhowLinks.length, 0);
    });
    await test('WORK tenant ' + mode + ': late attachment starts no detach or notification and reports false', async () => {
      let finish, entered, detaches = 0;
      const pending = new Promise(r => finish = r), started = new Promise(r => entered = r);
      const c = tenantCase({
        insertTemplateKnowhow: () => { entered(); return pending; },
        deleteTemplateKnowhow: async () => { detaches++; return true; },
      });
      const patch = { ...input, ownerId: 'qa-staff' };
      if (mode === 'edit') c.store.setState({ templates: [{ ...input, id: 'qa-stable' }], knowhowLinks: [{ templateId: 'qa-stable', entryId: 'qa-remove' }] });
      const saving = mode === 'add' ? c.store.getState().addTask(patch, 'qa-stable') : c.store.getState().editTask('qa-stable', patch);
      await started; c.reset(); finish(true);
      const result = await saving;
      assert.equal(c.notifications(), 0); assert.equal(detaches, 0); assert.equal(result, false);
      assert.equal(c.store.getState().knowhowLinks.length, 0);
    });
  }
  await test('WORK tenant: old attachment failure cannot remove a fresh generation link', async () => {
    let finish;
    const pending = new Promise(r => finish = r);
    const c = tenantCase({ insertTemplateKnowhow: () => pending });
    const saving = c.store.getState().attachKnowhow('qa-stable', ['qa-kh']);
    c.reset(); // A -> another tenant -> A can load the same link in a later generation.
    c.store.setState({ knowhowLinks: [{ templateId: 'qa-stable', entryId: 'qa-kh' }] });
    finish(false); assert.equal(await saving, false);
    assert.equal(c.store.getState().knowhowLinks.length, 1);
  });

  for (const mode of ['create', 'edit', 'routine']) {
    await test('WORK-02 ' + mode + ' waits, prevents double submit, preserves failure, closes on success', async () => {
      let finish, closed = 0, calls = 0, error = '';
      const saveIds = [];
      let pending = new Promise(r => finish = r);
      const save = () => { calls++; return pending; };
      const submit = extractedFunction('src/components/work/TaskComposerModal.tsx', 'submit', {
        canSubmit: true, routineMode: mode === 'routine', isEdit: mode === 'edit', editTemplate: { id: 'existing' }, isDup: false,
        buildInputs: () => [input], buildEditInput: () => input,
        onSubmit: save, onEdit: save, onSubmitRoutine: save,
        onClose: () => closed++, submittingRef: { current: false }, saveIds, genId: () => 'qa-retry',
        setSaveIds: ids => { saveIds.splice(0, saveIds.length, ...ids); },
        setSaving: () => {}, setSaveError: v => { error = v; },
        text: 'QA', description: '', remindOn: false, remindValid: true, remindAt: '', picked: [],
        currentTenantEpoch: () => 1, isStaleEpoch: () => false,
        savePendingDraft: async () => {}, clearPendingDraft: async () => {}, draftKey: 'work-test',
        when: 'today', today: '2026-10-23', pickedDate: '2026-10-23', dows: [], section: 'open', taskScope: 'shared', knowhowIds: [],
      });
      const first = submit(); const second = submit();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, 0, 'closed before response');
      assert.equal(calls, 1, 'duplicate request');
      finish(false); await Promise.all([first, second]);
      assert.equal(closed, 0, 'closed on failure');
      assert.ok(error, 'failure message absent');
      pending = Promise.resolve(true); await submit();
      assert.equal(closed, 1);
    });
  }

  await test('C1 lost acknowledgement survives restart with one task and assignment event', async () => {
    const disk = new Map(), rows = new Map(); let lost = true, events = 0, closed = 0;
    const storage = { getItem: async k => disk.get(k) ?? null, setItem: async (k,v) => disk.set(k,v), removeItem: async k => disk.delete(k) };
    const boot = async () => {
      const pending = load('src/lib/storage/pendingDraft.ts', { '@react-native-async-storage/async-storage': storage });
      const draft = await pending.loadPendingDraft('work:restart');
      const c = tenantCase({
        insertTemplate: async row => { if (!rows.has(row.id)) { rows.set(row.id,row); events++; } return !lost; },
        fetchTemplateById: async id => lost ? { data: null, error: true } : { data: rows.get(id) ?? null, error: false },
        updateTemplate: async (id, patch) => { rows.set(id,{...rows.get(id),...patch}); return true; },
      });
      const ids = draft?.ids ?? [];
      const submit = extractedFunction('src/components/work/TaskComposerModal.tsx','submit',{
        canSubmit:true,routineMode:false,isEdit:false,isDup:false,buildInputs:()=>[{...input,knowhowIds:[]}],
        onSubmit:async (inputs,taskIds)=>(await Promise.all(inputs.map((v,i)=>c.store.getState().addTask(v,taskIds[i])))).every(Boolean),
        onClose:()=>closed++,submittingRef:{current:false},saveIds:ids,genId:()=>{assert.equal(draft,null);return 'restart-id'},setSaveIds:()=>{},
        setSaving:()=>{},setSaveError:()=>{},text:'QA',description:'',remindOn:false,remindValid:true,remindAt:'',picked:[],
        currentTenantEpoch:()=>1,isStaleEpoch:()=>false,...pending,draftKey:'work:restart',
        when:'today',today:'2026-10-23',pickedDate:'2026-10-23',dows:[],section:'open',taskScope:'shared',knowhowIds:[],
      });
      return submit;
    };
    await (await boot())(); assert.equal(closed,0); assert.equal(rows.size,1); assert.equal(disk.size,1);
    lost=false; await (await boot())();
    assert.equal(rows.size,1); assert.equal(events,1); assert.equal(closed,1); assert.equal(disk.size,0);
  });

  await test('C8 understanding comes only from server and ignores stale tenant response', async () => {
    let result={data:[],error:false};
    const c=tenantCase({fetchKnowhowUnderstandingResult:async()=>result});
    assert.equal(await c.store.getState().markUnderstood(['entry'],'staff'),false);
    assert.equal(c.store.getState().understanding.length,0);
    result={data:[{entryId:'entry',staffId:'staff',staffName:'server',verifiedAt:'2026-10-23'}],error:false};
    assert.equal(await c.store.getState().markUnderstood(['entry'],'staff'),true);
    assert.equal(c.store.getState().understanding[0].staffName,'server');
    result={data:[],error:true};
    assert.equal(await c.store.getState().markUnderstood(['entry'],'staff'),false);
    assert.equal(c.store.getState().understanding.length,1);
    let resolve;const other=tenantCase({fetchKnowhowUnderstandingResult:()=>new Promise(r=>resolve=r)});
    const pending=other.store.getState().markUnderstood(['entry'],'staff');other.reset();
    resolve({data:[{entryId:'entry',staffId:'staff'}],error:false});
    assert.equal(await pending,false);assert.equal(other.store.getState().understanding.length,0);
  });

  await test('WORK-02 multi-assignee draft remains one task', async () => {
    const build = extractedFunction('src/components/work/TaskComposerModal.tsx', 'buildInputs', {
      text: 'QA', when: 'today', dows: [], remindValid: true, baseInput: () => input,
      personalMode: false, me: 'qa-owner', picked: ['qa-a', 'qa-b'],
    });
    const rows = build();
    assert.equal(rows.length, 1); assert.deepEqual(Array.from(rows[0].ownerIds), ['qa-a', 'qa-b']);
  });

  const boardText = read('src/components/WorkBoard.tsx');
  const boardAst = ts.createSourceFile('WorkBoard.tsx', boardText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let boardProps;
  function visitBoard(n) {
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(boardAst) === 'TaskComposerModal') boardProps = n.attributes.properties;
    ts.forEachChild(n, visitBoard);
  }
  visitBoard(boardAst);
  function boardCallback(name, globals) {
    const attr = boardProps.find(p => p.name?.getText(boardAst) === name);
    const code = ts.transpileModule('module.exports = ' + attr.initializer.expression.getText(boardAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} }; vm.runInNewContext(code, { ...globals, module: mod }); return mod.exports;
  }
  await test('WORK-02 real parent propagates failure and reuses draft ID', async () => {
    let receivedId, toast = 0;
    const submit = boardCallback('onSubmit', {
      addTask: async (_input, id) => { receivedId = id; return false; }, showToast: () => toast++,
      assigneesOf: () => [], userId: 'qa-owner',
    });
    assert.equal(await submit([input], ['stable']), false);
    assert.equal(receivedId, 'stable'); assert.equal(toast, 0);
  });
  await test('WORK-02 duplicate guard permits own partial task but rejects another task', async () => {
    const duplicate = boardCallback('isDuplicate', {
      storeTemplates: [{ id: 'stable' }, { id: 'other' }],
      findDuplicateTask: (rows, target) => rows.find(row => row.id === target.id),
    });
    assert.equal(duplicate({ id: 'stable' }, 'stable'), false);
    assert.equal(duplicate({ id: 'other' }, 'stable'), true);
  });

  const billingSource = read('src/app/billing-card.tsx');
  const sf = ts.createSourceFile('billing-card.tsx', billingSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(n) {
    if (ts.isArrowFunction(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) effect = n;
    ts.forEachChild(n, visit);
  }
  visit(sf);
  const js = ts.transpileModule('module.exports = ' + effect.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const c of [
    { name: 'pending', charged: { done: 0, failed: 0, pending: 1 }, phase: 'pending', phrase: '확인' },
    { name: 'mixed', charged: { done: 1, failed: 0, pending: 1 }, phase: 'pending', phrase: '확인' },
    { name: 'declined', charged: { done: 0, failed: 1, pending: 0 }, phase: 'done', phrase: '승인되지' },
    { name: 'done', charged: { done: 1, failed: 0, pending: 0 }, phase: 'done', phrase: '완료' },
    { name: 'unknown legacy', charged: undefined, phase: 'pending', phrase: '확인' },
  ]) await test('BILL-04 ' + c.name, async () => {
    let phase, detail;
    const mod = { exports: {} };
    vm.runInNewContext(js, {
      module: mod, p: { mode: 'update', authKey: 'mock', customerKey: 'mock' },
      cardUpdateCard: async () => ({ ok: true, body: { retried: true, charged: c.charged } }),
      refreshMembership: async () => {}, setPhase: v => phase = v, setDetail: v => detail = v, setTitle: () => {},
    });
    await mod.exports();
    assert.equal(phase, c.phase); assert.ok(detail.includes(c.phrase), detail);
  });
  console.log(JSON.stringify({ failed, network: 'disabled by dependency allowlist' }));
  process.exitCode = failed ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });

