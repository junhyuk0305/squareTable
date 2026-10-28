// Offline fixtures for the same semantic contract used by qa:blocks. No credentials or backend.
import assert from 'node:assert/strict';
import { auditDesignGroups } from './lib/design-group-audit.mjs';

const group = (key) => [
  { kind: 'group', key, id: `design-group-${key}`, parentGroup: null },
  { kind: 'title', key, id: `design-group-title-${key}`, parentGroup: key, text: key },
  { kind: 'action', key, item: 'open', id: `design-group-action-${key}--open`, parentGroup: key },
  ...['first', 'second'].map((item) => ({
    kind: 'row', key, item, id: `design-group-row-${key}--${item}`, parentGroup: key,
    ownCard: false, nestedGroup: false,
  })),
];
let checks = 0;
const expect = (name, markers, status, error) => {
  const result = auditDesignGroups(markers);
  assert.equal(result.status, status, name);
  if (error) assert(result.errors.some((message) => message.includes(error)), name);
  checks++;
  console.log(`PASS ${name}: expected ${status}`);
};

expect('Three category groups are valid', [...group('education'), ...group('work'), ...group('shift')], 'pass');
expect('A title outside its group fails', group('education').map((m) => m.kind === 'title' ? { ...m, parentGroup: null } : m), 'fail', 'Expected one visible title');
expect('An action in another group fails', [...group('education').map((m) => m.kind === 'action' ? { ...m, parentGroup: 'work' } : m), ...group('work')], 'fail', 'Outside its group');
expect('Repeated rows with independent card surfaces fail', group('work').map((m) => m.kind === 'row' ? { ...m, ownCard: true } : m), 'fail', 'Repeated row');
expect('A nested group inside a repeated row fails', group('work').map((m) => m.kind === 'row' ? { ...m, nestedGroup: true } : m), 'fail', 'Repeated row');
expect('Duplicate group keys fail', [...group('work'), ...group('work')], 'fail', 'Duplicate group');
expect('Reserved marker prefixes fail as group keys', group('action-work'), 'fail', 'Invalid marker');
expect('Extra separators fail', group('work').map((m) => m.kind === 'action' ? { ...m, id: `${m.id}--extra` } : m), 'fail', 'Invalid marker');
expect('Empty titles fail', group('work').map((m) => m.kind === 'title' ? { ...m, text: '' } : m), 'fail', 'Expected one visible title');
expect('No group is unverified, never pass', [], 'unverified');
expect('Orphan markers fail even without groups', group('work').filter((m) => m.kind === 'action'), 'fail', 'Outside its group');
console.log(`PASS: ${checks} offline fixtures. Live screens and DOM extraction were not exercised.`);
