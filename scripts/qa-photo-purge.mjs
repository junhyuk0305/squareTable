#!/usr/bin/env node
// qa-photo-purge.mjs — F3(QA 2026-10-05): 매장·계정을 파기할 때 그 매장 사진 파일도 지운다. 정적 검사(DB·네트워크 없음).
//
// 왜: 처리방침은 사진도 매장 데이터와 함께 파기한다고 적었다. 그런데 units 를 지우면 cascade 로 행만 지워지고
//   스토리지(playbook-photos/<unit_id>/…) 파일은 그대로 남았다. 지우는 코드가 어디에도 없었다.
//   ★SQL 로 storage.objects 행만 지우면 실제 파일은 저장소에 남는다(호스팅 Supabase). 그래서 파일은 Storage API 로 지운다.
// 경로: units 삭제(탈퇴 30일 파기·매장 삭제·프로필 하드삭제 트리거 전부) → 트리거가 그 매장 폴더 파일을 대기열에 넣는다
//   → 엣지 push 5분 틱(mode='task_reminders')이 대기열을 읽어 storage.remove → 지운 경로를 대기열에서 뺀다.
// 실행: node scripts/qa-photo-purge.mjs
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n, extra)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// 주석을 빼고 본다(주석에 쓴 말로 통과하지 않게).
const stripSql = (s) => s.replace(/--[^\n]*/g, '');
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const mig = files.filter((f) => /photo_purge_queue/.test(read(`supabase/migrations/${f}`)));
const sql = stripSql(mig.map((f) => read(`supabase/migrations/${f}`)).join('\n'));

console.log('\n■ 서버(마이그레이션)', mig.join(', ') || '(없음)');
check('★대기열 표가 있다', /create table if not exists public\.photo_purge_queue/.test(sql));
check('대기열은 앱에서 못 읽고 못 쓴다(RLS 켜고 권한 회수)',
  /alter table public\.photo_purge_queue enable row level security/.test(sql)
  && /revoke all on (table )?public\.photo_purge_queue from public, anon, authenticated/.test(sql));
const trg = (sql.match(/create or replace function public\.queue_unit_photos_on_delete\(\)[\s\S]*?\$\$;/) || [''])[0];
check('★매장 행이 지워지면 그 매장 폴더 사진을 대기열에 넣는다',
  /storage\.objects/.test(trg) && /'playbook-photos'/.test(trg) && /split_part\(o\.name, '\/', 1\) = old\.id/.test(trg));
check('트리거가 units 삭제 뒤에 돈다', /after delete on public\.units[\s\S]*?execute function public\.queue_unit_photos_on_delete\(\)/.test(sql));
const due = (sql.match(/create or replace function public\.photo_purge_due\([\s\S]*?\$\$;/) || [''])[0];
check('★살아 있는 노하우·제안이 아직 가리키는 사진은 지우지 않는다(본사 사본은 작업실 폴더를 가리킨다)',
  /playbook_entries/.test(due) && /playbook_suggestions/.test(due));
check('정리 함수는 service_role 만 부른다',
  /revoke execute on function public\.photo_purge_due\(integer\) from public, anon, authenticated/.test(sql)
  && /revoke execute on function public\.photo_purge_done\(text\[\]\) from public, anon, authenticated/.test(sql)
  && /revoke execute on function public\.queue_unit_photos_on_delete\(\) from public, anon, authenticated/.test(sql));
// 되돌릴 수 없는 한 번 정리는 0278 에서 빼서 0298('올리기 조건: 라이브 대상 확인 뒤')로 둔다.
check('★0278 에는 한 번 정리가 없다(라이브 대상 확인 전 삭제 대기 금지)',
  !/not exists \(select 1 from public\.units u where u\.id = split_part/.test(stripSql(read('supabase/migrations/0278_unit_photo_purge.sql'))));
check('0298 머리말에 올리기 조건이 있다', /^-- 올리기 조건:/m.test(read('supabase/migrations/0298_photo_purge_backfill.sql')));
check('이미 지워진 매장의 남은 사진도 한 번 대기열에 넣는다(폴더가 있는 것만)',
  /insert into public\.photo_purge_queue[\s\S]*?not exists \(select 1 from public\.units u where u\.id = split_part\(o\.name, '\/', 1\)\)/.test(sql)
  && /o\.name like '%\/%'/.test(sql));

console.log('\n■ 엣지(push 크론 틱)');
const push = stripTs(read('supabase/functions/push/index.ts'));
const branch = (push.match(/if \(payload\.mode\) \{[\s\S]*?return json\(200/) || [''])[0];
check('★5분 틱이 사진 정리를 부른다', /sweepPhotoPurge\(token\)/.test(branch));
const sweep = (push.match(/async function sweepPhotoPurge[\s\S]*?\n\}/) || [''])[0];
check('Storage API 로 파일을 지운다', /rpc\('photo_purge_due'/.test(sweep) && /storage\.from\('playbook-photos'\)\.remove\(/.test(sweep));
check('지우기가 실패하면 대기열에서 빼지 않는다', /if \(rmErr\)[\s\S]*?return/.test(sweep) && /rpc\('photo_purge_done'/.test(sweep));

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
