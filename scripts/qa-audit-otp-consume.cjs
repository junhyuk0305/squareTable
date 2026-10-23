// Offline execution of the production consumer. No credentials, SMS or live rows.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/otp/index.ts'), 'utf8');
const ast = ts.createSourceFile('otp.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'consumeCode');
assert.ok(fn);
const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
// Support the original internal signature so the same safety assertions run before the fix.
const originalSignature = fn.parameters[2].name.getText(ast) === 'codeHash';
let passed = 0;
let failed = 0;
const seed = () => ({ phone: 'qa-synthetic', code_hash: 'qa-hash', expires_at: '2030-01-01T00:03:00.000Z' });
function harness(times = ['2030-01-01T00:00:00.100Z', '2030-01-01T00:00:00.200Z']) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [times.shift()])); } }
  const context = vm.createContext({ Date: Clock, console });
  vm.runInContext(js + '\nthis.consumeCode = consumeCode;', context);
  const row = seed();
  const pending = [];
  const admin = { from(table) {
    assert.equal(table, 'phone_otps');
    const filters = [];
    let patch;
    return {
      update(value) { patch = value; return this; },
      eq(key, value) { filters.push(() => row[key] === value); return this; },
      gt(key, value) { filters.push(() => Date.parse(row[key]) > Date.parse(value)); return this; },
      select() { return new Promise(resolve => pending.push((error = null) => {
        const matches = !error && filters.every(f => f());
        if (matches) Object.assign(row, patch);
        resolve({ data: matches ? [{ phone: row.phone }] : [], error });
      })); },
    };
  } };
  return { row, pending, consume(snapshot = { ...row }, extra) {
    return context.consumeCode(admin, row.phone, originalSignature ? snapshot.code_hash : snapshot, extra);
  } };
}
async function test(name, run) {
  try { await run(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, e.message); }
}
(async () => {
  for (const order of [[1, 0], [0, 1]]) await test(`only one consumer, DB order ${order}`, async () => {
    const h = harness();
    const results = [h.consume(), h.consume()];
    order.forEach(i => h.pending[i]());
    assert.deepEqual((await Promise.all(results)).sort(), ['ok', 'taken']);
  });
  await test('same timestamp still has one winner', async () => {
    const h = harness(['2030-01-01T00:00:00.100Z', '2030-01-01T00:00:00.100Z']);
    const results = [h.consume(), h.consume()];
    h.pending.forEach(f => f());
    assert.deepEqual((await Promise.all(results)).sort(), ['ok', 'taken']);
  });
  await test('new code generation is not consumed by an old request', async () => {
    const h = harness(); const result = h.consume();
    h.row.expires_at = '2030-01-01T00:04:00.000Z'; // Same digits can recur; expiry identifies the issuance.
    h.pending[0](); assert.equal(await result, 'taken');
    assert.equal(h.row.expires_at, '2030-01-01T00:04:00.000Z');
  });
  await test('different code hash is not consumed', async () => {
    const h = harness(); const result = h.consume();
    h.row.code_hash = 'new-code'; h.pending[0](); assert.equal(await result, 'taken');
  });
  await test('expired code is rejected', async () => {
    const h = harness(['2030-01-01T00:04:00.000Z']); const result = h.consume();
    h.pending[0](); assert.equal(await result, 'taken');
  });
  await test('DB failure is not a successful verification', async () => {
    const h = harness(); const result = h.consume();
    h.pending[0]({ message: 'injected offline error' }); assert.equal(await result, 'db');
  });
  await test('verification evidence survives one-time consumption', async () => {
    const h = harness(); const extra = { verified_at: '2030-01-01T00:00:00Z', verified_by: 'qa-user' };
    const result = h.consume(undefined, extra); h.pending[0]();
    assert.equal(await result, 'ok'); assert.equal(h.row.verified_by, extra.verified_by);
    assert.equal(h.row.verified_at, extra.verified_at);
  });
  console.log(JSON.stringify({ passed, failed, skipped: 0, boundary: 'actual consumeCode, mocked PostgREST and clock' }));
  process.exitCode = failed ? 1 : 0;
})();
