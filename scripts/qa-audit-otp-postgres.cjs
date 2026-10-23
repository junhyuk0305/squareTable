// Local PostgreSQL only. Executes predicates captured from the real consumer on a temp table.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const file = path.resolve(__dirname, '../supabase/functions/otp/index.ts');
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'consumeCode');
const original = fn.parameters[2].name.getText(ast) === 'codeHash';
const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
function query(time) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } }
  const ctx = vm.createContext({ Date: Clock, console });
  vm.runInContext(js + '\nthis.consumeCode = consumeCode;', ctx);
  let result;
  const admin = { from(table) {
    assert.equal(table, 'phone_otps');
    let patch; const filters = [];
    return {
      update(p) { patch = p; return this; },
      eq(k, v) { filters.push(`${k} = ${quote(v)}`); return this; },
      gt(k, v) { filters.push(`${k} > ${quote(v)}`); return this; },
      select() {
        result = `update qa_otp_consume set ${Object.entries(patch).map(([k, v]) => `${k} = ${quote(v)}`).join(', ')} where ${filters.join(' and ')} returning phone`;
        return Promise.resolve({ data: [], error: null });
      },
    };
  } };
  ctx.consumeCode(admin, 'qa', original ? 'hash' : { code_hash: 'hash', expires_at: '2030-01-01T00:03:00.000Z' });
  return result;
}
const a = query('2030-01-01T00:00:00.100Z');
const b = query('2030-01-01T00:00:00.200Z');
const seed = "truncate qa_otp_consume; insert into qa_otp_consume values ('qa','hash','2030-01-01T00:03:00Z');";
const count = q => `with changed as (${q}) select count(*) from changed;`;
const legacy = "update qa_otp_consume set expires_at = '2030-01-01T00:00:00.200Z' where phone = 'qa' and code_hash = 'hash' and expires_at > '2030-01-01T00:00:00.200Z' returning phone";
const sql = `begin;
create temp table qa_otp_consume(phone text primary key, code_hash text, expires_at timestamptz) on commit drop;
${seed} ${count(b)} ${count(a)}
${seed} update qa_otp_consume set expires_at = '2030-01-01T00:04:00Z'; ${count(a)}
${seed} ${count(a)} ${count(legacy)}
${seed} ${count(legacy)} ${count(a)}
rollback;`;
const output = execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
const observed = output.trim().split(/\r?\n/).map(Number);
const expected = [1, 0, 0, 1, 0, 1, 0];
console.log(JSON.stringify({ boundary: 'actual consumeCode predicates, local PostgreSQL temp table, sequential controlled interleavings; not Edge authentication', observed, expected }));
assert.deepEqual(observed, expected);
console.log('PASS reverse request order, resend generation, old/new Edge order both ways; ROLLBACK completed');
