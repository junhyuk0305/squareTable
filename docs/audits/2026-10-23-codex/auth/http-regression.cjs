const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const {sql,request}=require('../auth-environment/client.cjs');
const repo=path.resolve(__dirname,'../../../..');
const phase=process.argv[2];if(!['red','green'].includes(phase))throw Error('Choose red or green');
const env=JSON.parse(fs.readFileSync(path.join(__dirname,'../auth-environment/environment.json'),'utf8'));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const j=source=>{const lines=sql(source).trim().split('\n');return JSON.parse(lines.filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1)??'null');};
const ids=Object.fromEntries(['solo','normal','blocked','staff','closed','closedStaff','onboard','profileless'].map(k=>[k,crypto.randomUUID()]));
const sessions=Object.fromEntries(Object.keys(ids).map(k=>[k,crypto.randomUUID()]));
const prefix='audit_'+phase+'_'+Date.now();
const units={solo:prefix+'_solo',normal:prefix+'_normal',blocked:prefix+'_blocked',closed:prefix+'_closed',kept:prefix+'_kept'};
const fixtures=[];
fixtures.push("insert into public.app_config(key,value) values('billing_free_mode','false') on conflict(key) do update set value='false';");
for(const [name,id] of Object.entries(ids)){
  fixtures.push(`insert into auth.users(id,raw_user_meta_data,raw_app_meta_data) values(${q(id)},'{"name":"Synthetic audit account","role":"owner"}','{}');`);
  fixtures.push(`update public.profiles set created_at='2000-01-01',birth_date='2000-01-01',role=${q(name.toLowerCase().includes('staff')?'junior':'owner')} where id=${q(id)};`);
  fixtures.push(`insert into auth.sessions(id,user_id) values(${q(sessions[name])},${q(id)});`);
}
for(const [name,unit] of Object.entries(units)){
  const owner=ids[name==='kept'?'closed':name];
  fixtures.push(`insert into public.units(id,store_name,owner_id) values(${q(unit)},'Synthetic audit store',${q(owner)});`);
  fixtures.push(`insert into public.unit_members(user_id,unit_id,role) values(${q(owner)},${q(unit)},'owner');`);
  if(name!=='kept')fixtures.push(`update public.profiles set unit_id=${q(unit)},active_unit_id=${q(unit)} where id=${q(owner)};`);
}
fixtures.push(`insert into public.unit_members(user_id,unit_id,role) values(${q(ids.staff)},${q(units.blocked)},'junior'),(${q(ids.closedStaff)},${q(units.closed)},'junior');`);
fixtures.push(`update public.profiles set unit_id=${q(units.blocked)},active_unit_id=${q(units.blocked)} where id=${q(ids.staff)}; update public.profiles set unit_id=${q(units.closed)},active_unit_id=${q(units.closed)} where id=${q(ids.closedStaff)};`);
fixtures.push(`insert into public.owner_kept_unit(owner_id,unit_id) values(${q(ids.closed)},${q(units.kept)});`);
for(const name of ['solo','normal']){
  fixtures.push(`insert into public.playbook_entries(id,unit_id,category,title) values(${q(prefix+'_'+name+'_entry')},${q(units[name])},'audit','Synthetic audit knowhow');`);
  fixtures.push(`insert into public.unit_member_prefs(user_id,unit_id) values(${q(ids[name])},${q(units[name])});`);
}
fixtures.push(`insert into public.brands(id,name) values(${q(prefix+'_brand')},'Synthetic audit brand'); insert into public.brand_members(brand_id,user_id) values(${q(prefix+'_brand')},${q(ids.solo)});`);
fixtures.push(`delete from public.profiles where id=${q(ids.profileless)};`);
fs.writeFileSync(path.join(__dirname,phase+'-fixture.sql'),fixtures.join('\n'));
sql('begin;\n'+fixtures.join('\n')+'\ncommit;');
const claims=name=>({sub:ids[name],session_id:sessions[name]});
const call=(name,fn,body={})=>request({method:'POST',resource:'/rpc/'+fn,claims:claims(name),body});
const get=(name,resource)=>request({resource,claims:claims(name)});
const results=[];
function check(name,expected,actual,ok){results.push({name,expected,actual,pass:!!ok});}
function profile(name){return j(`select json_build_object('deleted',p.deleted_at is not null,'active_unit_id',p.active_unit_id,'banned',u.banned_until>now(),'sessions',(select count(*) from auth.sessions s where s.user_id=p.id),'members',(select count(*) from public.unit_members m where m.user_id=p.id)) from public.profiles p join auth.users u on u.id=p.id where p.id=${q(ids[name])};`);}
function rls(name,table){return j(`begin; set local role authenticated; select set_config('request.jwt.claims',${q(JSON.stringify(claims(name)))},true); select json_build_object('count',count(*)) from public.${table}; rollback;`);}
const start={time:new Date().toISOString(),head:cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),migrationSha:crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'supabase/migrations/0335_deleted_account_access.sql'))).digest('hex')};
let r=get('solo','/playbook_entries?select=id');check('normal own-store read',1,r,r.status===200&&r.data.length===1);
r=get('solo','/playbook_entries?select=id&unit_id=eq.'+units.normal);check('cross-store read denied',0,r,r.status===200&&r.data.length===0);
r=get('solo','/unit_member_prefs?select=user_id');check('own-user RLS baseline',1,r,r.status===200&&r.data.length===1);
const blockedBefore=profile('blocked');r=call('blocked','delete_my_account');const blockedAfter=profile('blocked');
check('owner_has_staff rejects delete','owner_has_staff',r,r.status>=400&&r.data?.message==='owner_has_staff');
check('rejected delete leaves profile/session/membership unchanged',blockedBefore,blockedAfter,JSON.stringify(blockedBefore)===JSON.stringify(blockedAfter));
const lock=j(`select json_build_object('closed',public.unit_access_locked(${q(units.closed)}),'kept',public.unit_access_locked(${q(units.kept)}));`);check('closed store fixture', {closed:true,kept:false},lock,lock.closed&&!lock.kept);
r=call('closed','delete_my_account');check('closed store staff does not trap owner',204,r,r.status===204);
r=call('solo','delete_my_account');check('owner without staff can delete',204,r,r.status===204);
const soloAfter=profile('solo');check('delete clears active store',null,soloAfter,soloAfter.deleted&&soloAfter.active_unit_id===null);check('delete bans Auth user',true,soloAfter,soloAfter.banned===true);check('delete removes Auth sessions',0,soloAfter,soloAfter.sessions===0);
for(const [name,resource] of [['stale JWT knowhow','/playbook_entries?select=id'],['stale JWT own-user prefs','/unit_member_prefs?select=user_id'],['stale JWT own profile','/profiles?select=id']]){r=get('solo',resource);check(name,401,r,r.status===401);}
for(const fn of ['my_units','auth_brand_id']){r=call('solo',fn);check('stale JWT definer '+fn,401,r,r.status===401);}
for(const table of ['playbook_entries','unit_member_prefs','profiles']){r=rls('solo',table);check('direct authenticated RLS '+table,0,r,r.count===0);}
r=get('normal','/playbook_entries?select=id');check('unrelated active account stays normal',1,r,r.status===200&&r.data.length===1);
r=request({resource:'/playbook_entries?select=id',claims:{role:'service_role'}});check('service-role maintenance remains allowed','at least 2 rows',r,r.status===200&&r.data.length>=2);
r=request({method:'POST',resource:'/rpc/quiz_link_open',body:{p_token:'synthetic-nonexistent-token'}});check('anon invalid shared-link result unchanged',200,r,r.status===200);
r=call('onboard','complete_profile',{p_name:'Synthetic onboarding',p_phone:null,p_birth_date:'2000-01-01',p_role:'owner'});check('new user complete_profile',204,r,r.status===204);
r=call('onboard','create_store',{p_store_name:'Synthetic onboarding store',p_industry:'카페',p_biz_no:null});check('new user create_store','200 and invite code',r,r.status===200&&Array.isArray(r.data)&&!!r.data[0]?.invite_code);
r=call('profileless','complete_profile',{p_name:'Synthetic profileless',p_phone:null,p_birth_date:'2000-01-01',p_role:'owner'});check('profileless complete_profile not blocked',204,r,r.status===204);
r=call('profileless','my_units');check('profileless authenticated bootstrap remains empty',[],r,r.status===200&&Array.isArray(r.data)&&r.data.length===0);
const finish={time:new Date().toISOString(),head:cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),migrationSha:crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'supabase/migrations/0335_deleted_account_access.sql'))).digest('hex')};
const report={phase,database:env.database,scope:'Full schema restored, real triggers/RLS, actual PostgREST and signed synthetic JWT. Auth login/refresh not executed.',start,finish,ids,sessions,units,results,failed:results.filter(x=>!x.pass).length};
fs.writeFileSync(path.join(__dirname,phase+'-http-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({phase,scenarios:results.length,failed:report.failed,failures:results.filter(x=>!x.pass)},null,2));
if(report.failed)process.exitCode=1;
