const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'src/lib/push/nativepush.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const response = (id = 'alert-a', route = '/junior/work?view=todo&task=synthetic-task') => ({ notification: { request: { identifier: id, content: { data: { unitId: 'synthetic-unit', route } } } } });
function app(os, opts = {}) {
  let state = { status: 'loading', userId: '', sessionCheck: 'ok', unitId: 'synthetic-unit', role: 'junior', stores: [] };
  const subscribers = new Set(), timers = new Map(), routes = [], reads = [], entries = [];
  let timerId = 0, listener, last = opts.last === null ? null : response(), resolvesLast, resolvesMeta;
  const notifications = {
    setNotificationHandler() {}, setNotificationChannelAsync: async () => {}, AndroidImportance: { HIGH: 4 },
    addNotificationResponseReceivedListener(fn) { listener = fn; },
    getLastNotificationResponseAsync() { reads.push(true); return opts.deferLast ? new Promise(r => { resolvesLast = r; }) : Promise.resolve(last); },
    clearLastNotificationResponseAsync: async () => { last = null; },
    dismissAllNotificationsAsync: async () => {}, setBadgeCountAsync: async () => {},
  };
  const mocks = {
    'react-native': { Platform: { OS: os } }, 'expo-notifications': notifications,
    'expo-constants': { default: {} }, 'expo-router': { router: { push: url => routes.push({ url, user: state.userId, status: state.status }) } },
    '@/lib/supabase': { supabase: new Proxy({}, { get() { throw Error('Network forbidden'); } }) },
    '@/lib/analytics/track': { reportError() {} },
    '@/lib/store/useSessionStore': { useSessionStore: { getState: () => state, subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } } },
    '@/lib/db': { fetchOwnerAlertMeta: () => new Promise(r => { resolvesMeta = r; }) },
    '@/lib/storage/authStorage': { authStorage: {} }, '@/lib/push/signOutPush': {},
    '@/lib/store/useStoreEntryStore': { useStoreEntryStore: { getState: () => ({ enter: async input => { entries.push({ ...input, user: state.userId }); } }) } },
  };
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file];
    const s = file === 'src/lib/push/nativepush.ts' ? source : fs.readFileSync(path.join(repo, file), 'utf8');
    const output = ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, console,
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
      require(id) { if (id in mocks) return mocks[id]; if (id.startsWith('@/')) return load('src/' + id.slice(2) + '.ts'); throw Error('Unexpected ' + id); },
    }, { filename: file });
    return cache[file] = module.exports;
  }
  const push = load('src/lib/push/nativepush.ts'); push.bindNotificationTapRouting();
  return {
    routes, reads, entries, clear: () => push.clearDeviceNotifications(),
    state(next) { state = { ...state, ...next }; for (const fn of [...subscribers]) fn(state); },
    login(id = 'user-a') { this.state({ status: 'signed_in', userId: id, sessionCheck: 'ok' }); },
    tap(r = response()) { listener(r); },
    async settle() { await tick(); for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await tick(); },
    finishRead(r = response()) { assert(resolvesLast, 'read started'); resolvesLast(r); },
    finishMeta() { assert(resolvesMeta, 'legacy read started'); resolvesMeta(null); },
  };
}
const cases = [
  ['normal cold start', async a => { a.login(); await a.settle(); assert.equal(a.routes.length, 1); assert.equal(a.routes[0].status, 'signed_in'); }],
  ['offline recovery retains destination', async a => { a.state({ status: 'signed_out', sessionCheck: 'offline' }); await a.settle(); assert.equal(a.routes.length, 0); a.login(); await a.settle(); assert.equal(a.routes.length, 1); }],
  ['manual login retains destination', async a => { a.state({ status: 'signed_out' }); a.login(); await a.settle(); assert.equal(a.routes.length, 1); }],
  ['listener waits for authentication', async a => { a.tap(); assert.equal(a.routes.length, 0); a.login(); await a.settle(); assert.equal(a.routes.length, 1); assert.equal(a.routes[0].status, 'signed_in'); }],
  ['cold response and listener deduplicate', async a => { a.tap(); a.login(); await a.settle(); a.tap(); assert.equal(a.routes.length, 1); }],
  ['explicit signout clears pending before login', async a => { a.tap(); await a.clear(); a.state({ status: 'signed_out' }); a.login('user-b'); await a.settle(); assert.equal(a.routes.length, 0); }],
  ['account switch cancels pending settle', async a => { a.login('user-a'); a.login('user-b'); await a.settle(); assert.equal(a.routes.length, 0); }],
  ['no notification is a no-op', async a => { a.login(); await a.settle(); assert.equal(a.routes.length, 0); }, { last: null }],
  ['unsafe external route ignored', async a => { a.login(); await a.settle(); a.tap(response('external', 'https://example.invalid')); assert.equal(a.routes.length, 0); }, { last: null }],
  ['new tap after logout and login works', async a => { a.login(); await a.settle(); await a.clear(); a.state({ status: 'signed_out', userId: '' }); a.login('user-b'); await a.settle(); a.tap(response('new-alert')); assert.equal(a.routes.length, 1); assert.equal(a.routes[0].user, 'user-b'); }, { last: null }],
  ['late OS read after explicit signout ignored', async a => { a.login(); await a.settle(); await a.clear(); a.state({ status: 'signed_out' }); a.login('user-b'); a.finishRead(); await a.settle(); assert.equal(a.routes.length, 0); }, { deferLast: true }],
  ['late legacy metadata after account switch ignored', async a => { a.login(); await a.settle(); const r = response('legacy'); r.notification.request.content.data = { url: '/billing' }; r.notification.request.content.categoryIdentifier = 'owner-alert-1'; a.tap(r); a.login('user-b'); a.finishMeta(); await a.settle(); assert.equal(a.routes.length, 0); }, { last: null }],
  ['known same account offline recovery keeps new tap', async a => { a.login(); await a.settle(); a.state({ status: 'signed_out', userId: '', sessionCheck: 'offline' }); a.tap(response('later')); a.login(); await a.settle(); assert.equal(a.routes.length, 1); }, { last: null }],
  ['known different account discards queued tap', async a => { a.login(); await a.settle(); a.state({ status: 'signed_out', userId: '' }); a.tap(response('old-user')); a.login('user-b'); await a.settle(); assert.equal(a.routes.length, 0); }, { last: null }],
  ['latest tap wins over delayed cold response', async a => { a.login(); await a.settle(); a.tap(response('latest', '/junior/schedule')); a.finishRead(response('older')); await a.settle(); assert.equal(a.routes.length, 1); assert.equal(a.routes[0].url, '/junior/schedule'); }, { deferLast: true }],
  ['different store enters before destination', async a => { a.login(); await a.settle(); const r = response('other-store'); r.notification.request.content.data.unitId = 'synthetic-unit-b'; a.tap(r); await tick(); assert.equal(a.entries.length, 1); assert.equal(a.entries[0].uid, 'synthetic-unit-b'); assert.equal(a.routes.length, 0); }, { last: null }],
  ['account change during store import cancels entry', async a => { a.login(); await a.settle(); const r = response('other-store'); r.notification.request.content.data.unitId = 'synthetic-unit-b'; a.tap(r); a.login('user-b'); await tick(); assert.equal(a.entries.length, 0); }, { last: null }],
];
(async () => {
  const results = [];
  for (const os of ['android', 'ios']) for (const [name, test, opts] of cases) {
    try { await test(app(os, opts)); results.push({ os, name, pass: true }); }
    catch (e) { results.push({ os, name, pass: false, error: e.message }); }
  }
  const out = { time: new Date().toISOString(), source: sourcePath, sha256: crypto.createHash('sha256').update(source).digest('hex'), scope: 'actual modules, mocked native/session/router APIs; no device or network', passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
  console.log(JSON.stringify(out, null, 2)); process.exitCode = out.failed ? 1 : 0;
})();
