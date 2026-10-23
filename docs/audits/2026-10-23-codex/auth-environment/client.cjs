// Isolated audit DB only. Never prints JWT, secret, or connection credentials.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const state=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'environment.json'),'utf8'));
function sql(source){const s=state();if(!/^audit_auth_full_\d+$/.test(s.database))throw Error('Non-audit DB refused');return cp.execFileSync('docker',['exec','-i',s.container,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',s.database,'-At'],{input:source,encoding:'utf8',maxBuffer:16*1024*1024});}
function request({method='GET',resource='/',claims=null,body}){
  const s=state();if(!s.httpContainer?.startsWith('audit_auth_rest_'))throw Error('Non-audit HTTP refused');
  if(!resource.startsWith('/')||resource.startsWith('//'))throw Error('Only relative resources permitted');
  const inspected=JSON.parse(cp.execFileSync('docker',['inspect',s.httpContainer],{encoding:'utf8'}))[0];
  const secret=inspected.Config.Env.find(x=>x.startsWith('PGRST_JWT_SECRET=')).slice('PGRST_JWT_SECRET='.length);
  let config=`url = ${JSON.stringify(s.httpBaseInDbContainer+resource)}\nrequest = ${JSON.stringify(method)}\nheader = "Content-Type: application/json"\n`;
  if(claims){
    const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const unsigned=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,...claims});
    const token=unsigned+'.'+crypto.createHmac('sha256',secret).update(unsigned).digest('base64url');
    config+=`header = ${JSON.stringify('Authorization: Bearer '+token)}\n`;
  }
  if(body!==undefined)config+=`data = ${JSON.stringify(JSON.stringify(body))}\n`;
  let output;
  try{output=cp.execFileSync('docker',['exec','-i',s.container,'curl','--silent','--show-error','--config','-','--write-out','\n%{http_code}'],{input:config,encoding:'utf8',maxBuffer:16*1024*1024});}
  catch{throw Error('Audit HTTP transport failed; credential-bearing input suppressed');}
  const split=output.lastIndexOf('\n'),text=output.slice(0,split);let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:Number(output.slice(split+1)),data};
}
module.exports={sql,request};
if(require.main===module){const r=request({resource:'/rpc/auth_unit_id',method:'POST',claims:{sub:'00000000-0000-0000-0000-000000000001'},body:{}});console.log(JSON.stringify({status:r.status,data:r.data}));}
