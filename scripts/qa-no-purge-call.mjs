#!/usr/bin/env node
// qa-no-purge-call.mjs — 앱이 퇴사자 6개월 삭제(purge_expired_former_staff)를 더는 부르지 않는지 소스로 확인한다.
// DB·네트워크를 쓰지 않는다.
//
// ★2026-10-04 마스터 계획 P3-12 (Q2)
//   사장 화면(owner/_layout)이 열릴 때마다 purgeExpiredFormerStaff() 를 불렀다. 재직 중인지 보지 않고 지웠다.
//   서버는 0234 부터 이 함수가 아무것도 지우지 않고 0 을 돌려준다(옛 앱이 불러도 무해).
//   새 앱은 호출과 db.ts 함수를 둘 다 지운다.
// 실행: node scripts/qa-no-purge-call.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

console.log('\n■ 앱 소스(src)에 퇴사자 삭제 호출이 없다');
const hits = [];
for (const f of walk(join(root, 'src'))) {
  const text = readFileSync(f, 'utf8');
  if (/purgeExpiredFormerStaff|purge_expired_former_staff/.test(text)) hits.push(relative(root, f).replace(/\\/g, '/'));
}
check('src 어디에도 purgeExpiredFormerStaff · purge_expired_former_staff 가 없다', hits.length === 0, hits.join(', '));

const layout = readFileSync(join(root, 'src/app/owner/_layout.tsx'), 'utf8');
check('owner/_layout 이 사장 진입 때 삭제를 부르지 않는다', !/purgeExpiredFormerStaff\s*\(/.test(layout));

const db = readFileSync(join(root, 'src/lib/db.ts'), 'utf8');
check('db.ts 에 purgeExpiredFormerStaff 함수가 없다', !/export\s+async\s+function\s+purgeExpiredFormerStaff/.test(db));

console.log(`\n── ${pass} PASS · ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
