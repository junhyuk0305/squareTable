const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const repo=path.resolve(__dirname,'../../../..');
const container='supabase_db_SquareTable';
const stateFile=path.join(__dirname,'environment.json');
if(fs.existsSync(stateFile))throw Error('Environment manifest already exists; inspect before creating another DB');
const database=`audit_auth_full_${Date.now()}`;
const docker=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',maxBuffer:64*1024*1024});
const sql=(db,s)=>docker(['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',db,'-At'],s);
const state={createdAt:new Date().toISOString(),database,container,sourceDatabase:'postgres',schemaOnly:true,secretCopied:false};
fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
const dump=docker(['exec',container,'pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-publications','--no-subscriptions']);
fs.writeFileSync(path.join(__dirname,'schema-only.sql'),dump);
state.schemaSha256=crypto.createHash('sha256').update(dump).digest('hex');
state.sourceLedger=sql('postgres','select version from supabase_migrations.schema_migrations order by version;').trim().split('\n');
state.sourceFunctions=sql('postgres',"select proname || '|' || md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname in ('auth_unit_id','auth_member_unit_id','auth_can_manage','auth_brand_id','delete_my_account','quiz_self_servable_wide','quiz_my_last_submissions','quiz_course_live') order by proname;").trim().split('\n');
fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
sql('postgres',`create database ${database};`);
state.databaseCreated=true;fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
try {
  const output=sql(database,dump);fs.writeFileSync(path.join(__dirname,'restore.log'),output);
  state.restored=true;
  for(const name of fs.readdirSync(path.join(repo,'supabase/migrations')).filter(n=>/^033[1-4]_.*\.sql$/.test(n)).sort()){
    const source=fs.readFileSync(path.join(repo,'supabase/migrations',name),'utf8');
    if(/\bALTER\s+ROLE\b|\bcron\s*\.\s*schedule\b|\bnet\s*\.\s*http_/i.test(source))throw Error('Global/external action found in '+name);
    const result=sql(database,source);
    fs.writeFileSync(path.join(__dirname,name+'.log'),result);
    (state.appliedMigrations??=[]).push({name,sha256:crypto.createHash('sha256').update(source).digest('hex')});
    fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  }
  state.objects=sql(database,"select 'tables='||count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'; select 'rls_policies='||count(*) from pg_policy; select 'user_triggers='||count(*) from pg_trigger where not tgisinternal; select 'auth_users='||count(*) from auth.users;").trim().split('\n');
  state.ready=true;
}catch(e){state.error='Restore/application failed; see sanitized terminal diagnostics';throw e;}
finally {fs.writeFileSync(stateFile,JSON.stringify(state,null,2));}
console.log(JSON.stringify({database,ready:state.ready,objects:state.objects,sourceLedgerLast:state.sourceLedger.slice(-5),appliedMigrations:state.appliedMigrations?.map(x=>x.name)},null,2));
