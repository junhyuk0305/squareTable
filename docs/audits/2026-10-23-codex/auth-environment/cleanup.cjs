const fs=require('fs'),path=require('path'),cp=require('child_process');
const file=path.join(__dirname,'environment.json'),s=JSON.parse(fs.readFileSync(file,'utf8'));
if(!/^audit_auth_full_\d+$/.test(s.database)||s.container!=='supabase_db_SquareTable')throw Error('Cleanup target outside audit scope');
if(s.cleanedAt){console.log('Already cleaned');process.exit(0);}
if(s.httpContainer){
  if(!/^audit_auth_rest_\d+$/.test(s.httpContainer))throw Error('Unexpected HTTP cleanup target');
  cp.execFileSync('docker',['rm','-f',s.httpContainer],{stdio:'pipe'});
}
cp.execFileSync('docker',['exec',s.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',`DROP DATABASE ${s.database};`],{stdio:'pipe'});
s.cleanedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(s,null,2));
console.log('Removed only tracked audit REST container and audit database');
