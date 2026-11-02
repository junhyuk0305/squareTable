// Local code evidence index. No network, credentials, database, or product writes.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = 'docs/ai-knowledge';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const slash = (s) => s.replaceAll('\\', '/');
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const json = (p) => JSON.parse(read(p));
const save = (p, value) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); };
const digest = (p) => existsSync(p) ? sha(readFileSync(p)) : null;
const git = (root, ...args) => {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.error?.message || r.stderr.trim()}`);
  return r.stdout.trimEnd();
};
export function safePath(root, file) {
  if (typeof file !== 'string' || isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error(`Unsafe path: ${file}`);
  const target = resolve(root, file);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Outside repository: ${file}`);
  return target;
}
export function walk(root, dir) {
  const p = safePath(root, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink() || ['node_modules', '.git', '.temp', '.branches', '.expo'].includes(e.name)) return [];
    const f = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(root, f) : [f];
  }).sort();
}
// Deliberate source allowlist. Never inspect .env, local DB state, keys, user data or generated native builds.
export function sourceFiles(root) {
  return [...['src', 'supabase/migrations', 'supabase/functions', 'public', '.github/workflows']
    .flatMap(p => walk(root, p)).filter(p => /\.(?:[cm]?[jt]sx?|sql|html|ya?ml)$/.test(p)),
  ...['app.json', 'eas.json', 'vercel.json', 'package.json', 'supabase/config.toml'].filter(p => existsSync(join(root, p)))].sort();
}
export function identity(root) {
  return { root: slash(git(root, 'rev-parse', '--show-toplevel')), head: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'branch', '--show-current'), node: process.version, platform: process.platform };
}
export function changedFiles(root) {
  // Both index and working tree, plus untracked. No porcelain quoting or rename parsing ambiguity.
  return [...new Set([
    ...git(root, 'diff', '--cached', '--name-only', '-z', '--').split('\0'),
    ...git(root, 'diff', '--name-only', '-z', '--').split('\0'),
    ...git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')
  ].filter(Boolean))].sort();
}
export function loadFeatures(root) {
  return walk(root, `${DATA}/features`).filter(p => p.endsWith('.json')).map(p => ({ ...json(join(root, p)), recordFile: p }));
}
export function inventory(root) {
  const candidates = [];
  const add = (file, kind, name, anchor, line) => candidates.push({ file, kind, name, anchor, line, status: 'candidate' });
  const patterns = [
    ['rpc-call', /\.rpc(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g],
    ['table-access', /\.from\(\s*['"]([^'"]+)['"]/g],
    ['edge-call', /\.functions\.invoke\(\s*['"]([^'"]+)['"]/g],
    ['sql-function', /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?["']?([a-z_][a-z_0-9]*)/gi],
    ['sql-table', /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z_0-9]*)/gi],
    ['sql-trigger', /create\s+(?:or\s+replace\s+)?trigger\s+([a-z_][a-z_0-9]*)/gi],
    ['sql-policy', /create\s+policy\s+["']?([a-z_][a-z_0-9]*)/gi],
    ['scheduled-job', /cron\.schedule\(\s*['"]([^'"]+)['"]/g],
    ['event-name', /(?:tag|type):\s*['"]([^'"]+)['"]/g],
  ];
  for (const file of sourceFiles(root)) {
    const s = read(join(root, file));
    if (/^src\/app\/.*\.tsx$/.test(file) && !/\/(?:_layout|\+html)\.tsx$/.test(file)) {
      add(file, 'route', file.replace(/^src\/app/, '').replace(/\.tsx$/, '').replace(/\/index$/, '') || '/', 'default', 1);
    }
    if (/^supabase\/functions\/[^/]+\/index\.ts$/.test(file)) add(file, 'edge-entry', file.split('/')[2], 'index.ts', 1);
    for (const [kind, re] of patterns) {
      re.lastIndex = 0;
      for (const m of s.matchAll(re)) add(file, kind, m[1], m[0], s.slice(0, m.index).split('\n').length);
    }
  }
  return { generatedAt: new Date().toISOString(), identity: identity(root), candidates,
    limitations: ['문자열 기반 후보 추출. 주석/과거 SQL도 포함하며 호출 순서/권한을 증명하지 않음.',
      '동적 SQL/동적 테이블명/원격 설정/생성 코드/별도 저장소는 완전 추출하지 못함.',
      '최신 SQL 정의와 이후 ALTER/GRANT/DROP을 실제 코드에서 재확인해야 함.'],
    screenRegistry: existsSync(join(root, 'scripts/ia-screens.json')) ? 'scripts/ia-screens.json' : null };
}
export function snapshot(root) {
  const features = loadFeatures(root);
  const evidenceFiles = [...new Set(features.flatMap(f => (f.evidence || []).map(e => e.file)))];
  // 기준점은 저장소에 커밋된다. 체크아웃 경로는 PC마다 달라 남기지 않는다.
  const { root: _root, ...id } = identity(root);
  return { capturedAt: new Date().toISOString(), identity: id,
    sources: Object.fromEntries(sourceFiles(root).map(p => [p, digest(join(root, p))])),
    evidence: Object.fromEntries(evidenceFiles.map(p => [p, digest(safePath(root, p))])),
    records: Object.fromEntries(features.map(f => [f.recordFile, digest(join(root, f.recordFile))])) };
}
export function check(root) {
  const errors = [], warnings = [], features = loadFeatures(root), featureIds = new Set();
  for (const f of features) {
    if (!f.id || featureIds.has(f.id)) errors.push(`duplicate/missing feature id: ${f.id}`);
    featureIds.add(f.id);
    if (f.schemaVersion !== 1 || !f.name || !Array.isArray(f.nodes) || !Array.isArray(f.evidence) || !Array.isArray(f.edges)) {
      errors.push(`${f.id}: invalid schema`); continue;
    }
    const ev = new Map(), nodes = new Set(), edgeIds = new Set();
    for (const e of f.evidence) {
      if (!e.id || ev.has(e.id)) errors.push(`${f.id}: duplicate/missing evidence ${e.id}`);
      ev.set(e.id, e);
      try {
        const p = safePath(root, e.file);
        if (!existsSync(p)) errors.push(`${f.id}: missing evidence file ${e.file}`);
        else if (!e.symbol || !read(p).includes(e.symbol)) errors.push(`${f.id}: missing anchor ${e.file}#${e.symbol}`);
      } catch (e) { errors.push(e.message); }
      if (!['code', 'test', 'config'].includes(e.kind)) errors.push(`${f.id}: invalid evidence kind ${e.kind}`);
    }
    const refs = (item) => {
      if (!Array.isArray(item.evidence) || !item.evidence.length) errors.push(`${f.id}/${item.id || 'transition'}: no evidence`);
      for (const id of item.evidence || []) if (!ev.has(id)) errors.push(`${f.id}: broken evidence reference ${id}`);
    };
    for (const n of f.nodes) {
      if (!n.id || nodes.has(n.id)) errors.push(`${f.id}: duplicate/missing node ${n.id}`);
      nodes.add(n.id); refs(n);
      if (!n.type || !n.name || !n.current) errors.push(`${f.id}/${n.id}: missing node content`);
    }
    for (const e of f.edges) {
      if (!e.id || edgeIds.has(e.id)) errors.push(`${f.id}: duplicate/missing edge ${e.id}`);
      edgeIds.add(e.id); refs(e);
      if (!nodes.has(e.from) || !nodes.has(e.to)) errors.push(`${f.id}: broken edge ${e.id}`);
      if (!e.relation || !e.when || !['confirmed-code', 'inferred'].includes(e.confidence)) errors.push(`${f.id}: incomplete edge ${e.id}`);
    }
    for (const step of f.flow || []) if (!nodes.has(step.node)) errors.push(`${f.id}: broken flow node ${step.node}`);
    for (const t of f.transitions || []) refs(t);
    for (const t of f.tests || []) if (!existsSync(safePath(root, t.file))) errors.push(`${f.id}: missing test ${t.file}`);
  }
  if (!features.length) errors.push('No reviewed features. Discovery candidates do not count as feature knowledge.');
  for (const file of walk(root, `${DATA}/changes`).filter(p => p.endsWith('.json'))) {
    const change = json(join(root, file)), reqs = new Map(), tasks = new Map();
    for (const r of change.requirements || []) {
      if (!r.id || reqs.has(r.id) || !r.source || !['unconfirmed', 'approved', 'rejected'].includes(r.status)) errors.push(`${file}: invalid requirement ${r.id}`);
      reqs.set(r.id, r);
    }
    for (const t of change.tasks || []) {
      if (!t.id || tasks.has(t.id) || !t.acceptance || !t.verification || !t.requirements?.length) errors.push(`${file}: incomplete task ${t.id}`);
      tasks.set(t.id, t);
      for (const id of t.requirements || []) if (!reqs.has(id)) errors.push(`${file}: broken requirement ${id}`);
      for (const target of t.targets || []) if (!features.find(f => f.id === target.feature)?.nodes.some(n => n.id === target.node)) errors.push(`${file}: broken task target ${target.feature}/${target.node}`);
      if (['completed', 'verified', 'implemented'].includes(t.status)) {
        if ((t.requirements || []).some(id => reqs.get(id)?.status !== 'approved')) errors.push(`${file}: completed task ${t.id} has unapproved requirements`);
        const proof = runs(root).find(r => r.file === t.run);
        if (!proof?.appliesToCurrentState) errors.push(`${file}: completed task ${t.id} has no current executable proof`);
        if (!t.verificationCheck || proof?.name !== t.verificationCheck) errors.push(`${file}: task ${t.id} verificationCheck does not match its run`);
        if (!['tooling', 'static', 'pure-code'].includes(t.verificationLevel)) errors.push(`${file}: task ${t.id} needs an explicit supported verificationLevel; runtime/device completion is not certified by this runner`);
        if (['tools', 'records'].includes(proof?.name) && t.verificationLevel !== 'tooling') errors.push(`${file}: tooling proof cannot verify product task ${t.id}`);
      }
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      if (visiting.has(id)) { errors.push(`${file}: task dependency cycle ${id}`); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of tasks.get(id)?.dependsOn || []) {
        if (!tasks.has(dep)) errors.push(`${file}: missing dependency ${dep}`); else visit(dep);
      }
      visiting.delete(id); visited.add(id);
    };
    for (const id of tasks.keys()) visit(id);
  }
  const baselinePath = join(root, DATA, 'baseline.json');
  const drift = { added: [], modified: [], deleted: [], evidence: [], records: [] };
  if (!existsSync(baselinePath)) warnings.push('No baseline. Run refresh --reviewed only after code review.');
  else {
    const base = json(baselinePath), now = snapshot(root);
    for (const key of ['head', 'branch']) if (base.identity[key] !== now.identity[key]) warnings.push(`Snapshot ${key} differs: ${base.identity[key]} -> ${now.identity[key]}`);
    for (const p of Object.keys(now.sources)) {
      if (!(p in base.sources)) drift.added.push(p);
      else if (now.sources[p] !== base.sources[p]) drift.modified.push(p);
    }
    for (const p of Object.keys(base.sources)) if (!(p in now.sources)) drift.deleted.push(p);
    for (const [p, hash] of Object.entries(base.evidence)) if (digest(safePath(root, p)) !== hash) drift.evidence.push(p);
    for (const p of new Set([...Object.keys(base.records), ...Object.keys(now.records)])) if (base.records[p] !== now.records[p]) drift.records.push(p);
    if (Object.values(drift).some(a => a.length)) warnings.push('Stale or unreviewed code/record changes. Inspect discovery and actual code before refreshing.');
  }
  const changes = changedFiles(root);
  const referenced = new Set(features.flatMap(f => f.evidence.map(e => e.file)));
  const unmapped = changes.filter(p => sourceFiles(root).includes(p) && !referenced.has(p));
  if (unmapped.length) warnings.push('Git changes outside reviewed evidence; no relation does not mean no impact.');
  return { status: errors.length ? 'fail' : warnings.length ? 'review-needed' : 'pass', errors, warnings, drift, unmapped,
    features: features.length, gitChanges: changes, identity: identity(root),
    scope: 'Record structure and local freshness only. This does not validate product behavior.' };
}
const normalized = (s) => String(s).toLowerCase().replaceAll('\\', '/').trim();
const includes = (s, q) => normalized(s).includes(q);
export function impact(root, query, kind = 'unknown') {
  const kinds = ['unknown', 'recipient', 'field', 'contract', 'copy'];
  if (!kinds.includes(kind)) throw new Error(`Unknown change kind: ${kind}. Use ${kinds.join(', ')}`);
  const isGit = query === '--git', files = isGit ? changedFiles(root) : [], q = normalized(query);
  if (!q) throw new Error('Query is required');
  const results = [];
  for (const f of loadFeatures(root)) {
    const evidence = new Map(f.evidence.map(e => [e.id, e]));
    const whole = !isGit && [f.id, f.name, ...f.aliases].some(v => includes(v, q));
    const matches = f.nodes.filter(n => whole || (!isGit && [n.id, n.name, ...n.aliases].some(v => includes(v, q))) ||
      n.evidence.some(id => { const e = evidence.get(id); return e && (isGit ? files.includes(e.file) :
        [e.file, e.symbol, `${e.file}#${e.symbol}`].some(v => includes(v, q))); }));
    if (!matches.length) continue;
    const direct = matches.filter(n => kind === 'unknown' || (n.changeKinds || []).includes(kind));
    const relevant = f.edges.filter(e => kind === 'unknown' || (e.kinds || []).includes(kind));
    const seeds = whole && kind !== 'unknown' ? direct : matches;
    const reached = new Set(seeds.map(n => n.id)), paths = [], queue = seeds.map(n => ({ id: n.id, path: [], depth: 0 }));
    while (queue.length) {
      const cur = queue.shift();
      if (cur.depth >= 3) continue;
      for (const e of relevant.filter(e => e.from === cur.id || e.to === cur.id)) {
        const next = e.from === cur.id ? e.to : e.from;
        const path = [...cur.path, e.id];
        if (!paths.some(p => p.edge === e.id)) paths.push({ edge: e.id, from: e.from, to: e.to, relation: e.relation,
          when: e.when, confidence: e.confidence, path, evidence: e.evidence.map(id => evidence.get(id)) });
        if (!reached.has(next)) { reached.add(next); queue.push({ id: next, path, depth: cur.depth + 1 }); }
      }
    }
    // Edges describe verification dependencies, not permission to edit every connected node.
    results.push({ feature: f.id, name: f.name, record: f.recordFile, directCandidates: direct.map(n => ({ ...n, evidence: n.evidence.map(id => evidence.get(id)) })),
      verifyCandidates: f.nodes.filter(n => reached.has(n.id) && !direct.includes(n)).map(n => ({ ...n, evidence: n.evidence.map(id => evidence.get(id)) })),
      paths, tests: f.tests, unknowns: f.unknowns, decisionsNeeded: f.desired?.decisionsNeeded || [],
      findings: f.findings, flow: f.flow, transitions: f.transitions });
  }
  const candidates = inventory(root).candidates.filter(c => isGit ? files.includes(c.file) : [c.name, c.file, c.anchor].some(v => includes(v, q))).slice(0, 60);
  return { query, kind, status: results.length ? 'review-code-before-use' : 'not-mapped', results, candidates,
    freshness: check(root), limitations: ['최대 3단계의 확인 후보. 관계 방향은 from/to에 보존한다. 검색 결과는 완전성을 증명하지 않는다.',
      '필드명과 조건이 기록에 없으면 상위 테이블/함수로 다시 검색하고 실제 코드를 읽는다.',
      '변경 종류 unknown은 보수적으로 반환한다. 연결된 모든 항목을 수정하라는 뜻이 아니다.',
      '공유 테이블만으로 기능 사이 영향을 자동 전파하지 않는다. 다른 기능 후보는 discovery에서 재확인한다.'] };
}
export function compactImpact(result) {
  return { query: result.query, kind: result.kind, status: result.status,
    results: result.results.map(f => ({ feature: f.feature, record: f.record,
      directCandidates: f.directCandidates.map(n => ({ id: n.id, name: n.name,
        evidence: n.evidence.map(e => `${e.file}#${e.symbol}`) })),
      verifyCandidates: f.verifyCandidates.map(n => ({ id: n.id, name: n.name, evidenceIds: n.evidence.map(e => e.id) })),
      paths: f.paths.map(p => ({ from: p.from, to: p.to, relation: p.relation, confidence: p.confidence, when: p.when, evidenceIds: p.evidence.map(e => e.id) })),
      tests: f.tests.map(t => ({ command: t.command, scope: t.scope })),
      unknowns: f.unknowns, decisionsNeeded: f.decisionsNeeded,
      details: `node scripts/service-knowledge.mjs show ${f.feature}` })),
    candidateCountShown: result.candidates.length,
    candidates: result.results.length ? '기록에 없는 연결은 discover로 재확인' : result.candidates.slice(0, 12),
    freshness: { status: result.freshness.status, errors: result.freshness.errors, warnings: result.freshness.warnings },
    limitations: result.limitations,
    note: 'evidenceIds는 record의 evidence 항목이다. 전체 설명/방향/관계 종류는 show 또는 query에 --full을 붙여 확인한다.' };
}
export function diagram(root, id) {
  const f = loadFeatures(root).find(f => f.id === id);
  if (!f) throw new Error(`Unknown feature: ${id}`);
  const ids = new Map(f.nodes.map((n, i) => [n.id, `n${i}`]));
  const label = s => s.replace(/["\[\]<>\r\n]/g, ' ');
  return 'flowchart LR\n' + f.nodes.map(n => `  ${ids.get(n.id)}["${label(n.name)}"]`).join('\n') + '\n' +
    f.edges.map(e => `  ${ids.get(e.from)} -->|"${label(e.relation)}"| ${ids.get(e.to)}`).join('\n');
}
export function codeState(root) {
  const files = [...sourceFiles(root), ...walk(root, 'scripts').filter(p => /\.(?:mjs|cjs|json)$/.test(p)),
    ...walk(root, '.claude').filter(p => !p.includes('settings.local') && /\.(md|mjs|json)$/.test(p)),
    ...walk(root, `${DATA}/features`)];
  const hashes = Object.fromEntries([...new Set(files)].sort().map(p => [p, digest(join(root, p))]));
  return { ...identity(root), digest: sha(JSON.stringify(hashes)), files: hashes };
}
export function verify(root, name) {
  const commands = {
    tools: [process.execPath, ['--test', 'scripts/service-knowledge.test.mjs']],
    records: [process.execPath, ['scripts/service-knowledge.mjs', 'check']],
    retrieval: [process.execPath, ['scripts/service-knowledge.eval.mjs']],
    'manager-routes': [process.execPath, ['scripts/qa-manager-routes.mjs']],
    'notif-axis': [process.execPath, ['scripts/qa-notif-axis.mjs']],
    'push-route': [process.execPath, ['scripts/qa-push-route.mjs']],
    'route-sync': [process.execPath, ['scripts/check-push-route-sync.mjs']],
    'session-readfail': [process.execPath, ['scripts/qa-session-readfail.mjs']],
    'iap-notes': [process.execPath, ['scripts/qa-iap-notes.mjs']],
    'quiz-owner-state': [process.execPath, ['scripts/qa-quiz-owner-state.mjs']],
    typecheck: [process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
    lint: [process.execPath, ['node_modules/expo/bin/cli', 'lint']],
  };
  if (!commands[name]) throw new Error(`Supported local checks: ${Object.keys(commands).join(', ')}. No arbitrary or live commands run here.`);
  const before = codeState(root), startedAt = new Date().toISOString();
  const [command, args] = commands[name];
  const env = { ...process.env, CI: '1' };
  // Node suppresses nested test runners when this inherited marker is present.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const after = codeState(root), stable = before.digest === after.digest;
  const record = { name, startedAt, finishedAt: new Date().toISOString(), command: ['node', ...args],
    exitCode: r.status, error: r.error?.message || null, status: r.status === 0 && stable ? 'pass' : 'fail', stable,
    codeState: before, stdout: r.stdout || '', stderr: r.stderr || '', scope: name === 'tools' ? 'Local harness regression tests' :
      name === 'records' ? 'Record structure and freshness' : `${name}: local static/pure-code check only; no DB/device delivery proof` };
  const file = `${DATA}/runs/${name}-${Date.now()}.json`; save(join(root, file), record);
  return { file, name, status: record.status, exitCode: record.exitCode, stable, codeDigest: before.digest };
}
export function runs(root) {
  const current = codeState(root);
  return walk(root, `${DATA}/runs`).filter(p => /\/(?:tools|records|retrieval|manager-routes|notif-axis|push-route|route-sync|session-readfail|iap-notes|quiz-owner-state|typecheck|lint)-\d+\.json$/.test(p)).flatMap(file => {
    const r = json(join(root, file));
    if (!r.command || !Object.hasOwn(r, 'exitCode')) return [];
    const sameCodeState = r.codeState?.digest === current.digest &&
      ['root', 'head', 'branch', 'node', 'platform'].every(k => r.codeState[k] === current[k]);
    const valid = r.exitCode === 0 && r.stable === true && r.status === 'pass' && sameCodeState;
    return [{ file, name: r.name, scope: r.scope, status: r.status, sameCodeState, appliesToCurrentState: valid, startedAt: r.startedAt }];
  });
}
export async function main(argv = process.argv.slice(2), root = ROOT) {
  const [command, ...args] = argv;
  let result;
  switch (command) {
    case 'list': result = loadFeatures(root).map(({ id, name, aliases, depth, unknowns }) => ({ id, name, aliases, depth, unknowns })); break;
    case 'show': result = loadFeatures(root).find(f => f.id === args[0]); if (!result) throw new Error('Feature not found'); break;
    case 'query': case 'impact': {
      const full = impact(root, args[0], args[1]?.startsWith('--') ? 'unknown' : args[1] || 'unknown');
      result = args.includes('--full') ? full : compactImpact(full); break;
    }
    case 'check': result = check(root); process.exitCode = result.status === 'fail' ? 1 : result.status === 'review-needed' ? 2 : 0; break;
    case 'discover': {
      const found = inventory(root);
      if (args.includes('--save')) save(join(root, DATA, 'discovery.json'), found);
      result = { ...found, candidates: args[0] && !args[0].startsWith('--') ? found.candidates.filter(c => includes(c.name, normalized(args[0])) || includes(c.file, normalized(args[0]))) : found.candidates,
        note: '자동 추출 후보는 features의 검토 기록을 덮어쓰지 않는다.' }; break;
    }
    case 'refresh': {
      if (!args.includes('--reviewed')) throw new Error('Read changed evidence and update records first, then refresh --reviewed. This does not prove behavior.');
      const c = check(root); if (c.errors.length) throw new Error(c.errors.join('\n'));
      save(join(root, DATA, 'baseline.json'), snapshot(root));
      result = { status: 'baseline-updated', behaviorVerified: false }; break;
    }
    case 'diagram': console.log(diagram(root, args[0])); return;
    case 'verify': result = verify(root, args[0]); if (result.status !== 'pass') process.exitCode = 1; break;
    case 'runs': result = runs(root); break;
    case 'hook': {
      let input = ''; for await (const chunk of process.stdin) input += chunk;
      const event = JSON.parse(input || '{}');
      // No block/continue decision: never traps Stop in a loop. Uses actual cwd, not originating checkout.
      const eventRoot = event.cwd ? git(event.cwd, 'rev-parse', '--show-toplevel') : root;
      if (resolve(eventRoot) !== resolve(root)) {
        console.log(JSON.stringify({ systemMessage: 'service-knowledge: cwd differs from installed checkout. Run the local check explicitly; this hook did not check that worktree.' })); return;
      }
      const c = check(root);
      result = { systemMessage: `service-knowledge ${c.status}: ${c.errors.length} record errors, ${c.warnings.length} freshness warnings. node scripts/service-knowledge.mjs check. Product behavior is not verified.` };
      const receipt = { event: event.hook_event_name, at: new Date().toISOString(), root: slash(root), status: c.status, errors: c.errors.length, warnings: c.warnings.length };
      save(join(root, DATA, 'runs', 'hook-last.json'), receipt); break;
    }
    default: result = { commands: ['list', 'show <feature-id>', 'query <term|--git> [unknown|recipient|field|contract|copy]',
      'impact <term|--git> [kind]', 'discover [term] [--save]', 'check', 'refresh --reviewed', 'diagram <feature-id>', 'verify tools|records', 'runs'],
    guide: `${DATA}/README.md` };
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`service-knowledge: ${error.message}`); process.exitCode = 1; });
}
