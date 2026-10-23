const fs=require('fs'),path=require('path'),cp=require('child_process');
const envFile=path.join(__dirname,'../auth-environment/environment.json');
const freshFile=path.join(__dirname,'fresh-final-apply.json');
const env=JSON.parse(fs.readFileSync(envFile,'utf8'));const fresh=JSON.parse(fs.readFileSync(freshFile,'utf8'));
if(env.container!=='supabase_db_SquareTable'||fresh.container!==env.container)throw Error('Unexpected container');
const records=[];
if(!env.cleanedAt){
 if(!/^audit_auth_rest_\d+$/.test(env.httpContainer)||!/^audit_auth_full_\d+$/.test(env.database))throw Error('Unexpected HTTP database cleanup target');
 cp.execFileSync('docker',['rm','-f',env.httpContainer],{stdio:'pipe'});
 cp.execFileSync('docker',['exec',env.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',`DROP DATABASE ${env.database};`],{stdio:'pipe'});
 env.cleanedAt=new Date().toISOString();fs.writeFileSync(envFile,JSON.stringify(env,null,2));records.push({database:env.database,httpContainer:env.httpContainer,cleanedAt:env.cleanedAt});
}
if(!fresh.cleanedAt){
 if(!/^audit_auth_final_apply_\d+$/.test(fresh.database))throw Error('Unexpected fresh database cleanup target');
 cp.execFileSync('docker',['exec',env.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',`DROP DATABASE ${fresh.database};`],{stdio:'pipe'});
 fresh.cleanedAt=new Date().toISOString();fs.writeFileSync(freshFile,JSON.stringify(fresh,null,2));records.push({database:fresh.database,cleanedAt:fresh.cleanedAt});
}
fs.writeFileSync(path.join(__dirname,'cleanup-results.json'),JSON.stringify({at:new Date().toISOString(),records},null,2));console.log(JSON.stringify({cleaned:records.length,sharedDatabasesModified:false}));
