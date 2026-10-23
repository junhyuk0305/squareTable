const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const file = process.argv[2] || path.join(repo, 'src/lib/analytics/track.ts');
const source = fs.readFileSync(file, 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function run(route, reject = false) {
  const rows = [];
  const module = { exports: {} };
  const mocks = {
    '@/lib/supabase': { HAS_SUPABASE: true, supabase: { from: table => ({ insert: row => {
      rows.push({ table, ...row });
      return reject ? Promise.reject(new Error('synthetic transport failure')) : Promise.resolve({ error: null });
    } }) } },
    '@/lib/analytics/posthog': { initPostHog() {}, phSetContext() {}, phCapture() {} },
  };
  vm.runInNewContext(js, { module, exports: module.exports,
    require: name => { assert(name in mocks, 'Only mocked dependencies allowed'); return mocks[name]; },
    window: route === undefined ? undefined : { location: { pathname: route, search: '?secret=SYNTHETIC', hash: '#SYNTHETIC' } },
  });
  module.exports.reportError('synthetic.open', { code: '503', message: 'synthetic failure' });
  module.exports.track('synthetic.event');
  return rows;
}
let failed = 0;
for (const [label, route, expected] of [
  ['shared token', '/q/SYNTHETIC_TOKEN', '/q/[token]'],
  ['encoded token', '/q/SYNTHETIC%2FTOKEN', '/q/[token]'],
  ['trailing slash', '/q/SYNTHETIC_TOKEN/', '/q/[token]/'],
  ['ordinary route', '/owner/work', '/owner/work'],
  ['similar route', '/owner/quiz/ordinary-id', '/owner/quiz/ordinary-id'],
  ['empty route', '', null],
  ['native without window', undefined, null],
]) {
  try {
    const rows = run(route);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].table, 'client_errors');
    assert.equal(rows[1].table, 'app_events');
    for (const row of rows) assert.equal(row.route, expected);
    assert.equal(rows[0].context, 'synthetic.open');
    assert.equal(rows[0].code, '503');
    console.log('PASS', label);
  } catch (e) { failed++; console.log('FAIL', label, e.message); }
}
run('/q/SYNTHETIC_TOKEN', true);
setImmediate(() => {
  console.log(JSON.stringify({ failed, sourceHash: crypto.createHash('sha256').update(source).digest('hex'), time: new Date().toISOString(), transport: 'mocked; no network', rejectedInsertDoesNotThrow: true }));
  process.exitCode = failed ? 1 : 0;
});
