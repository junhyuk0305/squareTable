#!/usr/bin/env node
// qa-audit-store.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 매장·직원 묶음 재현 검사.
//   [C1] 무료 매장 좌석 잠금은 한 판정을 쓴다. 직원이 3명 이하면 아무도 잠그지 않는다.
//        매장이 유료가 되면 옛 "계속 함께할 직원" 명단을 비운다. 사장 화면 잠김 수도 같은 판정으로 센다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 실행: node --no-warnings scripts/qa-audit-store.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const sqlStrip = (s) => s.replace(/--.*$/gm, '');
const migDir = new URL('../supabase/migrations/', import.meta.url);
const migFiles = () => readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

// 함수의 마지막 정의 본문(가장 큰 번호 마이그레이션). create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  let body = '', file = '';
  for (const f of migFiles()) {
    const s = readFileSync(new URL(f, migDir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
const fileHas = (file, text) => !!file && read(`supabase/migrations/${file}`).includes(text);

console.log('[C1] 무료 매장 좌석 잠금은 한 판정 — 3명 이하면 아무도 안 잠그고, 유료가 되면 옛 명단을 비운다');
{
  const p = lastDef('seat_locked_for');
  const idxCount = p.body.search(/<= 3 then return false/);
  const idxList = p.body.indexOf('unit_kept_seat_uids');
  check('★한 판정(seat_locked_for)이 있고, 직원 3명 이하 검사가 명단 검사보다 먼저다',
    !!p.file && idxCount > 0 && idxList > idxCount, p.file || '없음');
  check('판정은 유료·전면 무료 모드에서 잠그지 않는다',
    /billing_free_mode\(\)/.test(p.body) && /effective_plan\(p_unit\) <> 'free'/.test(p.body));
  check('명단이 없으면 합류 순서(seat_rank > 3)로 정한다', /seat_rank\(p_unit, p_uid\)/.test(p.body) && /> 3/.test(p.body));
  check('seat_locked_for 는 내부 판정이다(클라 실행 불가)',
    fileHas(p.file, 'revoke all on function public.seat_locked_for(text, uuid) from public, anon, authenticated;'));

  const m = lastDef('my_seat_locked');
  check('★my_seat_locked 가 그 판정을 쓴다', /public\.seat_locked_for\(v_unit, v_uid\)/.test(m.body), m.file);
  check('my_seat_locked 권한 유지(authenticated)',
    fileHas(m.file, 'grant execute on function public.my_seat_locked() to authenticated;'));

  const s = lastDef('unit_seat_status');
  check('★unit_seat_status 의 잠김 수도 같은 판정으로 센다',
    /public\.seat_locked_for\(v_unit, m\.user_id\)/.test(s.body) && !/greatest\(total - cap, 0\)/.test(s.body), s.file);
  check('unit_seat_status 권한 유지(authenticated)',
    fileHas(s.file, 'grant execute on function public.unit_seat_status() to authenticated;'));

  const t = lastDef('clear_kept_seats_on_paid');
  check('★매장이 유료가 되면 그 매장의 옛 명단을 비운다(unit_subscriptions 트리거)',
    /effective_plan\(new\.unit_id\) <> 'free'/.test(t.body) && /delete from public\.unit_kept_seats where unit_id = new\.unit_id/.test(t.body)
      && fileHas(t.file, 'after insert or update on public.unit_subscriptions'), t.file || '없음');
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
