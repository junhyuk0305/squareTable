#!/usr/bin/env node
// qa-audit-account.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 계정·개인정보 묶음 재현 검사.
//   [F2] 설정에 '다른 기기에서 모두 로그아웃' — 지금 기기는 유지 · 다른 기기 푸시도 멈춘다.
//   [F4] 설정(앱 설정)에 '마케팅 정보 받기' — 동의·철회 시각을 user_consents 에 남긴다 · 동의서의 위치 문구가 실제 위치다.
//   [F5] 앱의 '탈퇴를 되돌리려면 문의' 문구를 뺀다(처리방침 문장은 동결이라 그대로).
// 서버 동작은 로컬 도커 DB 트랜잭션(고정 계정 · 끝나면 되돌림)과 로컬 Supabase 실로그인(고정 계정 owner@pilot)으로 본다.
// 도커·로컬 Supabase 가 없으면 서버 동작은 SKIP.
// 실행: node --no-warnings scripts/qa-audit-account.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const lastDef = (name) => {
  let body = '', file = '';
  for (const f of migFiles()) {
    const s = readFileSync(new URL(f, migDir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return 'ERR=' + String(e.stderr ?? e.message).replace(/\s+/g, ' ').slice(0, 300); }
};
const tail = (o) => o.split('\n').filter((l) => /^R=|ERR=/.test(l)).join(' ').slice(0, 300);
let dbUp = true;
try { execFileSync('docker', ['exec', 'supabase_db_SquareTable', 'psql', '-U', 'postgres', '-c', 'select 1'], { stdio: 'pipe' }); } catch { dbUp = false; }
const env = {};
for (const f of ['.env', '.env.seed']) for (const line of read(f).split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim(); }
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const localAuth = dbUp && !!URL_ && !!ANON && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_);

console.log('[F2] 설정에 "다른 기기에서 모두 로그아웃" — 지금 기기는 유지');
{
  const ss = strip(read('src/lib/store/useSessionStore.ts'));
  const m = (ss.match(/\n  signOutOthers: async \(\) => \{[\s\S]*?\n  \},/) || [''])[0];
  check('★세션 스토어 signOutOthers 가 scope others 로 로그아웃한다', /supabase\.auth\.signOut\(\{ scope: 'others' \}\)/.test(m), m.slice(0, 160));
  check('지금 기기의 세션이 없으면(만료) 성공이라고 하지 않는다', /getSession\(\)/.test(m) && /return \{ error:/.test(m));
  check('signOutOthers 가 타입에 있다', /signOutOthers: \(\) => Promise<\{ error: string \| null \}>;/.test(ss));
  const scr = strip(read('src/app/account-settings.tsx'));
  check('★설정에 "다른 기기에서 모두 로그아웃" 행이 있다', scr.includes('label="다른 기기에서 모두 로그아웃"'));
  const on = (scr.match(/const onSignOutOthers = async \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
  check('★확인창을 거친 뒤 실행한다', /confirmAction\(/.test(on) && /signOutOthers\(\)/.test(on) && on.indexOf('confirmAction(') < on.indexOf('signOutOthers()'), on.slice(0, 200));
  check('★성공·실패 토스트', /showToast\([^)]*'good'\)/.test(on) && /showToast\([^)]*'warn'\)/.test(on), on.slice(0, 300));

  if (!localAuth) console.log('  SKIP 실로그인 — 로컬 Supabase 아님/없음');
  else {
    // 같은 계정으로 두 기기 로그인 → 기기마다 푸시 토큰 저장 → 기기1 에서 '다른 기기 로그아웃' → 기기2 세션·푸시가 멈추고 기기1 은 그대로.
    const { createClient } = await import('@supabase/supabase-js');
    const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const sidOf = (c) => c.auth.getSession().then(({ data }) => JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString()).session_id);
    const c1 = mk(), c2 = mk();
    const T1 = 'ExponentPushToken[qa_f2_dev1]', T2 = 'ExponentPushToken[qa_f2_dev2]';
    try {
      const l1 = await c1.auth.signInWithPassword({ email: 'owner@pilot.squaretable.app', password: 'pilot1234' });
      const l2 = await c2.auth.signInWithPassword({ email: 'owner@pilot.squaretable.app', password: 'pilot1234' });
      if (l1.error || l2.error) throw new Error(`로그인 실패 ${l1.error?.message ?? l2.error?.message}`);
      const s1 = await sidOf(c1), s2 = await sidOf(c2);
      const r1 = await c1.rpc('save_push_device_token', { p_token: T1, p_platform: 'ios' });
      const r2 = await c2.rpc('save_push_device_token', { p_token: T2, p_platform: 'android' });
      if (r1.error || r2.error) throw new Error(`토큰 저장 실패 ${r1.error?.message ?? r2.error?.message}`);
      const targets = () => psql(`select 'R=' || coalesce(string_agg(token, ',' order by token), '') from public.push_device_targets(array[(select id from auth.users where email = 'owner@pilot.squaretable.app')]) where token like '%qa_f2_%';`);
      const before = targets();
      check('실로그인 전제: 두 기기 모두 푸시 대상이다', before.includes(`R=${T1},${T2}`), tail(before));
      const so = await c1.auth.signOut({ scope: 'others' });
      const alive = psql(`select 'R=' || (select count(*) from auth.sessions where id = '${s1}') || ':' || (select count(*) from auth.sessions where id = '${s2}');`);
      check('★다른 기기 로그아웃 → 기기2 세션만 지워지고 지금 기기(1)는 남는다', !so.error && alive.includes('R=1:0'), `${so.error?.message ?? ''} ${tail(alive)}`);
      const after = targets();
      check('★0236 세션 판정: 기기2 푸시가 멈추고 기기1 은 계속 간다', after.includes(`R=${T1}`) && !after.includes(T2), tail(after));
      const ref = await c2.auth.refreshSession();
      check('기기2 는 토큰을 새로 받지 못한다(다시 로그인해야 한다)', !!ref.error || !ref.data?.session, ref.error?.message ?? 'refresh 성공');
      const still = await c1.rpc('auth_unit_id');
      check('지금 기기는 그대로 쓴다', !still.error && !!still.data, still.error?.message ?? '');
      await c1.auth.signOut({ scope: 'local' });
    } catch (e) {
      check('실로그인 실행', false, String(e?.message ?? e));
    } finally {
      psql(`delete from public.push_device_tokens where token like '%qa_f2_%';`);
    }
  }
}

console.log('\n[F4] 설정에 "마케팅 정보 받기" — 동의·철회 시각을 서버에 남기고, 동의서는 실제 위치를 가리킨다');
{
  const d = lastDef('set_my_marketing_consent');
  check('★서버 함수 set_my_marketing_consent 가 있다', !!d.file, '없음');
  const f = d.file ? read(`supabase/migrations/${d.file}`) : '';
  check('권한: authenticated 만', /revoke all on function public\.set_my_marketing_consent\(boolean, text\) from public, anon, authenticated;/.test(f)
    && /grant\s+execute on function public\.set_my_marketing_consent\(boolean, text\) to authenticated;/.test(f), d.file);
  for (const fn of ['record_signup_consents', 'record_my_consents']) {
    const x = lastDef(fn);
    check(`${fn} 는 철회되지 않은 동의만 중복으로 본다(철회 뒤 다시 동의하면 새 행)`, /on conflict \(user_id, item, version\) where withdrawn_at is null do nothing/.test(x.body), x.file);
  }
  const db = strip(read('src/lib/db.ts'));
  check('★앱이 현재 상태를 읽는다(철회되지 않은 marketing 행)', /export async function fetchMyMarketingConsent\(\)/.test(db)
    && /from\('user_consents'\)[\s\S]{0,200}\.eq\('item', 'marketing'\)[\s\S]{0,80}\.is\('withdrawn_at', null\)/.test(db));
  check('★앱이 바꾼다(rpc set_my_marketing_consent)', /rpc\('set_my_marketing_consent', \{ p_on: on, p_version: TERMS_VERSION \}\)/.test(db));
  const scr = strip(read('src/app/account-settings.tsx'));
  check('★설정 > 앱 설정에 "마케팅 정보 받기" 토글', /<SettingsSection icon="options-outline" title="앱 설정">[\s\S]*label="마케팅 정보 받기"[\s\S]*?<\/SettingsSection>/.test(scr));
  check('현재 상태를 읽기 전에는 토글을 그리지 않는다', /marketing !== null && \(/.test(scr) || /marketing === null \? null/.test(scr));
  const doc = read('src/app/legal/[doc].tsx');
  // ⛔약관 동결(토스 심사): 동의서 '철회 방법' 위치 문구는 10/16 이후에 실제 위치(설정 › 앱 설정 › 마케팅 정보 받기)로 고친다.
  //   그때까지는 main 문구 그대로여야 한다. 동결이 풀리면 이 검사를 실제 위치 기대로 되돌린다.
  check('동의서 철회 방법 문구는 약관 동결로 main 그대로다(10/16 이후 실제 위치로)',
    doc.includes('설정 › 알림에서 언제든 수신을 끌 수 있고') && !doc.includes('설정 › 앱 설정 › 마케팅 정보 받기'));

  if (!dbUp) console.log('  SKIP 서버 동작 — 로컬 도커 DB 없음');
  else {
    // 계정 id 는 역할을 바꾸기 전에 읽어 둔다(authenticated 는 auth.users 를 못 읽는다).
    const IDS = `select set_config('qa.j', (select id::text from auth.users where email = 'staff2@pilot.squaretable.app'), true);
select set_config('qa.o', (select id::text from auth.users where email = 'owner@pilot.squaretable.app'), true);\n`;
    const AS = (who) => `set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('qa.${who}'), 'role', 'authenticated')::text, true);\n`;
    const STATE = `select 'R=state:' || count(*) filter (where withdrawn_at is null) || '/' || count(*) from public.user_consents where item = 'marketing';\n`;
    const o = psql(`begin;
${IDS}delete from public.user_consents where user_id = current_setting('qa.j')::uuid and item = 'marketing';
${AS('j')}
select 'R=on1:' || (public.set_my_marketing_consent(true, '2026-10-01')->>'on');
${STATE}select 'R=on2:' || (public.set_my_marketing_consent(true, '2026-10-01')->>'on');
${STATE}select 'R=off:' || (public.set_my_marketing_consent(false, '2026-10-01')->>'on');
${STATE}select 'R=wd:' || (select count(*) from public.user_consents where item = 'marketing' and withdrawn_at is not null);
select 'R=on3:' || (public.set_my_marketing_consent(true, '2026-10-01')->>'on');
${STATE}select 'R=off2:' || (public.set_my_marketing_consent(false, '2026-10-01')->>'on');
select 'R=re:' || public.record_my_consents(array['marketing'], '2026-10-01', 'reconsent');
${STATE}select 'R=chan:' || string_agg(distinct channel, ',' order by channel) from public.user_consents where item = 'marketing';
rollback;
`);
    check('★켜기 → 동의 행 1개(철회 안 됨)', o.includes('R=on1:true') && /R=state:1\/1 R=on2/.test(tail(o)), tail(o));
    check('이미 켠 상태에서 또 켜도 행이 늘지 않는다', /R=on2:true R=state:1\/1/.test(tail(o)), tail(o));
    check('★끄기 → 그 행에 철회 시각이 남는다(행은 지우지 않는다)', /R=off:false R=state:0\/1 R=wd:1/.test(tail(o)), tail(o));
    check('★다시 켜기 → 새 동의 행이 생긴다(이전 동의·철회 기록은 그대로)', /R=on3:true R=state:1\/2/.test(tail(o)), tail(o));
    check('철회 뒤 재동의 화면(record_my_consents)으로 동의해도 새 행이 생긴다', /R=re:1 R=state:1\/3/.test(tail(o)), tail(o));
    check('설정에서 바꾼 행은 채널 settings', /R=chan:reconsent,settings/.test(tail(o)), tail(o));
    const bad = psql(`begin;\n${IDS}${AS('j')}select public.set_my_marketing_consent(true, 'v1');\nrollback;\n`);
    check('버전 형식이 틀리면 거부', /consent_version_invalid/.test(bad), tail(bad));
    const anon = psql(`begin;\nset local role anon;\nselect public.set_my_marketing_consent(true, '2026-10-01');\nrollback;\n`);
    check('로그인 안 한 호출은 거부', /permission denied|not_authenticated/.test(anon), tail(anon));
    const own = psql(`begin;
${IDS}${AS('j')}select public.set_my_marketing_consent(true, '2026-10-01');
${AS('o')}select 'R=other:' || count(*) from public.user_consents where user_id = current_setting('qa.j')::uuid;
rollback;
`);
    check('다른 사람의 동의 기록은 못 읽는다', own.includes('R=other:0'), tail(own));
  }
}

console.log('\n[F5] 앱의 "탈퇴를 되돌리려면 문의" 문구를 뺀다');
{
  const copy = await import('../src/lib/account/copy.ts').catch((e) => ({ __err: String(e?.message ?? e) }));
  const t = copy.DELETED_LOGIN_TEXT ?? '';
  check('★탈퇴 계정 로그인 문구에 "되돌리려면 문의"가 없다', !!t && !/되돌리|문의/.test(t), copy.__err ?? t);
  check('30일 뒤 지워지고 같은 이메일로 다시 가입할 수 있다는 사실은 남긴다', /30일 뒤 완전히 지워지고/.test(t) && /다시 가입할 수 있어요/.test(t), t);
  const all = ['src/lib/account/copy.ts', 'src/lib/store/useSessionStore.ts', 'src/app/account-settings.tsx', 'src/app/login.tsx'].map((p) => strip(read(p))).join('\n');
  check('앱 코드 어디에도 탈퇴 복구 문의 안내가 없다', !/되돌리려면 문의|복구가 필요하면 문의/.test(all));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
