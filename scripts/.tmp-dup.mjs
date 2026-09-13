// 임시 — 게스트가 같은 문항을 반복 제출하면 그대로 적히는가(중복 증폭·점수 조작).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here=(r)=>fileURLToPath(new URL(r,import.meta.url));
function pe(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env={...pe(here('../.env')),...pe(here('../.env.seed')),...process.env};
const URL_=env.EXPO_PUBLIC_SUPABASE_URL, ANON=env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const admin=createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const owner=createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
const guest=createClient(URL_,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
const id=(p)=>`${p}_dup${String(Date.now()).slice(-8)}`;
const tok=()=>(globalThis.crypto?.randomUUID?.()??`t${Date.now()}`).replace(/[^a-z0-9]/gi,'');
const { data: auth, error: aErr } = await owner.auth.signInWithPassword({ email: env.QA_EMAIL ?? 'qa.owner@example.com', password: env.QA_PASSWORD ?? 'QaTest1234!' });
if (aErr) { console.error('로그인 실패', aErr.message); process.exit(2); }
const uid=auth.user.id;
const { data: prof } = await owner.from('profiles').select('unit_id').eq('id',uid).maybeSingle();
const UNIT=prof.unit_id, now=new Date().toISOString();
const entryId=id('pb'), courseId=id('tc'), itemId=id('qz'), linkId=id('ql'), tk=tok();
const cleanup=[];
try{
  await owner.from('playbook_entries').insert({ id:entryId, unit_id:UNIT, creator_id:uid, creator_name:'QA사장', category:'Know-how', subcategory:'일반', title:'중복검증', tags:[], search_keywords:['중복'], square:{ situation:'마감 때 가스 밸브를 잠가요.', action:{steps:[]}, extract:{do:'',dont:''}, result:{before:'',after:'',metric:''}, uncover:'', quagmire:'' }, execution:{tone:'친절',timing:'필요할 때',channel:'구두',stakeholders:[]}, stats:{thumbs_up:0,thumbs_down:0,last_used_at:now,query_hits_30d:0,resolution_rate:0}, photos:[], version:1, status:'published', quality_score:0.6, created_at:now, updated_at:now, is_template:false, pack_id:null, needs_review:false, correction_points:[], section:null, order_index:0 });
  cleanup.push(()=>owner.from('playbook_entries').delete().eq('id',entryId));
  await owner.from('training_courses').insert({ id:courseId, unit_id:UNIT, key:`q_${courseId}`, name:'중복 검증', description:null, preset:null, min_items:1, max_items:10, due_days:null, start_at:null, answer_days:null, position:0, active:true });
  cleanup.push(()=>owner.from('training_courses').delete().eq('id',courseId));
  await owner.from('course_entries').insert({ course_id:courseId, entry_id:entryId, unit_id:UNIT });
  cleanup.push(()=>owner.from('course_entries').delete().eq('course_id',courseId));
  await owner.from('quiz_items').insert({ id:itemId, unit_id:UNIT, entry_ids:[entryId], kind:'t3', format:'mc4', payload:{ ask:'무엇을 잠그나요?', choices:['가스 밸브','창문','냉장고'], answer_index:0, explain:'가스 밸브.' }, status:'active', source:'owner', created_by:uid, created_at:now, source_updated_at:now });
  cleanup.push(()=>owner.from('quiz_items').delete().eq('id',itemId));
  await owner.from('quiz_links').insert({ id:linkId, course_id:courseId, unit_id:UNIT, token:tk, expires_at:new Date(Date.now()+86400000).toISOString(), revoked_at:null, created_at:now, created_by:uid });
  cleanup.push(()=>owner.from('quiz_links').delete().eq('id',linkId));

  // ★코스에 문항은 **1개**뿐이다. 같은 id 를 200번 보낸다.
  const answers = Array.from({length:200},()=>({ item_id:itemId, response:{ choice:0 } }));
  const { data, error } = await guest.rpc('quiz_link_submit', { p_token:tk, p_guest_name:'중복검증', p_guest_phone:null, p_phone_verified:false, p_answers:answers });
  console.log('  제출 반환(적힌 행 수) =', data, error?.message ?? '');
  const { count } = await admin.from('quiz_attempt_items').select('id',{count:'exact',head:true}).eq('item_id',itemId);
  const { data: att } = await admin.from('quiz_attempts').select('total,correct,guest_name').eq('course_id',courseId);
  console.log('  quiz_attempt_items 실제 행 수 =', count);
  console.log('  quiz_attempts =', JSON.stringify(att));
  console.log('');
  console.log(count > 1 ? `  🚨 문항 1개짜리 퀴즈인데 ${count}행이 적혔다 — 중복이 그대로 들어간다` : '  OK 중복이 걸러진다');
  if (att?.[0]) console.log(att[0].total > 1 ? `  🚨 사장 화면 점수 = ${att[0].correct}/${att[0].total} (실제 문항 1개)` : '  OK 점수 정상');
  await admin.from('quiz_attempt_items').delete().eq('item_id',itemId);
  await admin.from('quiz_attempts').delete().eq('course_id',courseId);
} finally { for (const c of cleanup.reverse()) { try{ await c(); }catch{} } }
