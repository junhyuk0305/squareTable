import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here=(r)=>fileURLToPath(new URL(r,import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env={...pe(here('../.env')),...pe(here('../.env.seed'))};
const admin=createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const { data, error } = await admin.rpc('exec_sql', { q: 'x' }).then(r=>r, e=>({error:e}));
console.log('exec_sql 있음?', error ? 'no' : 'yes');
