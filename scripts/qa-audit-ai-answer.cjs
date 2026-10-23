// Actual Edge answer handler and filters, isolated from Deno/auth/DB.
// Default: deterministic mocked model responses. --live: explicit Gemini-only evaluation.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/ai/index.ts'), 'utf8');
const ast = ts.createSourceFile('ai/index.ts', source, ts.ScriptTarget.Latest, true);
const sha256 = crypto.createHash('sha256').update(source).digest('hex');
const variables = new Set(['MAX_SOPS', 'MAX_SOP_FIELD', 'MAX_QUERY_LEN', 'MAX_RAWTEXT_LEN', 'KOREAN_RULE', 'HANGUL_OR_WORD', 'LEAK_MARKERS', 'ANSWER_SCHEMA', 'ANSWER_CONSISTENCY_SCHEMA', 'MODEL']);
function loadAnswer(callGemini, live = false, runtime = {}) {
  const functions = new Set(['handleAnswer', 'fence', 'isJunkInput', 'looksLikeInstructionLeak']);
  if (live) { functions.add('callGemini'); functions.add('callGeminiParts'); }
  const selected = ast.statements.filter(s =>
    (ts.isVariableStatement(s) && s.declarationList.declarations.some(d => variables.has(d.name.getText(ast)))) ||
    (ts.isFunctionDeclaration(s) && functions.has(s.name?.text))
  ).map(s => s.getText(ast)).join('\n');
  let calls = 0;
  const context = {
    callGemini,
    AbortSignal,
    console: { error() {}, warn() {}, log() {} },
    GEMINI_API_KEY: live ? process.env.GEMINI_API_KEY : '',
    fetch: async (url, init) => {
      assert.ok(live, 'network disabled');
      assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'), 'only model endpoint permitted');
      assert.ok(++calls <= 20, 'model call budget exceeded');
      return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    },
    ...runtime,
  };
  vm.runInNewContext(ts.transpileModule(selected + '\nglobalThis.answer = handleAnswer;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { answer: context.answer, calls: () => calls };
}
const sop = (id, situation = '마감 직후', step = '표지판을 왼쪽에 놓는다') => ({ id, title: id, category: 'Routine', situation, steps: [step], donts: [], creatorName: 'QA', version: 1, updatedAt: '2026-10-22' });
const modelAnswer = (ids = ['A']) => ({ grounded: true, used_sop_ids: ids, summary: '표지판을 왼쪽에 놓는다', actions: ['표지판을 왼쪽에 놓는다'], donts: [], coverage: 'full', caveat: '' });
const usage = { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 };
async function runMock({ sops = [sop('A')], output = modelAnswer(), verdict = { status: 'consistent' }, failVerifier = false } = {}) {
  const calls = [];
  const { answer } = loadAnswer(async (_prompt, schema) => {
    const verifier = !!schema.properties?.status;
    calls.push(verifier ? 'verify' : 'answer');
    if (verifier && failVerifier) throw new Error('injected upstream failure');
    return { parsed: verifier ? verdict : output, usage: { ...usage } };
  });
  return { result: await answer({ query: '표지판을 어디에 놓나요?', sops }), calls };
}
function withheld(r) { assert.equal(r.grounded, false); assert.equal(r.block, null); assert.deepEqual(Array.from(r.usedSopIds), []); }
async function regression() {
  let pass = 0, fail = 0;
  const test = async (label, fn) => { try { await fn(); pass++; console.log('PASS ' + label); } catch (e) { fail++; console.log('FAIL ' + label + ': ' + e.message); } };
  await test('AI-02 unknown source is withheld', async () => withheld((await runMock({ output: modelAnswer(['missing']) })).result));
  await test('AI-02 mixed valid/unknown source is withheld', async () => withheld((await runMock({ output: modelAnswer(['A', 'missing']) })).result));
  await test('AI-02 empty sources cannot ground answer', async () => withheld((await runMock({ output: modelAnswer([]) })).result));
  await test('AI-02 missing grounded flag is withheld', async () => { const out = modelAnswer(); delete out.grounded; withheld((await runMock({ output: out })).result); });
  await test('AI-02 valid source keeps old response shape', async () => { const r = (await runMock()).result; assert.equal(r.grounded, true); assert.equal(r.block.source.entry_id, 'A'); assert.equal(r.coverage, 'full'); });
  await test('AI-02 duplicate source IDs are normalized', async () => { const r = (await runMock({ output: modelAnswer(['A','A']) })).result; assert.deepEqual(Array.from(r.usedSopIds), ['A']); });
  const pair = [sop('A'), sop('B', '마감 직후', '표지판을 오른쪽에 놓는다')];
  await test('AI-05 conflict prevents answer generation', async () => { const r = await runMock({ sops: pair, output: modelAnswer(['A','B']), verdict: { status: 'conflicting' } }); withheld(r.result); assert.deepEqual(r.calls, ['verify']); });
  await test('AI-05 uncertain verification is withheld', async () => withheld((await runMock({ sops: pair, verdict: { status: 'uncertain' } })).result));
  await test('AI-05 missing verifier result fails closed', async () => withheld((await runMock({ sops: pair, verdict: {} })).result));
  await test('AI-05 verifier transport failure cannot trigger client mock answer', async () => { const r = await runMock({ sops: pair, failVerifier: true }); withheld(r.result); assert.deepEqual(r.calls, ['verify']); });
  await test('AI-05 hot/cold conditions can both be valid', async () => { const r = await runMock({ sops: [sop('A','따뜻한 라떼','우유 180 ml'),sop('B','아이스 라떼','우유 120 ml')], output: modelAnswer(['A','B']) }); assert.equal(r.result.grounded,true); assert.deepEqual(r.calls,['verify','answer']); assert.equal(r.result.usage.totalTokenCount,24); });
  await test('output instruction leak remains blocked', async () => withheld((await runMock({ output: {...modelAnswer(), summary:'responseSchema'} })).result));
  await test('multi-source total deadline withholds slow answer before client timeout', async () => {
    let now = 0;
    const { answer } = loadAnswer(async (_p, schema, _n, _m, signal) => {
      if (schema.properties?.status) { now += 4500; return { parsed: {status:'consistent'}, usage }; }
      if (signal?.timeout <= 8000) throw new Error('simulated deadline');
      now += 8000; return { parsed:modelAnswer(['A','B']),usage };
    }, false, { Date:{now:()=>now}, AbortSignal:{timeout:ms=>({timeout:ms})} });
    const r=await answer({query:'표지판을 어디에 놓나요?',sops:pair});
    withheld(r); assert.equal(r.rejected,'answer_failed'); assert.ok(now<12000);
  });
  await test('exhausted multi-source deadline starts no answer call', async () => {
    let now=0, calls=0;
    const {answer}=loadAnswer(async (_p,schema)=>{ calls++; now=10000; return {parsed:schema.properties?.status?{status:'consistent'}:modelAnswer(['A','B']),usage}; },false,{Date:{now:()=>now},AbortSignal:{timeout:ms=>({timeout:ms})}});
    withheld(await answer({query:'表지판을 어디에 놓나요?',sops:pair})); assert.equal(calls,1);
  });
  console.log(JSON.stringify({ mode: 'mocked model; actual handler/filters', sha256, pass, fail, skip: 0 }));
  if (fail) process.exitCode = 1;
}
async function live() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required; no keys loaded or copied by this script');
  const input = process.argv[3], output = process.argv[4];
  if (!input || !output) throw new Error('Usage: node scripts/qa-audit-ai-answer.cjs --live evaluation-set.json output.json');
  const cases = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '')).cases;
  cases.push({ id:'EVAL-07', category:'조건이 다른 다중 근거', query:'라떼 우유량은 얼마인가요?', sops:[sop('qa-hot','따뜻한 라떼 주문','우유 180 ml를 넣는다'),sop('qa-cold','아이스 라떼 주문','우유 120 ml를 넣는다')] });
  const handler = loadAnswer(undefined, true);
  const report = { mode:'local modified handler, real model, no Edge deployment/auth/DB', sha256, planned:cases.length, results:[] };
  for (const c of cases) {
    try { report.results.push({ id:c.id, category:c.category, response:await handler.answer({query:c.query,sops:c.sops}), status:'returned' }); }
    catch { report.results.push({ id:c.id, category:c.category, status:'failed', error:'model_or_parse_error' }); }
    fs.writeFileSync(output, JSON.stringify({...report,modelCalls:handler.calls()},null,2));
  }
  console.log(JSON.stringify({ output, planned:cases.length, returned:report.results.filter(r=>r.status==='returned').length, modelCalls:handler.calls() }));
  if(report.results.some(r=>r.status==='failed')) process.exitCode=1;
}
(process.argv[2] === '--live' ? live() : regression()).catch(() => { console.error('QA execution failed; inspect setup without exposing credentials'); process.exitCode=1; });
