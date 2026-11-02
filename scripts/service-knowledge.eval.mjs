// Source-grounded retrieval oracle. Pilot cases were independently reviewed;
// expansion cases come from source readers and receive separate sample review.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, impact, sourceFiles, walk, codeState } from './service-knowledge.mjs';

const scenarios = [
  {
    name: '새 제안 수신자 변경', query: '노하우 제안', kind: 'recipient', baseline: /노하우 제안|notifyOwnersSuggestion/,
    required: [
      ['src/lib/push/notify.ts', 'notifyOwnersSuggestion'],
      ['supabase/functions/push/index.ts', "tag === 'suggestion'"],
      ['src/lib/utils/notifications.ts', 'function managerOwnerRows'],
      ['supabase/migrations/0339_work_assignment_server_push.sql', 'function public.push_client_event'],
      ['supabase/migrations/0093_manager_role.sql', 'create policy ps_update'],
      ['supabase/migrations/0315_manager_permissions.sql', 'function public.auth_can_manage'],
      ['supabase/migrations/0338_legacy_quiz_hub.sql', 'function public.my_units_notif_data'],
      ['src/lib/utils/roles.ts', 'MANAGER_OWNER_ROUTES'],
      ['src/lib/notif/registry.ts', 'suggestion:'],
      ['src/lib/push/pushTap.ts', 'pushTapPlan'],
      ['src/lib/config/store-policy.ts', 'WEB_PUSH_ENABLED = false'],
    ],
  },
  {
    name: '내 매장 역할 반환 계약', query: 'my_units.role', kind: 'contract', baseline: /my_units/,
    required: [
      ['supabase/migrations/0303_closed_store_server_block.sql', 'function public.my_units'],
      ['src/lib/db.ts', 'fetchMyUnits'],
      ['src/lib/store/useSessionStore.ts', 'loadProfile'],
      ['src/lib/store/sessionRole.ts', 'deriveStoreRole'],
      ['src/app/stores.tsx', 'StoresHub'],
    ],
  },
];
scenarios.push(...JSON.parse(readFileSync(join(ROOT, 'scripts/service-knowledge.scenarios.json'), 'utf8')));
const files = [...sourceFiles(ROOT), ...walk(ROOT, 'scripts').filter(p => /\.(?:mjs|cjs)$/.test(p) && !p.includes('service-knowledge'))];
const source = new Map(files.map(p => [p, readFileSync(join(ROOT, p), 'utf8')]));
const results = [];
for (const s of scenarios) {
  for (const [file, symbol] of s.required) assert.ok(source.get(file)?.includes(symbol), `Oracle source changed: ${file}#${symbol}`);
  const baseline = new RegExp(s.baseline);
  const before = files.filter(p => baseline.test(source.get(p)));
  const result = impact(ROOT, s.query, s.kind);
  const after = [...new Set(result.results.flatMap(f => [...f.directCandidates, ...f.verifyCandidates].flatMap(n => n.evidence.map(e => e.file))))];
  const required = s.required.map(([p]) => p);
  const measure = found => ({ requiredFound: required.filter(p => found.includes(p)), requiredMissing: required.filter(p => !found.includes(p)),
    nonRequiredCandidates: found.filter(p => !required.includes(p)), retrievedCount: found.length });
  const newResult = measure(after);
  assert.equal(newResult.requiredMissing.length, 0, `${s.name}: required evidence missing`);
  if (s.expectedFeature) assert.ok(result.results.some(f => f.feature === s.expectedFeature), `${s.name}: expected feature missing`);
  for (const id of s.forbiddenFeatures ?? []) assert.ok(!result.results.some(f => f.feature === id), `${s.name}: unrelated feature ${id}`);
  if (s.kind === 'recipient' && s.query === '노하우 제안') {
    assert.ok(!result.results.some(f => f.feature === 'store-list'), 'Shared membership does not imply store-list edit');
    const direct = result.results.flatMap(f => f.directCandidates.map(n => n.id));
    assert.deepEqual(direct.sort(), ['inapp', 'push-request', 'recipients', 'tests'].sort());
  }
  results.push({ scenario: s.name, query: s.query, kind: s.kind, oracle: s.required,
    expectedFeature: s.expectedFeature, forbiddenFeatures: s.forbiddenFeatures ?? [], before: measure(before), after: newResult });
}
const copy = impact(ROOT, '내 매장', 'copy');
assert.deepEqual(copy.results.find(f => f.feature === 'store-list').directCandidates.map(n => n.id), ['screen']);
assert.equal(impact(ROOT, 'not-a-reviewed-feature', 'unknown').status, 'not-mapped');
const report = { at: new Date().toISOString(), codeState: codeState(ROOT), status: 'pass', results,
  additionalCases: ['copy-only request targets screen, not DB', 'unmapped request does not claim no impact'],
  limits: ['Before is an explicitly defined literal search baseline, not a timed AI performance study.',
    'Non-required candidates are counted separately; not all are proven irrelevant.',
    'Required source anchors and unrelated-feature exclusions measure the listed scenarios, not exhaustive service coverage.',
    'Expansion cases are source-reader authored; independent sample reviews are recorded separately.'] };
const dir = join(ROOT, 'docs/ai-knowledge/runs'); mkdirSync(dir, { recursive: true });
const path = join(dir, `retrieval-${Date.now()}.json`); writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path, status: report.status, results: results.map(r => ({ scenario: r.scenario,
  required: r.oracle.length, beforeFound: r.before.requiredFound.length, beforeCandidates: r.before.retrievedCount,
  afterFound: r.after.requiredFound.length, afterCandidates: r.after.retrievedCount })) }, null, 2));
