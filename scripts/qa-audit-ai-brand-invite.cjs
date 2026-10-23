// Actual RPC bodies in a new synthetic database. No production/public database changes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const container = 'supabase_db_SquareTable';
const db = `qa_audit_brand_${Date.now()}`;
const baseline = process.argv.includes('--baseline');
const read = f => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8');
function extract(text, name) {
  const start = text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  const end = text.indexOf('end $$;', start);
  assert.ok(end > start);
  return text.slice(start, end + 7);
}
const names = ['accept_brand_member_invite', 'respond_brand_invite', 'brand_revoke_invite'];
const files = ['0210_brand_invites.sql', '0211_brand_units.sql', '0214_brand_invite_revoke.sql'];
const migration = '0331_brand_invite_single_use.sql';
const definitions = names.map((n,i) => extract(read(baseline ? files[i] : migration), n)).join('\n');
const args = database => ['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-At','-q','-v','ON_ERROR_STOP=1'];
function sql(query, database = db) { return execFileSync('docker', args(database), {input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(); }
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const userA = '00000000-0000-0000-0000-000000000001';
const userB = '00000000-0000-0000-0000-000000000002';
const admin = '00000000-0000-0000-0000-000000000003';
function session(user, name, query) {
  const child = spawn('docker', args(db), {stdio:['pipe','pipe','pipe']});
  let out='', err=''; child.stdout.on('data',x=>out+=x); child.stderr.on('data',x=>err+=x);
  child.stdin.end(`set application_name=${quote(name)}; set role authenticated; select set_config('request.jwt.claim.sub',${quote(user)},false); ${query}`);
  return new Promise(resolve=>child.on('close',code=>resolve({code,out:out.trim(),err:err.trim()})));
}
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function waitSleeping(name) {
  for (let i=0;i<60;i++) {
    if (sql(`select count(*) from pg_stat_activity where datname=${quote(db)} and application_name=${quote(name)} and wait_event='PgSleep'`) === '1') return;
    await delay(30);
  }
  throw new Error('first request did not reach controlled overlap');
}
async function race(first, second) {
  const a = session(first.user, 'qa_first', first.query);
  await waitSleeping('qa_first');
  const b = session(second.user, 'qa_second', second.query);
  return Promise.all([a,b]);
}
const accept = {user:userA, query:"select public.accept_brand_member_invite('token');"};
const respond = (unit='unitA', yes=true) => ({user:userA,query:`select public.respond_brand_invite('invite',array[${quote(unit)}],'summary',${yes});`});
const revoke = {user:admin,query:"select public.brand_revoke_invite('invite');"};
function seed(kind='member') {
  sql(`truncate brand_events,brand_members,brand_units,brand_invites;
  insert into brand_members values ('brand',${quote(admin)},null);
  insert into brand_invites(id,brand_id,kind,token,phone_norm,payer,status,expires_at,created_by)
  values ('invite','brand',${quote(kind)},'token','qa-phone','brand','pending',now()+interval '1 day',${quote(admin)});`);
}
let pass=0,fail=0;
async function test(name, fn) { try {await fn();pass++;console.log('PASS',name);}catch(e){fail++;console.log('FAIL',name,e.message);} }
function oneWinner(results) { assert.deepEqual(results.map(r=>r.code===0).sort(),[false,true]); }
function state() { return sql("select status from brand_invites where id='invite'"); }
(async()=>{
  sql(`create database ${db};`,'postgres');
  try {
    sql(`create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table brand_invites(id text primary key,brand_id text,kind text,token text unique,phone_norm text,payer text,status text,expires_at timestamptz,created_by uuid,used_at timestamptz,used_by uuid,unit_id text);
    create table brand_members(brand_id text,user_id uuid,invited_by uuid,primary key(brand_id,user_id));
    create table brand_units(brand_id text,unit_id text,status text default 'active',payer text,visibility text,invite_id text,invited_by uuid,accepted_by uuid);
    create unique index one_active on brand_units(unit_id) where status='active';
    create table profiles(id uuid primary key,phone_norm text);
    create table units(id text primary key,kind text,deleted_at timestamptz);
    create table unit_members(unit_id text,user_id uuid,role text);
    create table brand_events(event text);
    insert into profiles values (${quote(userA)},'qa-phone'),(${quote(userB)},'qa-phone');
    insert into units values ('unitA','store',null),('unitB','store',null);
    insert into unit_members values ('unitA',${quote(userA)},'owner'),('unitB',${quote(userA)},'owner');
    create function public.auth_brand_id() returns text language sql stable security definer set search_path=public as $$ select brand_id from brand_members where user_id=auth.uid() limit 1 $$;
    create function public.auth_owns_unit(p_unit text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from unit_members where unit_id=p_unit and user_id=auth.uid() and role='owner') $$;
    create function public.brand_log(text,text,text,jsonb) returns void language sql as $$ insert into brand_events values ($3) $$;
    ${definitions}
    grant execute on all functions in schema public to authenticated;
    alter table brand_invites enable row level security; alter table brand_members enable row level security; alter table brand_units enable row level security;
    create function qa_pause() returns trigger language plpgsql as $$ begin if current_setting('application_name')='qa_first' then perform pg_sleep(1.2); end if; return new; end $$;
    create trigger pause_member before insert on brand_members for each row execute function qa_pause();
    create trigger pause_unit before insert on brand_units for each row execute function qa_pause();
    create trigger pause_invite before update on brand_invites for each row execute function qa_pause();`);
    await test('two users cannot consume one member invite', async()=>{
      seed(); const r=await race(accept,{...accept,user:userB}); oneWinner(r);
      assert.equal(sql(`select count(*) from brand_members where user_id<>${quote(admin)}`),'1');
      assert.equal(sql("select count(*) from brand_events where event='member_joined'"),'1');
    });
    await test('same user simultaneous retry has one event', async()=>{
      seed(); oneWinner(await race(accept,accept)); assert.equal(sql("select count(*) from brand_events where event='member_joined'"),'1');
    });
    await test('two disjoint units cannot consume one store invite twice', async()=>{
      seed('store'); oneWinner(await race(respond(),respond('unitB'))); assert.equal(sql('select count(*) from brand_units'),'1');
    });
    await test('accept starts before revoke: accepted state and relation agree', async()=>{
      seed('store'); const r=await race(respond(),revoke); oneWinner(r); assert.equal(r[0].code,0); assert.equal(state(),'accepted'); assert.equal(sql('select count(*) from brand_units'),'1');
    });
    await test('revoke starts before accept: no relation survives', async()=>{
      seed('store'); const r=await race(revoke,respond()); oneWinner(r); assert.equal(r[0].code,0); assert.equal(state(),'revoked'); assert.equal(sql('select count(*) from brand_units'),'0');
    });
    await test('decline starts before accept: no relation survives', async()=>{
      seed('store'); const r=await race(respond('unitA',false),respond()); oneWinner(r); assert.equal(r[0].code,0); assert.equal(state(),'declined'); assert.equal(sql('select count(*) from brand_units'),'0');
    });
    await test('normal multi-unit acceptance remains atomic and supported', async()=>{
      seed('store'); const r=await session(userA,'qa_normal',"select public.respond_brand_invite('invite',array['unitA','unitB'],'summary',true);"); assert.equal(r.code,0,r.err); assert.equal(sql('select count(*) from brand_units'),'2');
      const retry=await session(userA,'qa_normal',respond().query); assert.notEqual(retry.code,0); assert.match(retry.err,/invite_invalid/); assert.equal(sql('select count(*) from brand_units'),'2');
    });
    await test('wrong invitee and unrelated revoker remain denied', async()=>{
      seed('store'); sql(`update profiles set phone_norm='different' where id=${quote(userB)}`);
      const r=await session(userB,'qa_normal',respond().query); assert.notEqual(r.code,0); assert.match(r.err,/not_invitee/);
      const q=await session(userB,'qa_normal',revoke.query); assert.notEqual(q.code,0); assert.match(q.err,/not_brand_member/); assert.equal(state(),'pending');
    });
    console.log(JSON.stringify({mode:baseline?'RED original RPCs':'GREEN migration RPCs',pass,fail,skipped:0,database:db,boundary:'actual concurrent PostgreSQL RPCs; synthetic tables/auth claims and delay triggers; not HTTP/JWT authentication or full schema integration'}));
  } finally { assert.match(db,/^qa_audit_brand_\d+$/); sql(`drop database ${db};`,'postgres'); console.log('CLEANUP own synthetic database dropped'); }
  if(fail)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
