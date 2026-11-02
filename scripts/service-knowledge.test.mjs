import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { check, changedFiles, codeState, diagram, identity, impact, inventory, main, runs, safePath, snapshot, sourceFiles, verify } from './service-knowledge.mjs';

const featureFile = 'docs/ai-knowledge/features/suggestion.json';
const baselineFile = 'docs/ai-knowledge/baseline.json';
const write = (root, file, value) => {
  const p = join(root, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};
const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const evidence = (id, file, symbol, kind = 'code') => ({ id, file, symbol, kind });
const node = (id, name, evidenceId, changeKinds, aliases = []) => ({ id, name, type: 'operation', current: `${name} is observed in fixture code.`, evidence: [evidenceId], changeKinds, aliases });
const edge = (id, from, to, evidenceId, kinds) => ({ id, from, to, relation: 'calls', when: 'The suggestion was stored successfully', confidence: 'confirmed-code', evidence: [evidenceId], kinds });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'squaretable-knowledge-test-'));
  t.after(async () => {
    // Delete only the directory returned by mkdtemp, after checking the absolute boundary.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('squaretable-knowledge-test-'));
    await rm(root, { recursive: true, force: true });
  });
  write(root, '.gitignore', 'docs/ai-knowledge/baseline.json\ndocs/ai-knowledge/runs/\ndocs/ai-knowledge/discovery.json\n');
  write(root, 'package.json', { name: 'knowledge-fixture', private: true });
  write(root, 'src/app/junior/suggest.tsx', 'export default function SuggestScreen() { return null; }\n');
  write(root, 'src/lib/suggestions.ts', "export function createSuggestion(db) { return db.rpc('submit_suggestion'); }\nexport function selectRecipients(db) { return db.from('notifications'); }\n");
  write(root, 'src/lib/labels.ts', "export const suggestionLabel = '제안 보내기';\n");
  write(root, 'src/lib/stores.ts', "export function listStores(db) { return db.from('stores'); }\n");
  write(root, 'supabase/functions/push/index.ts', "export const handlePush = { type: 'suggestion_created' };\n");
  write(root, 'scripts/fixture-regression.mjs', 'export const fixtureRegression = true;\n');
  write(root, featureFile, {
    schemaVersion: 1, id: 'suggestion', name: '노하우 제안', aliases: ['직원 제안', 'suggest knowhow'],
    evidence: [
      evidence('ui', 'src/app/junior/suggest.tsx', 'SuggestScreen'),
      evidence('db', 'src/lib/suggestions.ts', 'createSuggestion'),
      evidence('recipient', 'src/lib/suggestions.ts', 'selectRecipients'),
      evidence('push', 'supabase/functions/push/index.ts', 'handlePush'),
      evidence('label', 'src/lib/labels.ts', 'suggestionLabel'),
    ],
    nodes: [
      node('screen', '제안 입력', 'ui', ['contract']),
      node('save', '제안 저장', 'db', ['contract', 'field'], ['submit_suggestion', 'API:submit_suggestion']),
      node('recipients', '수신자 결정', 'recipient', ['recipient', 'field'], ['notifications.recipient_id']),
      node('push', '푸시 요청', 'push', ['recipient', 'contract'], ['suggestion_created']),
      node('copy', '버튼 문구', 'label', ['copy']),
    ],
    edges: [edge('input-save', 'screen', 'save', 'db', ['contract']), edge('save-recipient', 'save', 'recipients', 'recipient', ['recipient', 'field']), edge('recipient-push', 'recipients', 'push', 'push', ['recipient'])],
    flow: [{ node: 'screen', next: 'save' }, { node: 'save', next: 'recipients' }],
    tests: [{ id: 'fixture-test', file: 'scripts/fixture-regression.mjs', scope: 'Fixture only, not a product test' }],
    desired: { status: 'unconfirmed', decisionsNeeded: ['Who should receive the event?'] },
    unknowns: ['Device delivery unverified'], findings: [],
  });
  write(root, 'docs/ai-knowledge/features/store-list.json', {
    schemaVersion: 1, id: 'store-list', name: '매장 목록', aliases: ['stores'],
    evidence: [evidence('stores', 'src/lib/stores.ts', 'listStores')],
    nodes: [node('stores', '매장 조회', 'stores', ['contract'], ['stores'])], edges: [],
    unknowns: [], tests: [],
  });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Knowledge fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'add', '.');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Deterministic fixture');
  write(root, baselineFile, snapshot(root));
  return root;
}

test('a reviewed snapshot passes only the structure and freshness gate', t => {
  const root = fixture(t);
  assert.deepEqual(changedFiles(root), []);
  const result = check(root);
  assert.equal(result.status, 'pass');
  assert.equal(result.features, 2);
  assert.deepEqual(result.errors, []);
  assert.match(result.scope, /does not validate product behavior/);
});

test('uncommitted evidence changes are stale even when HEAD stays identical', t => {
  const root = fixture(t), before = identity(root).head;
  appendFileSync(join(root, 'src/lib/suggestions.ts'), '\n// A rule was changed without a commit.\n');
  const result = check(root);
  assert.equal(identity(root).head, before);
  assert.equal(result.status, 'review-needed');
  assert.ok(result.drift.evidence.includes('src/lib/suggestions.ts'));
  assert.ok(result.drift.modified.includes('src/lib/suggestions.ts'));
});

test('deleted and renamed evidence both fail and expose deleted sources', async t => {
  for (const action of ['delete', 'rename']) await t.test(action, async st => {
    const root = fixture(st), original = join(root, 'src/lib/suggestions.ts');
    if (action === 'delete') await rm(original);
    else renameSync(original, join(root, 'src/lib/renamed.ts'));
    const result = check(root);
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some(e => e.includes('missing evidence file src/lib/suggestions.ts')));
    assert.ok(result.drift.deleted.includes('src/lib/suggestions.ts'));
    if (action === 'rename') assert.ok(result.drift.added.includes('src/lib/renamed.ts'));
  });
});

test('invalid graph structure and anchors are rejected independently', async t => {
  const root = fixture(t), original = readJson(root, featureFile);
  const cases = [
    ['edge endpoint', f => { f.edges[0].to = 'absent'; }, /broken edge/],
    ['evidence reference', f => { f.nodes[0].evidence = ['absent']; }, /broken evidence reference/],
    ['anchor', f => { f.evidence[0].symbol = 'nonexistent_symbol'; }, /missing anchor/],
    ['node id', f => { f.nodes.push(structuredClone(f.nodes[0])); }, /duplicate\/missing node/],
    ['edge id', f => { f.edges.push(structuredClone(f.edges[0])); }, /duplicate\/missing edge/],
    ['evidence id', f => { f.evidence.push(structuredClone(f.evidence[0])); }, /duplicate\/missing evidence/],
    ['flow endpoint', f => { f.flow[0].node = 'absent'; }, /broken flow node/],
  ];
  for (const [name, mutate, expected] of cases) await t.test(name, () => {
    const f = structuredClone(original);
    mutate(f); write(root, featureFile, f);
    const result = check(root);
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some(e => expected.test(e)), result.errors.join('\n'));
  });
});

test('duplicate feature ids fail even when held in separate files', t => {
  const root = fixture(t);
  write(root, 'docs/ai-knowledge/features/duplicate.json', readJson(root, featureFile));
  assert.ok(check(root).errors.some(e => e.includes('duplicate/missing feature id')));
});

test('new source and a new call in existing source produce drift and unconfirmed candidates', t => {
  const root = fixture(t);
  write(root, 'src/lib/new-feature.ts', "export const added = db.rpc('new_request');\n");
  appendFileSync(join(root, 'src/lib/suggestions.ts'), "\nexport const followup = db.rpc('new_followup');\n");
  const result = check(root), candidates = inventory(root).candidates;
  assert.equal(result.status, 'review-needed');
  assert.ok(result.drift.added.includes('src/lib/new-feature.ts'));
  assert.ok(result.drift.modified.includes('src/lib/suggestions.ts'));
  assert.ok(result.unmapped.includes('src/lib/new-feature.ts'));
  for (const name of ['new_request', 'new_followup']) {
    const found = candidates.find(c => c.name === name);
    assert.equal(found?.kind, 'rpc-call');
    assert.equal(found?.status, 'candidate');
  }
});

test('Git impact sees staged, unstaged, and untracked source changes', t => {
  const root = fixture(t);
  appendFileSync(join(root, 'src/lib/suggestions.ts'), '\n// staged\n');
  git(root, 'add', 'src/lib/suggestions.ts');
  appendFileSync(join(root, 'src/lib/stores.ts'), '\n// unstaged\n');
  write(root, 'src/lib/new.ts', "db.rpc('untracked_request');\n");
  assert.deepEqual(changedFiles(root), ['src/lib/new.ts', 'src/lib/stores.ts', 'src/lib/suggestions.ts']);
  const result = impact(root, '--git');
  assert.deepEqual(result.results.map(r => r.feature).sort(), ['store-list', 'suggestion']);
  assert.ok(result.candidates.some(c => c.name === 'untracked_request'));
});

test('Git impact does not lose a staged edit canceled in the working tree', t => {
  const root = fixture(t), file = 'src/lib/suggestions.ts', original = readFileSync(join(root, file));
  appendFileSync(join(root, file), '\n// index differs\n');
  git(root, 'add', file);
  writeFileSync(join(root, file), original);
  assert.deepEqual(changedFiles(root), [file]);
  assert.ok(impact(root, '--git').results.some(r => r.feature === 'suggestion'));
});

test('human aliases, files, functions, APIs, fields, and events resolve evidence', t => {
  const root = fixture(t);
  for (const term of ['직원 제안', 'src/lib/suggestions.ts', 'createSuggestion', 'submit_suggestion', 'notifications.recipient_id', 'suggestion_created']) {
    const result = impact(root, term);
    assert.equal(result.status, 'review-code-before-use', term);
    const feature = result.results.find(r => r.feature === 'suggestion');
    assert.ok(feature, term);
    assert.ok(feature.directCandidates.some(n => n.evidence.some(e => e?.file && e.symbol)), term);
  }
});

test('recipient changes exclude an unrelated feature and disconnected copy-only node', t => {
  const root = fixture(t), result = impact(root, '노하우 제안', 'recipient');
  assert.deepEqual(result.results.map(r => r.feature), ['suggestion']);
  const feature = result.results[0];
  assert.deepEqual(feature.directCandidates.map(n => n.id).sort(), ['push', 'recipients']);
  assert.ok(![...feature.directCandidates, ...feature.verifyCandidates].some(n => n.id === 'copy'));
  assert.ok(feature.verifyCandidates.some(n => n.id === 'save'));
  assert.ok(feature.paths.every(p => p.evidence.length && p.when && p.from && p.to));
  assert.deepEqual(feature.decisionsNeeded, ['Who should receive the event?']);
});

test('an unknown relation remains not-mapped with a discovery fallback', t => {
  const root = fixture(t);
  write(root, 'src/lib/unreviewed.ts', "db.rpc('unknown_contract');\n");
  const result = impact(root, 'unknown_contract');
  assert.equal(result.status, 'not-mapped');
  assert.deepEqual(result.results, []);
  assert.ok(result.candidates.some(c => c.name === 'unknown_contract' && c.status === 'candidate'));
  assert.equal(impact(root, 'this_does_not_exist').status, 'not-mapped');
});

// 기준점은 커밋되어 모든 체크아웃이 같이 쓴다(2026-11-02). 경로가 달라도 같은 코드면 통과해야 한다.
test('a checkout at another path reuses the snapshot without recording the path', async t => {
  const root = fixture(t);
  const target = join(root, 'copied-checkout');
  mkdirSync(target);
  for (const p of ['.git', '.gitignore', 'package.json', 'src', 'supabase', 'scripts', 'docs']) await cp(join(root, p), join(target, p), { recursive: true });
  assert.equal(snapshot(root).identity.root, undefined);
  const result = check(target);
  assert.ok(!result.warnings.some(w => w.startsWith('Snapshot root differs:')), result.warnings.join('\n'));
});

test('branch and HEAD changes invalidate a snapshot independently', async t => {
  for (const which of ['branch', 'head']) await t.test(which, async st => {
    const root = fixture(st);
    if (which === 'branch') git(root, 'checkout', '-qb', 'another-branch');
    else git(root, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Another HEAD');
    const result = check(root);
    assert.equal(result.status, 'review-needed');
    assert.ok(result.warnings.some(w => w.startsWith(`Snapshot ${which} differs:`)), result.warnings.join('\n'));
  });
});

test('refresh requires review and preserves desired behavior and change records', async t => {
  const root = fixture(t), desiredBefore = readFileSync(join(root, featureFile));
  const changeFile = 'docs/ai-knowledge/changes/recipient-change.md';
  write(root, changeFile, 'User decision remains pending. Do not implement.\n');
  const changeBefore = readFileSync(join(root, changeFile));
  await assert.rejects(main(['refresh'], root), /reviewed/);
  const log = console.log;
  try { console.log = () => {}; await main(['refresh', '--reviewed'], root); } finally { console.log = log; }
  assert.deepEqual(readFileSync(join(root, featureFile)), desiredBefore);
  assert.deepEqual(readFileSync(join(root, changeFile)), changeBefore);
  assert.equal(check(root).status, 'pass');
});

test('diagrams refer only to declared node identifiers', t => {
  const root = fixture(t), text = diagram(root, 'suggestion');
  assert.ok(text.startsWith('flowchart LR\n'));
  const declared = new Set([...text.matchAll(/^\s+(n\d+)\[/gm)].map(m => m[1]));
  const links = [...text.matchAll(/^\s+(n\d+) -->\|[^\n]+\| (n\d+)$/gm)];
  assert.equal(declared.size, 5);
  assert.equal(links.length, 3);
  assert.ok(links.every(m => declared.has(m[1]) && declared.has(m[2])));
  assert.ok(!text.includes('undefined'));
});

test('discovery excludes environment, generated, dependency, and local backend state files', t => {
  const root = fixture(t);
  for (const file of ['.env', '.env.seed', 'supabase/.temp/config.ts', 'src/node_modules/private.ts', '.claude/settings.local.json']) write(root, file, "db.rpc('must_not_be_indexed');\n");
  const found = inventory(root);
  assert.ok(!found.candidates.some(c => c.name === 'must_not_be_indexed'));
  assert.ok(!sourceFiles(root).some(p => /\.env|node_modules|\.temp|settings\.local/.test(p)));
  assert.throws(() => safePath(root, '../outside.ts'), /Unsafe path/);
  assert.throws(() => safePath(root, resolve(root, 'src/lib/stores.ts')), /Unsafe path/);
});

test('execution receipts reject failures, stale passes, and an unsupported pass claim', t => {
  const root = fixture(t), runner = 'scripts/service-knowledge.test.mjs';
  write(root, runner, "import test from 'node:test'; import { writeFileSync } from 'node:fs'; test('fixture pass', () => { writeFileSync('fixture-ran.txt', 'executed'); });\n");
  const passed = verify(root, 'tools');
  assert.equal(passed.status, 'pass');
  assert.equal(passed.exitCode, 0);
  assert.equal(runs(root).find(r => r.file === passed.file)?.appliesToCurrentState, true);
  const measured = readJson(root, passed.file);
  assert.equal(measured.codeState.digest, codeState(root).digest);
  assert.equal(readFileSync(join(root, 'fixture-ran.txt'), 'utf8'), 'executed');
  const changeFile = 'docs/ai-knowledge/changes/proof-scope.json';
  const change = {
    requirements: [{ id: 'r1', source: 'Approved fixture requirement', status: 'approved' }],
    tasks: [{ id: 't1', status: 'completed', requirements: ['r1'], targets: [{ feature: 'suggestion', node: 'recipients' }], dependsOn: [], acceptance: 'The requested verification has executable evidence', verification: 'Run the fixture harness', verificationCheck: 'tools', verificationLevel: 'pure-code', run: passed.file }],
  };
  write(root, changeFile, change);
  assert.ok(check(root).errors.some(e => e.includes('tooling proof cannot verify product task')));
  change.tasks[0].verificationLevel = 'tooling';
  write(root, changeFile, change);
  assert.equal(check(root).status, 'pass');
  change.tasks[0].verificationCheck = 'records';
  write(root, changeFile, change);
  assert.ok(check(root).errors.some(e => e.includes('verificationCheck does not match its run')));
  change.tasks[0].verificationCheck = 'tools';
  write(root, changeFile, change);
  appendFileSync(join(root, 'src/lib/suggestions.ts'), '\n// code changed after execution\n');
  assert.equal(runs(root).find(r => r.file === passed.file)?.appliesToCurrentState, false);
  assert.equal(runs(root).find(r => r.file === passed.file)?.sameCodeState, false);
  write(root, runner, "import test from 'node:test'; test('fixture failure', () => { throw new Error('expected fixture failure'); });\n");
  const failed = verify(root, 'tools');
  assert.equal(failed.status, 'fail');
  assert.notEqual(failed.exitCode, 0);
  assert.equal(runs(root).find(r => r.file === failed.file)?.appliesToCurrentState, false);
  assert.equal(runs(root).find(r => r.file === failed.file)?.sameCodeState, true);
  write(root, 'docs/ai-knowledge/runs/claim.json', { name: 'claim', status: 'pass', text: 'AI says everything passed.' });
  assert.ok(!runs(root).some(r => r.name === 'claim' && r.appliesToCurrentState));
});

test('development tasks cannot hide broken references, cycles, or unverified completion', async t => {
  const root = fixture(t), file = 'docs/ai-knowledge/changes/recipient-change.json';
  const original = {
    requirements: [{ id: 'r1', source: 'Hypothetical fixture request', status: 'unconfirmed' }],
    tasks: [{ id: 't1', status: 'planned', requirements: ['r1'], targets: [{ feature: 'suggestion', node: 'recipients' }], dependsOn: [], acceptance: 'Approved recipient selection has defined expected results', verification: 'Run a local recipient matrix after approval' }],
  };
  write(root, file, original);
  assert.equal(check(root).status, 'pass');
  const cases = [
    ['broken references', c => { c.tasks[0].requirements = ['missing']; c.tasks[0].targets[0].node = 'missing'; c.tasks[0].dependsOn = ['missing']; }, ['broken requirement', 'broken task target', 'missing dependency']],
    ['dependency cycle', c => { c.tasks[0].dependsOn = ['t2']; c.tasks.push({ ...structuredClone(c.tasks[0]), id: 't2', dependsOn: ['t1'] }); }, ['task dependency cycle']],
    ['unapproved completion', c => { c.tasks[0].status = 'completed'; }, ['unapproved requirements', 'no current executable proof']],
    ['approved but unverified completion', c => { c.requirements[0].status = 'approved'; c.tasks[0].status = 'completed'; }, ['no current executable proof']],
  ];
  for (const [name, mutate, messages] of cases) await t.test(name, () => {
    const change = structuredClone(original);
    mutate(change); write(root, file, change);
    const result = check(root);
    assert.equal(result.status, 'fail');
    for (const message of messages) assert.ok(result.errors.some(e => e.includes(message)), result.errors.join('\n'));
  });
});
