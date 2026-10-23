const fs=require('fs'),path=require('path');const {sql}=require('../auth-environment/client.cjs');
const g=JSON.parse(fs.readFileSync(path.join(__dirname,'green-http-results.json'),'utf8'));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const parse=x=>JSON.parse(x.trim().split('\n').filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));
sql(`insert into storage.buckets(id,name) values('playbook-photos','playbook-photos') on conflict(id) do nothing; insert into storage.objects(bucket_id,name) values('playbook-photos',${q(g.units.solo+'/synthetic.jpg')}),('playbook-photos',${q(g.units.normal+'/synthetic.jpg')});`);
const run=(role,name,query)=>parse(sql(`begin;set local role ${role};select set_config('request.jwt.claims',${q(JSON.stringify({sub:g.ids[name],session_id:g.sessions[name],role}))},true);${query};rollback;`));
const results=[];
for(const name of ['solo','normal']){
 const actual=run('authenticated',name,"select json_build_object('count',count(*)) from storage.objects where bucket_id='playbook-photos'");
 results.push({case:name==='solo'?'deleted account storage direct RLS':'active account own storage direct RLS',expected:name==='solo'?0:1,actual,pass:actual.count===(name==='solo'?0:1)});
}
const cross=run('authenticated','normal',`select json_build_object('count',count(*)) from storage.objects where name=${q(g.units.solo+'/synthetic.jpg')}`);results.push({case:'active cannot read other store storage',actual:cross,pass:cross.count===0});
const prefs=run('authenticated','solo',"with changed as(update public.unit_member_prefs set muted=true returning user_id) select json_build_object('changed',count(*)) from changed");results.push({case:'deleted own-user UPDATE RLS returns no row',actual:prefs,pass:prefs.changed===0});
const gaps=parse(sql("select json_build_object('gaps',coalesce(json_agg(n.nspname||'.'||c.relname),'[]'::json)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and c.relkind in('r','p') and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) and not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname='account_access_allowed' and not p.polpermissive and p.polcmd='*');"));results.push({case:'all targeted RLS tables have restrictive ALL policy',actual:gaps,pass:gaps.gaps.length===0});
const report={at:new Date().toISOString(),scope:'Direct SQL authenticated role without REST pre-request; storage metadata only, no Storage service or file bytes.',results,pass:results.every(x=>x.pass)};
fs.writeFileSync(path.join(__dirname,'direct-rls-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
