#!/usr/bin/env node
// qa-audit-knowhow.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 노하우·퀴즈·AI 묶음 재현 검사.
//   [E1] 초안·외부용 퀴즈는 직원 카드와 자동 배정(신입 첫 퀴즈·재확인)에 안 나온다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 순수 함수는 앱 코드를 그대로 import 해서 돌린다.
// 실행: node --no-warnings scripts/qa-audit-knowhow.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
// 주석을 뺀 코드(문자열 안의 // 는 드물어 무시한다).
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sqlStrip = (s) => s.replace(/--.*$/gm, '');
const migDir = new URL('../supabase/migrations/', import.meta.url);
const migFiles = () => readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
// 함수의 마지막 정의 본문. create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  let body = '', file = '';
  for (const f of migFiles()) {
    const s = readFileSync(new URL(f, migDir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
const tryImport = async (p) => { try { return await import(p); } catch (e) { return { __err: String(e?.message ?? e) }; } };

console.log('[E1] 초안·외부용 퀴즈는 직원 카드와 자동 배정에 안 나온다 (0139 이전 코스는 예전대로)');
{
  const sched = await tryImport('../src/lib/quiz/schedule.ts');
  const f = sched.staffCanSeeCourse;
  check('★staffCanSeeCourse 판정 함수가 있다', typeof f === 'function', sched.__err ?? '');
  if (typeof f === 'function') {
    const recent = '2026-10-01T03:00:00+00:00';
    check('★외부 사람용(guest)은 발송 원장과 무관하게 안 보인다',
      f({ audience: 'guest', startAt: '2026-10-01', createdAt: recent }, 0) === false
        && f({ audience: 'guest', startAt: '2026-10-01', createdAt: recent }, 3) === false);
    check('★만들던 퀴즈(일정 없음·원장 0건·0139 뒤에 만듦)는 안 보인다',
      f({ audience: null, startAt: null, createdAt: recent }, 0) === false);
    check('본사 사본(아직 안 보냄 · 원장 0건)도 안 보인다',
      f({ audience: 'staff', startAt: null, createdAt: recent }, 0) === false);
    check('원장 행이 있는 우리 직원 퀴즈는 보인다(누구에게 갔는지는 원장이 가른다)',
      f({ audience: 'staff', startAt: '2026-10-01', createdAt: recent }, 2) === true
        && f({ audience: null, startAt: null, createdAt: recent }, 1) === true);
    check('0139 이전에 만든 원장 0건 코스는 예전대로 보인다(하위 호환)',
      f({ audience: null, startAt: null, createdAt: '2026-08-01T00:00:00+09:00' }, 0) === true);
  }
  const board = strip(read('src/components/WorkBoard.tsx'));
  check('★직원 카드가 staffCanSeeCourse 로 거른다', /if \(!staffCanSeeCourse\(c, sends\.length\)\) continue;/.test(board));

  for (const fn of ['approve_member', 'enqueue_knowhow_rechecks']) {
    const d = lastDef(fn);
    check(`★${fn} 이 외부용 코스를 고르지 않는다`, /coalesce\(c\.audience, 'staff'\) = 'staff'/.test(d.body), d.file);
    check(`★${fn} 이 만들던 퀴즈(일정·사장 발송 없음)를 고르지 않는다(0139 이전 코스는 예외)`,
      /c\.start_at is not null/.test(d.body) && /x\.origin = 'manual'/.test(d.body) && /c\.created_at < timestamptz '2026-08-11 00:00:00\+09'/.test(d.body), d.file);
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
