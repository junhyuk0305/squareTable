// qa-race.mjs — 레이스(동시 요청) 하니스 틀 (2026-11-12 · 결함 전수 점검 S0)
//
// ★로컬 도커 전용. 접속 정보는 qa-fz-local.mjs 의 localEnv() 가 `supabase status` 에서만 얻는다.
// 두 방식:
//   방식 A(겹침 보장) twoAtOnce: db 컨테이너 안에서 psql 세션 둘을 0.3초 차이로 띄운다.
//     앞 세션은 대상 쓰기 뒤 1.5초 쥐고 커밋한다. 뒤 세션은 그 사이에 같은 쓰기를 보낸다.
//     잠금이 없으면 뒤 세션이 커밋 전 상태를 읽어 둘 다 통과한다 → 수정 전 항상 RED.
//     본뜬 곳 = scripts/lib/qa-space-store-link.mjs 5-2.
//   방식 B(실세션 반복): 실세션 두 개가 같은 요청을 Promise.all 로 n회(케이스 안의 반복문). RLS 를 지나는 클라 직접 쓰기용.
//     Promise.all 한 번은 증명이 아니다(겹친다는 보장이 없다). 그래서 반복 횟수 전체를 센다.
// 결과 모양: { ok: true, v: '<텍스트>' } | { ok: false, code: '<raise 코드 또는 SQLSTATE>' , msg }
import { spawnSync } from 'node:child_process';

export const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

export function makeRace(DB) {
  const psqlRun = (input) => spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-q'],
    { input, encoding: 'utf8', timeout: 60_000 });
  /** select 한 줄 값. 실패하면 던진다(셋업 실패 = fail 로 센다). */
  const val = (sql) => {
    const r = psqlRun(sql);
    if (r.status !== 0) throw new Error(`psql: ${(r.stderr || '').split('\n').find((l) => /ERROR/.test(l)) ?? r.stderr}`);
    return (r.stdout ?? '').trim();
  };
  /** 세션 머리: 이 사람으로(authenticated · RLS 적용). 'service' = service_role. 'postgres' = 머리 없음. */
  const as = (who) => {
    if (who === 'postgres') return '';
    if (who === 'service') return `select set_config('request.jwt.claims', '{"role":"service_role"}', false);\nset role service_role;`;
    const sid = crypto.randomUUID();
    return `select set_config('request.jwt.claims', json_build_object('sub', ${q(who)}, 'role', 'authenticated', 'session_id', ${q(sid)})::text, false);
select set_config('request.jwt.claim.sub', ${q(who)}, false);
set role authenticated;`;
  };
  /** 한 세션 SQL. body = 텍스트 하나를 내는 SQL 식, 또는 insert/update/delete … returning 문(결과 = 행 수).
   *  hold = 커밋 전에 1.5초 쥔다. */
  const session = (who, body, hold) => `\\set VERBOSITY verbose
${as(who)}
begin;
${/^\s*(insert|update|delete)\b/i.test(body)
    ? `with x as (${body}) select 'R|' || count(*) from x;`
    : `select 'R|' || coalesce((${body})::text, '<null>');`}
${hold ? 'select pg_sleep(1.5);' : ''}
commit;`;
  const parse = (o) => {
    const ok = (o ?? '').split(/\r?\n/).find((l) => l.startsWith('R|'));
    if (ok) return { ok: true, v: ok.slice(2) };
    const m = (o ?? '').match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/);
    if (m) {
      // P0001 = raise exception '<코드>' → 첫 낱말이 코드. 그 밖은 SQLSTATE 가 코드다(원문은 msg 로만).
      const code = m[1] === 'P0001' ? m[2].split(/[\s:]/)[0] : m[1];
      return { ok: false, code, msg: m[2].slice(0, 160) };
    }
    return { ok: false, code: '?', msg: (o ?? '').trim().slice(0, 160) };
  };
  /** 방식 A. [앞 세션 결과, 뒤 세션 결과]. 실행 자체가 실패하면 던진다. */
  const twoAtOnce = (a, b) => {
    const tag = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
    for (const [n, s] of [['a', a], ['b', b]]) {
      const w = spawnSync('docker', ['exec', '-i', DB, 'sh', '-c', `cat > /tmp/qa_race_${tag}_${n}.sql`], { input: s, encoding: 'utf8' });
      if (w.status !== 0) throw new Error('twoAtOnce: SQL 파일을 못 썼다');
    }
    const sh = `cd /tmp; psql -U postgres -tA -q -f qa_race_${tag}_a.sql > qa_race_${tag}_a.out 2>&1 & sleep 0.3; `
      + `psql -U postgres -tA -q -f qa_race_${tag}_b.sql > qa_race_${tag}_b.out 2>&1 & wait; `
      + `cat qa_race_${tag}_a.out; echo '=====QA====='; cat qa_race_${tag}_b.out; rm -f qa_race_${tag}_*`;
    const r = spawnSync('docker', ['exec', DB, 'sh', '-c', sh], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) throw new Error(`twoAtOnce: 실행 실패 ${r.stderr}`);
    const [oa, ob] = r.stdout.split('=====QA=====');
    return [parse(oa), parse(ob)];
  };
  return { psqlRun, val, as, session, twoAtOnce };
}

/** 결과 한 줄 표시. */
export const show = (r) => (r.ok ? `ok(${r.v})` : `err(${r.code})`);

/** 집계. RED(=결함 재현) 도 fail 로 센다. 셋업 실패도 fail 이다. */
export function makeCounter() {
  const t = { pass: 0, fail: 0, skip: 0, rows: [] };
  const check = (id, name, ok, detail = '') => {
    if (ok) t.pass++; else t.fail++;
    t.rows.push({ id, name, ok, detail });
    console.log(`  ${ok ? '✅' : '❌'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const skip = (id, name, why) => { t.skip++; t.rows.push({ id, name, ok: null, detail: why }); console.log(`  ⏭️  [${id}] ${name} — skip: ${why}`); };
  return { t, check, skip };
}
