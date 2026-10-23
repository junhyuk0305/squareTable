import { localEnv } from './qa-local-target.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
if (!process.argv.includes('--local')) throw Error('--local required');
const env = {...process.env, ...localEnv()};
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const fixed=[['44eb0c73-f736-4015-a3f0-1daf2fab4d41','owner@pilot.squaretable.app','owner'],['fb3e772d-848d-49f8-930e-ad59e57245f5','staff@pilot.squaretable.app','junior']];
await db.from('units').upsert({id:'store_001',store_name:'Local pilot',industry:'cafe',invite_code:'482193'}).throwOnError();
for(const [id,email,role] of fixed){
  const existing=await db.auth.admin.getUserById(id);
  if(!existing.data.user){
    const {error}=await db.auth.admin.createUser({id,email,password:'pilot1234',email_confirm:true,user_metadata:{role,unit_id:'store_001',name:email.split('@')[0]}});
    if(error)throw error;
  }
  await db.from('profiles').update({unit_id:'store_001',active_unit_id:'store_001',role}).eq('id',id).throwOnError();
  await db.from('unit_members').upsert({unit_id:'store_001',user_id:id,role},{onConflict:'unit_id,user_id'}).throwOnError();
}
await db.from('units').update({owner_id:fixed[0][0]}).eq('id','store_001').throwOnError();
await db.from('work_rooms').upsert({id:'room_main_store_001',unit_id:'store_001',name:'전체',is_default:true}).throwOnError();
const entries=JSON.parse(readFileSync('src/data/playbook-entries.json','utf8'));
await db.from('playbook_entries').upsert(entries.map(e=>({...e,unit_id:'store_001',creator_id:fixed[0][0]}))).throwOnError();
const empty = join(mkdtempSync(join(tmpdir(),'c-local-seed-')), 'empty.env');
writeFileSync(empty,'');
let failed=0;
for (const [file,args] of [['seed-demo.mjs',[empty]],['seed-brand-demo.mjs',[]],['qa-local-accounts.mjs',[]]]) {
  const result=spawnSync(process.execPath,['scripts/'+file,...args],{env,encoding:'utf8',timeout:120000});
  console.log(file, 'exit', result.status, result.stdout, result.stderr);
  if(result.status!==0) failed++;
}
process.exitCode=failed?1:0;
const {data:staff}=await db.from('profiles').select('id,role').eq('unit_id','store_001').throwOnError();
for(const p of staff??[]) await db.from('unit_members').upsert({unit_id:'store_001',user_id:p.id,role:p.role},{onConflict:'unit_id,user_id'}).throwOnError();
