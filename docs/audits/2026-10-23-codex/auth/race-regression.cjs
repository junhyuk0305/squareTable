const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {sql}=require('../auth-environment/client.cjs');
const env=JSON.parse(fs.readFileSync(path.join(__dirname,'../auth-environment/environment.json'),'utf8'));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
function session(name){
  const child=cp.spawn('docker',['exec','-i','-e','PGAPPNAME='+name,env.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',env.database,'-At'],{stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const ended=new Promise(resolve=>child.on('exit',code=>resolve({code,output})));
  return {child,ended,get output(){return output;}};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const deadline=Date.now()+10000;while(Date.now()<deadline){if(predicate())return;await wait(50);}throw Error('Timed out: '+label);}
async function run(firstAction){
  const owner=crypto.randomUUID(),staff=crypto.randomUUID(),sid=crypto.randomUUID(),unit='audit_race_'+Date.now();
  sql(`begin;
    insert into auth.users(id,raw_user_meta_data,raw_app_meta_data) values(${q(owner)},'{"role":"owner"}','{}'),(${q(staff)},'{"role":"junior"}','{}');
    update public.profiles set created_at='2000-01-01',birth_date='2000-01-01' where id in (${q(owner)},${q(staff)});
    insert into public.units(id,store_name,owner_id) values(${q(unit)},'Synthetic race store',${q(owner)});
    insert into public.unit_members(user_id,unit_id,role) values(${q(owner)},${q(unit)},'owner');
    update public.profiles set role='owner',unit_id=${q(unit)},active_unit_id=${q(unit)} where id=${q(owner)};
    update public.profiles set pending_unit_id=${q(unit)} where id=${q(staff)};
    insert into auth.sessions(id,user_id) values(${q(sid)},${q(owner)}); commit;`);
  const prefix=`begin; set local statement_timeout='12s'; set local role authenticated; select set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,session_id:sid}))},true);\n`;
  const actions={delete:'select public.delete_my_account();',approve:`select public.approve_member(${q(staff)});`};
  const next=firstAction==='delete'?'approve':'delete';
  const a=session(unit+'_first'),b=session(unit+'_second');
  try {
    a.child.stdin.write(prefix+actions[firstAction]+'\n\\echo AUDIT_READY\n');
    await until(()=>a.output.includes('AUDIT_READY'),'first transaction barrier');
    b.child.stdin.end(prefix+actions[next]+'\ncommit;\n');
    await until(()=>sql(`select exists(select 1 from pg_stat_activity where application_name=${q(unit+'_second')} and wait_event_type='Lock');`).trim()==='t','second transaction blocked on real DB lock');
    a.child.stdin.end('commit;\n');
    const [ar,br]=await Promise.all([a.ended,b.ended]);
    const state=JSON.parse(sql(`select json_build_object('ownerDeleted',(select deleted_at is not null from public.profiles where id=${q(owner)}),'staffMember',exists(select 1 from public.unit_members where user_id=${q(staff)} and unit_id=${q(unit)}),'pending',(select pending_unit_id from public.profiles where id=${q(staff)}));`).trim());
    const pass=ar.code===0&&br.code!==0&&(firstAction==='delete'?state.ownerDeleted&&!state.staffMember&&br.output.includes('invalid_unit'):!state.ownerDeleted&&state.staffMember&&br.output.includes('owner_has_staff'));
    return {firstAction,secondAction:next,barrier:'second request observed Lock wait before first commit',first:ar,second:br,state,pass};
  }finally{a.child.stdin.end();b.child.stdin.end();}
}
(async()=>{const results=[await run('delete'),await run('approve')];const report={at:new Date().toISOString(),database:env.database,scope:'Real functions, full schema, two SQL transactions with observed row-lock barrier. HTTP pre-request not used in these transactions.',results,pass:results.every(x=>x.pass)};fs.writeFileSync(path.join(__dirname,'race-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;})().catch(e=>{console.error(e.message);process.exitCode=1;});
