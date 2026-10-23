const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const file=path.join(__dirname,'environment.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
if(!state.ready||state.httpContainer)throw Error('DB not ready or HTTP already configured');
const inspect=name=>JSON.parse(cp.execFileSync('docker',['inspect',name],{encoding:'utf8'}))[0];
const original=inspect('supabase_rest_SquareTable');
const vars=Object.fromEntries(original.Config.Env.map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
if(!vars.PGRST_DB_URI)throw Error('No local REST database connection configured');
const uri=new URL(vars.PGRST_DB_URI);uri.hostname='127.0.0.1';uri.pathname='/'+state.database;
const secret=crypto.randomBytes(48).toString('base64url');
const name='audit_auth_rest_'+Date.now();
const args=['run','-d','--name',name,'--network','container:'+state.container,'--env','PGRST_DB_URI='+uri.toString(),'--env','PGRST_DB_SCHEMAS=public','--env','PGRST_DB_ANON_ROLE=anon','--env','PGRST_JWT_SECRET='+secret,'--env','PGRST_SERVER_HOST=127.0.0.1','--env','PGRST_SERVER_PORT=13023','--env','PGRST_LOG_LEVEL=error',original.Config.Image];
try {cp.execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
catch {throw Error('Isolated REST launch failed; credentials suppressed');}
state.httpContainer=name;state.httpBaseInDbContainer='http://127.0.0.1:13023';state.httpSecretSource='audit HTTP container environment only; generated locally, no production secret';
fs.writeFileSync(file,JSON.stringify(state,null,2));
console.log(JSON.stringify({httpContainer:name,httpBaseInDbContainer:state.httpBaseInDbContainer,externalPortPublished:false}));
